# Phase 2 step 4: kirim_line_report_bundle_set shipped for report_totals; report_query_page's swap applied, measured, reverted

Ships `docs/decisions/0210-...-phase3-design-proposal-set-based-vs-summary-table.md`
Option 1, as approved by the user — but only half of it. The other half was
applied to the live project, benchmarked, found to badly regress
`report_query_page`, and reverted before this session ended. Recorded here
in full per this project's schema/behavior-surprise logging rule.

## What shipped

`docs/data-corrections/2026-09-21_kirim_line_report_bundle_set_based_rewrite.sql`,
applied live:

1. **New `kirim_line_report_bundle_set(p_serials text[], p_from date, p_to date)`**
   — computes the 20-field bundle for every serial in the array in ONE
   query (GROUP BY serial / per-serial CTEs over the whole set), instead of
   one function call per distinct serial. 7 of the 20 fields are
   lifetime/current-state, 13 are period-scoped; the three cycle-aware
   fields (`state_moykada`, `moyka_asof`, `loss_range`) keep a LATERAL/join
   over CYCLES, matching 0210's design exactly.
2. **`report_totals(text[], ...)`** swaps its `cross join lateral
   kirim_line_report_bundle(ds.serial, p_from, p_to)` (one call per
   distinct serial) for one call to `kirim_line_report_bundle_set`.

**Verification before applying** (non-destructively, via a temporary
`kirim_line_report_bundle_set_test` function, dropped after):
- Byte-identity: 198 rows compared (33 distinct serials × 6 date-window
  shapes — full history, current month, empty window, mid-cycle-end, a
  fixed historical range, last 7 days) across all 20 fields, `IS DISTINCT
  FROM` per field. **0 mismatches.**
- Whole-output md5 (old per-serial calls vs. new set-based call, 33
  serials, one range): **identical md5.**
- RLS-role equivalence was **not** re-run under two separately impersonated
  JWTs (this sandbox has no browser→Supabase path and `.env.test` is
  incomplete, same limitation Phase 1 flagged). Argument instead: both
  `kirim_line_report_bundle` and `kirim_line_report_bundle_set` are plain
  `LANGUAGE SQL STABLE` functions with no `SECURITY DEFINER`, no `auth.uid()`
  or `my_role()` calls, and no role-conditional logic anywhere in either
  body — RLS is enforced identically on the same underlying table reads for
  both the old and new formulations, so if they agree under one role they
  agree under any role. Verified under the MCP `execute_sql` connection
  (effectively unrestricted read access, a superset of any real role), which
  is a reasonable substitute given the above, not an evasion of the
  requirement — stated plainly rather than silently skipped, per this
  project's scope-discipline rule.

**Post-apply re-verification against real data** (CLAUDE.md workflow rule:
"once applied, re-verify end-to-end against real data"):
- `report_totals` called live, sane non-null output (88 rows, 27 serials,
  totals matching the shape of real business data).
- `report_query_page` row count (88) matches `report_totals.total_count`
  (88) — cross-check that both functions still agree with each other after
  the change.
- `EXPLAIN ANALYZE` on live `report_totals`: **217ms** total (down from
  0208's documented ~770ms baseline for the same function, though that
  baseline was `pg_stat_statements` mean over real traffic, not a single
  cold `EXPLAIN ANALYZE` call — the two aren't perfectly apples-to-apples,
  but the direction and rough magnitude both point the same way as 0210's
  own ~449ms combined-bundle estimate).

## What did NOT ship — the report_query_page regression

0210's design also called for `kirim_line_report_bundle(p_serial, from, to)`
to become a thin wrapper delegating to `kirim_line_report_bundle_set` (one-
element array), and for `report_query_page(text[], ...)` to swap its own
per-serial LATERAL for one set-based call, mirroring `report_totals`. Both
were applied to the live project and benchmarked as part of the same
end-to-end re-verification pass.

**`report_query_page` regressed severely**: `EXPLAIN ANALYZE` showed 8.9s–
16s total wall time (Planning Time alone 1.4s–8.3s across three runs),
against ~150–300ms for the exact original per-serial-LATERAL body,
benchmarked under identical fresh-connection conditions (both via MCP
`execute_sql`, which opens a new connection per call — this was controlled
for, not a caching artifact of comparing a warm connection against a cold
one).

Isolated the trigger via three targeted reproductions (all via temporary
test-named functions, dropped after):
1. `kirim_line_report_bundle_set` called directly and standalone (33
   serials, one range): **80ms.** Fast on its own.
2. The same function fed into `report_query_page`'s existing structure via
   `array_agg(distinct f.serial)`, WITH the function's pre-existing LATERAL
   to `chiqim_dispatch_calibre_breakdown` still in place: **8.9s–16s.**
   Slow.
3. `f` + `b` (the `kirim_line_report_bundle_set` CTE) alone, with the
   `chiqim_dispatch_calibre_breakdown` LATERAL removed from the
   reproduction: **168ms.** Fast.
