# Эski (ювилган) drill-down replaced with a type x calibre cross-tab table

## What changed

`OldStockDrilldown.tsx` rewritten: the "Эски (ювилган)" card's two
one-dimensional breakdowns (per-calibre bars, per-type bars added earlier
today in `0200`) are both replaced by a single cross-tab table — rows are
product types with nonzero Eski washed stock, columns are the fixed K1–K8
set (matching client Производство's own "always all fixed columns"
convention from `0203`), with an Итого column (row sums) and an Итого row
(column sums, grand total in the corner). Answers "how much K4 of Subxon
do I have?" directly, which neither of the two separate bar breakdowns
could.

"Старый склад Кондитерка" converted from bars to a matching simple table
(Вид сырья | кг, Итого row) for visual consistency with its neighbor —
same data (`oldKn: {totalKg, series}`, unchanged shape), only the
rendering changed from `HorizontalBar` stacks to a table.

Both tables wrap in `overflow-x-auto` with a `min-w` floor on the table
itself, per explicit instruction: wide-on-mobile scrolls horizontally
rather than shrinking text or hiding columns.

## Data path

No new query. `computeDashboardDerived()`'s `stockByType`/`regroupByType`
(the flat per-type bar totals from `0200`, now unused) replaced with
`stockByCalibreType`/`regroupByTypeCalibreCode`: the same
`snapshot.byCalibre` rows, Turlar-sliced identically, resolved straight to
calibre **code** (not raw `calibreId`) so `OldStockDrilldown` doesn't need
its own calibre lookup — it receives `{typeId, calibreCode, kg}[]`
directly and pivots client-side (group by `typeId`, then by
`calibreCode`, row/column/grand sums computed from the same cells, never
a second independently-fetched total).

🚩 **Flagged, not solved:** the cross-tab's columns are exactly K1–K8 —
old-washed stock in a KN/numberless calibre is structurally possible
(`regroupByTypeCalibreCode` explicitly excludes it) but has nowhere to
render in a fixed-8-column table. Currently 0 kg for the one real owner,
confirmed live (every `snapshot('eski').byCalibre` row is
`isNumberless: false` today), so no visible effect — would need its own
decision if that ever becomes nonzero.

## Verification

- `npx tsc -b`, `npx oxlint` (same 2 pre-existing warnings), `npm run
  build` — all clean.
- Live query against `rahbar_stock_snapshot('eski').byCalibre` for the
  TEST client, joined to `calibres`/`product_types` and pivoted in SQL the
  same way the new frontend code pivots client-side: **K1 column total
  1,430 kg and K8 column total 30,610 kg match exactly** the numbers the
  user had already reported seeing on the old per-calibre bar view before
  this fix — strong independent confirmation the new pivot's arithmetic is
  correct, not just internally consistent.
