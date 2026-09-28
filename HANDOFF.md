# HANDOFF — Rezka build

Rezka is built in four prompts. Design audit: `docs/REZKA-AUDIT.md` (its wrong-premises list is
authoritative over the original brief). Rules: `docs/SPEC.md` §5.R. Decisions:
`docs/decisions/0219`–`0225`.

## Prompt 1 — data layer, blockers, regressions (branch `rezka-prompt-1`) — COMPLETE

**Status: complete; merging to `main` via PR** (`main` rejects direct pushes). Migrations
`0141`–`0143` **applied to live on 2026-09-24** (schema_migrations versions
`20260924051834`, `20260924052123`, `20260924052503`; stored statements md5-identical to the
committed files). Post-apply: all 11 live baselines unchanged apart from the new keys, which
are all 0; Ledger C re-verified live in a ROLLBACK run (`docs/decisions/0222`).

**Test 6 passed:** `full-chain.spec.ts`, 1 passed (1.2m) on `b36918d`, run locally by the
product owner. Getting there needed three spec-only fixes, all drift that predates Prompt 1
(no app change): Ombor icon-nav link names (one-word labels since 2026-08-15),
`yield_rows` has no row for an open serial (0101, 2026-08-29), and no Menejer CHIQIM tara
input (Prompt 11, 2026-08-29).

**Built**
- `kirim_lines.process` (moyka/rezka) + `enforce_serial_process` guard on moyka_sends /
  wash_cycles / rezka_sends / rezka_cycles.
- `rezka_cycles.opened_at/cycle_no/closed_at`; `ensure_open_rezka_cycle`,
  `close_rezka_cycle_if_settled` (exact settlement only), `close_rezka_cycle_serial` (any
  residual, signed, no lab).
- `rezka_kn_draws` ledger + `send_kn_to_rezka(owner, type, kg)`; every available-KN site nets
  out draws; Ledger C / client report `finished.rezkaDrawnKg`.
- Dispatch verdict gates: "lab passed OR serial in rezka_cycles"; Rezka pallets never
  "awaiting lab" in stock-on-hand.
- `rahbar_stock_snapshot.rezkaKnKg` / `rezkaRawKg` (regression from 0080 fixed).
- RKN label → "Standard". `send_finished_pallets_to_rezka` revoked from app roles;
  `send_old_kn_pool_to_rezka` left as dead code.
- Frontend: Laborator KIRIM/CHIQIM/history exclude Rezka; `useMoykaSerials` exposes
  `process` (Moyka picker filters it; Xom raw pool keeps it); `isInRezka`,
  `computeRezkaLossDisplay`; `FinishedReceiptForm` `rezka` prop.

## Prompt 2 — Ombor sections 2/3 with a Moyka/Rezka pill (branch `rezka-prompt-2`) — BUILT, `0144` APPLIED

**Status:** code complete on `rezka-prompt-2`; PR left for the product owner.
- **Migration `0144` applied to live on 2026-09-28** (schema_migrations version
  `20260928074512`). The stored statement is md5-identical to the committed file
  (`6e003fda70ef23227230346a3fad0372`, 25,034 bytes).
- Post-apply checks, run right before and right after the apply (07:43:33 and 07:45:45 UTC).
  All 14 reads were identical in canonical md5:
  - the three regression reads: `yield_rows` (43 rows), `wip_rows` (10 rows),
    `lab_turnaround_avg`;
  - the 11 Prompt 1 baselines: ledger ×3 scopes, snapshot ×3, client report ×3 owners,
    `stock_on_hand_rows` (135), `finished_pallet_availability` (216).
- Local checks: `tsc -b` clean, `oxlint` 2 old warnings, `node --test` 81/81,
  `lint:rpc-wrapper` OK, build OK.

**E2E — the product owner runs it locally, next to test 6:**
`npx playwright test tests/e2e/rezka-ombor.spec.ts tests/e2e/full-chain.spec.ts`
(needs `.env.test` including `SUPABASE_SERVICE_ROLE_KEY`; `0144` is now live).
- The spec uses the dedicated owner **TEST Rezka E2E** (created if missing) and TEST- plates.
- It voids its pallets and closes its cycles afterwards. Nothing is deleted.
- It could not run in the cloud container: there is no `.env.test`, and the proxy blocks
  browser→Supabase.

