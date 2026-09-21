# Phase 2 data-layer summary: what moved to React Query, the request budget, the rpc() rule, and what the edge logs say about the pool ceiling

Branch `claude/data-layer-phase2`, 9 commits (one per build-order step;
step 5 spans two, step 8 is folded into step 5's `useGateHistory`
rewrite). No PR opened — Abdulloh opens it. Companion entries:
`0212` (step 4, partial ship + incident), `0213` (statement_timeout).

## What moved to React Query

Before this phase 8 read paths were on React Query (0209). After it, 24
hooks are, all following one pattern: query key in `queryClient.ts`'s
`queryKeys` including every param, `.abortSignal(signal)` on every
Supabase call, throw on `.error`, `loading` = `isPending` (first fetch
only), `refreshing` = `isFetching && !isPending` for a "yangilanmoqda…"
indicator, `error` surfaced to a `StatusNote`.

| step | hooks | notes |
|---|---|---|
| 1 | `useProductTypes`, `useOwners`, `useCalibres`, `useProductCategories` | staleTime 10min; `masterDataAdmin.ts` invalidates on every admin write. **The pererabotano fix**: `useProductTypes` never checked `.error`, so a failed fetch rendered as `'—'` in every row. |
| 2 | `useIntakeLines`, `useMoykaSerials`, `useMoykaOutput`, `useOmborChiqimRequests` | `refetchInterval: 60_000`, `refetchIntervalInBackground: false`; `OmborHome`'s raw `setInterval` and route-change refresh effect removed. |
| 5 | `useWipRows`, `useProfileNames`, `useLaboratorKirim`, `useLaboratorChiqim`, `useKirimTrips`, `useChiqimTrips`, `useYieldRows`, `useStockOnHand`, `useGateHistory`, `useIntakeHistory`, `useLaboratorHistory`, `useFinishedChiqimRequests`, `useChiqimRequestById` | `HistoryView` shell gained optional `error`/`refreshing` props so all 4 role Hisobotlar screens got both for free. |

Step 3 wired `invalidateReportData()` after all 25 flow-level write
completions covering 0211's 33-site inventory (several statement-level
sites share one transaction/refresh, hence 25 calls). Step 4 is in 0212.
Step 7 added `src/lib/rpc.ts` + `scripts/check-rpc-wrapper.mjs`.

**Not migrated (flagged, not silently skipped)** — the remaining
`useEffect` hooks, all smaller per-request/per-row utilities: `useNotes`,
`useSettingsLimits`, `useDispatchManifestLines`,
`useRawDispatchLinesByRequest`, `useOldKnCollectionsByRequest`,
`useChiqimTruckTypes`, `useAvailableFinishedStock`, `useEffectiveQty`
(`effectiveQty.ts`), `usePrintQueue`, `usePrinter`, `useProfile`,
`useSession`, and the old `useRahbarDashboard.ts` (`useRahbarExceptions`).
Two of these are the exact duplicate-mount pattern this phase fixed for
the Ombor badges and are the first to do next: `useNotes` via
`EntityNotes` is mounted once per visible row in `LaboratorChiqimTab`'s
awaiting list (N uncached, undeduped `notes` reads per render), and
`useSettingsLimits` is mounted separately by `KirimOrdersList`,
`OmborIntakeTab`, `OmborHisobotlar` and `ThresholdsSection` (refetches on
every tab switch). Also un-migrated: `useReportQuery` keeps its 0209
shape (debounce + AbortController + `fetchQuery` inside a `useEffect`),
deliberately — it was fixed on 2026-09-20 and is not broken.

## Request budget (step 6) — code-derived, not browser-measured

