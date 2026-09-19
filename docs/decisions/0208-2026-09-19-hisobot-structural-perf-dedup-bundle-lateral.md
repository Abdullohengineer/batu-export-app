# Hisobot performance: statement_timeout mitigation + `report_query_page` bundle dedup

Follow-up to `0207`, which found (but deliberately did not fix)
`report_query_page`/`report_totals`' bottleneck. User escalated: not
acceptable to leave in tech debt while users are timing out.

## 1. Mitigation shipped first: statement_timeout 8s → 20s

`0134`. Users get a slow response instead of a hard failure while the
structural work proceeds. Reversible.

**Non-obvious finding worth recording:** the role that actually governs this
is `authenticator`, not `authenticated`. PostgREST/Supavisor authenticates
every pooled connection as `authenticator` (confirmed via
`pg_stat_activity` — every PostgREST backend shows
`usename = authenticator`), then issues `SET ROLE authenticated` per
request. Postgres applies `ALTER ROLE ... SET` defaults **only at session
start, for the login role** — a later `SET ROLE` does not re-fetch the
target role's stored GUC defaults. So changing only `authenticated` (the
intuitive target) would likely have had **no effect at all**. Both are set;
`authenticator` is the one doing the work.

Deliberately NOT changed:
- **`lock_timeout`** (still 8s). Real lock contention on these tables is
  confirmed — two live `40P01 deadlock detected` errors while applying the
  earlier RLS migrations. Raising it would make queries queue longer behind
  locks instead of failing fast, working against stability.
- **`anon`** (still 3s). Hisobot is authenticated-only; unauthenticated
  traffic should stay tightly bounded.

Takes effect on newly-opened pooled connections; existing backends keep 8s
until they cycle.

## 2. Rejected on evidence: converting the bundle to `plpgsql`

The obvious read of `0207`'s "planning time is huge because Postgres inlines
a ~1458-plan-node function tree" is: stop the inlining, make
`kirim_line_report_bundle` opaque (`LANGUAGE plpgsql`), let its plan be
built once and cached per session.

Tested in a rolled-back transaction before committing to it. **Refuted:**

| | Planning | Execution |
|---|---|---|
| current (`LANGUAGE sql`, inlined) | 437ms | 2845ms |
| `plpgsql` twin (opaque) | 212ms | **12,007ms** |

Planning halved, execution **4.2x worse** — ~135ms per row opaque vs ~32ms
per row inlined. Inlining is load-bearing: it lets the planner specialize
the per-serial work. The planning cost buys much more than it costs. Not
shipped. (Worth remembering: "high planning time" is not by itself a reason
to defeat inlining.)

## 3. Shipped: dedup the bundle LATERAL (`0135`)

The real waste was much simpler. `report_query_page` called
`kirim_line_report_bundle(f.serial, …)` once per **row**, but rows share
serials — one serial yields a `kirim` row, `moyka_send` rows,
`moyka_output` rows, etc. Measured on the real unfiltered page-1 query:

- 89 rows returned
- 77 rows carry a serial
- **32 distinct serials**

So the bundle ran 77 times to produce 32 distinct answers — 2.4x redundant.
Postgres was not memoizing it away (14 `Memoize` nodes exist in the plan,
all on small sub-lookups, none on the bundle LATERAL).

Fix: compute the bundle once per distinct serial in a CTE, plain-JOIN it
back. `kirim_line_report_bundle` itself is **untouched** — no business logic
changed, only invocation count.

| | Planning | Execution | Total |
|---|---|---|---|
| before | 437ms | 2845ms | 3282ms |
| after | 314ms | **1643ms** | **1957ms** (−40%) |

### Correctness gate

Verified byte-identical output (md5 of the full result set, compared
row-by-row in output order) across 4 combinations **before** shipping:

| combination | rows | identical |
|---|---|---|
| client role, no filters, limit 100 | 89 | ✅ |
| client role, `directions=['kirim']` | 25 | ✅ |
| client role, chiqim + chiqim_raw + chiqim_old_kn | 12 | ✅ |
| rahbar role, no filters, limit 50 offset 50 | 39 | ✅ |

The chiqim combination matters specifically because it exercises the second
(`chiqim_dispatch_calibre_breakdown`) LATERAL, which the dedup does *not*
touch — confirming it was left intact.

Then, **after** applying the migration live, re-verified the deployed
function against md5 baselines captured from the old implementation
immediately before replacing it: both matched (`637343a7…`, `ffe3069c…`).

### One deliberate hardening change

The outer `SELECT` now carries an explicit `ORDER BY`. The previous row
order was an *accident* of nested-loop LATERAL joins preserving the driving
side's order; a plain JOIN is free to reorder. The explicit `ORDER BY`
reproduces exactly the order the inner subquery already sorted by — output
unchanged, but now guaranteed rather than incidental. This is a latent
fragility that existed before and would have become a real bug the moment
the planner picked a hash join.

## 4. Still open

- **`report_totals`** gets no benefit from this fix — it *already* dedups
  (`select distinct serial from filtered` before its own
  `cross join lateral`). Its ~1.7s execution is inherent: ~33 distinct
  serials × ~50ms per bundle call. Reducing it requires making the bundle
  itself cheaper — a set-based rewrite computing all serials' aggregates in
  one pass (`GROUP BY serial`) instead of one parameterized call per serial.
  That is a genuine rewrite of correctness-critical ledger math
  (`moykada_per_cycle`, `moyka_asof_calc`, `loss_range_calc` with its nested
  per-cycle `client_calibre_split()` call) and needs its own careful
  per-serial verification pass — not folded in here.
- **`get_serial_passport`** (max 4.03s, 412 calls) and
  **`client_chiqim_ledger`** (max 3.68s, mean 113ms) — not yet investigated.
- `pg_stat_statements` was reset at `2026-09-19 12:18:50 UTC` (in `0207`),
  so post-fix distribution needs a fresh observation window under real
  traffic before declaring the tail collapsed. Single-shot EXPLAIN ANALYZE
  numbers above are point measurements, not a distribution.