**Built**
- `0144`:
  - `rezka_kn_candidate_pallets` is the single Konditerka predicate, read by both
    `send_kn_to_rezka` (rewritten) and `rezka_kn_available()` (the tile).
  - Explicit Rezka exclusions in `yield_rows`, `wip_rows` and `lab_turnaround_avg`;
    `classify_kirim_line_sulfur` rejects Rezka.
- Pill (`ProcessPill`, persisted per tab):
  - The Moyka bodies moved unchanged to `MoykaSendSection` / `MoykaReceiveSection`.
  - The Rezka bodies are separate components.
- Section 2 Rezka:
  - Tashqaridan olish / Ichkaridan olish tiles.
  - Window 2 "Rezkada" with signed Rezkada, badge, and Ichki parent barcode2s.
- Section 3 Rezka:
  - No-lab, no-print Standard receive.
  - Window 2 with Yakunlash at any residual; the confirmation reads "Ortiqcha +X kg" on a gain.
- `RezkaBadge`; combined nav badges; `OmborIntakeTab` Window 2 reads `rezkaSent` for Rezka.
- `check-rpc-wrapper` accepts `run(supabase.from(...))` (it had rejected its own pattern).

**Resolved from the Prompt 1 "reported, not patched" list:**
- all four SQL items;
- `OmborIntakeTab`, `OmborHome` badges, and the `OmborMoykaTab` Window 1 split.

## Prompt 3 — Menejer KIRIM process toggle + CHIQIM Rezka tab (branch `rezka-prompt-3`) — BUILT, NO SQL

**Status:** code complete on `rezka-prompt-3`; the PR is left for the product owner.
- **No migration.** FIFO and availability already key on exact `calibre_id`
  (`docs/decisions/0225` §4).
- Local checks: `tsc -b` clean, `oxlint` 2 old warnings, `node --test` 81/81,
  `lint:rpc-wrapper` OK (41 files; `useAvailableFinishedStock.ts` left the allowlist), build OK.

**E2E — the product owner runs these locally:**
`npx playwright test tests/e2e/rezka-menejer.spec.ts tests/e2e/rezka-ombor.spec.ts tests/e2e/full-chain.spec.ts`
- The new spec has three serial tests on "TEST Rezka E2E" with `TEST-` plates. It is designed to
  leave no live remainder, and cleanup only voids.
- It could not run in the cloud container: there is no `.env.test`, and the proxy blocks
  browser→Supabase.
- Test 2 aborts on purpose if any Standard stock other than its own is available for Subxon
  (FIFO is not owner-scoped; see below).

**Built**
- KIRIM:
  - A **Moyka | Rezka** toggle per line (not a `<select>`, so e2e `row.locator('select')` still
    works). `process` is written in the line insert.
  - Fixed at creation: there is no line edit path and Menejer has no UPDATE policy.
  - The save panel links serials by type + process.
- Rezka · Tashqi badge on:
  - the KIRIM save panel;
  - the Menejer KIRIM list, plus a read-only "Jarayon" line;
  - the Qorovul gate card (per truck);
  - Ombor intake Windows 1 and 2.
- CHIQIM **Rezka** tab:
  - Standard only, preselected from the type.
  - Stored as an ordinary `finished` line.
  - Same "Mavjud" and soft warning as Kalibrlangan.
- The Kalibrlangan and Eski zaxira "Yuvilgan" calibre lists no longer offer `is_rezka_output`.
  Before this they were completely unfiltered.
- Xom badges Tashqi Rezka raw.
- Plain "Rezka" badge on Rezka CHIQIM lines, on Ombor's card and in `ChiqimRequestDetail`.
- `RezkaBadge` provenance is now optional.
- `useFinishedCalibreAvailability` moved onto React Query (same query).

## Prompt 4 — reporting layer (branch `rezka-prompt-4`) — BUILT, `0146` APPLIED — **REZKA BUILD COMPLETE**
- Decision: `docs/decisions/0226`. Spec: §3.2.11, §5.R.2 (v1.70).
- `0146` (applied 2026-09-28 09:32 UTC, stored md5 `fecdbebd…`): `report_rezka_rows`; Rezka
  kinds only when named; Rezka lines out of every Oddiy kind (fixed four TEST Ichki mints
  leaking into Oddiy MOYKADAN); Rezka columns on `report_totals` / `report_page_enrich` /
  `report_query_page`; `rahbar_stock_snapshot` and `get_serial_passport` are wrappers over
  unchanged `*_core` bodies. `0145` is a comment-only record of the unused number.
