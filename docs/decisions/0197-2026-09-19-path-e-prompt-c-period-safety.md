# Path E prompt (c) — period-safety pass

## What this is

The follow-up to `docs/decisions/0196` this same session flagged as
outstanding: every loss/moyka consumer that reads `wash_cycles`/
`moyka_sends`/`finished_pallets` **per period or as-of-a-date**, not just
per serial, made cycle-aware — so a past-period report stays byte-stable
after a second Moyka cycle is exercised on a serial (residual-reprocess for
`290726-068/069/072`, the incident this whole Path E arc traces back to).
`0196` fixed the cycle-scoped *serial-level* functions
(`client_serial_loss_kg`/`kirim_line_state`); this migration
(`0127_path_e_prompt_c_period_safety.sql`) fixes everything downstream that
reads *ranges* of dates or *as-of* a date, which none of `0196`'s fixes
covered.

Applied 2026-09-19, after Abdulloh's explicit confirmation of the full
migration SQL, the before/after sample comparisons, and the inventory
cross-check findings (all presented and confirmed in-session before
`apply_migration` ran).

## Functions rewritten

All bounded by each cycle's own `[opened_at, next_opened_at)` window —
never `closed_at`, for the same reason `0196` settled on it: `closed_at` is
"when Yakunlash was clicked," not "when the next cycle's material actually
started arriving" (the same-day close-then-reopen bug class `0196`
documents in its own "second bug" section).

1. **`kirim_line_loss_asof(serial, p_to)`** — new. Cumulative realized loss
   across every cycle closed by `p_to`, each window-bounded. Feeds
   `client_serial_ledger`'s new `poteryaKg`.
2. **`kirim_line_loss_range(serial, p_from, p_to)`** — rewritten to sum only
   cycles whose `closed_at` falls in `[p_from, p_to]`, each independently
   window-bounded. **This was a real, live bug, not just a risk**: the old
   body called `client_serial_loss_kg` unconditionally whenever *any* cycle
   closed in range — and after `0126`, `client_serial_loss_kg` sums *every*
   closed cycle ever, lifetime. The moment a serial had two cycles, a
   period query touching either one would return the *combined* lifetime
   loss, silently pulling an earlier period's already-reported figure into
   a later period's report.
3. **`kirim_line_moyka_asof(serial, p_to)`** — rewritten. The old body was
   `exists(closed_at is not null and closed_at <= p_to) -> 0`, which stayed
   `true` permanently once *any* cycle had closed by `p_to`, even while a
   genuinely active *later* cycle existed. New body: find the cycle active
   at `p_to` (latest cycle with `opened_at <= p_to`); 0 if none or if it's
   closed by `p_to`; else that cycle's own window-bounded sent-minus-output
   gap.
4. **`kirim_line_moyka_range`** — **confirmed on inspection to need no
   change.** Read live via `pg_get_functiondef` before touching anything:
   it has no `closed_at` gating at all — `to_moyka_kg`/`from_moyka_kg` are
   pure period-flow sums (how much moved during `[p_from,p_to]`),
   legitimately cycle-agnostic by construction, same as `moyka_sends`'
   event-log nature. The task's own premise that it shared
   `kirim_line_moyka_asof`'s bug did not hold — flagged rather than
   silently "fixed" without cause.
5. **`get_client_report(owner, p_from, p_to)`** — `client_lines`'
   `wash_cycles` join changed from a plain join (fans out one row per
   cycle under multi-cycle, corrupting every downstream sum that reads
   `wash_cycle_id`) to a `LATERAL … order by cycle_no desc limit 1`
   latest-cycle subquery, used only for display fields
   (`quality_record.delivered_lab`, `completed_date`). The real loss/moyka
   figures (`loss_totals`/`loss_output`/`capped_by_serial`/
   `moykada_total`) no longer read that field at all — new `cycles_all`
   CTE (one row per real `(serial, cycle)` pair, each with its own
   `lead(opened_at)`-derived window) drives them, so a serial with two
   cycles closing inside the same wide reporting period correctly
   contributes two independent, separately-windowed rows.
6. **`rahbar_dashboard_ledger(p_from, p_to, p_scope)`** — same
   LATERAL-latest-cycle fix for the plain `closed_at` display field; new
   `cycles_all`/`active_cycle_at_to`/`active_cycle_before_from` CTEs drive
   `moyka_in_process`/`moyka_opening_total` (same active-cycle rule as
   `kirim_line_moyka_asof`, evaluated at `p_to` and `p_from` respectively).
   `processed_lines.sent_capped_kg`'s base sum now reads the active-at-
   `p_to` cycle's own window-bounded sends (capped at `effective_qty`); the
   pre-existing `0108` open-cycle subtraction is unchanged in shape.
