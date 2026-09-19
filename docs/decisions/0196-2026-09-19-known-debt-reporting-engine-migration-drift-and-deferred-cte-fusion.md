# Known debt / deferred: reporting-engine migration drift, and a deferred CTE fusion

Two items surfaced during the 2026-09-19 Hisobot perf pass (see the entry immediately above)
that were deliberately not acted on. Logged here so neither is rediscovered as a surprise.

## 1. Reporting-engine SQL lives in `docs/data-corrections/`, not `supabase/migrations/`

The live definitions of `report_rows_v2`, `report_filtered_rows_v2`, `report_totals`,
`report_query_page`, `report_dispatch_rows_v2`, `kirim_line_report_bundle`, and every
`kirim_line_*`/`chiqim_dispatch_*` helper function the reporting engine depends on were all
applied as ad hoc `CREATE OR REPLACE FUNCTION`/`DROP + CREATE` statements under
`docs/data-corrections/2026-09-14_*.sql`, `2026-09-15_*.sql`, and now
`2026-09-19_hisobot_bundle_and_direction_shortcircuit.sql` — **none of these appear anywhere
in `supabase/migrations/`.** Confirmed by grepping `supabase/migrations/*.sql` for every
function name involved and finding nothing past the pre-2026-09-14 shape (`report_rows_v2`
last touched there in migration `0102`).

**Consequence:** `supabase/migrations/` is no longer a reliable source of truth for the
reporting engine. A fresh `supabase db push` against an empty database — the Mac dev-
environment setup, a new hire's local sandbox, or disaster recovery — would **not** reproduce
the schema this app actually runs against; it would stop at whatever `report_rows_v2` looked
like as of migration `0111`/`0118`, missing every `docs/data-corrections/` change made since.

**Not reconciled in this pass or the perf pass before it** — both explicitly scoped it out
(logged as separate known debt at the time; this entry makes that debt a first-class,
citable item rather than a comment buried in a SQL file header).

**Must be reconciled before the Mac dev-environment migration, or before pilot, whichever
comes first.** The reconciliation itself (squash the `docs/data-corrections/` reporting-engine
changes into real numbered migrations, in order, verified against the live `pg_get_functiondef`
output) is its own task — not attempted here.

## 2. `finished_pallets` vs `report_moyka_output_rows` CTE fusion — deferred

`kirim_line_report_bundle` (this session's consolidation, see the entry above) kept two base
row-sets as separate CTEs — `fp_all` (reads `finished_pallets` directly, `status not in
('bekor_qilindi', 'storage_loss')` + `NOT EXISTS serial_mint_sources`) and `moyka_out_all`
(reads the view `report_moyka_output_rows`, `pallet_status not in ('bekor_qilingan',
'saqlashda_yoqolgan')` + the same `NOT EXISTS`) — rather than fusing them into one shared scan.

They are very likely the same set: `report_moyka_output_rows`'s `pallet_status` mapping
translates `fp.status = 'bekor_qilindi'`/`'storage_loss'` to exactly those two exclusion
labels, and a `serial_mint_sources`-consumed pallet (`pallet_status = 'ishlatilgan'`) is
already excluded independently by the shared `NOT EXISTS` on both sides — so the two
predicates should select the identical row set by construction. But "very likely" and
"should" are not the bar the byte-identity gate on this work demanded (any mismatch across
all 34 serials × 2 date windows × 20 fields was a HALT), and proving the equivalence rigorously
— rather than asserting it and hoping — wasn't worth the risk under this task's time
constraints for a pair of tables that are 28 (`moyka_sends`) and 255 (`finished_pallets`) rows
today. The real, verified consolidation win (one bundle call instead of five separate function
calls per serial) was kept either way — this is a smaller, second-order optimization left on
the table, not a blocker to the change that shipped.

**Revisit if Hisobot perf regresses post-pilot** — at that point the two exclusion sets should
be proven equivalent properly (a direct query comparing `fp_all`'s row set against
`moyka_out_all`'s across every serial with any `finished_pallets` history, not just an
inspection of the SQL text) before fusing them, with the same byte-identity discipline this
session used for the bundle itself.

## Cross-reference

- `docs/decisions/0195-2026-09-19-hisobot-perf-debounce-bundle-direction-shortcircuit-indexes.md`
  — the pass both items came out of.
- `docs/data-corrections/2026-09-19_hisobot_bundle_and_direction_shortcircuit.sql` — item 2's
  `fp_all`/`moyka_out_all` split, with the same reasoning in its own header comment.
