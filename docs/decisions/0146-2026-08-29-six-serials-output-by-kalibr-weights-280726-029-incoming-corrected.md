## 2026-08-29 — Six serials' output-by-kalibr weights + 280726-029 incoming corrected
**Context:** Manager reconciled the Hisobot output-by-kalibr view
(`0098_hisobot_output_by_kalibr.sql`, added earlier the same day) against the real
per-kalibr figures and supplied a corrected table for six serials: `290726-068`,
`290726-069`, `290726-070`, `290726-072`, `280726-029`, `110826-001`. Two problems
showed up at once. (a) `280726-029`'s incoming read **2218.4 kg** — a float artefact,
`800 + 1418.3999999999996`, sitting in `moyka_sends.qty_kg`; it is the only serial in
the set whose incoming figure was wrong. (b) Twelve `finished_pallets` rows carried
per-kalibr weights a few kg off the reconciled figures (e.g. `290726-068` KN 358 vs
360; `110826-001` K4 4657 vs 4670), so no serial's outputs + loss summed to its
incoming.

**Decision:** One data-correction migration, no DDL —
`0100_correct_serial_calibre_weights_and_moyka_send.sql`, applied live.

- **Loss is not written.** It is derived (`incoming − outputs`) in `yield_rows` and in
  the Hisobot totals alike, so correcting the outputs lands it on 50 / 45 / 27 / 53 /
  58 / 150 kg by itself. Writing a loss column would have meant storing a derived
  value — exactly what CLAUDE.md's "derive, don't store" rule forbids.
- **`weight_kg` edited in place, not void-and-remint** (chosen explicitly by Abdulloh
  when asked). None of the twelve pallets is referenced by
  `chiqim_pallet_consumption` — verified before writing — so their `barcode2` labels
  stay valid, and re-minting would have churned 12 printed labels and added 12 voided
  + 12 new pallet rows for what is a weight edit. Note this is *not* a departure from
  SPEC §2.15's "never DELETE, only void": nothing is deleted here. The 2026-08-28 pass
  that produced the current `-2`/`-3` barcode suffixes did use void-and-remint, but
  that pass was re-stating *which pallets exist*, a different operation from adjusting
  a weight on ones that already do.
- **Pallets keyed on `barcode2`**, a natural human-visible key, never on a generated
  uuid. Every `UPDATE` is additionally guarded on the value it replaces (and on
  `status = 'in_stock'`), so a re-run after any row has moved on is a no-op rather
  than a silent overwrite.
- **The migration carries its own reconciliation guard** — a `DO` block asserting
  `incoming` and `incoming − outputs` for all six serials against the expected
  figures, raising and aborting the transaction if any row lands elsewhere. It passed
  on application.

**Verified live, post-apply:** all six rows reproduce the manager's table exactly, and
so do the column totals — incoming 16,933; K2 3,130; K4 10,790; KN 2,610; K8 20; loss
383; total 16,933. Query used the same exclusion set as the Hisobot view
(`status not in ('bekor_qilindi', 'storage_loss')`).

**🚩 Flagged, not fixed (out of scope):** `yield_rows` does **not** exclude voided
pallets — its `output` CTE is a plain `LEFT JOIN finished_pallets` with no `status`
filter, unlike `0098`'s kalibr columns which correctly exclude
`bekor_qilindi`/`storage_loss`. Every one of these six serials has both a voided and a
live pallet set from the 2026-08-28 correction pass, so the Unumdorlik tab currently
double-counts their output and reports **negative loss** at roughly −100 % (e.g.
`290726-068`: `output_kg` 4,728 against 2,320 kg consumed, `loss_pct` −103.8; three
serials also show a `raw_overage_kg` in the −2,600…−5,800 range). This is a real
reporting bug on a live screen and pre-dates this task — it needs its own fix, and
correcting the weights here neither caused nor cures it.

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/serial-numbers-weight-units-x4zdut`.
