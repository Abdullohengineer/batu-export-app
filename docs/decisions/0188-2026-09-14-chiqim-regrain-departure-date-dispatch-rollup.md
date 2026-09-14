# Regrain Chiqim onto consumption events, fix departure-date basis, roll up to one line per dispatch

## What changed

Three changes to the CHIQIM side of the Hisobot report engine, applied
together as one new `_v2` layer alongside the pre-existing (untouched)
`report_chiqim_rows`/`report_raw_dispatch_rows`/`report_old_kn_rows`/
`report_filtered_rows`/`report_query_page`(13-arg)/`report_totals`(13-arg)
objects — those stay live, unchanged, solely for `fetchVoidedBarcodeMatch`'s
identity lookup (see `ChiqimReportRow`'s comment in `reportQuery.ts`).

**Change 1 — regrain onto consumption events.** `report_chiqim_rows_v2`/
`report_raw_dispatch_rows_v2`/`report_old_kn_rows_v2` anchor on
`chiqim_pallet_consumption` (resp. `raw_dispatch_lines`/`old_kn_collections`,
which were never grain-buggy) as the FROM, not `finished_pallets`. A pallet
consumed across N requests now produces N rows; `qty_kg` is always the
consumption row's own `qty_kg`, never book weight (`finished_pallets.weight_kg`).

**Change 2 — departure-date basis.** `date_basis` on all three `_v2` views
is `chiqim_departed_at(request_id)`, not `chiqim_requests.request_date` —
applied to raw/old-KN too even though they were immune to the grain bug, so
every CHIQIM-family row now shares one date concept. **Null-departure rule:
excluded, never falls back to `request_date`** — same precedent as
`report_filtered_rows`'s existing `date_basis IS NULL` handling for
`omborda`/`band_qilingan` pallets ("a non-dispatched pallet has no dispatch
date to anchor a CHIQIM-direction date-range filter on — expected, not a
bug"). Approved as recommended.

**Change 3 — one line per dispatch.** `report_dispatch_rows_v2(p_kinds, ...)`
groups by `chiqim_requests.id` (the shipment entity), summing whichever
components pass the active filters — **"at least one component matches"**
semantics, identical to `report_moyka_output_rows_by_serial`'s own
precedent for MOYKADAN. `report_filtered_rows_v2` unions this in place of
the old bare chiqim/chiqim_raw/chiqim_old_kn selects; `report_query_page`/
`report_totals` (14-arg overloads) are rewired to call it. Signatures/
return shapes of both are **unchanged** from before this task.

Archived SQL: `docs/data-corrections/2026-09-14_chiqim-regrain-departure-date-dispatch-rollup.sql`.

## Two independent bugs this fixes

1. **"Latest touch wins" swallowed history.** The old grain attributed a
   pallet's *whole* book weight to whichever `chiqim_pallet_consumption` row
   touched it most recently, silently dropping any earlier partial
   consumption from the report entirely — a multi-request pallet reported
   as one row, at book weight, dated by (and attributed entirely to) its
   last touch.
2. **Request-date, not departure-date.** `date_basis` read
   `chiqim_requests.request_date` (when the request was opened/entered),
   not when the truck actually left — already known to disagree with
   reality for `chiqim_pallet_status`'s own `pallet_status` derivation,
   which already used `chiqim_departed_at`. The date basis was the one
   place still reading the wrong column.

## Consumer audit

- **`ReportTableRow.tsx` / `ReportRowCard.tsx`** — rewritten: removed
  `chiqim_raw`/`chiqim_old_kn` branches everywhere (direction, serial,
  type, calibre, status, expand-panel), added the `chiqim_dispatch` case
  throughout. `STATUS_LABEL` (dead after the removal) deleted.
- **`reportExport.ts`** — `directionLabel`/`statusText`/`columnValue`
  updated for the new kind; `buildReportWorkbook` extended with a second
  worksheet (`fetchChiqimDispatchDetailRows`, new file
  `src/lib/chiqimDispatchDetail.ts`) so an export with any `chiqim_dispatch`
  row gets both a request-grain summary sheet and a component-grain detail
  sheet.
- **`ClientPrihodTab.tsx`** — **zero impact, confirmed both at proposal time
  and re-verified against the final wired implementation.** It hardcodes
  `directions: ['kirim']`; `report_totals(['kirim'], full year)` returns
  `total_kg_out = 0` live, proving no chiqim-family leakage through the
  shared RPCs it calls unmodified.
- **`ReportFilterBar.tsx`** — audited, no change needed. Its
  `DIRECTION_OPTIONS`/`ReportRowKind` is the FILTER checkbox vocabulary
  (`'chiqim' | 'chiqim_raw' | 'chiqim_old_kn'` stay 3 independently-checkable
  boxes, deliberately unchanged), distinct from the row-kind union
  `ReportRow` actually renders — `report_filtered_rows_v2` narrows these 3
  legacy strings into `p_kinds` server-side. **One real staleness found and
  fixed here**: `KIND_DATE_BASIS_LABEL`/`dateBasisLabel()`'s fallback text
  in `reportQuery.ts` still read `"so'rov sanasi"` (request date) for all
  three chiqim kinds — stale since Change 2, missed in the original
  consumer grep because it's a string constant, not a `row.kind === ...`
  comparison. Fixed to `"jo'natilgan sana"` (departure date).
- **`HisobotTab.tsx`** — audited, no chiqim-kind references at all.
- **`reportQuery.test.ts`** — `rawDbRow()`/its 2 tests (the only fixture
  using the now-invalid `kind: 'chiqim_raw'`) replaced with
  `chiqimDispatchDbRow()` and 3 tests covering field mapping, null
  fallbacks (`requestId`/`plate`/`driver` → `''`), and numeric coercion.
  `chiqimDbRow()` and its 6 tests (still valid — `ChiqimReportRow` itself
  is unchanged, still `fetchVoidedBarcodeMatch`'s return type) untouched.
  All 12 tests pass (`npx tsx --test src/lib/reportQuery.test.ts`).
- **`ChiqimReportRow.key`** changed to the consumption row id (was
  `barcode2`-derived) — approved, since barcode2 is no longer unique per
  row under the new grain even on this legacy view's own read path.
- **`OldKnRequestPassportModal`** drill-down preserved — re-wired into the
  new `ChiqimDispatchRowDetail.tsx` expand panel via `onOpenOldKnRequest`,
  rather than left silently unreachable now that `chiqim_old_kn` rows don't
  surface at the top level.
- **Deleted** (confirmed fully orphaned): `ChiqimRowDetail.tsx`,
  `RawDispatchRowDetail.tsx`, `OldKnRowDetail.tsx`.

`npx tsc --noEmit` — clean throughout. Note: TypeScript does **not** error
on a stale `row.kind === 'chiqim_old_kn'`-style comparison against a
literal no longer in the union — it silently narrows to `never` instead, so
a clean `tsc` run does not by itself prove every consumer was caught; each
file was manually re-read, not just type-checked.

## Post-hoc hardening: empty-array `p_kinds` footgun

Found while writing this entry up, same day. `report_dispatch_rows_v2`'s
match clause originally read:

```sql
(p_kinds is null or array_length(p_kinds, 1) is null or comp_kind = any(p_kinds))
```

`array_length()` of an **explicitly empty** array is `NULL` in Postgres
(not `0`), so this silently treated "caller computed zero overlapping
kinds" the same as "no restriction" — matching *every* component instead
of none. `report_filtered_rows_v2` computes `p_kinds` by intersecting the
caller's direction filter against `['chiqim','chiqim_raw','chiqim_old_kn']`
— e.g. `directions: ['kirim']` alone intersects to `{}`. Confirmed live:
`report_dispatch_rows_v2(array[]::text[], ...)` returned 10 rows before the
fix, where it should return 0.

Currently **inert** for every real caller: `report_filtered_rows_v2` wraps
the call in its own outer `p_directions && array['chiqim',...]` guard that
discards the whole union branch whenever the intersection would be empty —
so nothing live was actually wrong. But that's "correct only because the
one caller happens to guard first," exactly the shape CLAUDE.md's
origin-filtering section calls out ("an exclusion that only works because
the data happens not to overlap is not acceptable — make it explicit").
Fixed at the source: dropped the `array_length(...) is null` clause, so an
explicit empty array now means "matches nothing"; only bare `null` means
unrestricted. Verified: empty-array call now returns 0 rows; null-kinds
call still returns all 10; August/Sep1-12/full-year totals unchanged.

## Void-pallet exposure — not fixed, stays logged

Out of scope per the task's own instruction, checked whether the regrain
fixes it incidentally: it does not, structurally. A voided pallet
(`finished_pallets.status = 'bekor_qilindi'`) with a `chiqim_pallet_consumption`
row would still report weight under the new grain, same as the old one —
the regrain changes *attribution*, not the *exclusion* rule. Live check:
0 such rows currently exist (`finished_pallets` joined to
`chiqim_pallet_consumption` where `status='bekor_qilindi'` — 0 rows), so
not currently manifesting, but the exposure itself is unchanged and remains
logged, not closed.

## Moyka-internal identity gap — untouched

The −17,830 kg Moyka-internal identity gap (`docs/decisions/0186-...`) is
unrelated to CHIQIM's own grain and was not touched by this task, per its
own explicit exclusion.

## The five phantom-weight/misattribution instances

Two genuinely different problems hid under one "phantom weight" label
during the investigation — this entry separates them now that the full
per-consumption trace is available:

**Pure period-misattribution (fully resolved by Changes 1+2 — no residual
gap, only the month it lands in changed):**

| Barcode2 | Book kg | Consumed kg | Events |
|---|---|---|---|
| `PLT-110826-002-04-2` | 1,060 | 1,060 | 590 kg Aug 30 (`d43103ff`) + 10 kg Aug 28 (`061ac7f8`, see correction below) + 460 kg Sep 12 (`545883f6`) — 3 requests, 2 months |
| `PLT-110826-001-02-3` | 1,350 | 1,350 | 10 kg Aug 28 (`061ac7f8`) + 1,340 kg Sep 12 (`545883f6`) — **answers the user's own question: this pallet's correction does NOT land entirely within the September window** — 10 kg of it is now August, 1,340 kg September; the two sum back to book weight, so the aggregate/full-range figure nets to zero, but the split itself is real |

**Genuine book-vs-consumed gap, NOT resolved by this task (no consumption
event accounts for the difference — stays flagged, physical verification
needed, per CLAUDE.md "declared vs actual is a finding, not an error to
fix"):**

| Barcode2 | Book kg | Consumed kg | Gap |
|---|---|---|---|
| `PLT-110826-003-02-2` | 760 | 450 | 310 |
| `PLT-020826-034-06-5` | 720 | 700 | 20 |
| `PLT-150826-001-04-1` | 4,260 | 3,770 | 490 — **new, fifth instance**, found during Change 3, not in the original four-pallet investigation. User will verify physically. |

The original "940 kg" figure (600+310+20+10) from the earlier investigation
measured pure over-reporting across four pallets at a specific point in
time, before several of this session's other corrections (including
`061ac7f8`'s own departure-date fix) shifted the picture — per the user's
own correction, superseded by 910 kg/29,000 kg as the September reconciliation
target, itself now superseded again (for a different, unrelated reason —
see next section) by the restored 28,970 kg figure.

## Data correction: `061ac7f8` departure timestamp (isolated)

Found mid-Change-3, while wiring the rollup: September 1–12 showed **three**
dispatch lines, not the expected two — request `061ac7f8` (plate PIYODA,
30 kg) genuinely departed 2026-09-02 under `chiqim_departed_at`.

User's diagnosis, confirmed correct: the goods physically left 2026-08-28
(matching `request_date`); `ombor_finished_at = 2026-09-02 05:31` was when
the Ombor operator got around to entering the record, not the real
departure. Change 2's logic was not at fault — this one record's data was.

**Systemic check performed before applying** (required — "if several show
the same late-entry pattern, departure date is less trustworthy than
Change 2 assumes"): of all 10 live `chiqim_requests` with
`ombor_finished_at` set, only `061ac7f8` crosses a month boundary.
`d43103ff` has a 2-day gap but stays within August; every other request has
`gap_days = 0`. Corroborating evidence: `061ac7f8` was created by a
distinct operator account (`b9513ec3...`) from every other live request
(all created by the normal Ombor account, `13a62281...`) — consistent with
a backfilled entry. **Confirmed isolated, not systemic** — Change 2's
departure-date basis remains the right design.

Fixed: `ombor_finished_at` → `2026-08-28T12:00:00+00:00`, dry-run → paired
`audit_log` row (id 1356) → applied, standard discipline. Archived:
`docs/data-corrections/2026-09-14_061ac7f8-ombor-finished-at-correction.sql`.

**Caveat worth carrying forward** (not fixed now, per instruction — just
noted): the departure-date basis is only as good as the timestamp entry.
Late entry of `ombor_finished_at` silently moves a dispatch into the wrong
month, and there is currently nothing flagging a large request/departure
gap for review. Worth considering a warning later.

## Before/after reconciliation

All figures below are `report_dispatch_rows_v2`/`report_totals` live
results, post all three changes AND the `061ac7f8` correction:

| Scope | Total | Lines |
|---|---|---|
| August 2026 | 69,151 kg | 8 |
| September 1–12, 2026 | **28,970 kg** (exactly matches the user's restored expectation) | **2** (`4b639af5` 8,640 + `545883f6` 20,330) |
| August + September combined | 98,121 kg | — |
| Full year 2026 | 98,121 kg | 10 |

Full year matches August+September exactly — all live dispatch activity
falls in those two months.

Roll-up integrity: every one of the 10 live Aug–Sep dispatch lines' summed
`qty_kg` equals the sum of its own matching components, exactly, checked
row by row.

## Приход impact

Re-confirmed against the final wired implementation (not just the proposal):
`report_totals(['kirim'], '2026-01-01','2026-12-31', ...)` → `total_kg_out
= 0`. `ClientPrihodTab.tsx` never touches chiqim-family rows; the
`total_kg_out` CASE addition (`'chiqim_dispatch'` alongside the 3 legacy
kind-strings) is structurally inert for a KIRIM-only filtered set regardless
of scope.

## Regression tests

`tests/e2e/chiqim-regrain-dispatch-rollup.spec.ts` — 4 read-only tests
against real business data (same carve-out as
`moykada-yoqotish-invariant.spec.ts`; no fixtures seeded, nothing to tear
down), using `PLT-110826-002-04-2` itself as the "3 requests, 2 months"
case — no synthetic fixture needed, this real pallet already is that shape:

1. **Per-event integrity** — `report_chiqim_rows_v2` returns exactly 3 rows
   for this barcode, each at its own `qty_kg` (10/590/460), never at book
   weight (1,060); the three sum back to book weight.
2. **Period immutability** — this pallet's August total (600 kg) is
   independent of its September event (460 kg).
3. **Additivity** — August (69,151) + September (28,970) = the combined
   range = the full year (98,121).
4. **Roll-up integrity** — every dispatch line's `qty_kg` equals the sum of
   its own matching components, checked across all 10 live Aug–Sep lines.

🚩 **Not run in this session.** This environment's container has no
`.env.test` (gitignored, absent from a fresh checkout) and `@playwright/test`
is not resolvable from `playwright.config.ts` here — `npx playwright test
--list` fails at `ERR_MODULE_NOT_FOUND` before even reaching the missing
credentials. The 4 assertions above were independently verified via direct
SQL against the live project (same numbers, same logic, run through
`mcp__Supabase__execute_sql` rather than through the browser/RLS path) —
see the Before/after and reconciliation sections above — but the spec
itself has not been executed end-to-end in this session. Flagging
explicitly per CLAUDE.md rather than claiming a run that didn't happen; run
it for real the next time this environment (or one with `.env.test` and a
working Playwright install) is available.

## Related

- `docs/decisions/0187-2026-09-14-110826-001-closed-at-restored-to-august.md`
  — the preceding, unrelated data correction (110826-001's `wash_cycles.closed_at`),
  applied and committed separately.
- `docs/decisions/0186-2026-09-14-moykada-yoqotish-period-scoping.md` —
  establishes the "correct only because the data happens not to overlap is
  not acceptable" principle this entry's hardening fix follows.
- `docs/decisions/0166-2026-09-03-hisobot-moykadan-per-serial-rows-migration-0111.md`
  — origin of the "at least one component matches" rollup semantics this
  entry reuses for CHIQIM.