4. The thin-wrapper version of `kirim_line_report_bundle`, called
   PER-SERIAL via the ORIGINAL `cross join lateral` shape (not the
   array-based `b` CTE at all) but still landing on
   `kirim_line_report_bundle_set` underneath, with the dispatch LATERAL
   present: **8.9s** (Planning Time 8.3s of that). Also slow — ruling out
   "it's specifically the array-argument pattern" as the cause.

Conclusion: the trigger is `kirim_line_report_bundle_set`'s own structural
complexity (15 CTEs) combined with a SECOND LATERAL (`chiqim_dispatch_
calibre_breakdown`) in the SAME outer query — not either piece alone, and
not the specific integration shape (array-agg vs. per-serial LATERAL via
the thin wrapper). `report_totals` has no such second LATERAL and shows no
regression at all.

**Root cause not chased further.** The most likely mechanism (not
confirmed): PostgreSQL's planner may attempt to reason jointly about two
correlated/LATERAL-bearing function calls in the same query, and the
combined search space (15-CTE function × dispatch LATERAL × the `f` CTE's
own UNION of several sub-selects) becomes expensive to plan well — the
symptom profile (huge Planning Time in some runs, huge Execution Time with
a large unattributed gap before the bundle CTE's own reported timestamps in
others) is consistent with either pathological join-order search or
per-call re-planning of the SQL function body, but neither was proven. This
is exactly the kind of guess this project's scope-discipline rule says to
flag rather than chase blindly on a live financial-reporting path — Hisobot
(rahbar/menejer/ombor/qorovul) and client Приход both read
`report_query_page` directly, and 8–16s per page load would have been a
severe regression for all four.

## User impact of the regression window, measured after the fact

The migration table gives the exact window: applied `20260921094201`
(09:42:01 UTC), reverted `20260921095335` (09:53:35 UTC) — **11.5 minutes
live**, mid-afternoon Tashkent time (14:42–14:54 local), with real users
on. `edge_logs` for the 09:00 UTC hour:

| | requests | 5xx | success |
|---|---|---|---|
| inside 09:38–09:57 | 430 | **62** | 85.6% |
| rest of the hour | 449 | 0 | 100% |

All 62 of the hour's failures fall inside the window; none outside it.
Per 5-minute bucket, `report_query_page`+`report_totals` went 4/6, 4/6,
7/8 failed with p50 latency 14–25s and max 45s; the 09:55 bucket recovers
to 7/8 OK, p50 1.5s. The blast radius was wider than Hisobot: with each
`report_query_page` call holding a pool connection for 10–16s, the
10-connection PostgREST pool saturated and the 09:50 bucket shows 28
collateral **503s on `/profiles`, `/product_types`, `/calibres`** —
cheap reads that had nothing to do with the change and failed only
because no slot was free. That is exactly the pool-ceiling mechanism
0213 describes, reproduced by this session's own mistake.

This is a genuine incident caused by this session, owned here rather
than folded into "reverted." It also changes the verification standard
for anything touching these RPCs: a byte-identity check on the function's
OUTPUT (which passed, 0/198 mismatches) is not a check on its PLAN. The
`EXPLAIN ANALYZE` that caught this was run only *after* applying; it
should have been run against a test-named copy of the *calling* function
(`report_query_page_test`) before touching the live one — the set
function alone was benchmarked in isolation (80ms) and looked fine. Next
time: benchmark the full call path under a test name first, apply second.

## What was reverted

`kirim_line_report_bundle(p_serial, from, to)` restored to its exact
original per-serial body (the one migration 0135 shipped, saved from this
session's own initial `pg_get_functiondef` inspection before any changes).
`report_query_page(text[], ...)` restored to its exact original body
(the same per-serial `cross join lateral kirim_line_report_bundle(...)`
shape). Both re-verified after revert: `EXPLAIN ANALYZE` back to ~205–300ms
total, matching pre-change expectations; row counts still agree with
`report_totals`. All temporary test functions (`kirim_line_report_bundle_
set_test`, `kirim_line_report_bundle_old_test`, `report_query_page_old_
test`, `report_query_page_wrapper_test`) dropped — the live schema now
holds exactly: the new `kirim_line_report_bundle_set`, the swapped
`report_totals`, and the ORIGINAL (unchanged) `kirim_line_report_bundle`
and `report_query_page`.

## Follow-up (not done in this session — flagged, not silently skipped)

`report_query_page` is still the pre-0210 per-serial-LATERAL shape and
still pays the "~33 distinct serials × ~50ms" cost 0208 originally
measured (~1.85s). The set-based win designed in 0210 is real and proven
(`report_totals` now has it) but is NOT available to `report_query_page`
until the planner regression above is root-caused and fixed — candidates
worth trying in a follow-up, not attempted here: forcing
`kirim_line_report_bundle_set` to not be considered for inlining
(`SET (parallel_safe = ...)`-style hints don't apply here, but a
`plpgsql` wrapper forcing an opaque call boundary might), restructuring
`report_query_page` so the dispatch LATERAL and the bundle join don't
appear in the same top-level FROM list (e.g., computing dispatch figures
in a separate CTE joined afterward), or filing this as a PostgreSQL
planner behavior to work around structurally rather than fight.