🚩 This sandbox has no browser→Supabase path and `.env.test` holds no
role credentials (the same limitation 0209 and Phase 1 recorded), so the
numbers below come from enumerating every hook each role's screens mount
(file:line inventory in the step-6 research pass) and applying React
Query's rules: same key + within staleTime = one request; a plain
`useEffect` hook = one request per mount, always. "Before" is `main`
before this branch (only 0209's 8 paths cached). A network-tab
confirmation after deploy is listed under *Verification still owed*.
Counts are distinct requests; "switch back" = returning to the landing
tab within 30s (10min for master data).

| role | app open | first switch to busiest tab | switch back to landing | 5 min idle on landing |
|---|---|---|---|---|
| Rahbar | 4 → 4 | Hisobot: 6 → 4 | 2 → 0 | 0 → 0 |
| Menejer | 7 → 7 (3 still `useEffect`) | CHIQIM: 11 → 9 (revisit within 30s: 11 → 1) | 4 → 0 | 0 → 0 |
| Ombor | 10 → 8 | Moyka: **8 → 0** | **8 → 0** | 20 → 20 foregrounded, **20 → 0 backgrounded** |
| Qorovul | 3 → 3 | CHIQIM: 3 → 1 | 3 → 0 | 0 → 0 |
| Laborator | 3 → 3 | CHIQIM: 3 + N notes → 1 + N notes | 3 → 0 | 0 → 0 |
| Client | 4 → 4 | Приход: 4 → 2 | 2 → 0 | 0 → 0 |

App-open counts barely move because the first load of a session has no
cache to hit — the win is everywhere after it. Ombor is the headline: the
old `OmborHome` mounted 4 badge hooks *and* the active tab re-mounted 2 of
the same hooks (duplicates), *and* a route-change effect re-fired all 4
badge refreshes on every tab switch, so a Moyka→KIRIM→Moyka round trip
cost 16 requests; it now costs 0.

**Idle: the only thing that fires without user action** is the 4 Ombor
badge hooks, every 60s, only while the browser tab is visible. Justified:
the badges summarise queues other users write to (a truck the guard just
weighed, a lab result just entered), and a badge that lies for as long as
the operator stays on one screen is worse than no badge (the original
2026-08-15 reasoning). What changed: `refetchIntervalInBackground: false`
— before this phase the raw `setInterval` fired regardless of visibility,
so an Ombor tab left open in the background all day polled 4 RPCs a
minute forever. Nothing else in the app has a `refetchInterval`
(grep-verified). `refetchOnWindowFocus: true` is not idle traffic — it
fires on a focus event, and only for stale queries.

## The rpc() rule (step 7)

`src/lib/rpc.ts` — `run(builder)` (throws on `.error`) and
`callRpc(fn, args, signal)`. `scripts/check-rpc-wrapper.mjs` (`npm run
lint:rpc-wrapper`, in `.husky/pre-push` next to the build) fails on a
NEW raw `supabase.rpc(`/`.from(` call site outside a file on its
allowlist. The allowlist is the whole pre-wrapper data layer — 44 files —
grandfathered in today; it exists to shrink, and the script warns when an
allowlisted file no longer needs to be. Rule is in CLAUDE.md "Data
access" alongside the every-new-hook-is-React-Query rule.

## What the edge logs say (and the pool-ceiling verdict, stated plainly)

Source: `edge_logs`, `log_attributes['response.status_code']` and
`['response.origin_time']` (ms). Phase 1's `postgrest_logs` undercount
finding stands; this is the reliable source, and `origin_time` is a
per-request latency Phase 1 believed did not exist.

**The frontend of this branch is not deployed** (no PR yet), so there is
no "24h after deploy" number. Only the DB-side change (`report_totals` →
`kirim_line_report_bundle_set`, live since 09:42 UTC) is in these logs.
Today's numbers are the baseline to compare against after merge+deploy.

Today (2026-09-21, 05:00–10:00 UTC, all of `/rest/v1/*`):

| hour (UTC) | req | 5xx | success | p50 | p95 |
|---|---|---|---|---|---|
| 05 | 506 | 26 | 94.9% | 235ms | 36.8s |
| 06 | 93 | 6 | 93.5% | 207ms | 57.8s |
| 07 | 357 | 6 | 98.3% | 149ms | 19.7s |
| 08 | 848 | 53 | 93.7% | 72ms | 16.9s |
| 09 | 879 | 62 | 92.9% | 119ms | 13.7s |

Busiest hour 09:00 at 92.9% (Phase 1 baseline: 81–87%), but the errors
are not diffuse — they are three bursts, each a migration being applied:
08:18–08:40 (0136 + 0137, not this session's: 53/418 failed, plus
Cloudflare 521/522 = origin briefly unreachable, i.e. PostgREST
reloading), 09:38–09:57 (this session's step 4, 0212: 62/430), and the
05:10–06:50 cluster with no migration behind it — the **organic** pattern:
`rahbar_stock_snapshot`, `rahbar_dashboard_ledger`, `report_query_page`,
`report_totals` failing together with p95 25–125s, i.e. a dashboard and a
Hisobot open at the same time. Outside the two migration bursts the 08:00
and 09:00 hours were **430/430 and 449/449 — 100%**.

Steady state excluding all three windows (1,174 requests): 99.5%
success, p50 89ms, **p95 6.6s, p99 54s, 64 requests over 5s, 47 over
12s**.

**Verdict: yes, the residual failure and latency profile is explained by
the 10-connection pool ceiling — in combination with a handful of RPCs
that hold a slot for 1.3–2s each.** The evidence, each line
independently sufficient: (1) every 500 has `origin_time` ≥ 12.5s —
`statement_timeout` firing *after* a queue wait; (2) 503s take 2–30s to
fail — waiting for a slot, not a fast rejection; (3) 504s at 125s — the
gateway giving up; (4) 47 steady-state requests returned 200 after >12s,
impossible as execution under a 12s statement timeout, so it is time
spent waiting for a connection; (5) the incident: 10–16s
`report_query_page` calls alone were enough to 503 `/profiles` and
`/calibres` reads that cost milliseconds. Phase 2 attacks the queue
length (fewer requests contending — the table above) and, for
`report_totals`, the hold time (770ms → 217ms). It cannot shorten
`report_query_page`'s ~1.5s hold (0212) and it cannot raise the ceiling.
The number to watch after deploy is `over_12s` in steady state (47/1,174
today): if it does not fall substantially once the frontend ships, the
ceiling is the binding constraint and the remaining lever is
`report_query_page` (0212's follow-up) or compute — Abdulloh's call, as
agreed; not decided here.

## Verification done

- Every step: `tsc -b`, `oxlint`, `node --test` (74/74), `vite build`
  green; `lint:rpc-wrapper` from step 7 on. Pre-push hook runs build +
  rpc check on every push (confirmed in push output).
- Step 4: byte-identity 0/198 mismatches + md5 match before apply; live
  re-verification after apply; `EXPLAIN ANALYZE` before/after; revert
  re-verified (~205–300ms). Full detail and the incident in 0212.
- Pererabotano path, by code: `ClientProizvodstvoTab.tsx:94` merges
  `productTypesError` into `error`; `:151` renders the `StatusNote`;
  `:154`/`:156` gate both `TotalsBlock` and the rows table on `!error` —
  so a failed `product_types` fetch shows the banner and **no rows**, not
  dashes. `HisobotTab`, `ClientPanelTab`, `ClientReportTab`,
  `ClientRashodTab`, `ClientPrihodTab` (which previously never read
  `useReportQuery`'s error at all) surface the same error.
- statement_timeout live value, origin, and the stats-reset correlation
  (0213). `max_connections` still 60.

## Verification still owed (cannot be done from this sandbox — say so)

Each of these needs a browser logged in as a real role against the
deployed build; none could be run here (no browser→Supabase path, no
test-role credentials in `.env.test`, Playwright binary mismatch — all
pre-existing, all recorded in 0209). Concrete steps for Abdulloh:

1. **Time-to-render, before/after**: DevTools → Performance, for
   Hisobot / client report / Ombor home / Rahbar dashboard on (i) cold
   load, (ii) switch away and back within 30s, (iii) reload. Target
   <100ms for (ii)/(iii) with cached data visible — with (ii) the data
   should paint from cache with no spinner and a "yangilanmoqda…" label
   if a background refetch runs. (iii) will NOT hit: a reload clears the
   in-memory cache (no persister was added — out of scope, offline sync
   excluded) so a reload is a cold load. Flagging that now rather than
   after the fact.
2. **Network tab on `/ombor`**: filter `rest/v1`; expect
   `kirim_orders`/`kirim_lines`/`gate_weighings`/`storage_intake`
   (useIntakeLines) and the moyka/chiqim reads once each on load, then
   zero requests on Moyka↔KIRIM switches, then the 4 badge groups again
   at +60s while the tab is visible and nothing while it is hidden.
3. **Pererabotano repro**: DevTools → Network → block request URL
   `*/rest/v1/product_types*`, open the client's Производство tab:
   expect a red `StatusNote` with the Supabase error and no table.
4. **`edge_logs` at the busiest hour, 24h after deploy**: the hourly
   query and the steady-state query used above (in this entry's git
   history / the session transcript), compare `over_12s` and p95 to
   today's 47 and 6.6s.

## Live-schema drift found, not fixed

Migrations 0136 and 0137 are in the live migration table (applied
2026-09-21 08:23 and 08:39 UTC) but not in `supabase/migrations/` on
`main`. Details and why they are not committed by this session in 0213.
