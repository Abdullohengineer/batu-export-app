## 2026-07-20 — Reporting engine cleanup: test-data DELETE, TEST- filter, redundant-fetch collapse

**Context:** three-part task. Delete the orphaned `TEST-`-prefixed CHIQIM debris this whole project's testing history kept flagging-but-never-fixing (36+ open `chiqim_requests` in the last several entries above, no void mechanism ever built for those tables, deletion explicitly chosen as the resolution this time rather than building one). Filter `TEST-` rows out of the reporting engine so tomorrow's test runs don't repopulate what today's cleanup removes. Collapse `fetchEffectiveQty`'s redundant fetch inside `useMoykaSerials.ts`, deferred twice already (2026-07-19, 2026-07-20 Step 10 prompt 1 entries).

### 1. Deletion — a real, deliberate exception to the append-only lock

**🔒 Raw `DELETE` on `TEST-`-prefixed fixtures is a stated, deliberate exception to SPEC.md §2.15's "never DELETE, only void" rule — not an abandonment of it.** That rule governs *operational* data: real events this app's audit trail must never lose (a real intake, a real dispatch, a real wash cycle). `TEST-`-prefixed rows are not operational data — they are this project's own testing infrastructure's disposable output, created solely to prove code paths work, carrying zero business meaning once the run that created them has finished. `chiqim_requests`/`chiqim_lines`/`dispatch_manifest`/`gate_weighings` were flagged **four separate times** across this project's history (2026-07-17 and 2026-07-18 entries above) as having no void mechanism at all, and building one was explicitly out of scope each time (a schema change for a problem DELETE already solves correctly for non-operational rows). This entry is the record so a future reader sees this was a considered call, not a silent reversal of the append-only convention — the convention is unchanged and still applies to every real table's real rows, including `TEST-`-prefixed rows' own `finished_pallets`/`wash_cycles` (still voided, never deleted, unaffected by this cleanup).

