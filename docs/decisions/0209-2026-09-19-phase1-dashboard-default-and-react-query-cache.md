# Phase 1 (A + B): dashboard default period + client-side read cache

Acts on the diagnosis in `0207`/`0208` and the full diagnostic pass that
followed it. Phase 1 is the cheap, immediate-relief half: stop asking for
the widest possible data by default, and stop re-asking for data we already
have. No SQL, no schema, no RPC bodies changed.

## Why these two, from the measurements

A 17-minute window of real traffic (see caveat below) showed three RPCs
taking **64% of all database time** from 21 calls out of ~182 requests:

| RPC | calls | total ms | mean | max | share |
|---|---|---|---|---|---|
| `report_query_page` | 9 | 20,685 | 2,298 | **14,329** | 30.6% |
| `rahbar_stock_snapshot` | 6 | 12,449 | 2,075 | 3,456 | 18.4% |
| `rahbar_dashboard_ledger` | 6 | 10,367 | 1,728 | 2,961 | 15.3% |

And the supporting facts that pointed at these two fixes rather than indexes:

- **Index hit ratio 100.000% heap / 99.999% index, 3 disk reads total.** This
  is not an I/O or missing-index problem, and an index would have been
  effort spent on nothing.
- `kirim_lines` had **923,974 sequential scans against 33 live rows**
  (`dispatch_manifest` 336k scans against *zero* rows). The cost is repeated
  re-execution, not data volume.
- **Writes run at 1.2/hour** (24h) against ~640 read requests/hour — roughly
  500:1.

## A — dashboard default period: "Boshidan" → "Bu oy"

`RahbarHome.tsx` defaulted its period preset to `'boshidan'`, which resolves
to `from = '2026-07-15'` (a hardcoded project epoch) → today. So **every
fresh mount of the Rahbar dashboard asked `rahbar_dashboard_ledger` for the
entire dataset since inception** — automatically, by default, with no cache.
`ClientPanelTab.tsx` had the identical default.

Changed both to `'bu_oy'` (current month to date). "Boshidan" / "С начала"
is unchanged and still one click away in the period selector; only the
landing default moved.

Worth noting what was checked and *not* changed: Rahbar Hisobot already
defaults to last-30-days, and client Приход/Расход/Производство to
month-to-date. Those were already bounded — the all-time default was
specific to the two dashboards.

## B — client-side read cache (React Query), debounce, cancellation

The app had **no client-side caching of any kind**. Every mount refetched,
and since each tab is its own route, switching tabs unmounted the screen and
re-issued its whole RPC set on the way back.

- `@tanstack/react-query` added; provider wired in `main.tsx`.
- `src/lib/queryClient.ts` holds the client, the query keys, and the
  defaults.
- Converted to `useQuery` (cache + dedupe + cancellation via
  `.abortSignal(signal)`): `useRahbarStockSnapshot`,
  `useRahbarDashboardLedger`, `useClientReport`, plus the
  `client_chiqim_ledger` and `client_production_ledger` reads in
  `ClientRashodTab` / `ClientProizvodstvoTab`.
- `src/lib/useDebouncedValue.ts` (300ms) applied to the client Расход and
  Производство filters, which previously re-fired their RPC on **every**
  filter object change with no debounce and no cancellation.

### Three deliberate judgement calls

1. **`staleTime` is 30s, not the 60s suggested.** Write-triggered
   invalidation is *not* wired (see below), so this value alone bounds
   staleness. 30s + `refetchOnWindowFocus` keeps the worst case small at a
   measured 1.2 writes/hour.

2. **`retry: false`.** Every query behind this client is a heavy analytics
   RPC against a database still emitting `57014` timeouts. Retrying a
   request that just timed out re-submits the same expensive work and makes
   an overload worse. The failure should surface, not be amplified.

3. **`useReportQuery` (Hisobot) keeps its own logic; only its fetch is
   wrapped.** That hook already had the 300ms debounce, `AbortController`
   cancellation, and "on error keep the last good rows rather than render a
   fabricated empty result" — all three added in response to a real
   documented incident (see its own comments). It was the one screen already
   doing this correctly, so it gained caching via `queryClient.fetchQuery`
   inside the existing `load()`, preserving every one of those semantics
   rather than being rewritten into `useQuery`.

### 🚩 Not done: invalidation on write

The brief asked for it. It is **not** in this PR, deliberately. There are
**48 mutation call sites across 19 files**, and wiring all of them blind —
in the same change that introduces caching, in an environment where the
operator screens cannot be exercised in a browser (see Verification) — is
how an operator flow gets silently broken. `invalidateReportData()` exists
in `queryClient.ts` as the attachment point; wiring it is a small, separate,
reviewable change. Until then staleness is bounded by `staleTime` +
`refetchOnWindowFocus`, which at 1.2 writes/hour is a real but small gap,
stated rather than hidden.

## Verification

- `npx tsc -b` clean (`noUnusedLocals`/`noUnusedParameters` are on, so the
  removed `useEffect`/`setState` plumbing is confirmed fully removed).
- `npx oxlint` — only the 2 pre-existing `only-export-components` warnings.
- `npm run build` clean.
- **Booted the real app in Chromium** against the dev server: the tree mounts
  through the new `QueryClientProvider`, the login screen renders, and there
  are **zero console errors**. This is the check that would have caught a
  bad provider/import wiring.

🚩 **Authenticated screens were NOT exercised in a browser.** Attempting the
e2e suite failed at login with `net::ERR_TUNNEL_CONNECTION_FAILED` on
`…supabase.co/auth/v1/health` — this sandbox's proxy blocks
browser-initiated connections to the live Supabase project (the same
limitation already recorded in SPEC v1.48). Confirmed it is environmental,
not caused by this change, by reproducing the block with a bare `fetch` from
a blank page. Two further gaps found while trying:
`.env.test` holds only `TEST_RAHBAR_*`, so `client-portal-smoke.spec.ts`
(needs `TEST_CLIENT_*`) and `hisobot-filter-debounce-consistency.spec.ts`
(needs `TEST_MENEJER_*`) cannot run at all here; and the installed
`@playwright/test` 1.61.1 expects a chromium revision (1228) newer than the
one present (1194), so any suite run needs an explicit `executablePath`.

A purpose-built Phase-1 spec was written and then **removed rather than
committed**: it could not be run even once (login is blocked), and its
selectors are therefore unverified guesses. A test that has never passed is
worse than no test. What it was meant to assert — default preset is "Bu oy",
and returning to the dashboard within the cache window issues zero fresh
`rahbar_stock_snapshot`/`rahbar_dashboard_ledger` calls — is the thing to
verify by hand, or in an environment with Supabase egress, before trusting
Phase 1's numbers.

## Measurement protocol for this phase

Per the agreed protocol: reset `pg_stat_statements` immediately after this
deploys, let 4 hours of real business traffic accumulate, then compare top-10
by `mean_exec_time × calls`, the `max_exec_time` distribution, and the 24h
`postgres_logs` count of `canceling statement due to statement timeout` —
the number that has to reach zero — against today's baseline of **188**.

⚠️ Today's `pg_stat_statements` baseline covers only a **17-minute** window,
not 4 hours, because this session reset those statistics twice earlier in the
day. The 24h error-log counts are unaffected and are the sounder baseline.