- Regression: every Oddiy read identical except the four leak rows. R5 identity on TEST Rezka
  E2E: 590 = 590.
- Frontend: Hisobot Oddiy | Rezka group with the four Rezka directions, per-group columns and
  saved sets, Manba, Rezka chips and Excel; dashboard Rezka button; qoldiq Joriy | Eski | Rezka;
  passport Rezka block and parent draw lines.
- Spec cleanup fixed: `voidPalletsWithStock` voids only pallets with available kg > 0
  (`rezka-menejer`, `rezka-ombor`). New read-only `rezka-hisobot.spec.ts`.

## Post-Rezka cleanup prompt (collected; none started)
1. **`get_serial_passport` is slow under RLS — production risk (pre-existing `_core`).** Found
   2026-09-28 while fixing `rezka-hisobot` test 1 (17 concurrent passports → 8 hit the 12 s
   `authenticator` statement timeout; the test now calls them sequentially).
   - As an authenticated Rahbar: `get_serial_passport_core` 762–1,591 ms warm, with single-call
     spikes of 6.8 s and 14 s (no concurrency). As `service_role`/`postgres` (bypass RLS):
     45–60 ms. The 0146 wrapper adds about 0.1–0.3 s.
   - Through PostgREST (`pg_stat_statements`, 2026-09-28):

     | RPC | calls | mean ms | min ms | max ms |
     |---|---|---|---|---|
     | `rahbar_stock_snapshot` | 78 | 1,465 | 285 | 11,542 |
     | `rahbar_dashboard_ledger` | 76 | 1,495 | 511 | 9,017 |
     | `get_serial_passport` | 36 | 1,729 | 191 | 7,874 |
     | `report_totals` | 107 | 668 | 80 | 3,820 |
     | `report_query_page` | 13 | 612 | 6 | 2,836 |
     | `report_query_page_rows` | 100 | 221 | 3 | 1,121 |
     | `report_page_enrich` | 70 | 212 | 39 | 1,027 |

     Caps: 12 s for everything except the four report RPCs (5 s, `pgrst_statement_cap`).
     Figures include test-run bursts; they are cumulative since the last stats reset.
   - Not re-planning: a PL/pgSQL copy of the `_core` body returned an identical result and was
     no faster (1.0–1.8 s warm). The cost is executing under RLS — the `client_read_own_*`
     policy branches expand into hundreds of InitPlans per statement (the v1.58 / `0202` class
     of problem, never fixed for the passport).
   - Next: an authenticated `EXPLAIN ANALYZE` of the `_core` body to find the hot policy; then
     either a `security definer` passport with an explicit role/owner guard, or the `0130`
     `(select my_role())` rewrite extended to the passport's tables. Snapshot and ledger maxes
     say the same check is due there. See `0226` §10.
2. **Owner-scoped FIFO and availability** — `attribute_chiqim_line_fifo` /
   `finished_calibre_availability` match type + calibre only (product decision needed).
3. **`hasRawRemainder` ignores raw dispatch** — Moykaga badge and intake Window 2.
4. **KIRIM raw void path** — no way to clear stranded `TEST-` (or mistaken) raw.
5. **Kalibrlangan calibre list not filtered by the type's category.**
6. **Same type + same process on one truck collide in the KIRIM save-panel serial link.**
7. **`check-rpc-wrapper` misses multi-line `supabase\n  .from(` chains** (`KirimForm.tsx`).
8. **Client report / portal Rezka block** — out of scope for Prompt 4.
9. **Voided-departed TEST pallet `PLT-280926-024-RKN-1`** (30 kg, departed, voided by the old
   cleanup before the fix) — TEST data, void is one-way; its serial's Olib ketilgan reads 0.
10. **`rahbar_dashboard_ledger` reads Rezka raw as Oddiy raw** (origin filter only;
   `receivedKg`/`closingKg` include Tashqi Rezka raw that the snapshot moved out of `rawKg`;
   `byCalibreType.dispatched` carries Standard — frontend now drops it from the bars). 0 kg live.
11. **Deep-link hard load bounces to the role's home** (`useProfile` loading lags the session
    by one render → `RoleRoute` → `/login` → home). Refreshing `/menejer/hisobot` lands on
    KIRIM. Breaks every spec that `page.goto`s a deep route after login (`hisobot-moykadan`,
    `hisobot-filter-debounce-consistency`, `moykada-yoqotish-invariant`). Fix: derive profile
    loading from `profile?.id !== session.user.id`. See `0226` §10.
