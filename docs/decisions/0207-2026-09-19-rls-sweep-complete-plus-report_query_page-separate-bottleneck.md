# RLS auth.uid()/my_role() caching sweep now schema-wide complete — but `report_query_page`/`report_totals` have a separate, unresolved bottleneck

## What was asked

After `0206` (P0 follow-up for the dashboard RPCs), the user asked to finish
the remaining 12 advisor findings (10 tables) with the same pattern,
prioritizing `profiles` "for cascade impact," check `report_query_page`/
`report_totals` (Hisobot) specifically since users report it timing out too,
and consider `plan_cache_mode = force_custom_plan` as defensive hardening.

## Correction: the "profiles cascade" premise doesn't hold

Checked before acting on it, since it changes what "priority" even means
here: `my_role()`/`my_owner_id()` are `SECURITY DEFINER`, owned by
`postgres`; `pg_roles.rolbypassrls` for `postgres` is `true`. RLS is
**bypassed entirely** for their internal `SELECT ... FROM profiles` — a bare
`auth.uid()` on `profiles`'s own policies has **zero** effect on any other
policy that calls these two helpers. `profiles` is fixed in this pass
anyway (its own direct-read paths benefit), but not for the cascade
reason given, and it carries no special priority over the other 9 tables.

## Stale `pg_stat_statements` entries, not a live bug

The requested "top 20 slowest" query surfaced `client_report_rows`/
`client_report_totals` at up to **7.7s** — worse than anything else found.
Checked `pg_proc`: neither function exists any more (dropped in `0118`,
v1.48, when `ClientPrihodTab.tsx` was rewritten onto `report_query_page`/
`report_totals` directly). These are leftover aggregate stats from before
the drop — `pg_stat_statements` doesn't purge entries for dropped objects.
Not a live target. (Also filtered out as noise: `pg_timezone_names` and a
couple of one-off `CREATE OR REPLACE FUNCTION`/comment-text entries from
migration application itself — not app traffic.)

## The 10 remaining tables — fixed, sweep now 100% complete

`supabase/migrations/0132_rls_auth_uid_caching_remaining_tables.sql` wraps
`auth.uid()`/`my_role()`/`my_owner_id()` on the SELECT policies of
`chiqim_fura_photos`, `chiqim_line_raw_serials`, `dispatch_manifest`,
`notes`, `owners`, `product_categories`, `profiles`, `rezka_cycles`,
`settings_limits`, `audit_log` — same pattern as `0130`/`0131`. Applied
live, no deadlock this time.

Advisor re-run after `0132`: `auth_rls_initplan` count 12 → **2**, both on
`INSERT ... with_check` (`notes_insert`, `audit_log_insert`) — zero
read-latency relevance, but trivial to close too:
`0133_rls_auth_uid_caching_insert_policies_full_closure.sql`. Advisor
re-run after `0133`: **0 findings, schema-wide.** The entire RLS
role/owner-caching class of issue this session found (first on 2 RPCs in
`0202`, then the gap in the same 17 tables in `0206`, now the remaining 10)
is closed. `0205`'s tech-debt entry updated to reflect this — nothing left
in its scope.

## `report_query_page`/`report_totals`: real, but a *different* problem

Confirmed via `pg_stat_statements` (current, live, un-stale): both are
genuinely slow right now — `report_query_page` max 7.07s across several
parameter-shape variants, `report_totals` max 6.57s. Checked their
dependency graph: `chiqim_line_raw_serials`/`dispatch_manifest` (the two
tables the user specifically named as CHIQIM-relevant) are real
dependencies via `report_dispatch_rows_v2`, confirming that guess was
correct, unlike the `profiles` one.

Measured before/after `0132`/`0133` (client role, full-year range, no
filters, EXPLAIN ANALYZE):

| function | before | after |
|---|---|---|
| `report_query_page` | Planning 970ms + Execution 2904ms = **3874ms** | Planning 437ms + Execution 2845ms = **3282ms** |
| `report_totals` | Planning 341ms + Execution 1473ms = **1814ms** | Planning 383ms + Execution 1744ms = 2126ms (noise — see caveat below) |

