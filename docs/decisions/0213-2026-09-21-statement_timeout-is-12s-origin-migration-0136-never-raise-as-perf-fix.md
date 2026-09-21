# statement_timeout is 12s (not 0208's 20s), its origin is migration 0136 applied outside the repo, and it must not be raised as a performance fix

Recorded per the Phase 2 GO decision ("statement_timeout stays at 12s. Add a
DECISIONS.md entry recording the live value is 12s, that the origin of the
change is unknown, and that it must not be raised as a perf fix"). The
origin turned out to be knowable, so this entry records the corrected fact
rather than the "unknown" the decision anticipated.

## Live value, verified 2026-09-21 ~10:00 UTC

`pg_roles.rolconfig`:

| role | statement_timeout |
|---|---|
| `authenticator` | **12s** (+ `lock_timeout=8s`) |
| `authenticated` | **12s** |
| `anon` | 3s |
| `service_role` | none |
| `postgres` | none |

`authenticator` is the role PostgREST/Supavisor actually logs in as
(0208's own non-obvious finding: `ALTER ROLE ... SET` only applies at
session start for the LOGIN role, so `authenticator`, not `authenticated`,
is what governs an app request). Both carry 12s, so the effective app-side
limit is 12s either way.

## Origin: migration `0136_statement_timeout_stepdown_20s_to_12s`

`supabase_migrations.schema_migrations`:

| version | name | applied (UTC) |
|---|---|---|
| `20260919123913` | `0135_report_query_page_dedup_bundle_lateral` | 2026-09-19 12:39 (0208's shipped dedup) |
| `20260921082342` | `0136_statement_timeout_stepdown_20s_to_12s` | **2026-09-21 08:23:42** |
| `20260921083910` | `0137_phase3_stage_a_dashboard_rpcs_set_based` | 2026-09-21 08:39:10 |

0136's stored statements are exactly:

```sql
alter role authenticator set statement_timeout = '12s';
alter role authenticated set statement_timeout = '12s';
```

So: 0208 raised 8s→20s on 2026-09-19; 0136 stepped it back down 20s→12s on
2026-09-21 at 08:23 UTC, ~1h15m before this session's Phase 2 work began.

🚩 **Neither 0136 nor 0137 exists in `supabase/migrations/` on `main`**
(verified: `git ls-tree origin/main supabase/migrations/` has nothing past
0135; `origin/main` had not moved since this branch was cut). They were
applied through the migration API (the same `apply_migration` path this
session used) without being committed. The live schema is therefore
ahead of the repo by two migrations — a live-schema-drift finding, logged
here per the CLAUDE.md schema rule, NOT fixed here: they are not this
session's changes and their author's intent (0137 rewrites
`rahbar_stock_snapshot` set-based and splices a new `lines` CTE into
`rahbar_dashboard_ledger` behind an md5 guard — "Phase 3 Stage A", a
parallel effort) is not this session's to reconstruct. Whoever applied
them should commit the files; until then any fresh `supabase db reset`
or branch-from-migrations would silently lose both.

## The `pg_stat_statements` reset at 08:39:41 UTC

Phase 1 flagged this reset as "not a compute upgrade; origin unknown."
`max_connections` is still 60 (Free tier, unchanged), confirming it was
not a compute change. The reset is **31 seconds after 0137's apply
timestamp (08:39:10)**. 0137's stored statements do not themselves call
`pg_stat_statements_reset()`, so the reset was a separate manual call —
almost certainly the same actor clearing stats for a before/after
benchmark of the dashboard RPCs it had just rewritten. Strongly
correlated, not proven; recorded as such.

## Why 12s must NOT be raised as a performance fix

The edge logs (`edge_logs`, `log_attributes['response.origin_time']` —
a per-request latency field Phase 1 did not know was there) for the last
24h show what the timeout is actually doing:

| status | n | min | p50 | p95 | max |
|---|---|---|---|---|---|
| 200 | 2558 | 0 | 107ms | 10.9s | 74s |
| 503 | 67 | 451ms | 2.1s | 29.8s | 35.6s |
| 500 | 66 | **12.5s** | 25.3s | 93.3s | 123s |
| 504 | 11 | 68s | 125s | 125.6s | 125.6s |

Every 500 took ≥12.5s: that is `statement_timeout` firing after the
request had already waited in PostgREST's 10-connection pool for a slot.
The 503s took 2–30s to fail — a request that waited for a connection and
was refused, not a fast rejection. The 504s are the gateway giving up at
~125s. And 47 requests that eventually returned 200 in steady state
(outside every migration-application burst) still took >12s of
`origin_time` — impossible as execution time under a 12s statement
timeout, so it is queue time.

Raising the timeout would let the expensive RPCs (`report_query_page`
~1.3–1.6s, the dashboard pair) hold their connection longer, deepen the
queue for the other 9 slots, and turn 500s into slower 503s/504s for
everyone else. It treats the symptom (a killed query) by making the cause
(a saturated pool) worse. The lever is request volume and per-request
cost — what Phase 2 is for — not the ceiling on how long one request may
hog a slot. If anything, 0136's step DOWN was the right direction.
