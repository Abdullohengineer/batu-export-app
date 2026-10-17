# 0242 — Hisobot 57014 timeouts: report RPCs planned without their args (PostgREST JSON shape + RLS)

2026-10-17

## Reported

Rahbar → Hisobot, filters Yo'nalish (1) / Global Export Company / Natural /
2026-09-01..30: "Hisobotni yuklashda xatolik yuz berdi: canceling statement due
to statement timeout". DevTools: `POST /rpc/report_query_page_rows` → 500,
`{code: "57014"}`.

## Investigation (live project, read-only)

- `postgres_logs`: 18 × `canceling statement due to statement timeout` on
  2026-10-17 (03:31–09:44), the 09:41–09:44 ones matching this session's
  `report_query_page_rows` / `report_totals` 500s in `edge_logs`.
- Timeout in force is the role's 12s. The 5s `pgrst_statement_cap` is **not**
  bound any more (`authenticator` has no `pgrst.db_pre_request`; 0153 was
  applied). Its 39k calls in `pg_stat_statements` are history since the
  2026-09-22 stats reset.
- Not load: ~20 requests/min, one browser, no blocking sessions, no pg_cron.
- Not data volume: 48 `kirim_lines` rows.
- **The cause** — same `report_totals`, same filters, measured live:

  | caller | args | time |
  |---|---|---|
  | postgres | literal | 367 ms |
  | postgres | `json_to_record($1)` (PostgREST shape) | 108 ms |
  | rahbar (RLS) | literal | 358 ms |
  | **rahbar (RLS)** | **`json_to_record($1)`** | **0.8 s / 3.0 s / 14.6 s** (3 runs) |

  PostgREST passes RPC args out of `json_to_record($1)`, so they are not
  plan-time constants. The planner cannot fold `report_filtered_rows_v2`'s
  `p_directions is null or ... && array[...]` gates, so every branch
  (dispatch, moyka output, rezka) is planned and executed under RLS — a
  1,854-node plan for a 6-row result, 0.4–2.4 s of planning alone. On this
  burstable compute the same call swings 0.8 s → 14.6 s and crosses 12 s
  intermittently.

## Fix

`supabase/migrations/0160_report_rpcs_force_custom_plan.sql`: the three
report RPCs the app calls (`report_query_page_rows`, `report_totals` text[]
overload, and the Excel-export `report_query_page` text[] overload) are
renamed to `*_impl` (bodies untouched) and replaced by thin plpgsql wrappers
with identical names, signatures, defaults, result shapes and grants, still
SECURITY INVOKER (RLS unchanged), with `set plan_cache_mode =
force_custom_plan`. Inside plpgsql the args are bound params known at plan
time, so the inner SQL function inlines and the gates fold — the
literal-args case above. No formula change; no frontend change.

## Verification (live, inside a transaction that was rolled back)

Rahbar JWT, exact PostgREST call shape, three scenarios:

| scenario | new rows | new totals | new export page | parity vs `_impl` (md5 of full output) |
|---|---|---|---|---|
| kirim, Global Export, Natural, Sep | 106–234 ms | 322–443 ms | 334 ms | rows / totals / export: all equal |
| all directions, 2026-01-01..today | 341–479 ms | 996–1075 ms | 1041 ms | all equal |
| chiqim+chiqim_raw+chiqim_old_kn+moyka_output, Sep..today | 775–819 ms | 1026–1036 ms | 1159 ms | all equal |

The current (old) functions on the same three scenarios, same shape: the
batch did not finish inside a 55 s statement timeout.

**Applied to the live project 2026-10-17 11:05:10 UTC** (migration version
`20261017110510`), on the user's explicit approval. Re-checked live right
after: the three wrappers are plpgsql with `plan_cache_mode=force_custom_plan`,
`*_impl` are the untouched SQL bodies, ACLs identical to the originals.
Same scenario 1 as above (rahbar JWT, PostgREST call shape), 3 runs:
rows 171–269 ms, totals 397–475 ms — the same call measured 1.7–5.4 s
minutes before applying (by then the org was already on the $25 Pro plan;
the database had 25 days' uptime, so compute was unchanged by the plan
switch). Not verified over real HTTP from this session (the container's
egress proxy refuses `*.supabase.co`): the last report-RPC 500s in
`edge_logs` are 10:55–10:56, before the apply; confirm with the next real
Hisobot load.

## Flagged, not done (scope)

- `report_page_enrich` (mean 340 ms, max 3.5 s) and `rahbar_dashboard_ledger`
  / `rahbar_stock_snapshot` (mean ~1 s, max 10–12 s in `pg_stat_statements`)
  have the same PostgREST-args exposure; candidates for the same wrapper.
- Compute size: identical work varies ~15× run to run — a larger instance
  would narrow that, independently of this fix.
- `report_totals_v2_draft` (decision 0240 cleanup note) is still live.
