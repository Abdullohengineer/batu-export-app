# TECH DEBT (tracked, not yet scheduled): schema-wide RLS `my_role()`/`my_owner_id()` caching sweep

## Status: open, own PR later — not part of the `0202` P0 hotfix

`0202` fixed the specific timeout by wrapping `my_role()`/`my_owner_id()`
calls as `(select my_role())`/`(select my_owner_id())` in the 34
`client_read_own_*`/`read_all` SELECT policies on the 17 tables
`rahbar_stock_snapshot`/`rahbar_dashboard_ledger` touch. That fix was
deliberately scoped to exactly those tables ("whichever is minimal" for a
P0) — it did **not** touch every other RLS policy in the schema.

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

- Enumerate every `client_read_own_*`/`read_all` policy schema-wide via
  `pg_policies` (the same technique `0202`/`0195`'s table-by-table audits
  already used, just without limiting to a fixed table list this time).
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