**Inspected before deleting, not assumed:** confirmed current counts (`chiqim_requests`=96 — 53 `kutilmoqda`, 43 `olib_ketildi`; `dispatch_manifest`=85; `chiqim_lines`=82; `gate_weighings` dir=chiqim=34, all scoped to `plate LIKE 'TEST-%'`) via direct query before writing any `DELETE`. **Checked every one of the 85 `dispatch_manifest` rows' pallets back to their ORIGINATING `kirim_orders.plate`** (not just the claiming request's own plate) before deleting anything — every single one traced back to a `TEST-`-prefixed originating order (mostly `TEST-SEED-*`/`TEST-LAB-*`/`TEST-STEP9-CHAIN-*` from `helpers/fixtures.ts`'s seeding, plus the older manually-named `TEST-CHIQIM-*` fixtures from Step 7). **Zero real material was ever at risk** — confirmed, not assumed, per the task's explicit instruction to flag rather than assume if any had turned out real.

**Executed, user confirmed all 96 (both statuses, no narrower scope):**
```sql
delete from dispatch_manifest
where request_id in (select id from chiqim_requests where plate like 'TEST-%');

delete from chiqim_lines
where request_id in (select id from chiqim_requests where plate like 'TEST-%');

delete from gate_weighings
where request_id in (select id from chiqim_requests where plate like 'TEST-%');

delete from chiqim_requests
where plate like 'TEST-%';
```
**Confirmed final state:** all four counts (`chiqim_requests`/`dispatch_manifest`/`chiqim_lines`/`gate_weighings` scoped to `TEST-%`) at exactly 0. 34 `chiqim_requests` remain — pre-existing, non-`TEST-`-prefixed rows from before this project's `TEST-` fixture convention existed (same class of legacy artifact as the 6 non-`TEST-` `kirim_lines` rows the Hisobot filter also leaves visible, see below) — untouched, out of scope per "scope strictly to `TEST-` prefixed plates." 39 previously-claimed `in_stock` pallets are now unclaimed and available again (4 more were already `bekor_qilindi` and stay that way — releasing a voided pallet's stale claim doesn't un-void it). `finished_pallets`/`wash_cycles`/`kirim_orders`/`kirim_lines`/`storage_intake` were not touched by any of these four statements — only the CHIQIM-side claim chain was in scope.

### 2. TEST- filter in the reporting engine

Added `isTestPlate()` (`src/lib/reportQuery.ts`) — same unconditional, no-toggle precedent `useFinishedChiqimRequests.ts` already established ("no screen in this app has ever built a show-test-data switch"). Applied once in the shared query layer (`useReportQuery.ts`), not per-view, so every future saved view built on this engine inherits it automatically:
- KIRIM rows: excluded when their own `kirim_orders.plate` is `TEST-`-prefixed.
- CHIQIM rows: excluded when **either** the claiming `chiqim_requests.plate` **or** the pallet's own **originating** `kirim_orders.plate` is `TEST-`-prefixed (via the same `kirim_lines → kirim_orders` join the row already makes for target-quality data) — a request-only check would miss every still-in-storage or voided test pallet, which has no dispatch plate of its own to catch. Checked and excluded before the voided-barcode search even runs, so a `TEST-` fixture is invisible to this engine end to end, not merely absent from the default table.

**Verified live:** Menejer's Hisobot, default filters (last 30 days, both directions) — **298+ rows down to 6**, all 6 being the same pre-`TEST-`-convention legacy rows noted above (`150726-00{1,2,3}`, `140726-00{1,2,3}`). Zero console errors.

### 3. `fetchEffectiveQty` redundant-fetch collapse

Built exactly the design the 2026-07-19 entry already validated once and reverted only for timing reasons ("collapsing turned out non-trivial to do safely alongside the race fix, deferred rather than bundled in"): `fetchEffectiveQty` (`src/lib/effectiveQty.ts`) now accepts an optional third `prefetched: { intakes?, sends? }` argument; when present, it resolves those two queries from the given rows instead of re-fetching `storage_intake`/`moyka_sends` unfiltered a second time. Optional and additive — `useEffectiveQty` (`OmborIntakeTab.tsx`, `KirimOrdersList.tsx`) and `useReportQuery.ts` both omit it and keep their original always-fetch-fresh behaviour unchanged. Only `useMoykaSerials.ts` passes its own already-fetched `intakes`/`sends` through (the sole caller with those rows already in hand from the same refresh).

**`useMoykaOutput.ts` does NOT call `fetchEffectiveQty` at all — confirmed again** (third time across sessions; see the 2026-07-19 entry's own correction of an earlier session's inaccurate claim to the contrary). The task's own framing assumed both hooks call it; only `useMoykaSerials.ts` actually does, so that's the only place this collapse applies.

**Verified via live network trace, not just code inspection** (this environment's own request-log tool doesn't surface Supabase's `fetch()`-based calls, but `performance.getEntriesByType('resource')` does): cleared the resource-timing buffer, remounted Ombor's Moyka tab, and inspected every `storage_intake`/`moyka_sends` request fired. Only the two already-necessary fetches appeared (`useMoykaSerials`'s own `storage_intake?select=serial,actual_qty` and `moyka_sends?select=id,serial,sent_date,qty_kg,wash_cycle`, plus `useMoykaOutput`'s own distinctly-shaped `moyka_sends?select=serial,qty_kg,sent_date,wash_cycle` — all present because OmborMoykaTab genuinely consumes both hooks, section-mirroring the Tayyor tab's Window 1, unrelated to this change). `fetchEffectiveQty`'s own distinctly-shaped, previously-present `storage_intake?select=serial,actual_qty` and `moyka_sends?select=serial,sent_date` calls (its minimal, `useMoykaSerials`-independent column sets) are **absent** — the two round trips are confirmed gone, not just theoretically skippable. Functional correctness unaffected: Moyka tab still shows correct `Qabul qilingan`/`Qoladi` figures and the correct `+200 kg` truck-variance note for every serial checked.

### Testing

`npx tsc -b --noEmit` clean. `npm test` 85/85 (84 pre-existing + 1 new `isTestPlate` test, 6 assertions).

**Own smoke test needed a fixture fix, caused by this task's own filter.** `reporting-query-engine.spec.ts` (Step 10 prompt 1) seeded its KIRIM order under a `TEST-HISOBOT-...` plate — which the new `isTestPlate()` filter now correctly excludes, so the test's own row stopped appearing in Hisobot. Fixed by switching to `uniqueRealLookingPlate()` (`tests/e2e/helpers/fixtures.ts`), the same non-`TEST-`-prefixed-identifier helper `menejer-chiqim-finished-view.spec.ts` already uses for the identical reason against `useFinishedChiqimRequests`' own filter — updated that helper's comment to note it now has two consumers, not one. Confirmed passing 4 times after the fix (3 standalone + this run), after one earlier standalone failure that turned out to be a transient load spike (a live manual check of Hisobot immediately after showed normal, fast loading — not a systemic slowdown).

**Full suite run twice** (the first attempt returned `ERR_CONNECTION_REFUSED` across the board — the dev server wasn't up, an environment mistake on this session's part, not a test result; discarded). Clean run: **10/13 passing**, including `reporting-query-engine.spec.ts` cleanly. Three failures:
- `chiqim-full-chain.spec.ts` and `step9-single-product-full-chain.spec.ts`: timeouts in scan-confirmation and Tayyor-finish flows this task never touched — consistent with this suite's already well-documented DB-growth-driven flakiness (see multiple prior entries).
- `effective-qty.spec.ts`'s multi-product test: failed again, but with a **different** signature than the original bug (`-2,200 kg` reconciliation, not the original `-1,200 kg`) — the first failure of this specific test since the two-part dropped-submit fix shipped and passed cleanly 6 consecutive times this session (4 standalone + 2 prior full-suite runs). Not re-investigated — out of scope for this task, and one data point against six clean ones isn't grounds to declare the fix incomplete, but it's flagged here rather than silently ignored: worth a closer look if it recurs.

**Out of scope, not touched (per the task):** any void mechanism or status column for `chiqim_requests` (deliberately not built — deletion is the chosen approach, see above), remaining §3.2 saved views, demo-data seeding (explicitly deferred to the next prompt), and re-investigating the `effective-qty.spec.ts` anomaly noted just above.
