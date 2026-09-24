# HANDOFF — Rezka build

Rezka is built in four prompts. Design audit: `docs/REZKA-AUDIT.md` (its wrong-premises list is
authoritative over the original brief). Rules: `docs/SPEC.md` §5.R. Decisions:
`docs/decisions/0219`–`0224`.

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

## Prompt 2 — Ombor sections 2/3 with a Moyka/Rezka pill (branch `rezka-prompt-2`) — BUILT, NOT APPLIED

**Status:** code complete on `rezka-prompt-2`; PR left for the product owner.
- **Migration `0144` is NOT applied to live yet.** Its SQL was approved, and the ROLLBACK dry run
  passed (`docs/decisions/0224`). Apply it only on the product owner's go.
- Local checks: `tsc -b` clean, `oxlint` 2 old warnings, `node --test` 81/81,
  `lint:rpc-wrapper` OK, build OK.

**E2E — the product owner runs it locally, next to test 6:**
`npx playwright test tests/e2e/rezka-ombor.spec.ts tests/e2e/full-chain.spec.ts`
(needs `.env.test` including `SUPABASE_SERVICE_ROLE_KEY`, and `0144` applied first).
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
- **Prompt 3 (Menejer):** KIRIM per-line process select; CHIQIM Rezka tab = ordinary
  `finished` line on the Standard calibre. Migrate `useAvailableFinishedStock` onto React
  Query while there (`docs/decisions/0223`).
- **Prompt 4 (Hisobot/dashboard/qoldig'i):** Rezka directions, Yangi/Eski/Rezka toggle,
  passport Rezka lines. `RahbarHome` `grandTotal` and the client panel mirror read the
  snapshot keys by name — `rezkaRawKg`/`rezkaKnKg` are new and currently unread; `byCalibre`
  still carries Standard with `isNumberless: true`, so any frontend that sums
  `isNumberless` rows must exclude `is_rezka_output`.
- Pre-existing, flagged: dispatch verdict gates read an unordered first wash cycle
  (`docs/decisions/0223`); `get_client_report.finished.byCalibre` has no `ORDER BY`.
