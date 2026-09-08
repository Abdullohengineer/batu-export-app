## 2026-07-20 — Demo data for reporting pilot: seeded, deliberately non-TEST-, removal path documented

**Context:** the reporting engine (SPEC.md §3.2.1-3.2.4) had no realistic data to evaluate against — only the accumulated `TEST-`-prefixed automated-test fixtures (now excluded by the immediately-prior entry's filter) and a handful of pre-existing `Test Client A/B/C` rows predating the `TEST-` convention. Task: seed a small, realistic dataset that exercises every filter dimension and both dispatch outcomes, so Menejer/Rahbar can actually evaluate the Hisobot view before the pilot.

**Deliberately NOT `TEST-`-prefixed.** The whole point is to remain visible under `isTestPlate()` (`reportQuery.ts`), which excludes any `TEST-` plate unconditionally. Uses four brand-new clients and ordinary-looking plates/drivers instead: `supabase/seed/demo-data-2026-07-20.sql`, a single `do $$ ... $$` PL/pgSQL block, atomic (one failed statement rolls back everything).

**Nine "stories" (KIRIM orders), 2026-05-04 to 2026-07-20** — the eighth and ninth added incrementally (see below):
1. Boysun / Subxon, sulfur target, single cycle, fully dispatched incl. Konditirskiy.
2. Farg'ona / Isfara, natural, single cycle, partially dispatched (2 of 3 pallets left in stock).
3. Samarqand / Subxon + Qand qizil, multi-line — lineA dispatched, lineB's pallets deliberately left with no CHIQIM lab result yet (awaiting lab).
4. Toshkent / Subxon, re-wash (cycle 1 `qayta_yuvish` → cycle 2 `o'tdi`), Konditirskiy pallets from BOTH cycles left in stock forever.
5. Boysun / Isfara + Subxon, multi-line — lineA dispatched, lineB lab-passed but deliberately not dispatched.
6. Farg'ona / Qand qizil, natural, re-wash #2 (same shape as story 4, both cycle-2 pallets dispatched).
7. Samarqand / Subxon, KIRIM lab done, raw deliberately never sent to Moyka (still-in-storage raw stock).
8. Toshkent / Isfara, gate stage 1 only (no stage 2 → provisional `effective_qty`), no KIRIM lab result yet.
9. **Added mid-execution, on explicit request** ("nothing currently represents a batch with a `qayta_yuvish` verdict that hasn't been re-sent yet — that's a real WIP state the stuck-items view will need"): Samarqand / Isfara, cycle 1 fails lab (`qayta_yuvish`) and is voided, but deliberately has **no cycle 2 at all** — distinct from stories 4/6, which show the re-wash already completed. A small, self-contained append (no restructuring): reuses the same owner/product/calibre/profile IDs, needed zero changes to the cleanup script since it already scopes generically by owner_id through the same CTE chain.

**Row counts as executed** (verified by direct count against the same owner-scoped CTE the cleanup script uses, immediately after running the seed):

| Table | Rows |
|---|---|
| `owners` | 4 |
| `kirim_orders` | 9 |
| `kirim_lines` | 11 |
| `gate_weighings` | 15 |
| `storage_intake` | 11 |
| `lab_results` | 20 |
| `moyka_sends` | 11 |
| `wash_cycles` | 11 |
| `finished_pallets` | 26 |
| `chiqim_requests` | 6 |
| `dispatch_manifest` | 12 |
| **Total** | **136** |

**Pre-flight checks done before executing, not assumed:** all 11 hardcoded UUIDs the script references (3 product types, 4 calibres, 4 role profiles) verified live against the DB and matched their expected labels exactly. Confirmed the two capped queries `useReportQuery.ts` relies on (`storage_intake`, `dispatch_manifest`, both `FETCH_CAP=500`) had well under 500 rows each even after seeding (320→331 and 57→69 respectively), so none of the seeded rows risk being pushed out by newer unrelated test-run activity. Confirmed no owner-name collision with the pre-existing `Test Client A/B/C` rows.

**Verified live in Menejer's Hisobot (not just by re-reading the query code):**
- All nine stories' events render, unfiltered by `isTestPlate()`, at the full 2026-05-01–2026-07-20 date range.
- **Totals reconcile exactly against hand-computed expected values, cross-checked two different ways.** Owner-scoped: Boysun alone → Kirim 7,400 kg / Chiqim 6,050 kg (matches the multi-line-never-adopts-gate-net rule applied to story 5's two lines, 1,000 + 1,200 kg, each shown with its own truck-level `+100 kg farq` note rather than a redistributed value). Toshkent alone → Kirim 5,900 kg (4,100 gate net + 1,800 provisional intake) / Chiqim 2,450 kg. Cross-cut filter (direction=CHIQIM, Tur=Subxon, Kalibr=Kalibr 6, Laboratoriya xulosasi=O'tdi) → 5,750 kg across three different owners' pallets (Toshkent 1,150 + Samarqand 1,000 + Boysun 1,800 + 1,800), matching the sum of those four pallets' own `weight_kg` exactly.
- Filters checked individually and combined: direction, date range, owner, product type, calibre, wash cycle (`2+` correctly returns only story 4's cycle-2 pallets, excluding its still-in-stock cycle-1 Konditirskiy survivor), lab verdict.
- **Voided-Barcode-#2-findability (§3.2.2) confirmed working as designed, via the mechanism actually built — not the one a first guess would expect.** The "Bekor qilingan" status dropdown alone returns nothing for a voided pallet, because a voided pallet is never in `dispatch_manifest` and the CHIQIM query only reaches into `finished_pallets` directly when a Barcode #2 search string is present (`useReportQuery.ts`'s own comment on this). The actual findability path is the **exact-match red callout** above the table (`HisobotTab.tsx`'s `showVoidedCallout`), triggered by typing the barcode into the Barcode #2 field. Confirmed on two different pallets: story 4's `PLT-200726-216-06-1` correctly lists all three of its cycle-2 successors (including the Konditirskiy one); story 9's new `PLT-200726-222-06-1` correctly shows "Sikl 2 hali yangi barkod chiqarilmagan" (cycle 2 not yet issued) — the exact WIP state story 9 was added to cover.
- **Per-cycle loss% is NOT surfaced anywhere in this reporting view, by original Task 1 design, not a seeding gap.** `wash_cycles.final_loss_pct` isn't part of either `KirimReportRow` or `ChiqimReportRow` at all; `KirimRowDetail.tsx`'s own header comment says so explicitly ("NOT the full serial passport... no wash-cycle-by-wash-cycle breakdown" — that's §3.2.5, a different, not-yet-built view). What this view DOES correctly distinguish per cycle: the `Yuvish sikli` filter, each pallet's own cycle number, and — for a voided pallet — its cycle and successor-cycle linkage via the callout above. Story 4 and story 9 both exercise this correctly; neither shows a loss-percentage figure, because none of this reporting layer's rows carry one.

**Removability.** `supabase/seed/demo-data-2026-07-20-cleanup.sql` — a sequence of standalone `DELETE`s, each scoped by the four owner names via its own `WITH demo_owners AS (...)` CTE (repeated per statement, since CTEs don't persist across statements), chaining through orders/serials/requests/cycles as needed, in dependency order: dispatch chain → pallets/lab/wash/moyka chain → KIRIM intake/gate/lines/orders → owners last. Same deliberate append-only exception as the immediately-prior entry's `TEST-` deletion (this is disposable demo/pilot data, not operational data) — **run this before the pilot goes live on real client data**, or any time this demo set needs to be cleared and re-seeded.

**Testing.** `npx tsc -b --noEmit` clean. `npm test` 85/85 (unchanged — no pure-logic files touched by seeding). Full Playwright suite run once per the reduced-testing instruction: **9 passed, 4 failed.** Each failure isolated by re-running alone, not left as a single ambiguous full-suite number:
- `chiqim-flow.spec.ts` and `chiqim-full-chain.spec.ts` both **passed cleanly in isolation** — their full-suite failures were transient (one a plain login timeout), the same DB-growth/resource-contention flakiness this suite has repeatedly shown across many prior entries, unrelated to this seed.
- `laborator-chiqim-hard-gate.spec.ts` **fails deterministically (confirmed twice), and is a direct, traceable consequence of this seed's own data, not a new bug.** It asserts a hardcoded `/0 kg/` availability message for Subxon+Kalibr 6 — the exact fragility already flagged in an earlier entry ("depended on NO other unrelated Subxon/Kalibr 6 stock existing anywhere in the shared DB... don't hardcode one branch of a multi-branch UI message"). Story 5's lineB deliberately leaves a lab-passed, un-dispatched 600 kg Subxon/Kalibr 6 pallet in stock (exactly the "lab-passed but left in stock" scenario the task asked for) — the app now correctly reports real 600 kg availability where the test still expects zero. The app is behaving correctly; the test's assumption is what's now false. Not fixed — touching this test wasn't requested, and the task's own scope excludes new/modified e2e tests.
- `laborator-kirim.spec.ts` fails reproducibly but with a **different specific assertion each run** (once a `Yakunlangan` visibility timeout, once a `Sera kutilmoqda` count timeout) against **its own fresh, self-generated serial each time** — not a fixed collision with any specific seeded row the way the hard-gate test is. Traced to likely cause: `useLaboratorKirim.ts` does a fully unbounded, unordered-at-the-query-level fetch across `kirim_lines`/`storage_intake`/`lab_results` (486/343/248 rows at the time of this check) and stitches client-side; `kirim_lines` grew by ~176 rows in the few minutes between two direct counts taken during this same session, evidence of **active concurrent write load on this shared live DB from something other than this session** (this seed only added 11 `kirim_lines` rows). Most consistent with dataset-size/contention-driven timing flakiness, not a structural conflict with this seed's specific data. Flagged here, not fixed — out of scope, and not conclusively caused by this task's own changes.

**Out of scope, not touched (per the task):** the `-2,200kg` flaky race (diagnosed in the entry above, deliberately not re-opened), remaining §3.2 saved views, any app code changes, and the two test-fragility findings just above (neither is an app regression).
