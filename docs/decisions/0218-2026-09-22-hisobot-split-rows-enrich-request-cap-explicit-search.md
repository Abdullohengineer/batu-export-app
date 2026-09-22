# Hisobot: split the page query, cap runaway statements, and make search explicit

Fixes the "errors after ~5–6 rapid filter changes" report. Three changes plus
one investigation, in the order they matter.

## The mechanism

`report_query_page` was ONE statement doing three jobs: filter/order/page the
rows, then a per-serial `LATERAL kirim_line_report_bundle`, then a per-row
`LATERAL chiqim_dispatch_calibre_breakdown`. Measured under real RLS:

| role | isolated, warm |
|---|---|
| `postgres` (`rolbypassrls`) | 80ms |
| `authenticated` / rahbar | ~315ms |
| `authenticated` / **client** | **~1,035ms** |

`pg_stat_statements` over a 20.5h window put the PostgREST-wrapped report RPCs
at mean **2,091ms**, max **11,926ms** against the 12s ceiling.

Aborting the browser's HTTP request does **not** cancel the statement behind
it. So each filter change left a real ~2s statement running to completion,
holding one of PostgREST's 10 pool connections. Six changes ≈ twelve
statements (page + totals), the pool saturates, the next request queues and
dies on `statement_timeout`. `0215` already documented this exact mechanism
end-to-end from the other direction — its own 11.5-minute regression produced
62 5xx including collateral 503s on `/profiles`, `/product_types`,
`/calibres`, cheap reads that failed only because no slot was free.

⚠️ **The prescribed reproduction could not be run from this sandbox.** The
egress proxy denies CONNECT to `*.supabase.co` (gateway 403, org policy), so
there is no way to drive the browser or raw HTTP from here; and with no
`dblink`/`pg_background` there is no way to open concurrent sessions from
inside SQL either. The mechanism above is established from pg_stat_statements,
role-impersonated timings, and this project's own prior incident record — not
from a live 6-rapid-changes run. Recorded as a gap, not papered over.

## 1. The split

**`report_query_page_rows`** — `returns setof report_rows_v2`, body identical
to `report_query_page`'s own `f` CTE. Nothing else.

**`report_page_enrich`** — both enrichment halves, set-based, one call, told
apart by a `row_type` discriminator (`'bundle'` → key = serial, `'dispatch'`
→ key = request_id).

| | OLD (one statement) | NEW (a) rows | NEW (b) enrich |
|---|---|---|---|
| rahbar, best–worst of 3 | 303–621ms | **74–160ms** | **89–125ms** |
| client, best–worst of 3 | 1,300–7,241ms | 373–826ms | 169–5,700ms |

Targets (<200ms / <150ms) met on the rahbar path. The client numbers are
noisy — business-hours contention, one enrich call spiked to 5,700ms. That is
the 5–75x variance `0213` recorded, not a property of the new query, but it is
recorded here rather than quietly replaced with the best run.

### Why the signature is not `(p_serials, p_dispatch_keys, p_from, p_to)`

The brief specified those four arguments. That cannot work, and the
byte-identity gate would have caught it as a HALT. `chiqim_dispatch_calibre_
breakdown` is **filter-dependent** — its `is_match` consumes `p_directions,
p_calibre_id, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_serial,
p_type_id, p_partiya_no`. Same `request_id`, measured:

| filter shape | k1..kn |
|---|---|
| no filters | `(,10,,10,,10,,,)` |
| `p_calibre_id = 01` | `(,,,,,,,,)` |
| `p_status = 'bekor_qilingan'` | `(,,,,,,,,)` |

So the 9 filter params are required. This also forces **two cache grains**,
not one: the bundle half genuinely keys on `(serial, from, to)`, but the
dispatch half must include the filters or it would serve one filter's numbers
under another — silently wrong, not merely stale. Both grains are in
`queryClient.ts`'s `queryKeys` (`reportBundle`, `reportDispatch`).

### No LATERAL

The bundle half is one call to `kirim_line_report_bundle_set` (shipped in
`0215`). The dispatch half **inlines** `chiqim_dispatch_calibre_breakdown`'s
body as a single scan + `GROUP BY request_id`, so N request_ids cost one scan
rather than N function calls. The two halves sit in separate `UNION ALL`
branches rather than one top-level `FROM` list — the specific restructuring
`0215`'s follow-up section named after its own `report_query_page` swap
regressed to 8.9–16s with a 15-CTE set function and the dispatch LATERAL in
the same query.

### Column-name remap lives in SQL

`report_query_page`'s select list silently renames three bundle fields on the
way out. `report_page_enrich`'s output columns are named to match
`report_query_page`'s **output**, so the remap is encoded once, in SQL,
instead of being re-derived in TypeScript:

