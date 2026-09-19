# TECH DEBT (tracked, not yet scheduled): schema-wide RLS `my_role()`/`my_owner_id()` caching sweep

## Status: CLOSED 2026-09-19 (`0207`) — schema-wide `auth_rls_initplan` finding count is 0

`0132`/`0133` wrapped the remaining 10 tables (12 findings) plus the 2
trivial INSERT `with_check` findings this entry's own scope had listed.
Performance advisor re-run after both: **0 findings.** Nothing left to
schedule for this specific tech debt — see `0207` for the full writeup,
including a correction to an incorrect "profiles cascades to every RLS
check" claim that motivated prioritizing it (checked: `my_role()`/
`my_owner_id()` are `SECURITY DEFINER` owned by `postgres`, which has
`rolbypassrls = true` — profiles' own RLS never engaged for their internal
lookup, no cascade existed).

This class of issue is closed. A **different, unrelated** performance
problem was found on `report_query_page`/`report_totals` while checking
this sweep's real-world impact (deep per-row `LATERAL` function nesting +
unusually high planning time, not an RLS caching gap) — tracked separately,
see `0207`'s own "not yet actioned" section and any decision entry number
that follows it once that investigation starts.

## Status (historical, pre-closure): open, own PR later — not part of the `0202`/`0206` P0 hotfixes

`0202` fixed the specific timeout by wrapping `my_role()`/`my_owner_id()`
calls as `(select my_role())`/`(select my_owner_id())` in the 34
`client_read_own_*`/`read_all` SELECT policies on the 17 tables
`rahbar_stock_snapshot`/`rahbar_dashboard_ledger` touch. `0206` closed a gap
`0202` left open (a bare `auth.uid()` call in the same 17 tables' `read_all`
policy, plus two lookup tables `calibres`/`product_types` `0202` never
touched at all). Both were deliberately scoped to exactly the tables these
two RPCs depend on ("whichever is minimal" for a P0) — they did **not**
touch every other RLS policy in the schema.

**Update 2026-09-19 (post-`0206`):** re-ran the performance advisor after
`0206` — the `auth_rls_initplan` finding count dropped from 31 to **12**,
now confined to 10 tables outside both dashboard RPCs' dependency graph:
`audit_log`, `chiqim_fura_photos`, `chiqim_line_raw_serials`,
`dispatch_manifest`, `notes`, `owners`, `product_categories`, `profiles`,
`rezka_cycles`, `settings_limits`. The scope below is updated accordingly —
smaller than originally logged, still open.

## Why this is real, tracked debt

The same bare-`my_role()`/bare-`my_owner_id()` pattern has been the
standing convention for every `client_read_own_*`/`read_all` policy since
the v1.37 client-role rollout — it is very likely present, unexamined, on
every table added since, well beyond the 17 this P0 touched. Any other
client-scoped RPC that joins several RLS-protected tables together
(Hisobot's `report_query_page`/`report_totals`, `client_chiqim_ledger`,
`client_production_ledger`, `get_client_report`, `get_serial_passport`,
and anything not yet built) is exposed to the identical per-row-recheck
cost `0202` measured and fixed for the dashboard pair — currently latent
and invisible until a query happens to join enough of these tables at
once, exactly like this incident.

## Scope of a future sweep (not started)

- Remaining tables per the post-`0206` advisor re-run: `audit_log`,
  `chiqim_fura_photos`, `chiqim_line_raw_serials`, `dispatch_manifest`,
  `notes`, `owners`, `product_categories`, `profiles`, `rezka_cycles`,
  `settings_limits` (12 findings across these 10). None of these sit on the
  Rahbar dashboard / client Панель hot path — that path is now fully clear.
- Enumerate every `client_read_own_*`/`read_all` policy schema-wide via
  `pg_policies` (the same technique `0202`/`0195`'s table-by-table audits
  already used, just without limiting to a fixed table list this time) to
  confirm nothing beyond the advisor's current list is missed.
- Apply the same `(select my_role())`/`(select my_owner_id())` wrap to
  each — a pure, behavior-preserving performance rewrite, same as `0202`.
- Verify no regression per role (staff roles via `read_all`, client via
  `client_read_own_*`) the same way `0202` did: before/after
  `EXPLAIN ANALYZE` on a representative query per major RPC, plus a
  same-value data check.
- Consider, while auditing, whether `my_role()`/`my_owner_id()` themselves
  could be made cheaper at the source (they're `SECURITY DEFINER`, which
  blocks Postgres from inlining them even after the `(select ...)` wrap —
  each call is still a real function invocation, just no longer a
  per-row one). Not required for the wrap to work, but worth a look in
  the same pass.

## Why not bundled into `0202`

A schema-wide RLS rewrite is a much larger surface (every table, every
role, not just the two RPCs that were actually timing out) — proportionate
to a dedicated PR with its own review and verification pass, not
something to fold into a same-day P0 hotfix. Explicitly deferred on
request; this entry is the tracking record so it isn't lost.
