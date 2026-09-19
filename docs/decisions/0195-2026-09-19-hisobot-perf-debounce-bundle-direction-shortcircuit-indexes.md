# Hisobot perf: filter debounce, per-serial function bundle, direction short-circuit, timestamp indexes

## What was reported

Hisobot search/filter felt slow and, per the operator, kept getting worse as more data
accumulated — not just slow in absolute terms, but degrading on a curve. A prior diagnostic
session (read-only, `execute_sql` in read-only mode against project `qohoqbapevrcjqxbstxi`)
root-caused this to function-call fan-out, not indexes or disk I/O: `report_totals` and
`report_query_page` each called **five separate per-serial functions**
(`kirim_line_state`, `kirim_line_moyka_asof`, `kirim_line_moyka_range`,
`kirim_line_calibre_output_range`, `kirim_line_loss_range`) via five independent
`cross join lateral` / `left join lateral` drives over the filtered set — observed as
**152–431 nested-loop iterations at only 34 distinct serials**, with 100% shared-buffer
hits and zero disk reads. This entry covers the fix session that followed.

## What shipped

Four changes, applied together:

1. **300ms filter debounce** (`src/lib/useReportQuery.ts`) — RPC calls (`report_query_page` +
   `report_totals`) now fire 300ms after the last filter change, not on every keystroke.
   Page navigation and the initial load are explicitly excluded from the debounce (tracked via
   `isInitialMount`/`prevFilterKeyRef`) — both should still feel instant.
2. **`kirim_line_report_bundle(serial, from, to)`** — one new function replacing the five
   separate per-serial lateral calls inside `report_totals` and `report_query_page`. Shares
   base row-sets across the fields that need them (`moyka_sends`, `finished_pallets`,
   `wash_cycles`, `report_moyka_output_rows` are each fetched once per bundle call into a
   `materialized` CTE and reused via `FILTER`-clause sums, instead of being re-queried once
   per old function). `report_totals` goes from five `cross join lateral`s over
   `distinct_serials` to one; `report_query_page` goes from five `left join lateral`s per page
   row to one.
3. **Direction short-circuit** (`report_filtered_rows_v2`) — the `kind in ('kirim',
   'moyka_send')` branch and the `moyka_output` branch used to always fully evaluate their
   underlying view/function, discarding the result via a `WHERE` clause afterward if the
   direction wasn't actually selected. Both now sit behind a
   `(select 1 where <gate>) cross join lateral (<expensive query>)` — the standard
   Postgres zero-row-LATERAL short-circuit — so the branch's subplan is **absent from the
   plan entirely** when its direction is excluded, not merely filtered to zero rows after
   running. Verified via `EXPLAIN`: filtering to `p_directions = ['chiqim']` shows only
   `Function Scan on report_dispatch_rows_v2` in the plan, no trace of the other two branches.
4. **Four btree indexes** — `kirim_orders(order_date)`, `finished_pallets(received_date)`,
   `moyka_sends(sent_date)`, `rezka_sends(serial)`. The last one is the genuinely missing
   index (no index at all beyond `id`); the other three had columns filtered directly by the
   reporting engine with no supporting index.

Applied live via MCP `execute_sql`, then committed:
`docs/data-corrections/2026-09-19_hisobot_bundle_and_direction_shortcircuit.sql` (changes 2–3)
and `supabase/migrations/0124_hisobot_timestamp_indexes.sql` (change 4), branch
`claude/lucid-sagan-dfin74`, commit `2df40cf`.

## Byte-identity verification (the hard gate on change 2)

`kirim_line_report_bundle` was required to match the five original functions' combined output
byte-for-byte before being wired into `report_totals`/`report_query_page` — no new balance
math, no corrected semantics, any mismatch a HALT. Verified with a null-safe
(`IS DISTINCT FROM`) comparison across **all 34 distinct serials in `kirim_lines`**, **all 20
overlapping output fields**, on **two date windows** (a wide 2020–2027 range and a realistic
tight 2026-08-01–2026-09-19 range, to stress the range-scoped `FILTER`-clause translations
specifically) — **0 mismatches on both runs**. Only after that did the bundle get wired into
the two RPCs; `report_totals`'s own aggregate output (`total_count`, `state_serial_count`,
`total_kg_in`/`total_kg_out`) was re-checked against its pre-change values afterward and
matched exactly for the unrestricted (`p_directions = null`) case.

