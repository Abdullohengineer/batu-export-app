# Rezka Prompt 4: the reporting layer (Hisobot, dashboard, qoldiq, passport)

Rezka Prompt 4 of 4, and the end of the Rezka build. Spec: `docs/SPEC.md` §3.2.11 and §5.R.2
(v1.70). Builds on `0219`–`0225`. Migration `0146_rezka_reporting.sql`, applied 2026-09-28 09:32
UTC (version `20260928093230`) with approval. Stored md5 of the statement is
`fecdbebdf6e3bff4d69e5e7408b85776`, matching the file (41,906 bytes).

Rule for the whole prompt: **no new balance calculation.** Every figure points at an existing
read: `report_kirim_rows`' effective_qty ladder, `report_moyka_output_rows`' pallet status and
exclusions, `report_chiqim_rows_v2`'s consumption rows, `rezka_sends`, `rezka_kn_draws`, and
`rezka_cycles` with `close_rezka_cycle_serial`'s window rule.

## 1. R1: a parallel view, not new columns

`report_rezka_rows` has the same columns, in the same order, as `report_rows_v2`.

**Why not widen `report_rows_v2`:** every engine function returns `SETOF report_rows_v2`, so
widening that row type would force a rewrite of all of them. A same-shaped view slots into
`report_filtered_rows_v2` as one more UNION branch.

**What travels through enrichment instead:** Manba, parent barcodes and Rezka serial state go
through the existing per-page enrichment (`report_page_enrich`, keyed by serial), exactly as the
Moyka serial state does. The Excel export's full-set read, `report_query_page`, carries the same
four columns.

**Group rule:**
- `p_directions` null or empty still means every **Oddiy** kind, so every existing caller is
  unchanged.
- Rezka kinds come back only when named.
- The frontend sends all four Rezka kinds by name when the Rezka group has nothing checked
  (`effectiveDirections`).

**Rezka lines leave every Oddiy kind:**
- `kirim`;
- `moyka_output`;
- the pallet component of the `chiqim` dispatch row.

Xom dispatch of Tashqi Rezka raw **stays Oddiy `chiqim_raw`**, because Rezka chiqim is
consumption on Rezka pallets.

## 2. Rezka chiqim date basis: departure, same as Oddiy (finding)

Checked live before applying:
- `report_chiqim_rows_v2`, the source of every Oddiy dispatch row, dates by **departure**:
  `chiqim_departed_at`, as a UTC date.
- Only the retired v1 `report_chiqim_rows` used `request_date`. That is where the 2026-07-30
  "request date" wording comes from, and it no longer describes anything on screen.