| output column | bundle source |
|---|---|
| `state_moykaga_yuborilgan` | `moyka_range_to_moyka_kg` (period) |
| `state_moykada` | `moyka_asof` (as of `p_to`) |
| `state_moykadan_chiqgan` | `moyka_range_from_moyka_kg` (period) |
| `state_yoqotish` | `loss_range` |
| `state_moykaga_yuborilgan_lifetime` | `state_moykaga_yuborilgan` (lifetime) |
| `state_moykadan_chiqgan_lifetime` | `state_moykadan_chiqgan` (lifetime) |
| `state_k1..k8`, `state_kn` | `calibre_output_k1..k8`, `_kn` |

Because of that the client-side join is a plain object merge.

### Byte-identity — 6/6, run twice

Joined client result (rows ⋈ enrich) vs live `report_query_page`, whole-row
text, all columns, in output order. Run first against `zz_`-prefixed
throwaway functions **before** applying, then again against the applied
functions:

| shape | rows | identical |
|---|---|---|
| no filters, full history | 89 | ✅ |
| `directions=[kirim]` | 25 | ✅ |
| chiqim family | 13 | ✅ |
| current month (the default) | 38 | ✅ |
| `p_calibre_id=02` (dispatch-sensitive) | 3 | ✅ |
| `p_status=bekor_qilingan` (dispatch-sensitive) | 13 | ✅ |

The last two are the shapes the original signature could not have reproduced.
All `zz_` scaffolding dropped afterwards.

### Deprecated, not dropped

`report_query_page` stays **live and unchanged**. It still has one caller:
`fetchAllReportRowsForExport` (Excel export, 1000-row chunks). That path is
user-initiated and one-off rather than the rapid-filter problem, so it was
left alone deliberately — moving it is follow-up work, not part of this
change. `report_totals` is untouched. The legacy `p_direction text` overloads
of both are untouched and uncalled; flagged, not removed.

## 2. The 5s cap — not where the brief put it

🚩 **`SET LOCAL statement_timeout` inside the report functions is not
implementable.** Measured, in rolled-back transactions:

| variant | elapsed | outcome |
|---|---|---|
| `LANGUAGE sql` + function-level `SET statement_timeout='1s'`, body `pg_sleep(3)` | **3.01s** | COMPLETED, no timeout |
| `LANGUAGE plpgsql STABLE` + `SET LOCAL statement_timeout` | 0.00s | **ERROR 0A000: SET is not allowed in a non-volatile function** |
| `SET LOCAL` in a **preceding statement** of the same transaction | ~1s | **CANCELLED 57014** ✅ |

The function-level `SET` genuinely applies — a `sql` function carrying it
reads `statement_timeout = '1s'` inside its own body while the session reads
`2min` — but `statement_timeout` is armed once when the statement starts and
is never re-armed when the GUC changes mid-statement. Making the function
`VOLATILE` to satisfy plpgsql would additionally defeat SQL inlining, the
change `0215` measured at 2,845ms → 12,007ms.

PostgREST runs each request in its own transaction and calls
**`db-pre-request` as a separate statement first**, which is exactly the shape
that works. Hence `public.pgrst_statement_cap()`, wired with:

```sql
alter role authenticator set pgrst.db_pre_request = 'public.pgrst_statement_cap';
notify pgrst, 'reload config';
-- ROLLBACK:
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
```

Scoped by `request.path` to the four report RPCs only; everything else keeps
the 12s role default. Two safety properties, both deliberate:

- **An `EXCEPTION WHEN OTHERS` handler.** `db-pre-request` runs on *every*
  PostgREST request, so an error raised here would fail every request in the
  app. It must never throw.
- **Fail-safe on an unrecognised or NULL `request.path`** → no cap at all,
  i.e. today's behaviour, rather than capping the whole app.

Verified by replicating PostgREST's own sequence (set `request.path`, call the
hook as its own statement, observe the next statement's GUC):

| case | result |
|---|---|
| `/rpc/report_query_page_rows` | `statement_timeout = 5s` ✅ |
| unmatched path | stays 12s ✅ |
| `request.path` NULL | stays 12s ✅ |

⚠️ **Still unverified: that PostgREST actually populates `request.path`.**
This sandbox cannot issue HTTP to Supabase, and there has been **zero**
PostgREST traffic since the hook was wired (last edge request 05:37:52 UTC,
hook wired 05:46:19, checked again at 06:45 — 0 requests). The hook carries
temporary `RAISE LOG` lines precisely so this can be settled from real
traffic. **Next person to open any Hisobot or client report page settles it**:

```sql
select event_message, count(*) from postgres_logs   -- via the logs explorer
where event_message like 'pgrst_statement_cap%' group by 1;
```

A `MATCH path=/rpc/... statement_timeout=5s` line confirms it. A
`SKIP path=<NULL>` line means `request.path` is not populated on this
PostgREST version — in which case **reset the role setting immediately**
(rollback above) and the cap needs a different carrier. Remove the `RAISE LOG`
lines once confirmed; they currently log one line per request.

