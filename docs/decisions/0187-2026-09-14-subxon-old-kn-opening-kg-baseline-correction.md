## 2026-09-14 — Subxon OLD KN opening_kg baseline correction (supersedes 0121's Subxon line only)

**Context:** Migration `0121_old_stock_physical_count_reconciliation_20260716.sql`
(`docs/decisions/0186`) anchored `old_kn_pools.opening_kg` for all 4 pools to a 2026-07-16
physical count date. That date was wrong for Subxon specifically: the actual physical count
date is **2026-09-12**, which is *after* the 21,782 kg collected from the Subxon pool on
2026-08-21 (3 chiqim requests). 0121 set Subxon's `opening_kg` to 37,439 — the physical count
figure itself — but since the count postdates the collection, that figure already reflects
stock *after* the 21,782 kg had left. Subtracting the collection a second time (via the
`opening_kg − collected − minted` balance formula every read path uses) undercounted the pool
by exactly 21,782 kg, landing the live balance at 15,657 instead of the correct 37,439.

This entry does not rewrite `0121`/`0186` — those stand as written, describing what was known
and applied at the time. This is a new, independent correction to the one line that was wrong,
per CLAUDE.md's "update SPEC/log why, never contradict silently" rule applied to a decision
entry rather than the spec.

### What was applied

Migration `0122_subxon_old_kn_opening_kg_baseline_correction.sql`:

- `old_kn_pools.opening_kg` for Subxon (`b3aedb92-90dc-43b3-84eb-33af207b81d2`): **37,439 →
  59,221** (+21,782 — exactly the 2026-08-21 collection total, confirmed by a `SELECT sum(...)
  FROM old_kn_collections ... WHERE collected_at >= '2026-08-01'` before writing the migration:
  7,677 + 7,150 + 6,955 = 21,782, matched the expected figure exactly, so no stop condition was
  hit).
- Nothing else touched: no other pool, no `finished_pallets` row, no `old_kn_collections` row.
- Same audit shape as 0121/0073: one `audit_log` row, `actor = NULL`, `action =
  'update_correction'`, `before`/`after` as `row_to_json`, reason `"physical count date
  correction -- Subxon KN opening_kg rebased for 2026-09-12 count"` embedded in both.

### Why +21,782 and not some other adjustment

Physical count (2026-09-12) = what remained in the pool at that date = 37,439. Since the
2026-08-21 collection (21,782 kg) happened *before* the count, that material was already gone
by count day — the count correctly did not include it. So the pool's true starting quantity
(`opening_kg`, i.e. gross stock before any collection) must be the count figure *plus* what had
already been drawn down by then: 37,439 + 21,782 = 59,221. The live balance formula
(`opening_kg − Σcollected − Σminted`) then correctly nets the same 21,782 back out:
59,221 − 21,782 − 0 = 37,439, matching the physical count exactly.

### Post-apply verification

- `old_kn_pools.opening_kg` Subxon = 59,221.
- `stock_on_hand_rows` (old_kn bucket): Subxon 37,439, Isfara 36,849, Natural 7,367, Qand
  1,669 — other three pools confirmed byte-identical to their 0121 values.
- `rahbar_stock_snapshot('eski').oldKnByType` Subxon = 37,439 — matches `stock_on_hand_rows`
  exactly, no mismatch between read paths.
- `rahbar_stock_snapshot('eski').totalKg` = **122,184** — this now matches the figure the
  stage-1 report (`docs/old-stock-reconciliation-stage1-report.md`) originally predicted for
  post-reconciliation state. 0186 flagged a 100,402 vs. 122,184 discrepancy after 0121; this
  correction resolves it. The 100,402 figure was not wrong given 0121's (incorrect) baseline
  assumption — it was the correct consequence of anchoring to 2026-07-16. With the baseline
  date corrected to 2026-09-12, the numbers now reconcile as originally expected.
- No schema/view/RPC change; no new balance calculation. Every read path picked up the
  correction automatically.

### Plain-language walkthrough

Subxon's old-Konditirskiy pool's book starting quantity was corrected from 37,439 kg up to
59,221 kg (+21,782 kg). No material moved and nothing physically changed
— this only fixes what date the system believed the pool's quantity was counted on. The pool
had 21,782 kg collected by a client on 2026-08-21; the actual physical count happened later,
on 2026-09-12, by which point that 21,782 kg was already gone. The system had (incorrectly)
treated the count as if it happened before that collection, on 2026-07-16, which caused it to
subtract the 21,782 kg a second time. After this fix, the pool's live/current balance reads
37,439 kg — exactly the 2026-09-12 physical count — and the dashboard total for all old stock
is back to 122,184 kg, matching what the original reconciliation expected.