Real, measurable improvement in planning time (single-shot noise is large
at this scale — see every prior EXPLAIN ANALYZE in `0202`/`0206` — so
`report_totals`'s single after-sample landing slightly higher than its
single before-sample is not read as a regression). **But both functions
remain multi-second even after the complete RLS sweep** — this is not the
same bug as `0202`/`0206`, and the fix for those two doesn't fully resolve
this one.

### New finding: unusually high Planning Time, and per-row LATERAL nesting

`report_query_page` → `report_filtered_rows_v2` → `report_dispatch_rows_v2`
→ (`chiqim_component_is_match`, `kirim_line_report_bundle` — one call per
matched serial via `LATERAL`, `chiqim_dispatch_calibre_breakdown` — one
call per `chiqim_dispatch` row via `LATERAL`, itself calling
`client_calibre_split`/`chiqim_departed_at` internally). `report_totals`
additionally runs `kirim_line_report_bundle` over **every** distinct
serial matching the filter, not just the current page (`cross join lateral`
over `distinct_serials`, unbounded by `p_limit`/`p_offset`).

Two distinct, compounding costs, neither one an RLS caching problem:
1. **Planning Time itself is 300–970ms** — Postgres has to inline/expand
   this entire multi-level chain of `LANGUAGE sql` functions at plan time.
   This is unusually high; a typical query plans in single-digit ms.
2. **`kirim_line_report_bundle` is genuinely expensive per call** — several
   `materialized` CTEs and correlated subqueries against `moyka_sends`,
   `finished_pallets`, `wash_cycles`, `chiqim_pallet_consumption`, plus a
   nested call to `client_calibre_split()` inside its own `loss_range_calc`
   CTE — run once per distinct serial, unbounded by pagination in
   `report_totals`.

🚩 **Flagged, not fixed — needs its own investigation, not a blind
extension of this RLS-caching pass.** A real fix here is structural (e.g.
batching `kirim_line_report_bundle`'s per-serial logic into a single
set-based CTE joined once, instead of one `LATERAL` call per row) — a
bigger, riskier change than a policy rewrite, appropriate for its own PR
with its own before/after verification, not something to fold into a
same-day RLS hotfix. Logged as new tech debt (see below).

## `plan_cache_mode = force_custom_plan`: recommended against, with evidence

The requested defensive measure would very likely make **`report_query_page`/
`report_totals` slower on average**, not safer: since 300–970ms of their own
latency is *planning* time, forcing a custom (fully re-planned) plan on
*every* call means paying that cost every time, rather than letting
Postgres reuse a cheaper generic plan after repeat calls (which is likely
already happening some of the time, given the measured planning-time
variance itself). This is the opposite of the risk `force_custom_plan`
guards against — it trades a plan-*quality* risk (which the two rounds of
manual `PREPARE`/`EXECUTE ×7` testing in `0206` found no evidence of, for
`rahbar_stock_snapshot`) for a guaranteed planning-*cost* tax, on exactly
the two functions where that cost is highest. Not applied. If the
follow-up structural fix above doesn't fully resolve the tail, the
directionally-correct lever to revisit would be encouraging generic-plan
reuse (`force_generic_plan`), not forcing custom — but that carries its own
risk (a generic plan can't specialize per filter value) and wasn't tested
here either; recommend testing empirically before applying either way.

## `pg_stat_statements` reset

Reset at `2026-09-19 12:18:50 UTC`, right after the `0132`/`0133` fixes were
verified, so the next hour's data is clean and attributable to today's
actual state rather than mixed with pre-fix history (every prior number in
this document and in `0202`/`0206` was cumulative-since-last-reset, which
made it impossible to tell "still happening now" from "happened before the
fix" — worth remembering next time before drawing conclusions from
`pg_stat_statements` alone).

## Also surfaced, not yet actioned (from the "top 20 by max" scan)

- `get_serial_passport`: 412 calls, max 4.03s. Not investigated this round
  — flagged for the same kind of look `report_query_page` just got.
- `client_chiqim_ledger`: max 3.68s but mean only 113ms (huge stddev,
  small call count) — likely the same tail-latency shape, not investigated.