So Rezka chiqim uses `report_chiqim_rows_v2`'s own `date_basis` (`date_basis_source =
'departed_at'`) and counts departed requests only, in both groups. There is one dispatch date
basis across Oddiy and Rezka (product-owner decision, 2026-09-28). The on-screen label is the
same "jo'natilgan sana".

## 3. The `_core` rename

`rahbar_stock_snapshot(text)` and `get_serial_passport(text)` were renamed to `*_core`. Both
bodies are kept verbatim; none of the 17k-character passport body was retyped. New wrappers
under the original names add:
- `rezkadaKg` on the snapshot;
- `rezkaDrawsOut` and `rezka` on the passport.

**The wrapper is the only public name.** Callers keep calling `rahbar_stock_snapshot` /
`get_serial_passport`, and nothing in `src/` references `_core`.

Any future change to either function edits the `_core` body, with a new `create or replace ...
_core`. The wrapper stays a one-line merge.

## 4. The leak 0146 fixed (regression finding)

Before 0146, four TEST Ichki mints appeared in Oddiy MOYKADAN at 0 kg: `280926-006`, `-013`,
`-020` and `-027`, all with plate `QAYTA-ISHLASH`.
- **Cause:** their own plate is not `TEST-`, so the plate-based TEST exclusion missed them.
- **Fix, two parts:**
  - The Oddiy sources now drop every Rezka line.
  - `rezka_serial_is_test` treats a mint as TEST when any parent pallet's order is `TEST-`.

## 5. Regression after apply (re-read live)

Everything in the Oddiy regression set is identical, except the four leak rows.

| Read | Result |
|---|---|
| `rahbar_stock_snapshot` yangi / eski / hammasi | identical (`3bb0e136…`, `4b70a6a6…`, `8eefe8f2…`) |
| Passports, 8 real serials | identical (`b6d35913…`) |
| Page enrichment | identical (`4da9b025…`) |
| Page rows | `8d7ebca2…`, n = 104: the pre-apply 108 minus the four leak rows (re-hashed with them excluded: same hash) |
| Excel export rows | `9ae2b0d0…`, n = 104: same |
| `report_totals` | see below |

`report_totals` changes:
- Changed only by the leak rows:
  - count 108 → 104;
  - serial count 39 → 35;
  - Qabul qilingan 283,636 → 283,536 (−100).
- Unchanged: every other figure, including Kirim 223,736 and Chiqim 158,288.

`report_rezka_rows` currently returns 0 rows: all Rezka data in the project is TEST.

## 6. R5 reconciliation identity (TEST Rezka E2E owner, all 11 Rezka serials)

Computed from the underlying sources **without** the TEST filter, every term shown:

| Side | Term | kg |
|---|---|---|
| In | Tashqi qabul (all; 90 of it gate-completed) | 490 |
| In | Ichki mints (KN drawn) | 100 |
| **In total** | | **590** |
| Out | Raw unsent | 0 |
| Out | Xom dispatched | 0 |
| Out | Rezkada, open cycles | 0 |
| Out | Realized on closed cycles (signed) | 590 |
| Out | Pallets in stock | 0 |
| Out | Departed (non-void) | 0 |
| Out | Pending | 0 |
| Out | Storage loss | 0 |
| **Out total** | | **590** |

590 = 590.

For information: 606 kg of pallet weight is voided. That includes 30 kg that had already
departed, which is the cleanup bug in §7.

## 7. Spec cleanup bug: voiding departed pallets (fixed)

The dry-run preview showed `PLT-280926-024-RKN-1` (30 kg, departed on a Rezka CHIQIM) as
voided, so its serial's Olib ketilgan read 0.

**Cause:** `rezka-menejer`'s `afterAll` voided every pallet with `status='in_stock'`. A pallet's
status never leaves `in_stock` when it is consumed or departs, because consumption lives in
`chiqim_pallet_consumption`. So the cleanup rewrote history.

**Fix:** a new `voidPalletsWithStock` in `tests/e2e/helpers/teardown.ts`.
- It voids only barcodes with `finished_pallet_availability.available_kg > 0`, the pallets still
  on the shelf.
- Used by `rezka-menejer` and `rezka-ombor`. `rezka-ombor`'s blanket `voided_at is null` void
  had the same flaw for fully drawn KN pallets.

`PLT-280926-024-RKN-1` itself stays voided. It is TEST data, and void is one-way by design.
Logged in HANDOFF.

## 8. Frontend decisions

**Hisobot:**
- The group switch is `ReportFilters.group`. It is optional, so a saved filter from before
  loads as Oddiy.
- Each column carries an optional `group` tag. The picker and table list only the active
  group's columns.
- Each group keeps its own saved column set: `hisobot.columns` is unchanged, and
  `hisobot.columns.rezka` is new.

**Why the Rezka state columns are "(jami)":**
- `rezka_serial_state_set` is lifetime, and there is no range-scoped per-serial Rezka figure.
  Adding one would be a new balance calculation.
- So the columns are labelled "(jami)" and totalled once per distinct serial, like the Moyka
  lifetime twins.
- The period flows are separate "(davrda)" chips from the row sums (`total_kg_to_rezka` /
  `total_kg_from_rezka`), never under the same name.
- Rezkadan chiqgan reuses the bundle's lifetime Moykadan chiqgan. For a Rezka serial, that
  figure *is* the Rezka output.

**Totals rule, as built in `report_totals`:**
- Tashqi Rezka kirim (row key `rezka-kirim-%`) counts in Kirim; an Ichki mint does not.
- Rezka chiqim counts in Chiqim.
- Rezka send and output count in neither.

**Dashboard:**
- `rezka` is a UI-only fourth scope; it reads the `hammasi` snapshot, because the Rezka keys
  are scope-independent.
- No ledger charts under Rezka.
- `computeDashboardDerived` now drops the `is_rezka_output` calibre. It is numberless, so
  otherwise it was drawn as a second KN bar and counted in the KN dispatch figure. This was the
  Prompt 3 HANDOFF note.
- The client Панель shares this function, so its Oddiy bars lose Standard too. That is
  consistent with `konditirskiyKg`, which already excludes it.

**Qoldiq:**
- `useStockOnHand` reads the `process='rezka'` serial set in the same query, via `run()`, and
  marks rows `isRezka`.
- This read is required, not tolerated like the turnaround stat. Without it, a Rezka row would
  silently render as Joriy.
- The Rezkada caption reads the same snapshot figure as the dashboard.

## 9. Verification

- **Checks run:** `tsc -b`, lint (the 2 pre-existing warnings only), `npm test` (86, including 5
  new Rezka mapping and group tests), `lint:rpc-wrapper`, and the build.
- **New spec `tests/e2e/rezka-hisobot.spec.ts`**, read-only. Its DB checks re-derive the Rezka
  figures from base tables:
  - state set;
  - passport Rezka block and parent `rezkaDrawsOut`;
  - snapshot keys;
  - the group rule on `report_query_page_rows` / `report_totals`.

  Its UI checks cover the selector and the four directions, qoldiq's Rezka switch and the
  dashboard's Rezka tiles.
- **What ran here, and what did not:** the DB assertions were run as equivalent SQL against the
  live project and pass (Oddiy leaks 0, Rezka totals columns present, `rezkaDrawsOut` =
  `rezka_kn_draws`). The Playwright run itself needs `.env.test`, which this container does not
  have, so it is still to be run locally.

## 10. Flagged, not fixed

- **`rahbar_dashboard_ledger` still reads Rezka raw as Oddiy raw.**
  - Its raw ledger filters by `origin` only. So a Tashqi Rezka line is in `receivedKg`/
    `closingKg` at Yangi and Hammasi, while the snapshot moved Rezka raw out of `rawKg` (0143).
  - Its `byCalibreType.dispatched` also carries Standard.
  - The frontend now drops Standard from the bars; the raw ledger needs SQL.
  - Currently 0 kg live (all Rezka is TEST).
- **The Hisobot Excel export writes the Partiya column blank (pre-existing).** `columnValue` in
  `src/lib/reportExport.ts` has no `'partiya'` case. Unrelated to Rezka.
- **A hard load of any deep route bounces to the role's home (pre-existing app race).**
  - Found when `rezka-hisobot` test 3 failed on `page.goto('/menejer/hisobot')`. Traced with a
    stubbed backend: `/menejer/hisobot` → `/login` → `/menejer`, before the profile request is
    even sent.
  - Mechanism, one render long:
    1. `useSession` sets the session and `loading=false` together.
    2. `useProfile` still holds `loading=false` from its earlier null-session effect; its fetch
       effect has not run yet.
    3. So `AuthProvider` reports "not loading, no profile", and `RoleRoute` redirects to
       `/login`, which bounces to the role's home.
  - A user refreshing Hisobot, or opening a bookmarked deep link, lands on KIRIM or the
    dashboard.
  - The same race affects every existing spec that deep-links after login:
    `hisobot-moykadan`, `hisobot-filter-debounce-consistency`, `moykada-yoqotish-invariant`.
  - Spec fixed to navigate via the sidebar, like every passing spec. The app is not changed.
  - Proposed fix: in `useProfile`, treat "session present but `profile?.id !== session.user.id`"
    as loading (derive it; don't keep a separate flag).
- **The export uses the draft filters while the totals come from the applied ones
  (pre-existing).** If the user edits filters and exports without pressing Qidirish, the rows
  and the summary can describe different sets. The group switch inherits this.