12. Pre-existing, found in passing: Hisobot Excel export writes Partiya blank (no `'partiya'`
    case in `reportExport.ts`); export uses draft filters while totals use applied ones.
13. Carried from below: TEST- filter for Ombor section 3 Window 2 (Rezka); `fixtures.ts`
    outdated `wash_cycles` shape; stale Ombor link names in three specs; `chiqim-undo-scan`
    deletion; `full-chain` plates/hard-delete design.

## Prompt 3 follow-ups (logged, not fixed)
- **Kalibrlangan doesn't filter calibres by the type's category.** The CHIQIM calibre select
  lists every category's calibres; Prompt 3 only removed `is_rezka_output`.
- **Two lines of the same type and the same process on one truck collide in the serial link**
  on the KIRIM save panel. Matching is by type + process, so two Subxon-Moyka lines still show
  the same serial on both rows. Display only; the DB rows are correct.
- **`check-rpc-wrapper` misses call chains split across lines.** Its regex needs a literal
  `supabase.from(`, so `supabase\n  .from(` passes unchecked. `KirimForm.tsx` has two such calls
  and is not on the allowlist.
- **FIFO and availability are not owner-scoped (found while reading, pre-existing, undocumented).**
  - `attribute_chiqim_line_fifo` and `finished_calibre_availability` match on type + calibre
    only.
  - So Menejer's "Mavjud" counts every client's pallets, and Ombor's finalize can consume
    another client's pallets of the same type and calibre.
  - Needs a product decision.
- **KIRIM raw has no void path.** A `rezka-menejer` run that fails between intake and test 2's
  dispatch can leave `TEST-` raw in Ombor's pickers and badges. No app path can clear it.
- **Accepted raw has no void path, so any failed spec run strands `TEST-` raw in live queues**
  (Ombor Moyka/Tashqi pickers, intake Window 2, the Moykaga badge, Laborator KIRIM, the Menejer
  Xom pool). Needs either a `TEST-` filter on the Ombor/Laborator pickers or a void-raw RPC
  restricted to `TEST-` plates. Hit on 2026-09-28: the failed `rezka-menejer` run left
  `280926-009` (Moyka, 10 kg) and `280926-010` (Rezka, 30 kg).
  - 010 was cleared through app flows as TEST Ombor: sent 30 kg, received 30 kg Standard
    (auto-close), pallet voided.
  - 009 was lab-tested Naturel as TEST Laborator; its 10 kg raw is still live, pending a
    decision (see the next item).
- **`hasRawRemainder` ignores raw dispatch (pre-existing).**
  - The Moykaga badge and Ombor intake Window 2 use `hasRawRemainder(actual, moyka_sent)` for
    Moyka serials.
  - So a Moyka serial whose raw was dispatched on a Xom CHIQIM still shows "Qoldiq X kg" in
    intake Window 2 and still counts in the badge. The Moyka picker (`available > 0`) correctly
    drops it.
  - Affects real serials, not just tests. `MoykaSendSection`'s header comment already
    acknowledges the divergence.
- Intake and gate history screens are not badged. `useIntakeHistory` now carries `process`,
  but the UI does not show it.

## Reported, not patched — must also exclude / handle `process='rezka'` (for Prompts 2/3) — ✅ all resolved in Prompt 2 (`0144` + frontend)