⚠️ A separate correction worth recording: I predicted that the function's
`SET search_path` clause would push a GUC nest level and undo the inner
`SET LOCAL` on return. Measured: it does not — both the `SET`-carrying and
plain variants left `statement_timeout = 5s` after returning. The safer
`SECURITY DEFINER` + fixed `search_path` form was kept.

## 3. Explicit search — the rule

🚩 **A screen with 2+ filter inputs over a query costing more than ~300ms
gets an explicit search button, not live filtering.** Debounce is not a
substitute: it only delays *when* a request fires, and a request that has
already fired keeps running on the database after the browser abandons it.
One request per intent, not one per keystroke.

Applied to five surfaces via `useSearchTrigger` + `<SearchTrigger>` /
`<StaleResults>`: Hisobot, the three client report tabs, and the Rahbar
ledger period picker. **Not** applied to dashboards or the
Ombor/Qorovul/Laborator work tabs — single-purpose, cheap, and operators
expect them live.

Behaviour: filters edit local draft state only; `search()` commits. Old
results stay visible but **dimmed** rather than blanked — they are still real
numbers from a real query, and replacing them with an empty state is the
precise failure Phase 1 fixed. The button is disabled while in flight so a
second click cannot add a statement to the pool; **Enter is deliberately not
blocked**, and because `reloadToken` participates in the query key, Enter
mid-flight aborts the in-flight request and re-runs. That is how the brief's
"button disabled while in flight" and "a click during flight aborts and
re-runs" are both honoured without contradiction.

Two judgement calls: the client portal is a Russian-language surface, so the
control there reads «Поиск» / «Фильтры изменены — нажмите «Поиск»» rather
than the Uzbek string — an Uzbek string would have been the only Uzbek text on
those tabs. And on the Rahbar dashboard the button is scoped to the **custom
range only**; the three presets stay live, because one preset click is one
complete intent while the custom range is two inputs that fire a query against
a half-entered range.

## 4. The RLS gap (investigated, no change made)

All report functions are **SECURITY INVOKER** (`prosecdef = false`), owned by
`postgres`. Only `my_role()`/`my_owner_id()` are SECURITY DEFINER.

Two SELECT policies per table, OR'd: `read_all` =
`(select auth.uid()) is not null and (select my_role()) <> 'client'` — two
InitPlans, essentially free; and `client_read_own_*`, which on `kirim_lines`
and `finished_pallets` is a **correlated `EXISTS (... JOIN kirim_orders ...)`
per row**. All already use the `(select fn())` InitPlan form from the
0130/0131 work. The 80 → 315 → 1,035ms ladder is those client EXISTS
subqueries, not the function calls.

**Recommendation: do NOT make these SECURITY DEFINER.** They are owned by
`postgres`, which has `rolbypassrls = true`, so SECURITY DEFINER would bypass
base-table RLS entirely for their reads. Client scoping would then rest solely
on the `p_owner_id` **parameter the client controls** — a client could pass
another owner's uuid. A `my_role()` guard would have to *force*
`p_owner_id = my_owner_id()` for clients on all four functions and everything
they call, i.e. reimplementing RLS in application code on a client-facing
financial report with no policy backstop. Decision left with Abdulloh.

RLS is genuinely enforced today, including through the `postgres`-owned
`report_rows_v2` view (which is **not** `security_invoker`, so this was worth
checking rather than assuming).

## 🚩 5. Only one owner has data — fix before pilot

`owners` has 3 rows but **only one** (`Global Export Company`) has any
orders: 32 orders, all 595 report rows, one distinct `owner_id` everywhere.

**A client-scoping regression is invisible in this data.** My first scoping
test was vacuous for exactly that reason — the client saw 89 rows and so did
rahbar, which proves nothing when there is only one owner. A real answer
needed a second owner inserted inside a rolled-back transaction, after which
the client correctly saw 32 of 33 orders and **0** foreign rows, both directly
and through the view.

This is the same class of defect as `lab_turnaround_avg()` in CLAUDE.md's
origin-filtering section: *an exclusion that only works because the data
happens not to overlap is not acceptable*. **A second real test owner, with
its own orders and a `TEST ` client account, is needed before pilot** so that
scoping regressions become visible in ordinary use and in any e2e run —
otherwise the first time a leak shows up is when a second real customer is
onboarded.

## Flagged, not fixed

- `src/lib/useDebouncedValue.ts` now has **no consumers** — its two users
  (client Расход/Производство) moved to explicit search, and Hisobot always
  had its own internal constant. Left in place rather than deleted; it is a
  reasonable shared utility and removing it is not this task's scope.
- `fetchAllReportRowsForExport` still calls the old `report_query_page`.
- The legacy `p_direction text` overloads of `report_query_page` /
  `report_totals` remain, uncalled.
- `scripts/check-rpc-wrapper.mjs`'s allowlist shrank by two
  (`clientChiqimLedger.ts`, `clientProductionLedger.ts`), which the check
  itself asked for once those files moved onto `callRpc`.
