# 0191 — Multi-wash support: wash_cycles model shift

**Date:** 2026-09-15
**Branch:** `multi-wash-support`
**Supersedes/extends:** 0090 (2026-07-28, "Lab moves inside Moyka, wash-cycle concept
removed" — established `wash_cycles` as one row per serial, lab-linkage-only),
190 (2026-09-15, "mint_serial_from_sources partial-consumption eligibility fix" —
the earlier, narrower fix that surfaced this problem).

## Trigger

A user report: three serials (`290726-068`/P1, `290726-069`/P2, `290726-072`/P4,
all Subxon/Global Export Company) had a small raw remainder sent to Moyka today
(2026-09-15: 92/29/36 kg respectively) that never appeared in Ombor's "Moykada"
window. Investigation traced it to `wash_cycles.closed_at`: all three serials'
single `wash_cycles` row was closed on 2026-08-29 (a bulk backfill run when the old
manual Tugallash system was retired — see 0090/0086), each with a small pre-existing
realized loss already booked (50/45/53 kg, `final_loss_pct` 2.24/2.22/2.27%,
confirmed against the stored column, not recomputed). `isInMoyka()` excludes any
closed serial "regardless of its residual," by design — that design assumed a
serial's wash story, once closed, was permanently over.

The immediate fix considered — clearing `closed_at` on the three rows — was rejected.
Every consumer of `wash_cycles` (`yield_rows` chief among them) sums
`moyka_sends`/`finished_pallets` for the **whole serial's lifetime**, not scoped to a
wash. Clearing `closed_at` would have retroactively folded each serial's
already-realized, already-reported loss (2.24/2.22/2.27%) back into "still in
process" the instant the new send's activity touched those totals — corrupting
historical figures already shown in Hisobot, the Rahbar Yield tab, and client
reports. This is the same class of leak CLAUDE.md's origin-filtering rules exist to
prevent, just retroactive instead of forward-leaking.

## Decision

`wash_cycles` becomes one row per **wash of one portion** of a serial, not one row
per serial for its whole life. A serial that gets a genuine second raw-material send
after its first wash closes gets `wash_no=2`, not a reopened `wash_no=1`.

- Schema (`0124_wash_cycles_multi_wash_schema.sql`): `wash_no int not null default 1`
  on `wash_cycles`; composite unique `(serial, wash_no)` replaces the old
  single-column unique; a partial unique index `(serial) where closed_at is null`
  enforces at most one open wash per serial, ever. `moyka_sends.wash_no` (NOT NULL —
  never exists without a `wash_cycles` row). `finished_pallets.wash_no` (**nullable**,
  deliberately — see below).
- New-wash gate: `open_or_continue_wash(p_serial)` (RPC, `0125`) — opens `wash_no=N+1`
  only when wash N is closed and `stock_on_hand_rows`'s own raw-remainder figure for
  that serial is still positive. Replaces `OmborMoykaTab.tsx`'s raw client-side
  `wash_cycles` upsert, which both breaks (targets the now-gone single-column unique)
  and can't enforce the gate (needs a row lock + a real balance read).
- Every read path keyed on `wash_cycles.serial` alone (RLS hard gate, ~13 RPCs/views,
  the two client-facing report functions) rewritten to resolve the *specific*
  relevant wash — either via `finished_pallets.wash_no`/`moyka_sends.wash_no` for
  pallet/send-level joins, or via "the currently open wash" for live-balance
  aggregates, or via "every wash that closed in period X" for period-scoped realized
  loss. Full inventory, per-object verdicts, and the SQL itself are in `0125`,
  `0127` (`get_client_report`), and the `rahbar_dashboard_ledger` follow-up.

## Deliberate deviations from the original brief

1. **`finished_pallets.wash_no` stays nullable, not `NOT NULL`.** `finished_pallets`
   is shared with the not-yet-shipped Rezka cutting line (`rezka_cycles`, not
   `wash_cycles` — see `0076_rezka_data_layer.sql`; the live
   `finished_pallets_ombor_writes` RLS policy already carries the Rezka OR-branch,
   confirmed in production even though Rezka stage 2 hasn't built). A Rezka pallet
   never has a `wash_cycles` row (`prevent_dual_process_serial` guarantees a serial
   can never have both). Forcing `NOT NULL` here would either fail outright the
   first time a real Rezka pallet is inserted, or silently mis-tag it as wash-1
   Moyka output. `NULL` = "not Moyka-wash output." 0 Rezka pallets exist today
   (confirmed live) — a no-op now, the correct guard once Rezka ships.
2. **`client_serial_loss_kg` preserves its original `NULL`-when-nothing-closed-yet
   contract** rather than collapsing to `0` — audited across the whole batch for the
   same NULL-vs-zero mistake (`client_serial_moyka_kg` needed the same audit; its
   original contract was "always numeric, never null," which an early draft
   accidentally broke by returning NULL when no wash is currently open — caught and
   fixed before this landed).
3. **`kirim_line_loss_range`/`kirim_line_moyka_asof` keep their scalar signature.**
   They feed a generic report-grid column (`reportColumns.ts`) — one cell per
   serial. Turning them into per-wash sets (matching the "list each wash on its own
   row" spirit applied to the passport/client report) would need the grid itself
   redesigned to a row-per-wash shape. Flagged as a named follow-up, not decided
   unilaterally here.
4. **`yield_rows` now returns multiple rows per serial** for a multi-wash serial
   (one per closed wash) — this is the correct fix for the retroactive-corruption
   bug above, but it means Hisobot and the Rahbar Yield tab will show 2 rows where
   they showed 1. Decision on display (wash-number badge per row vs. an expandable
   per-serial breakdown) deferred to the frontend batch, in context.

## Scope note — this is much larger than a 3-serial display bug

An initial task brief for this work cited "nine sites patched during Rezka stage 1"
per a "2026-08-15 note in DECISIONS.md." That citation does not check out:
`docs/DECISIONS.md` holds no entries by design (see its own pointer note); the
closest real document, `0126-2026-08-16-rezka-data-layer-design-not-applied.md`, is
dated 2026-08-16 (not 08-15), is about the Rezka cutting-line data layer (a
different subsystem), and its own title states its migration was a dry run,
rolled back, never applied. The actual scope of this change was established by a
fresh, direct inventory against the live database (`pg_get_functiondef`/
`pg_get_viewdef`), not from that citation — **~21 objects** (13 SQL in this
migration series' first batch, `get_client_report` and `rahbar_dashboard_ledger` as
their own follow-up commits for the `client_lines`/`client_washes`-style split
their period-scoped realized-loss calculations need, and 8 frontend/test modules),
not the 4 report surfaces originally named.

## Data migration

`0126_wash_cycles_multi_wash_data_p1_p2_p4.sql` opens wash 2 for the three live
serials, gated behind an explicit "DO NOT APPLY YET" banner — stays unapplied until
the schema, SQL batch 1, `get_client_report`, `rahbar_dashboard_ledger`, and the
frontend batch are all reviewed and merged to `main`. This means P1/P2/P4 remain
visibly broken in the live app for the duration of this review, rather than getting
a partial fix that depends on unmerged code paths (several of the "NEEDS CHANGE"
objects, `yield_rows` foremost, would misreport these exact three serials if the
data migration landed ahead of the report-layer fixes).

Stated exception to "never mutate, only append" (CLAUDE.md workflow rule): this is
a one-time backfill making the new schema match reality for rows that predate it,
not a routine data correction.

## Follow-ups tracked, not bundled here

- `wash_cycles` → `washes` rename (naming now reads oddly given the model — a
  deliberate, separate change, not bundled with this one to keep the diff
  reviewable).
- `reportColumns.ts`'s generic grid redesign for per-wash rows (item 3 above).
- `yield_rows`'s multi-row-per-serial display decision in Hisobot/Rahbar Yield tab
  (item 4 above) — to be decided in the frontend batch, in context.