7. **`client_serial_ledger(p_from, p_to, type)`** — replaced the old single
   `is_final`/`gap_kg` pair (an existence check with **no `p_to_date` bound
   at all**, and an unbounded whole-serial gap once true) with
   `kirim_line_moyka_asof` (→ `vPererabotkeKg`) and the new
   `kirim_line_loss_asof` (→ `poteryaKg`) — both already cycle-correct by
   construction. Under multi-cycle these can now legitimately both be
   non-zero at once (a closed cycle's booked loss and a later open cycle's
   own in-process balance are not mutually exclusive, unlike the old
   single-gap design). **Deliberate display change**: `vPererabotkeKg` now
   reads `0` (never `null`) when nothing is in process, matching
   `kirim_line_moyka_asof`'s own convention — the old code rendered `null`
   in that case, mutually exclusive with `poteryaKg`. Flagging this since
   it's a visible frontend behavior change, not purely internal.

## Two more found by the cross-check, beyond the named six

Re-ran the `pg_proc`/`pg_views` inventory technique `0196` used. Found two
more functions with the identical structural bug as `kirim_line_moyka_asof`
pre-fix — a raw `wash_cycles` join (fans out under multi-cycle) gated only
on "does any open cycle exist," with no date bound on `sent_kg`/`output_kg`
at all:

8. **`client_panel_summary()`** — client-portal home screen's stock
   summary. Neither this nor the next function takes a date parameter of
   its own (both are implicitly "right now"); both now delegate to
   `kirim_line_moyka_asof(serial, current_date)`.
9. **`rahbar_stock_snapshot(p_scope)`** — Rahbar's own stock snapshot, same
   fix, same delegation.

Also found, a related but distinct bug (not the leak/zero-out pattern, an
earliest-send-date error):

10. **`lab_turnaround_avg()`** — earliest send bound tightened to
    `>= wc.opened_at` per cycle, was whole-serial earliest-ever send. A
    cycle 2 lab result would previously have measured turnaround against
    cycle 1's old send date, inflating the average.

No other function reads unbounded `sum(moyka_sends)`/`sum(finished_pallets)`
per serial — confirmed by the same inventory search. `get_serial_passport`
and `yield_rows` (prompt b) untouched, as instructed.

## Before/after verification (byte-identical for single-cycle data)

Done via shadow `_v2` functions, diffed against live production with
full-JSONB equality (`old(...) = new(...)`, not field-by-field) across 3
owners and multiple periods/scopes, dropped after verification:

- `get_client_report` — byte-identical. One pre-existing gap closed as a
  side effect, not a regression: `byType`'s `jsonb_agg` had no `ORDER BY`
  in *either* version — confirmed via a separate `order by
  elem->>'typeId'` comparison that the underlying values were always
  identical, array position only. Added `order by rt.type_id` for
  determinism.
- `rahbar_dashboard_ledger` — **caught a real bug during this
  verification, before it ever shipped**: an early draft of
  `moyka_opening_total`'s inclusion condition had an inverted comparison
  (`< p_from` where it needed to be `>= p_from` — the original's rule was
  "exclude/zero-out ONLY when `closed_at < p_from`, include otherwise").
  Diffing against production for `2026-09-01`–`2026-09-19` showed
  `openingKg` reading `0` instead of the correct `24030`, with
  `residualKg` off by the same amount. Fixed; re-verified byte-identical
  across 8 scope/period combinations including the `chart` field. Confirmed
  live post-apply: `rahbar_dashboard_ledger('2026-09-01', today,
  'hammasi') -> moykadaSnapshot -> openingKg` reads `24030`.
- `client_serial_ledger`, `client_panel_summary`, `rahbar_stock_snapshot`,
  `lab_turnaround_avg` — verified via targeted value comparisons against
  real serials. `client_panel_summary` is `SECURITY DEFINER` +
  `my_owner_id()`-scoped, uncallable directly via the MCP/superuser
  connection — relied on its structural identity to the independently
  shadow-verified `rahbar_stock_snapshot` fix (same bug, same delegation
  target) instead.
