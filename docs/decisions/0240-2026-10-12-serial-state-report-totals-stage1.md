# 0240 — serial_state (Stage 1): report_totals lifetime fields set-based

2026-10-12

## Problem

Hisobot and client KIRIM feel slow because `report_totals` (shared by both
via `useReportQuery.ts`) ran `kirim_line_report_bundle_set`'s per-serial
fan-out across every distinct serial in the FILTERED set, not just the
visible page. The expensive part specifically: `kirim_line_effective_qty`
is a scalar function called once per serial, each call doing its own joins
against `storage_intake`/`gate_weighings`/`kirim_lines`/box-mass — O(N)
re-executions of the same join shape instead of one grouped scan.
`report_query_page_rows`/`report_page_enrich` (the per-page path) were
already fine — untouched by this change.

## What shipped (Stage 1 of a staged migration)

1. **`serial_state`** (new view, one row per serial, set-based — grouped
   scans and joins, no per-row scalar calls): `serial, owner_id,
   product_type_id, origin, arrival_date, declared_kg, netto_kg,
   hisobiy_kg, received_kg, skladda_kg, moykaga_kg, moykada_kg,
   moykadan_kg, vozvrat_kg, olib_ketilgan_kg`.
2. **`report_totals`** (text[] overload) rewritten: the 6 genuinely
   date-independent lifetime fields (`state_qabul_qilingan`,
   `state_omborda_qoldi`, `state_xom_jonatilgan`, `state_olib_ketilgan`,
   `state_moykaga_yuborilgan_lifetime`, `state_moykadan_chiqgan_lifetime`)
   now come from a plain join+sum against `serial_state`. The
   date-dependent fields (Moykada as-of-p_to, Moyka/Yo'qotish/K1-K8/KN
   period figures) are lifted out of `kirim_line_report_bundle_set`'s own
   body **verbatim** — same formulas, same two-status exclusion that
   function already uses — and inlined directly into `report_totals`,
   rather than called through the function, so the now-redundant lifetime
   computation is actually removed from this path rather than left as
   discarded output a planner might or might not prune.
   `kirim_line_report_bundle_set` itself is unchanged; `report_page_enrich`
   still calls it exactly as before.

Out of scope (per instruction): dashboard tiles, serial passport, Ledger
B/C — those swap onto `serial_state` one at a time in follow-up PRs.

## Deliberate, disclosed correction (confirmed with Abdulloh before shipping)

The task's instruction to use the 0106 three-status exclusion
(`bekor_qilindi`, `consumed`, `storage_loss`) for `serial_state`'s
finished-side terms directly conflicts with byte-matching
`report_totals`' *current* behaviour, which only excludes two statuses
(`bekor_qilindi`, `storage_loss`) via `kirim_line_report_bundle_set`.
Checked live: 32 `consumed` pallets / 26,740 kg exist; 12 / 7,590 kg are
already excluded today via the separate `serial_mint_sources` check,
leaving **20 pallets / 19,150 kg** that current `report_totals` counts and
this migration stops counting. Asked Abdulloh directly; chose to apply the
0106 exclusion now rather than hold byte-parity.

## Verification (all against production, read-only until this file;
objects created live only for testing, see below)

**Component formulas**, each checked against the existing scalar function
for every real (non-TEST) serial in production:
- `netto_kg`/`received_kg` vs `kirim_line_effective_qty()` — 0 mismatches.
- `moykada_kg` vs `kirim_line_moyka_asof(serial, current_date)` — 0
  mismatches (no open-cycle serial in production currently touches a
  `consumed` pallet, so this check didn't exercise the exclusion
  difference, but the join/aggregate shape matches the validated pattern).
- `moykadan_kg`/`olib_ketilgan_kg` vs `kirim_line_state()` — 10 serials
  differ, exactly the ones touching the 20 non-mint-sourced `consumed`
  pallets; every difference is accounted for by the disclosed correction
  above, nothing else.

**63,040 kg re-check**: `serial_state`'s own finished-on-hand sum
(`sum(moykadan_kg) - sum(olib_ketilgan_kg)`, `origin in ('delivery',
'internal_reprocess')`) = **63,040 kg exactly** — the true current
on-hand from the earlier "omborda qolgan" caption fix (PR before this
one), not the old buggy 80,790 kg period-closing figure. Confirms
`serial_state` doesn't carry forward that bug class.

**Byte-compare, old vs new `report_totals`, 3 scenarios** (temporary
`report_totals_v2_draft` function created live for this comparison, then
left behind — see cleanup note):
- **(a) wide-open** (`p_directions=null, p_from=2020-01-01, p_to=today`):
  differs only on `state_moykadan_chiqgan_lifetime` (243,800 → 224,650,
  -19,150) and `state_olib_ketilgan` (129,930 → 128,530, -1,400, serial
  210826-002). All other 29 fields exact.
- **(b) one month, single direction** (`kirim`, Sept 2026): differs only
  on `state_moykadan_chiqgan_lifetime` (73,700 → 62,150, -11,550 — a
  smaller slice of the same correction since fewer affected serials fall
  in this narrower window). All other fields exact, including
  `state_olib_ketilgan` (unaffected serial not in this window).
- **(c) one client KIRIM profile** (Global Export, this month to date,
  `kirim` only): **exact match, zero diff** — no affected serial falls in
  this range.

**Timing** (`EXPLAIN ANALYZE`, scenario a, 2 runs each): execution time
229.8ms → 166.6ms (run 1, -27%) and 187.97ms → 144.19ms (run 2, -23%) —
consistent ~23-28% reduction. Total wall time (incl. planning) was noisier
run-to-run due to unrelated planning-time variance on this small (47-serial)
test dataset; execution time is the more meaningful, consistent signal.
Expected to scale more favorably on a larger serial count, since the
removed per-serial scalar calls were O(N) while `serial_state`'s join is a
single scan.

**Cleanup note**: a temporary `report_totals_v2_draft` function was
created live for the byte-compare/timing checks above and could not be
dropped before this file was written — `DROP FUNCTION` timed out at the
tool layer (plain `SELECT`s stayed fast throughout, so the database itself
wasn't the bottleneck). **Needs manual cleanup**:
`drop function public.report_totals_v2_draft(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer);`
— harmless if left (unreferenced by the app), but should not stay in
production.
