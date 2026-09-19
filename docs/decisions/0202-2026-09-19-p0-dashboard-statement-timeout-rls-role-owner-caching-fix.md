# P0: dashboard "statement timeout" — root-caused to uncached RLS helper calls, fixed live

## What was reported

Rahbar dashboard/client Панель showed "canceling statement due to
statement timeout" and the "Omborda hozir"/"Текущий остаток на складе —
по калибрам" section never resolved past "Загрузка...", on Новое/С начала
(Yangi/Boshidan). Both screens read `rahbar_stock_snapshot`/
`rahbar_dashboard_ledger`. Reported cause hypothesis: Path E's multi-cycle
`wash_cycles` rewrite and/or the RLS additions from this branch's own
earlier rounds.

## Investigation

Statement timeout on this project is 2 minutes. Measured both RPCs with
`EXPLAIN (ANALYZE, BUFFERS)`, role-switched, same params
(`p_from='2026-07-15'`, `p_to='2026-09-19'`, `p_scope='yangi'` — the
reported Boshidan/Yangi combination):

| Caller | `rahbar_dashboard_ledger` | `rahbar_stock_snapshot` |
|---|---|---|
| Unprivileged (RLS bypassed) | 106 ms / 7,718 buffer hits | — |
| Real Rahbar/menejer role | 1,917 ms / 85,288 buffer hits | — |
| TEST client role | 5,592 ms / 416,975 buffer hits | 1,245 ms / 56,076 buffer hits |

None of these alone hit 2 minutes in this sandbox, but the client-role
path was already ~53x slower than unprivileged and rising fast relative to
Rahbar's own role — under real production load (concurrent connections,
colder cache, a larger real dataset than this project's single active
owner) the same multiplier plausibly crosses the timeout, matching the
report. Root-caused by isolating segments (`lines` CTE alone: 33 rows,
42 ms; `pallet_base`/`pallet_departures` alone: 191 ms — neither explains
the whole-function cost) and then checking the RLS helper functions
themselves:

```
my_role()      STABLE SECURITY DEFINER  -- select role from profiles where id = auth.uid() and active
my_owner_id()  STABLE SECURITY DEFINER  -- select owner_id from profiles where id = auth.uid() and active
```

Every `client_read_own_*`/`read_all` SELECT policy on every table these
two RPCs touch calls these **bare** — `my_role() = 'client'`,
`owner_id = my_owner_id()`, etc. Postgres only recognizes a filter as a
"One-Time Filter" (evaluated once per statement, cached) when the *entire*
qual has zero per-row correlation. The instant the same qual also compares
a row column (`owner_id = my_owner_id()`, or an `EXISTS` join keyed to the
current row), the whole filter — including the `my_role()`/`my_owner_id()`
sub-calls, which never change — is re-evaluated **per row**, each
re-running a real `SELECT ... FROM profiles` query. This RPC pair joins
these tables together dozens of times across ~20 CTEs, worsened by Path
E's multi-cycle rewrite adding several more join sites
(`cycles_all`/`active_cycle_at_to`/`active_cycle_before_from`), so the
per-row overhead compounds. Client role is hit harder than Rahbar's
because client policies need **both** `my_role()` and `my_owner_id()` plus
an `EXISTS` join, versus Rahbar's single `my_role() <> 'client'` check —
matching the measured 5.6s vs. 1.9s split exactly.

This is the documented Postgres/Supabase RLS performance pattern: wrap the
call as `(select my_role())` instead of bare `my_role()` so Postgres plans
it as an uncorrelated subquery (an InitPlan), cached once per statement
regardless of what else is in the same qual. Confirmed empirically in a
rolled-back transaction before touching anything for real — first found a
regex bug in the diagnostic script itself (Postgres's regex flavor uses
`\y` for a word boundary, not `\b`; the first "no improvement" result was
the buggy regex silently not matching anything, not a disproof of the
hypothesis) — then, with the fix applied for real:

| | `rahbar_dashboard_ledger` (client role) | `rahbar_stock_snapshot` (client role) |
|---|---|---|
| Before | 5,592 ms / 416,975 buffer hits | 1,245 ms / 56,076 buffer hits |
| After | 651–878 ms / 10,953–52,044 buffer hits | 863 ms / 12,677 buffer hits |

6–8x faster, comfortably clear of the 2-minute timeout with room to spare
even accounting for production being noisier than this sandbox.

## Fix

`supabase/migrations/0130_rls_cache_role_owner_lookups_dashboard_timeout_fix.sql`
rewrites the `client_read_own_*`/`read_all` SELECT policies on every table
`rahbar_stock_snapshot`/`rahbar_dashboard_ledger` touch (17 tables, 34
policies: `kirim_lines`, `kirim_orders`, `wash_cycles`, `storage_intake`,
`moyka_sends`, `rezka_sends`, `raw_dispatch_lines`, `chiqim_lines`,
`chiqim_requests`, `old_stock_closeouts`, `finished_pallets`,
`serial_mint_sources`, `chiqim_pallet_consumption`, `lab_results`,
`old_kn_pools`, `old_kn_collections`, `gate_weighings`) — every
`my_role()`/`my_owner_id()` call wrapped as `(select my_role())`/
`(select my_owner_id())`. Purely a performance rewrite: each policy's
`USING` clause is semantically identical, confirmed by re-running
`rahbar_stock_snapshot`'s `rawKg`/`oldKnKg` for the TEST client after
applying — byte-identical to the pre-fix values (51,832 / 2,880 / 83,324).
Also spot-checked an `ombor`-role session against the same tables
post-fix (non-zero, sane row counts, no errors) — `read_all` unaffected
for staff roles.

🚩 **Scoped, not schema-wide — flagged as a real follow-up.** This same
bare-`my_role()`/`my_owner_id()` pattern almost certainly exists on every
other `client_read_own_*`/`read_all` policy in the schema (it's been there
since the v1.37 client-role rollout, on every table added since). Every
other client-scoped RPC (Hisobot, Приход, Расход, Производство) likely
carries the same latent, currently-invisible cost, worse the more
join-heavy the query. Not swept here — "whichever is minimal" for this P0,
scoped to exactly what's timing out.

## Verification

- Live, non-transactional `EXPLAIN ANALYZE` re-run after applying: both
  RPCs 6–8x faster, same result values.
- `ombor`-role spot check across 6 of the affected tables: correct,
  non-zero row counts, no errors.
- No frontend changes — this is a pure backend/RLS fix, `rahbar_stock_snapshot`/
  `rahbar_dashboard_ledger`'s JSON shape is untouched.