- All 8 rewritten functions re-checked live immediately after
  `apply_migration`: run without error against real production data, and
  `290726-068` (single-cycle, closed, post-`0195`-cleanup) reads
  `kirim_line_loss_asof = 50`, `kirim_line_loss_range('2026-01-01', today)
  = 50`, `kirim_line_moyka_asof(today) = 0` — matching the values `0195`/
  `0196` already established for this serial this session.

## Playwright

`tests/e2e/path-e-multi-cycle-residual-reprocess.spec.ts` extended with one
new test covering the exact regressions this migration targets: cycle 1 is
closed for real then backdated (service client, same RLS-bypass pattern the
suite's own audit_log teardown already uses) into a fixed August window;
cycle 2 is opened and closed for real, landing in September. Asserts, via
direct RPC calls:

- `kirim_line_loss_range` for August-only (40), September-only (null before
  cycle 2 closes / 10 after), and the full August–September span (50) —
  the exact leak `kirim_line_loss_range` had via `client_serial_loss_kg`'s
  unconditional lifetime sum.
- `kirim_line_moyka_asof` mid-cycle-2 (sent 200, received 0 yet → 200, not
  the old permanent 0), and confirms August's own 40kg figure is
  unchanged by cycle 2 existing at all — checked both mid-cycle-2 and
  again after cycle 2 closes, so the "already-reported period never moves"
  invariant is proven at two different points, not just at the end.
- `kirim_line_loss_asof` as-of August-only (40, before cycle 2 exists) and
  as-of today (50, both cycles closed).
- `client_serial_ledger`, logged in as the `CLIENT` test role: the fixture
  serial's own row reads `poteryaKg = 50`, `vPererabotkeKg = 0` — proves
  the new asof-based columns wire through end to end for a real owner-
  scoped, period-scoped report call.

**Scope note, deliberately narrower than a full-suite rewrite**:
`get_client_report`/`rahbar_dashboard_ledger`/`rahbar_stock_snapshot`/
`client_panel_summary` were not given exact-value Playwright assertions.
They read across an owner's or the whole project's entire line set, not
just one fixture serial — an exact-value assertion on them would be
comparing against unrelated real production data and would break the
moment that data changes elsewhere. Those four were verified instead via
the live shadow-function diffing described above, during the migration's
own before/after step — the same rigor, just not encoded as a Playwright
assertion.

**Not run in this session — no `.env.test` present**, the same standing
limitation `0196` and every other Playwright suite in this project
documents (see `docs/decisions/0028` "Step 7 testing infra"). The
arithmetic the new test encodes was instead verified directly via MCP SQL
calls against the live schema before and after `apply_migration`, as
described in "Before/after verification" above.

## Plain-language walkthrough (of the live MCP verification, since Playwright didn't run)

Checked the three period-reading functions directly against a real,
already-closed serial (`290726-068`) right after the migration went live:
asked "how much loss happened between January and today" and got 50kg —
the same number this serial has read all session, confirming the rewrite
didn't move anything for a serial that only ever had one cycle. Asked "is
anything still in the wash for this serial as of today" and got 0 —
correct, since it's fully closed. Then checked the one real bug this pass
caught before it ever reached the live database: asked the dashboard ledger
function "how much raw material was already in the wash at the start of
September" for the whole company, and an early draft answered 0kg; the
correct answer, confirmed by re-deriving it from the underlying
`moyka_sends`/`finished_pallets` rows by hand, was 24,030kg. Fixed the
comparison direction that was causing it, re-asked the same question, got
24,030kg, and re-checked it stayed exactly the same across eight different
combinations of date range and company-scope filter before trusting it
enough to ship. After applying the real migration to the live database,
asked that same September question one more time directly — it still reads
24,030kg, confirming the fix is actually live and not just correct in a
disposable test copy.

## Out of scope, deliberately not touched

- `get_serial_passport`'s `cycles` array, `yield_rows`' grain — prompt (b),
  explicitly excluded per instruction.
- Any UI — this is a pure backend/reporting-function pass, no screen
  changes.
- `moyka_sends`/`finished_pallets`/`wash_cycles` schema — unchanged; this
  migration only rewrites function bodies.

## Related

- `docs/decisions/0196` — the multi-cycle schema/RPC build this migration
  completes the period-safety half of; see its own "Downstream consumers
  still on lifetime sums" section for the original flag that named these
  three Hisobot functions as carrying real bug risk.
- `docs/decisions/0195` — the phantom-`moyka_sends` cleanup for
  `290726-068/069/072` that started this whole investigation thread; this
  migration is the last blocker the task named before residual-reprocess
  can safely run on those three serials.
