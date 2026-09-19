import { QueryClient } from '@tanstack/react-query'

// Client-side read cache (2026-09-19, Phase 1B of the Hisobot/dashboard
// performance pass — see docs/decisions/ "Phase 1"). Before this, the app had
// NO caching of any kind: every mount re-fired every RPC, and because each
// tab is its own route, switching tabs unmounted the screen and re-issued the
// whole query set on the way back. The diagnosis measured three RPCs
// (report_query_page, rahbar_stock_snapshot, rahbar_dashboard_ledger)
// accounting for 64% of all database time, so removing redundant refetches is
// the single cheapest lever available.
//
// STALE_TIME is deliberately short (30s, not the 60s the brief suggested).
// The app currently has NO write-triggered invalidation wired into its ~48
// mutation call sites, so staleness is bounded by this value alone: after a
// write, the worst case a user can see is 30s-old numbers, and any tab
// refocus refetches sooner than that (refetchOnWindowFocus below). At the
// measured write rate (1.2 writes/hour) a collision is rare; explicit
// invalidation is a follow-up, not a silent omission — see
// invalidateReportData() below for the hook it will attach to.
const STALE_TIME_MS = 30_000
const GC_TIME_MS = 5 * 60_000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      gcTime: GC_TIME_MS,
      // Deliberately NO retry. Every query behind this client is a heavy
      // analytics RPC against a database that was, at diagnosis time, still
      // emitting `canceling statement due to statement timeout`. Retrying a
      // request that just timed out after 20s re-submits the same expensive
      // work and makes an overload worse, not better — the failure needs to
      // surface to the user, not be silently amplified.
      retry: false,
      // Bounds staleness without needing write-path invalidation: coming
      // back to the tab re-validates anything older than STALE_TIME_MS.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
})

// Query keys live here so an invalidation can never drift from the key a
// hook actually registers under.
export const queryKeys = {
  rahbarStockSnapshot: (scope: string) => ['rahbar_stock_snapshot', scope] as const,
  rahbarDashboardLedger: (from: string, to: string, scope: string) =>
    ['rahbar_dashboard_ledger', from, to, scope] as const,
  clientReport: (ownerId: string, from: string, to: string) => ['get_client_report', ownerId, from, to] as const,
  clientChiqimLedger: (key: string) => ['client_chiqim_ledger', key] as const,
  clientProductionLedger: (key: string) => ['client_production_ledger', key] as const,
}

// Call after any write that changes ledger/stock numbers, to drop the cached
// reads immediately instead of waiting out STALE_TIME_MS.
//
// 🚩 Not yet wired into the app's ~48 mutation call sites (19 files) — doing
// that blind, in the same PR that introduces caching and without the ability
// to exercise the operator screens in a browser from this environment, is how
// an operator flow gets broken. Deferred deliberately as its own small,
// reviewable change; until then STALE_TIME_MS + refetchOnWindowFocus are what
// bound staleness.
export function invalidateReportData(): void {
  queryClient.invalidateQueries()
}
