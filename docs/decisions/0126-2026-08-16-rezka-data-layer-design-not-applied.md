## 2026-08-16 — Rezka data layer: design, not applied

**Context.** First real build step for the Rezka cutting line, following the read-only readiness
investigation the same day. Task: design the data layer (calibre separation, send/completion
tracking, the Barcode #2 gate, mint callers for both inside sources, a surplus audit, provenance)
and resolve one loose thread from the investigation — a documented-but-uncaptured RLS policy.
Branch `rezka-data-layer` off `main`. Read/design only: exact SQL shown and dry-run-verified
against production inside a rolled-back transaction, nothing applied for real. Explicitly out of
scope: Ombor UI, the Rezka reporting section (stages 2/3), Hisobot/nav/tara branches.

**The missing migration — resolved.** Checked the live database directly rather than trusting the
prior investigation's inference. `pg_policies` confirms the `wash_cycles` `ombor_updates` policy's
`with_check` already carries the finalize-verdict branch DECISIONS.md's 2026-08-14 entry describes,
byte-identical. `supabase_migrations.schema_migrations` confirms it as a real applied migration —
version `20260813141859`, name `wash_cycles_finalize_lab_gate` — applied via the MCP
`apply_migration` tool directly, never pulled down into `supabase/migrations/` afterward. Its
`statements` column holds the exact original SQL, comments included, byte-for-byte reproduced in
`supabase/migrations/0074_wash_cycles_finalize_lab_gate_record.sql` (`drop policy if exists` +
`create policy`, idempotent against a fresh environment or production alike). A second, smaller
instance of the same gap exists (`kirim_lines_is_sulfured_flag`, version `20260815031646`, no local
file — only that day's second apply became local file `0069`) — flagged in 0074's own header
comment, not fixed; lower risk (a missing column fails loudly) and wasn't the policy asked about.

**Rezka KN calibre — `is_numberless` stays `true` for both, separated by a new discriminator, not
by faking a numbered calibre.** Plain KN is a raw source; Rezka KN is cut output; giving Rezka KN
`is_numberless = false` would land it in the "calibred" bucket everywhere, which is a different
wrong answer, not a fix. Added `calibres.is_rezka_output boolean not null default false`, one
"Rezka KN" row per category that already has a plain KN row (dynamic `insert ... select`, not
hardcoded to the one live category — confirmed live, exactly one category/one KN row exist today).

Investigated all four `sum(...) filter (where c.is_numberless)` aggregates named in the
investigation, not assumed vulnerable just because they were named:
- `rahbar_stock_snapshot.finished_konditirskiy_total` — reads `stock_on_hand_rows` directly, no
  `wash_cycles` gate anywhere upstream. **Confirmed vulnerable, patched.**
- `rahbar_dashboard_ledger.processed_konditirskiy_total` ("Ledger B") — reads `processed_lines`,
  which requires `wc.status = 'final' and wc.finalized_at is not null`. A Rezka serial never
  acquires a `wash_cycles` row (this same task's own #2/#3 below), so it cannot enter this CTE
  regardless of calibre. **Confirmed immune, not patched.**
- `get_client_report.loss_output`/`processedBreakdown.konditirskiyKg` — reads `loss_totals`, same
  `wash_cycle_status = 'final'` gate. **Confirmed immune, not patched.**
- `yield_rows.output.konditirskiy_kg` — `finished_serials` CTE, same gate. **Confirmed immune, not
  patched.**

Only `rahbar_stock_snapshot` needed a real change — `finished_konditirskiy_total` narrowed to
`is_numberless and not is_rezka_output` (preserves every existing value exactly, since no row had
`is_rezka_output=true` before this migration), a new `finished_rezka_kn_total` CTE, and a
`rezkaKnKg` key added to the output — included in `totalKg`, not excluded, mirroring the exact
reasoning already on record for `oldKnKg`: dropping a real balance from the total to dodge a merge
is the worse error. Verified live (dry run, rolled back): before, `konditirskiyKg: 0`,
`finishedCalibredKg: 52210`, `totalKg: 183367`. After minting+receiving a 1650 kg Rezka pallet from
2 consumed KN pallets (1440 kg book) and a 500 kg old-KN pool draw: `konditirskiyKg: 0` (exactly
unchanged), `rezkaKnKg: 1650`, `finishedCalibredKg: 50770` (exactly `52210 − 1440`), `oldKnKg:
103436` (exactly `103936 − 500`), `totalKg: 183077` (exactly `183367 − 1440 − 500 + 1650`). No kg
created, destroyed, or merged.

**Send + completion tracking — `rezka_sends`/`rezka_cycles`, copied from `moyka_sends`/
`wash_cycles`' CURRENT shape, not a reuse.** `rezka_sends` mirrors `moyka_sends` exactly
post-`0035` (no `wash_cycle` column — Moyka itself has been one-row-per-serial since then, nothing
cycle-numbered left to mirror). `rezka_cycles` mirrors `wash_cycles`' current shape
(`id`/`serial unique`/`status`/`final_loss_pct`/`finalized_at`) but deliberately does **not** copy
`wash_cycles`' finalize-verdict UPDATE policy — Rezka has no lab, so there is no verdict to gate on;
`rezka_cycles`' own update policy stays the plain `ombor`-role check `wash_cycles` itself had before
that gate existed. `final_loss_pct` carries no CHECK constraint, matching `wash_cycles`' own total
absence of one — a negative value (received > sent) is a legitimate figure, not an error state.

The mechanism that actually keeps this from becoming a hole for real Moyka serials: a new trigger
function, `prevent_dual_process_serial()`, fires `before insert` on **both** `wash_cycles` and
`rezka_cycles`, raising if the serial already has a row in the other table. Without this, nothing
would stop an `ombor`-role client from inserting a `rezka_cycles` row for an ordinary Moyka serial
specifically to route around the new Barcode #2 branch below. Symmetric — also blocks a Rezka
serial from acquiring a `wash_cycles` row, which would otherwise let it try to satisfy Moyka's own
finalize gate with a verdict it can structurally never have, permanently unfinalizable there —
exactly the failure mode the 2026-08-14 entry flagged as the reason to keep Rezka off `wash_cycles`
at all. Verified live (dry run): inserting `rezka_cycles` then attempting `wash_cycles` for the same
serial raised `23514` as designed; the reverse order raised the mirrored message.

**The Barcode #2 gate — one new OR-branch, the Moyka branch untouched.** `finished_pallets`'
`ombor_writes` INSERT policy gains `or exists (select 1 from rezka_cycles rc where rc.serial =
finished_pallets.serial)`, copied verbatim from the live policy read via `pg_policies` immediately
before writing this (byte-identical Moyka branch). Exactly what this lets through: an insert
succeeds with **no** passing CHIQIM verdict, if and only if the serial has a `rezka_cycles` row —
which, by the trigger above, means it can never simultaneously be a real Moyka serial. Verified live
(dry run, real `ombor`-role session via a `request.jwt.claims` override, not a superuser bypass):
received 1650 kg against 1500 kg sent, zero verdict, zero rejection.

**Mint callers — `mint_serial_from_sources` (0055) itself untouched, confirmed by not editing it.**
`send_finished_pallets_to_rezka` mirrors `send_old_stock_to_moyka`'s one-transaction shape exactly
(pallet shape, `declared_qty` = the weighed figure not the book figure, same reasoning). 
`send_old_kn_pool_to_rezka` is the weight-pool branch's first real caller — dormant since
`0055` ("No caller in Stage 3; Rezka is the first"). `p_pool_weight_kg` used as both the mint's
`declared_qty` and the `rezka_sends` amount — a pool draw has no book-vs-weighed distinction to
preserve, so one figure is correct, not a simplification. Both verified live: minted `160826-001`
(2 real pallets, 1440 kg book, 1500 kg weighed) and `160826-002` (500 kg drawn from a real 38,202 kg
old-KN pool balance) — pallets flipped to `consumed`, pool balance decremented by exactly the draw.
Outside-KN intake needs no RPC at all — an ordinary delivered `kirim_lines` row already exists, so
sending it to Rezka is the same two plain inserts `OmborMoykaTab.handleSend` already does for Moyka
(a frontend concern, stage 2).

**Surplus — audited, nothing needed to change beyond what's already above.** Every constraint,
floor, cap, and threshold reachable by the Rezka path was checked individually:
`wash_cycles.final_loss_pct` (and now `rezka_cycles`' own) carries no CHECK; `moyka_sends`/
`rezka_sends.qty_kg > 0` constrains the send side only, never compared against received;
`finished_pallets.weight_kg > 0` is a single-pallet floor with no upper bound; the mint RPC's own
`p_pool_weight_kg > v_available` check guards the draw side only; `yield_rows`' `loss_kg`/`loss_pct`
formulas are plain unclamped subtraction/division (a Rezka serial cannot reach them regardless, per
above); `rahbar_exceptions`' `abnormal_loss_pct` threshold is a plain `>` comparison, not `abs()` —
won't misfire on a gain (but also won't flag an abnormal one; a blind spot, not a rejection, and
moot for Rezka today since it can't reach `yield_rows` either). No `type="number"` field anywhere on
the receive/send forms carries a `max` attribute. **The one real bug found**: `computeFinalLossPct`
(`src/lib/tayyorCompletion.ts`) floors at `Math.max(0, ...)`, silently discarding a gain's magnitude
— frontend, out of scope this pass, flagged for whoever writes Rezka's own completion UI: do not
reuse this function verbatim, it needs a signed version. Verified live: a 1650 kg receipt against
1500 kg sent (a 10% gain) was accepted with zero resistance anywhere in the database layer.

**Provenance — fully derivable, nothing new stored.** `kirim_orders.origin` (`delivery` = outside-KN,
no minting; `internal_reprocess` = either inside source) plus `serial_mint_sources.source_kind`
(`pallet` = washed-KN consumed pallets; `weight_pool` = old-KN pool draw) together fully determine
which of the three sources a Rezka line came from — no new column needed anywhere.
`get_serial_passport`'s existing `mintOrigin` section already reports pallet- and pool-sourced
provenance correctly for a Rezka-minted serial with zero passport changes — its `poolDrawKg` field,
dormant since `0056` ("always 0 for a Stage 3 old-stock re-wash"), now reads real numbers the moment
the pool-draw caller above runs. Verified live: `160826-002`'s passport returned `poolDrawKg: 500`
with no passport code touched. One narrow, real gap found and **not** fixed here (touches
`get_serial_passport`, stage-2/3 territory): `mintOrigin.sentWeighedKg` sources only from
`moyka_sends` via a shared `sends_total` CTE also used by `joriyHolat.raw.sentToMoykaKg` (correctly
0 for Rezka, so the CTE itself can't just be broadened) — would misreport 0 for a Rezka-minted
serial. Exact fix (a new `rezka_sends_total` CTE, added only to the `mintOrigin.sentWeighedKg`
expression) recorded for stage 2, not applied.

**`kirim_orders.origin` — confirmed reused unchanged, not a new value, verified not assumed.** Every
origin-filtered view that could plausibly see Rezka activity was checked directly: `Ledger B`'s
`processed_konditirskiy_total`, `get_client_report`'s `loss_output`/`processedBreakdown`, and
`yield_rows`' `konditirskiy_kg` are all gated on `wash_cycles.status='final'` upstream of where
`origin` is even read — a Rezka serial cannot reach any of them regardless of its origin value,
because it will never have a `wash_cycles` row. A new origin value would buy no additional
protection (the `wash_cycles` absence already does the real work) and would need its own entry in
every one of CLAUDE.md's origin-filtering categories for no behavioural gain. Rejected.

🚩 **Separate, more urgent finding — not fixed here, flagged ahead of the decisions-needed list
below because it isn't really a "stage 2" concern.** An outside-KN serial sent *partially* to Rezka
(no minting involved — it's an ordinary `kirim_lines` row) would still show its full original raw
balance as available everywhere "raw remaining" is computed by subtracting `moyka_sends` (+
`raw_dispatch_lines`) alone — confirmed directly in `stock_on_hand_rows.raw_rows` and
`rahbar_dashboard_ledger`'s `lines` CTE (`sent_before_from_kg`/`sent_as_of_to_kg`). Nothing today
subtracts `rezka_sends` anywhere. Left unfixed, Ombor could send the same raw kilograms to both
Moyka and Rezka — a real double-commit risk, not a cosmetic dashboard gap. **Minted-serial Rezka
lines are not at risk of this specific issue** — `mint_serial_from_sources` deliberately gives a
minted serial no `storage_intake` row, and every one of these views already requires
`has_intake`/an inner join to `storage_intake` before a line can appear in a raw balance at all, the
same protection Moyka's own mint path has always relied on (verified directly, not assumed — this
concern was raised, investigated, and structurally ruled out before writing this paragraph). Not
patched in this migration: every confirmed call site is a reporting/balance view (out of scope this
pass), and `get_client_report`'s own `client_lines` equivalent needs the same direct verification
before anyone touches it.

**Verification.** Full migration (`0074` + `0075`) dry-run against production inside a single
`BEGIN…ROLLBACK`, with `request.jwt.claims` locally set to a real `ombor`-role profile id so every
RLS policy and role-gated RPC ran under genuine enforcement, not a superuser bypass. Confirmed:
`rahbar_stock_snapshot` figures reconcile exactly before/after (see above); one `RKN` calibre row
created, not duplicated; both mint callers succeed and correctly decrement their source (pallet
status → `consumed`, pool balance reduced by exactly the draw); the finished_pallets gate accepts a
10% surplus with no verdict; both trigger directions raise as designed; the passport's dormant
`poolDrawKg` field reports correctly with zero passport-code changes. Rolled back — nothing
persisted. Not yet tested: a real authenticated browser session (matching the 2026-08-14 precedent
for the `wash_cycles` finalize gate) — the dry run's JWT-claims override proves the SQL is correct
under real RLS enforcement, but is not a substitute for clicking through the actual (not-yet-built)
Ombor UI once stage 2 exists.

**Decisions needed before stage 2:**
1. The partial-send raw-balance gap (double-commit risk, flagged above) — fix before any outside-KN
   serial is ever sent to Rezka in production, not bundled with cosmetic reporting work. Needs
   `get_client_report.client_lines` checked for the same characteristic before it's touched.
2. Whether the four Rahbar-dashboard/reporting patches this task deliberately left alone
   (`rahbar_dashboard_ledger`, `get_client_report`, `yield_rows` are immune by construction and need
   nothing; `get_serial_passport`'s `sentWeighedKg` is the one real, narrow, ready-to-apply fix) get
   folded into stage 2's own migration or shipped as their own small follow-up first.
3. Completion-tracking UX for Rezka — `rezka_cycles.status`/`final_loss_pct` exist, but nothing yet
   decides what "finalize" means operationally for a cutting batch (a Tugallash-equivalent action,
   presumably, but its exact trigger/UI is stage 2).
4. `computeFinalLossPct`'s floor — confirm whether Rezka's own completion UI gets a new, signed
   sibling function, or whether the existing one gets a parameter, before stage 2's frontend work
   starts (affects whether it's a shared-file change or a net-new file).
5. Whether `send_finished_pallets_to_rezka`/`send_old_kn_pool_to_rezka` are the final RPC surface,
   or whether stage 2's UI needs additional read-side RPCs (e.g., a "what's available to send to
   Rezka" list, mirroring `useMoykaSerials.ts`) not designed in this pass.