SQL (each needs its origin-filter category stated when touched — CLAUDE.md):
- `classify_kirim_line_sulfur` — Laborator sulfur classification; a Rezka line has no lab.
- `lab_turnaround_avg` — processing aggregate; Rezka serials never have lab rows, but exclude
  explicitly (CLAUDE.md "an exclusion that only works because the data happens not to
  overlap is not acceptable").
- `wip_rows` (raw_not_sent) — a Tashqi Rezka serial awaiting a Rezka send would show as idle
  *Moyka* raw.
- `yield_rows` — Moyka yield; structurally gated on `wash_cycles`, exclude explicitly.

Frontend:
- `OmborIntakeTab` — Window 2 "remaining" / `hasRawRemainder` counts Rezka serials as
  awaiting a Moyka send.
- `OmborHome` badges (Moyka count via `useMoykaSerials` / `hasRawRemainder`) — would count
  Rezka serials in the Moyka badge.
- `OmborMoykaTab` Window 1 list (built from the same hook) — Prompt 2's Moyka/Rezka pill
  must split it by `process`.

## E2E test follow-ups (found while getting test 6 green)
- **TEST Rahbar's password in `.env.test` is stale** (2026-09-28): the auth log shows `400
  invalid_credentials` for `900000001` and the account's last successful sign-in is
  2026-08-12. `rezka-hisobot` test 3 is the only spec that logs in as Rahbar. The account is
  fine (active, confirmed, role `rahbar`). Fix `.env.test` locally; `loginAs` now fails fast
  with the login error instead of hanging on the URL wait.
- **TEST- plate filter for Ombor section 3 Window 2 (Rezka).** `rezka-ombor.spec.ts` voids its
  pallets and closes its cycles, but the TEST serials stay listed as closed rows in
  "Qabul qilingan seriyalar": `useRezkaOutput().received` has no TEST- filter. Add one, same
  family as `isTestPlate()`, to that window only; the live windows are unaffected once cycles
  close.
- **`seedDispatchablePallets` (`tests/e2e/helpers/fixtures.ts`) writes the outdated
  `wash_cycles` shape.** It inserts `{ serial, status: 'final', final_loss_pct: 0 }`, which
  predates `cycle_no`/`opened_at`/`closed_at` (0124). Its `window.supabase` type also lacks
  `auth`, which is a tsc error at line 199. Unused by the Rezka spec; any spec that still calls
  it needs it updated.
- Update the stale Ombor link names (`Moykaga Chiqarish` / `Tayyor Mahsulot` / `Skladga
  KIRIM` / `Skladdan CHIQIM` → `Moykaga` / `Tayyor` / `KIRIM` / `CHIQIM`, `exact: true`) in
  `tests/e2e/lab-packing-hard-gate.spec.ts`, `lab-relocation-loss-verification.spec.ts` and
  `path-e-multi-cycle-residual-reprocess.spec.ts` — same drift `full-chain.spec.ts` had.
  They may carry the other two drifts as well (`yield_rows` open-serial rows, CHIQIM tara).
- Delete `tests/e2e/chiqim-undo-scan.spec.ts`: it tests the scan-to-load flow whose
  `chiqimScan.ts` was removed with the 0087–0092 FIFO dispatch.
- `full-chain.spec.ts` breaks two CLAUDE.md testing rules: it uses real-looking plates
  (`uniqueRealLookingPlate()`), not the `TEST-` prefix, and its `afterEach` teardown
  (`tests/e2e/helpers/teardown.ts`) **hard-deletes** its chain instead of voiding it. The
  plates were chosen deliberately (several views exclude `TEST-%` plates, so a `TEST-` run
  would be invisible to what it asserts), so fixing it needs a design decision, e.g. a
  dedicated test-owner filter instead of plate prefixes. Not changed.

## Notes for the next prompts
- **Prompt 2 (Ombor):** Tashqi send = `ensure_open_rezka_cycle` + a `rezka_sends` insert
  (RLS `ombor_writes`), picker = `useMoykaSerials` rows with `process='rezka'` and
  `available > 0`. Ichki = `send_kn_to_rezka`; UI warning (never a block) under 10 kg.
  Receive = `FinishedReceiptForm rezka`, no lab gate, then `close_rezka_cycle_if_settled`;
  Window membership = `isInRezka`; loss = `computeRezkaLossDisplay`; Yakunlash =
  `close_rezka_cycle_serial`. No printing on the Rezka path. New hooks on React Query;
  writes via `src/lib/rpc.ts`.
- ~~**Prompt 3 (Menejer):** KIRIM per-line process select; CHIQIM Rezka tab = ordinary
  `finished` line on the Standard calibre. Migrate `useAvailableFinishedStock` onto React
  Query while there (`docs/decisions/0223`).~~ Done — see Prompt 3 above.
- ~~**Prompt 4 (Hisobot/dashboard/qoldig'i):** Rezka directions, Yangi/Eski/Rezka toggle,
  passport Rezka lines.~~ Done — see Prompt 4 above (Standard excluded from the
  `isNumberless` sums in `computeDashboardDerived`). `RahbarHome` `grandTotal` and the client panel mirror read the
  snapshot keys by name — `rezkaRawKg`/`rezkaKnKg` are new and currently unread; `byCalibre`
  still carries Standard with `isNumberless: true`, so any frontend that sums
  `isNumberless` rows must exclude `is_rezka_output`.
- Pre-existing, flagged: dispatch verdict gates read an unordered first wash cycle
  (`docs/decisions/0223`); `get_client_report.finished.byCalibre` has no `ORDER BY`.
