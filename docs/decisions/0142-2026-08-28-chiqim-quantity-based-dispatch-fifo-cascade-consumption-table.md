## 2026-08-28 — CHIQIM quantity-based dispatch: FIFO cascade, consumption table

Reverses the 2026-08-18 "loading takes the whole calibre" decision, and with it "CHIQIM Option B"
(2026-07-26/27, pallet-level reservation + Ombor scan-to-load) wholesale — not just the narrower
batch decision the brief itself named. Ombor no longer scans anything; a finished/old_washed CHIQIM
line is quantity-only again (calibre + declared net kg + declared tara kg, Menejer's form), and
which specific `finished_pallets` rows actually get consumed is decided at Ombor's finalize click,
by FIFO over receipt date, tracked in a new append-only `chiqim_pallet_consumption` ledger rather
than mutating `finished_pallets`. This is the shape Option A had before Option B existed, but with
a genuinely new fulfillment mechanism neither prior design had: a batch can now be **partially**
consumed, split across several requests, which is exactly what removes the double-count risk that
motivated 2026-08-18's whole-calibre rule in the first place.

**Three premises the brief itself got wrong, corrected via investigation before writing any code**
(all confirmed with the user via `AskUserQuestion` before proceeding):
1. **FIFO trigger event.** The brief assumed Qorovul's gate stage 2. Traced the actual code
   (`useAvailableFinishedStock.ts`, `stock_on_hand_rows`' pre-migration definition) and confirmed a
   pallet becomes unavailable the instant it's written to `dispatch_manifest`, at Ombor's own
   `Yuklashni yakunlash` click — cross-checked against SPEC.md's "CHIQIM per-role finalization"
   named invariant, which explicitly states there is no single shared completing event by design.
   User confirmed Ombor's finish click as the FIFO trigger, preserving current-day
   availability-reduction timing exactly.
2. **FIFO tie-break key.** `finished_pallets` had no timestamp finer than `received_date` (day
   granularity, frequently tied across same-day pallets). User confirmed adding
   `finished_pallets.created_at timestamptz`, backfilled deterministically for historical rows
   (`received_date` midnight + a per-day barcode2-lexical-order offset).
3. **"Per-calibre batch" shape.** The brief assumed `finished_pallets` was already consolidated
   one-row-per-calibre-batch. Confirmed via `FinishedReceiptForm.tsx` (already read in full for a
   prior prompt) that the 2026-08-20 per-calibre entry was a one-time **manual data correction** for
   exactly two historical serials — the real receive-form consolidation change was explicitly
   deferred and never built. Doesn't block the design: the consumption-ledger approach treats every
   `finished_pallets` row as independently, partially consumable regardless of whether it represents
   one physical pallet or several.

**Migration 0087** — the core mechanism, applied first:
- `finished_pallets.created_at` (see premise 2 above) — FIFO ordering key.
- `chiqim_lines.declared_tara_kg` — Menejer's declared tare for a finished/old_washed line,
  additive to the existing `qty_kg` (declared net, unchanged meaning).
- `chiqim_pallet_consumption(id, chiqim_line_id, barcode2, qty_kg, created_at, created_by)` —
  append-only. A trigger backstops `sum(qty_kg) per barcode2 <= finished_pallets.weight_kg` (defense
  in depth; the real guard is the FIFO function's own row lock, below). RLS: `read_all` +
  `client_read_own_...` (same serial→kirim_lines→kirim_orders→owner_id chain as
  `finished_pallets`' own client policy) + `ombor_writes`/`ombor_deletes` (delete window matches
  `dispatch_manifest`'s own pre-gate-stage-2 policy exactly).
- Three views — `finished_pallet_availability`, `finished_calibre_availability`,
  `finished_serial_calibre_availability` — the ONE canonical availability read (brief's own
  constraint: "no new balance calculation beyond the one canonical availability read"). Per-pallet
  remaining balance (`weight_kg - consumed_kg`, floored at 0), then the two aggregate levels the
  brief asked for: total-by-calibre and per-parent-serial-by-calibre.
- `attribute_chiqim_line_fifo(line_id, loaded_kg, actor)` — `security definer`, `for update`-locks
  candidate `finished_pallets` rows (type+calibre+isOldStock, `status='in_stock'`) for the call's
  duration, cascades the loaded kg oldest-`created_at`-first, and **hard-fails** (raises, aborting
  the whole call, nothing partially written) if the requested kg can't be fully covered right then —
  "no partial dispatch," the one place in this whole area that is NOT "never blocks," because an
  actually-impossible dispatch is a different class of problem than an under/over-target one.
- `finalize_chiqim_dispatch(request_id, lines, actor)` — loops every finished/old_washed line's
  loaded kg through the function above, then stamps `chiqim_requests.ombor_finished_at/by`.
- `chiqim_line_pallets` (Option B's reservation table) dropped outright — confirmed empty first
  (0 rows), along with `dispatch_manifest` (0 rows) and any `chiqim_lines` with
  `line_kind in ('finished','old_washed')` (0 rows): finished-goods CHIQIM had never actually been
  dispatched through Option B in production, so no backfill/reconciliation was needed anywhere in
  this migration series. `dispatch_manifest`'s TABLE is kept (never written to again) as a
  historical artifact — same "keep table, stop writing" precedent as `wash_cycles` (0086).

**Migration 0088** — the read-path rewrite, all 9 sites that read the old `dispatch_manifest`+gate
model, switched to `chiqim_pallet_consumption` (+ the same gate-completion check for "truly
departed," unchanged in meaning): `kirim_line_state`, `stock_on_hand_rows` (a partially-consumed
pallet now correctly splits into an `available` portion and a `band_qilingan` portion, both nonzero
at once — impossible under the old whole-pallet model), `get_client_report` (`client_pallets` CTE
split into a "still held" branch + one row per gate-completed consumption portion, preserving the
exact old "claimed-but-undeparted has zero effect" semantics), `rahbar_dashboard_ledger` (identical
split), `get_serial_passport` (`dispatch_ids`/`dispatch_pallets`/`finished_dispatched_total`
switched to consumption; new `dispatchedByCalibre` block, the brief's own explicit requirement,
scoped to gate-completed consumption only). `useAvailableFinishedStock.ts` (2026-08-28.5.4-scoped
frontend read) rewritten separately, below. `rahbar_stock_snapshot` and `client_calibre_split`
confirmed needing NO changes (the former only aggregates `stock_on_hand_rows`' own bucket, inheriting
its fix automatically; the latter computes gross produced totals straight off `finished_pallets`,
never touched `dispatch_manifest`).

**Migration 0089 — a gap caught before any UI was built on top of it.** `attribute_chiqim_line_fifo`
and the availability views selected candidates on `status = 'in_stock'` alone, missing the
pre-existing hard gate (`labVerdict.ts`, SPEC.md Laborator v2) that a serial's CURRENT wash-cycle
verdict must be `o_tdi` before its pallets are dispatchable — untested and `qayta_yuvish`-flagged
stock was reachable by both the FIFO cascade and Menejer's feasibility hint. Fixed by adding the
identical wash_cycles+latest-lab_results-by-scope='chiqim' join `stock_on_hand_rows` already used
for its own `available` bucket. No effect on the live total at the time (every in-stock pallet's
serial already carried an `o_tdi` verdict) — a correctness fix for future data, not a live-data
change.

**A real-data test-pollution incident during hard-fail verification — caught, reverted, disclosed
per this session's standing transparency rule (CLAUDE.md "Testing workflow").** While verifying
`attribute_chiqim_line_fifo`'s hard-fail behavior with an intentionally-over-large request, the
isolated `TEST-FIFO-*` fixture's chosen type/calibre combination turned out to already have real
production stock. The FIFO cascade correctly did its job — cascading across ALL matching stock
globally — which meant it also consumed 720kg+160kg from real serial `240826-001` and 69kg from
`110826-001` (a serial already corrected once earlier in this session's own work). Caught
immediately by checking `finished_serial_calibre_availability` for those two real serials right
after the test and noticing the drop; the four erroneous `chiqim_pallet_consumption` rows were
identified by exact UUID and hard-deleted, and both serials' availability was verified restored to
their known-correct pre-test figures (`110826-001`: 1127/4657/20/1350 across calibres; `240826-001`:
140+880=1020) — plus the fleet-wide `finished_calibre_availability` total matched the pre-test
baseline (76650kg) exactly, both before and after. The hard-fail test was then re-run properly
isolated, against `Subxon`/`Kalibr 5` (a combination with zero real stock), via an explicit
DO-block-with-BEGIN/EXCEPTION harness asserting the exception fires and zero consumption rows leak —
passed cleanly. All `TEST-FIFO%`-plated fixtures (both batches) were hard-deleted afterward
(these are genuinely disposable SQL test rows, never app-visible — distinct from the app's own
void-only business-data rule), verified via a final zero-count query and the availability total
still matching baseline.

**A second, broader gap — caught by an active post-deploy sweep, not by chance.** After the
frontend rewrite (below) was done and 0087-0089 were already live, a deliberate
`pg_get_functiondef`/`pg_get_viewdef` sweep across every live function and view for lingering
`dispatch_manifest`/`chiqim_line_pallets` references turned up SEVEN more objects 0087 had silently
broken by dropping/abandoning those two tables without checking every dependent:
- **Migration 0090** — `chiqim_requests_release_reservations` (a 0033 trigger, AFTER UPDATE ON
  `chiqim_requests`) still called `release_chiqim_reservations()`, which directly referenced the
  now-dropped `chiqim_line_pallets`. Since this trigger fires on ANY update setting `voided_at` or
  `ombor_finished_at`, this meant **every CHIQIM void and every Ombor finish click** — including the
  brand-new `finalize_chiqim_dispatch` path this very prompt built — would throw `relation
  chiqim_line_pallets does not exist` the moment it ran. Caught via code archaeology before either
  path was ever exercised through the new UI. Fixed by dropping the trigger and function outright —
  the reservation-release mechanism it implemented has nothing left to release.
- **Migration 0091** — six more objects, two failure modes. THROWS:
  `mint_serial_from_sources` (Rezka's pallet-source eligibility check) also queried
  `chiqim_line_pallets` directly — any pallet-source mint would have thrown. SILENTLY WRONG (worse:
  no error, just a wrong answer) since `dispatch_manifest` is now permanently empty:
  `close_out_old_stock`'s `old_washed` branch and `old_stock_closeout_lines` (both would count every
  in-stock old_washed pallet as "still remaining" even once FIFO had departed some or all of it, and
  the close-out would mis-void pallets that should already read as gone); `client_filtered_report_rows`
  (the client portal's own `'chiqim'` rows always got `date_basis = NULL` via the dead join, which
  the function's own WHERE clause then silently filtered out entirely — **every client's own
  dispatched-finished-goods rows had vanished from their own report**); `report_chiqim_rows` and
  `report_moyka_output_rows` (`pallet_status` always fell through to `'omborda'` for a departed
  pallet — feeds `get_serial_passport`'s own `cycles[].pallets[]` list directly, so a dispatched
  pallet's passport badge would have silently read "still in warehouse"). All six fixed by the same
  pattern already established in 0088/0089: swap the dead `dispatch_manifest`/`chiqim_line_pallets`
  read for `chiqim_pallet_consumption` (+ gate-completion, where "departed" specifically matters).
  Where the original object was whole-pallet-boolean (`close_out_old_stock`,
  `old_stock_closeout_lines`), the fix kept that same granularity rather than inventing a third,
  finer balance calculation for a close-out/audit context that never needed one before either.
- **Migration 0092 — a genuine security gap, not just a correctness one.** `get_advisors` (security)
  flagged `attribute_chiqim_line_fifo` and `finalize_chiqim_dispatch` as callable by the `anon` role
  over PostgREST — unlike every other `security definer` write RPC in this schema
  (`mint_serial_from_sources`, `close_out_old_stock`), both were missing the `my_role() = 'ombor'`
  gate every sibling function already has as its first check. An unauthenticated caller could have
  invoked either directly to attribute arbitrary FIFO consumption against arbitrary `chiqim_lines`,
  or stamp `ombor_finished_at` on any request. Fixed by adding the identical gate.

This second sweep is the reason this entry runs longer than a typical migration writeup: dropping a
table this deeply embedded turned out to have eight total dependents across two migrations' worth of
initial rewrite work, not the handful anticipated going in. Worth naming as a process point, not just
a fix list — the lesson carried forward is that dropping/abandoning a table needs the SAME
`pg_get_functiondef`/`pg_get_viewdef ilike` sweep this session eventually ran, run BEFORE the drop is
applied, not after the fact once something downstream throws or goes quiet.

**Frontend, `src/lib/`:**
- `useAvailableFinishedStock.ts` — rewritten (same file, new export
  `useFinishedCalibreAvailability`): the old per-pallet picker list is gone; reads
  `finished_calibre_availability` directly, returning `{type_id, calibre_id, is_old_stock,
  available_kg}[]`. Reused as-is by both Menejer's form and Ombor's new loaded-kg entry, so the two
  screens' soft-warning hints can never disagree.
- `useOmborChiqimRequests.ts` — `chiqim_line_pallets` nested select removed (the table it read no
  longer exists); `ChiqimLine` drops `reservedPallets`, gains `declared_tara_kg`.
- `useDispatchManifestLines.ts` — reads `chiqim_pallet_consumption` instead of `dispatch_manifest`;
  `weight_kg` is now the portion actually attributed to that request (`qty_kg`), not the whole
  pallet's book weight — a pallet can now appear split across several requests' own detail views.
- `chiqimScan.ts`, `chiqimFeasibility.ts` (+ both `.test.ts`), `useReservedPalletBarcodes.ts` —
  deleted outright (Option B's scan-resolution, whole-pallet feasibility-matching, and reservation
  machinery; nothing left references any of them). `sortFinishedByOmborFinish` (still needed, W2's
  own sort) and `lineStatus`/`shortfallLines` (still needed, now generic across every CHIQIM line
  kind including finished/old_washed's own loaded-kg entry) were split out into two new
  dependency-free modules — `sortChiqimFinished.ts`, `chiqimLineStatus.ts` — before the rest of
  `chiqimScan.ts` was deleted, each carrying its own tests forward unchanged.

**Frontend, pages:**
- `ChiqimForm.tsx` (Menejer) — the picker (`matchingPallets`/`togglePallet`/`selectedBarcodes`,
  the `chiqim_line_pallets` reservation insert with its 23505-race handling) removed entirely for
  finished/old_washed rows. Replaced with a plain net-kg input (no longer read-only) plus a new
  required tara-kg input, and a feasibility hint that's now a simple "declared kg ≤
  `finished_calibre_availability`" check instead of the old whole-pallet nearest-below/above
  matching (`checkFeasibility`, deleted with `chiqimFeasibility.ts` above — FIFO can now split any
  pallet arbitrarily, so "does it map to whole pallets" stopped being a meaningful question). raw/
  old_raw/old_kn rows are untouched — out of this change's scope, confirmed via the brief's own
  explicit exclusion list.
- `OmborChiqimTab.tsx` — the "Yig'ish kerak" prep-list and the scan zone
  (`BarcodeCameraScanner`/manual barcode form/`processBarcode`/`handleScan`) are gone. Replaced with
  a per-line "Yuklangan og'irlikni kiriting" entry (one number, declared net+tara shown as context,
  the live available-kg hint from `useFinishedCalibreAvailability`), held client-side until
  `Yuklashni yakunlash` — same deferred-commit shape the raw/old_kn draw composers already used.
  `handleFinish` now calls `attribute_chiqim_line_fifo` per finished/old_washed line FIRST, before
  any raw/old_kn commit — a hard-fail there aborts the whole click before anything else is written,
  so a retry is clean rather than partial (this ordering is a deliberate departure from calling the
  bundled `finalize_chiqim_dispatch` RPC, which would stamp `ombor_finished_at` before the raw/old_kn
  commits below it, risking a duplicate-draw retry on a later, unrelated failure). W2's undo
  (`handleUndoScan`) now DELETEs from `chiqim_pallet_consumption` instead of `dispatch_manifest`,
  same RLS-enforced pre-gate-stage-2 window as before, same "empty `.select()` result means
  RLS-refused, not already-gone" reasoning.
- `serialPassport.ts`/`SerialPassportModal.tsx` — new `dispatchedByCalibre` block (brief's own
  explicit requirement) wired through and rendered as a small per-calibre table.
  `PassportPendingDispatch`'s `kind='finished'` case is gone, not replaced — flagged, not silently
  dropped: it read `chiqim_line_pallets` (Option B's reservation, its only source), and there is no
  equivalent any more — FIFO attribution happens only at Ombor's finalize click, so a still-open
  finished/old_washed line has no specific pallets reserved in advance to report as "pending" for
  any one serial. `kind='raw'` (a different table, untouched) is unaffected.

**e2e:** `chiqim-undo-scan.spec.ts` rewritten end-to-end for the new flow (kept its filename — still
the exact right word, "undo," just for a loaded-kg entry now, not a scan); now requests the FULL
4000kg across two fixture pallets so the FIFO cascade deterministically consumes both, then
discovers via a direct `chiqim_pallet_consumption` query which barcode landed in which row rather
than assuming a specific tie-break order between two same-instant-created pallets. `full-chain.spec.ts`'s
CHIQIM section updated to the new form (net+tara, no picker) and Ombor's new loaded-kg entry (no
scan). `tests/e2e/helpers/teardown.ts` gained a `chiqim_pallet_consumption` cleanup step (resolved
via `chiqim_line_id`, since it FKs there and not to `request_id` directly) ahead of the `chiqim_lines`
delete — every future e2e run's teardown would otherwise leave orphaned consumption rows behind for
any test that drives this flow.

**Not built — flagged, not silently skipped:** old_washed pallets' barcode-label printing had no
trigger point left. The old prep-list's per-row/print-all buttons existed specifically because a
reserved old_washed pallet got its first physical label at reservation time (old-stock pallets
aren't labeled at intake, unlike regular finished pallets). With the reservation step gone, there is
no UI moment left where an old_washed pallet's label naturally gets printed for the first time before
dispatch. Out of this task's explicit scope (labeling wasn't named in the brief); a real gap for
whoever picks up old-stock dispatch UX next.

**Verified:** `npx tsc -b --noEmit` clean; `npx oxlint` clean (one pre-existing, unrelated warning on
`AuthProvider.tsx`); `node --test` full suite passes (52/52, including two new/moved test files).
`npm run build` succeeds. SQL verified extensively and directly against live data after every
migration (0087 through 0092): `finished_calibre_availability`'s fleet-wide total held at exactly
76650kg across every single change in this series (a strong signal nothing was silently
double-counted or dropped along the way); every rewritten function/view executed cleanly against
real rows; the FIFO hard-fail path was exercised twice (once with real-data contamination, caught
and fully reverted; once cleanly isolated). **No live-browser Playwright run this session** — this
sandbox has no `.env.test` (test-role credentials), so the rewritten e2e specs are updated for
correctness but not executed; flagging this explicitly rather than claiming a UI-level pass this
session couldn't actually perform.

SPEC.md §5.4 amended inline (struck the scan-to-load/whole-pallet-only bullets, added the FIFO
cascade description) — plus two smaller mentions elsewhere that had gone stale in the same way
("a pallet is atomic... loaded whole or not at all" in the Barcode #2 notes row; the CHIQIM form's
own "whole-pallet soft warning" bullet) — both amended the same inline way, not rewritten wholesale.
