# PROPOSAL (awaiting approval, no code written): React Query write-invalidation

Design-only, answering the three questions asked: which mutations invalidate
which queries, how factory-floor freshness is affected during the 30s stale
window, and whether any operator screen needs sub-30s freshness.

## The finding that shrinks this from "48 sites" to something small

**The cache barely touches the factory floor.** Only these read paths go
through React Query (`src/lib/queryClient.ts`, `useReportQuery.ts`):

| cached query | screens |
|---|---|
| `report_query_page` + `report_totals` | Hisobot (rahbar/menejer/ombor/qorovul) + client Приход |
| `rahbar_stock_snapshot`, `rahbar_dashboard_ledger` | Rahbar Bosh sahifa + client Панель |
| `get_client_report` | Mijoz hisoboti |
| `client_chiqim_ledger`, `client_production_ledger` | client Расход / Производство |

Every **operator work tab** — `OmborIntakeTab`, `OmborMoykaTab`,
`OmborTayyorTab`, `OmborChiqimTab`, both Qorovul tabs, both Laborator tabs,
Menejer's KIRIM/CHIQIM forms and lists — uses plain `useEffect` hooks
(`useIntakeLines`, `useMoykaSerials`, `useOmborChiqimRequests`,
`useStockOnHand`, `useKirimTrips`, `useChiqimTrips`, `useLaboratorKirim`,
`useLaboratorChiqim`) and already calls an explicit `refresh()` after its own
write. Those paths are **untouched by Phase 1B** and self-heal today.

Also worth stating plainly: **no mutations exist at all** under
`src/pages/client/*`, `src/pages/rahbar/*`, `src/pages/reports/*`, or the
users-admin page. Those roles are read-only, so the screens that *are* cached
are largely the screens that never write.

Inventory: 49 table/RPC writes + 7 storage uploads + 3 auth + 1 local pref,
across 19 files. Of those, **33 are LEDGER-affecting** (change kg/stock/dates
that a report or dashboard displays); the rest are incidental (photos, notes,
printer prefs, master data, auth).

## Which mutations invalidate which queries

**All of them invalidate all of it** — and that is the correct design here,
not laziness. Every cached query is an *aggregate report* over the whole
ledger: a single `finished_pallets` insert can move `rahbar_stock_snapshot`,
`rahbar_dashboard_ledger`, `report_totals`, `get_client_report`, and
`client_production_ledger` simultaneously. Building a per-mutation → per-key
map would be 33 × 7 judgement calls, each a chance to under-invalidate
silently, to save re-running queries that are cheap once Phase 3 lands.

So: `invalidateReportData()` (already exists, `queryClient.ts`, currently
zero call sites) after each of the 33 LEDGER mutations. Grouped by flow:

| flow | sites |
|---|---|
| KIRIM intake | `KirimForm.tsx:118,135`; `OmborIntakeTab.tsx:116,166`; `KirimOrdersList.tsx:148` |
| Gate weighing | `QorovulKirimTab.tsx:86,106`; `QorovulChiqimTab.tsx:104,127` |
| Moyka send | `OmborMoykaTab.tsx:83`; `OldStockToMoykaForm.tsx:106` |
| Lab result | `LaboratorKirimTab.tsx:77,120,161`; `LaboratorChiqimTab.tsx:91,138,179`; `classifySulfur.ts:35` |
| Wash cycle close | `OmborTayyorTab.tsx:135,146` |
| Finished pallet | `OmborTayyorTab.tsx:96` |
| CHIQIM dispatch | `ChiqimForm.tsx:228,247`; `OmborChiqimTab.tsx:345,378,403,438,445`; `FinishedChiqimList.tsx:102,146` |
| Old stock | `OldStockCloseoutTab.tsx:89`; `OmborChiqimTab.tsx:438` |

Mechanical: one `await invalidateReportData()` after each successful write,
next to the `refresh()` call most of these already make. **No cache-key
plumbing, no per-site judgement.**

The 16 incidental writes get nothing. Two are arguable and deliberately
included above rather than skipped: `classify_kirim_line_sulfur` (no kg, but
it is a Hisobot column and a dispatch gate) and `kirim_orders` date/plate
corrections (`order_date` re-buckets report rows).

## Factory-floor freshness during the 30s window

**Unaffected**, because the floor doesn't read cached queries:

| flow | what the operator looks at next | cached? |
|---|---|---|
| KIRIM intake | stays on OmborIntakeTab | no — `refresh()` + `refreshEffectiveQty()` |
| Gate weighing | same Qorovul tab | no — refreshed |
| Moyka send | Moyka Window 2 / Tayyor | no — refreshed |
| Lab result | same Laborator tab, W1→W2→W3 | no — refreshed |
| Finished pallet | Tayyor tab | no — refreshed |
| CHIQIM dispatch | OmborChiqimTab request list | no — refreshed |
| Old-stock closeout | OldStockCloseoutTab | no — refreshed |

The cache only bites when someone **crosses from a work tab into a report
screen** right after writing — ombor/qorovul → `/…/hisobotlar`, menejer →
`/menejer/hisobot`, rahbar → dashboard. There they'd see ≤30s-old numbers
missing their own write. At the measured **1.2 writes/hour**, that overlap is
rare; with invalidation wired, it's zero.

## Operator screens needing sub-30s freshness

**None among the cached queries.** The genuinely time-critical numbers all
live on uncached operator tabs.

🚩 But the inventory surfaced **three pre-existing staleness bugs on
`OmborChiqimTab`, unrelated to React Query and present before Phase 1**:

- `useFinishedCalibreAvailability` (`src/lib/useAvailableFinishedStock.ts:23-44`)
  has an **empty dependency array and exports no refresh at all** — verified
  directly. After finishing request A, the "Omborda mavjud: X kg" figure
  (`OmborChiqimTab.tsx:692`) and the over-availability warning (`:708`) still
  show the pre-A balance for request B on the same screen.
- `useStockOnHand()` (`OmborChiqimTab.tsx:124`) backs the old-KN pool balance
  (`:900`); `refresh()` at `:476` refreshes the request list only.
- `useMoykaSerials` raw balances (`:783`) — same gap after
  `raw_dispatch_lines` insert at `:403`.

**Severity, stated accurately:** these are misleading *hints*, not a
correctness hole. The hook's own comment records that
`attribute_chiqim_line_fifo` hard-fails server-side on insufficient stock, so
a stale hint cannot over-draw real stock — it can only mislead the operator
into attempting something the server then refuses.

**These need a different fix** (expose and call a refresh on those hooks),
not cache invalidation. Flagged, not bundled — they predate Phase 1 and
fixing them inside an invalidation PR would confuse two unrelated changes.

## Proposed sequencing

1. **Invalidation PR** — 33 one-line additions, no key mapping. Low risk,
   mechanical, reviewable as a single diff.
2. **Separate small PR** — refresh gap on the three `OmborChiqimTab`
   availability hooks.

Neither is written. Both await your go-ahead.

## Caveat on verification

The same limitation as Phase 1 applies: operator screens **cannot be
exercised in a browser from this environment** (proxy blocks
browser→Supabase; `.env.test` holds only `TEST_RAHBAR_*`). An invalidation
change touches 11 operator-screen files across every role, so it is exactly
the kind of change that wants a human click-through — or the TEST accounts
that would let the e2e suite cover it.