One inconsistency in the original functions — a wash-cycle open-date comparison that uses a
bare `opened_at::date` cast in one place and `(opened_at at time zone 'utc')::date` in
another — was reproduced verbatim in the bundle rather than fixed, because fixing it would
have changed output and failed the verification gate. Flagged, not silently carried forward:
see the SQL file's "NOTE A" comment. A real fix belongs in a future prompt that explicitly
touches state-column semantics — out of scope here.

## Measured effect

Benchmarked with `EXPLAIN (ANALYZE, FORMAT JSON)` on `report_totals`/`report_query_page`,
wide date range, all directions, one product type (Subxon), 3 warm runs per datapoint:

| Datapoint | `report_totals` plan/exec (ms) | `report_query_page` plan/exec (ms) |
|---|---|---|
| Baseline | 32.0 / 58.7 | 29.8 / 128.3 |
| After change 2 (bundle) | 43.6 / 72.1 | 39.4 / 133.0 |
| After change 3 (short-circuit) | 41.4 / 86.7 | 35.4 / 124.9 |
| After change 4 (indexes) | 33.7 / 52.5 | 32.5 / 151.9 |

**Wall-clock is roughly flat at today's 22–34-serial data size — within run-to-run noise, not
a measured win.** Planning time for `report_totals` went up slightly after change 2, because
one larger function body costs more to plan than five small ones, even though it's now
invoked once instead of five times per serial. The debounce (change 1) is the only change
with an immediately *felt* improvement, since it cuts request count regardless of data
volume — it isn't captured by the `EXPLAIN` numbers above at all.

What did verifiably improve, structurally:

- `report_totals`'s full plan dropped from **850 to 475 nodes** after change 2 — the five
  separate per-serial driving loops over `distinct_serials` collapsed into one.
- Change 3's short-circuit is confirmed via `EXPLAIN`, not inferred: the excluded branch's
  subplan is missing from the plan tree entirely under a narrowed direction filter.
- Change 4's indexes are confirmed **inert today** — `EXPLAIN` still shows `Seq Scan` chosen
  on all four tables (0–255 rows each), which is the objectively correct plan at this size —
  but present so the plan flips to an index scan automatically once each table outgrows that
  threshold, rather than silently regressing.

Changes 2–4 are asymptotic fixes for the "gets worse as data grows" curve, not a today's-
latency win — consistent with the original diagnostic's finding that the cost is procedural
fan-out (call count × nested-loop iterations), not disk I/O, at current data volume.

## Explicitly not changed

- No change to Hisobot's output shape, column semantics, or balance math anywhere.
- The five original functions (`kirim_line_state`, `kirim_line_moyka_asof`,
  `kirim_line_moyka_range`, `kirim_line_calibre_output_range`, `kirim_line_loss_range`) are
  left in place, unchanged — still called by `get_serial_passport`, `get_client_report`,
  `rahbar_dashboard_ledger`, and `yield_rows`, none of which this pass touched. Dropping them
  is explicitly deferred, not attempted.
- `finished_pallets`- and `report_moyka_output_rows`-sourced row-sets inside the bundle were
  **not** fused into one shared CTE despite likely being equivalent sets — see the next entry.

## Cross-reference

- `docs/data-corrections/2026-09-19_hisobot_bundle_and_direction_shortcircuit.sql` — changes 2
  and 3 (`kirim_line_report_bundle`, the updated `report_totals`/`report_query_page`, the
  updated `report_filtered_rows_v2`), applied against `qohoqbapevrcjqxbstxi`.
- `supabase/migrations/0124_hisobot_timestamp_indexes.sql` — change 4.
- Commit `2df40cf` on `claude/lucid-sagan-dfin74`.
