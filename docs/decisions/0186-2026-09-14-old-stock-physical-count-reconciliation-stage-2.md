## 2026-09-14 — Old-stock physical count reconciliation, stage 2 (applied)

**Context:** Stage 1 (`docs/old-stock-reconciliation-stage1-report.md`) compared live old-stock
figures against a 16.07.2026 physical count, read-only. This entry records stage 2 — the
approved corrections, applied as migration
`supabase/migrations/0121_old_stock_physical_count_reconciliation_20260716.sql` (archived copy:
`docs/data-corrections/2026-09-14_old-stock-physical-count-reconciliation-stage2.sql`). Direct
SQL in one `DO $$` block, modeled on the tara-correction audit_log shape
(`0073_correct_kirim_line_tara_rpc.sql`) and the pallet-correction pattern from
`docs/decisions/0183` — `audit_log` row per change, `before`/`after` as `row_to_json`, `actor =
NULL`, reason embedded as a jsonb key, same transaction as the write.

### What was applied

1. **Relabel 3 pallets Qand Qizil → Qand** (`finished_pallets.type_id`), same barcodes, same
   serial `020826-038`, no void/insert: `PLT-020826-038-06-1` (720 kg), `PLT-020826-038-06-2`
   (320 kg), `PLT-020826-038-08-1` (180 kg). Confirmed before writing: all three were
   `status='in_stock'`, `voided_at IS NULL`, and had zero rows in
   `chiqim_pallet_consumption`, `serial_mint_sources`, `dispatch_manifest`, or
   `lab_results.sampled_pallet` — safe to retype, nothing downstream could break.

2. **`old_kn_pools.opening_kg` corrected for 4 pools** (collections/`serial_mint_sources`
   untouched):
   - Isfara: 56,120 → 36,849 (id `c788e71e-3c24-45f5-b360-96796350a38d`)
   - Subxon: 38,202 → 37,439 (id `b3aedb92-90dc-43b3-84eb-33af207b81d2`)
   - Natural: 7,791 → 7,367 (id `53490ad6-6cc8-44c3-95e5-a107000fdea5`)
   - Qand: 1,584 → 1,669 (id `10169b1f-4ac8-4836-ba39-d46cb1e833d2`)

   `old_kn_pools` carries one relevant constraint, `CHECK (opening_kg >= 0)` — no DB-level tie
   to collections. Confirmed by hand that new `opening_kg >= collected + minted` for every
   pool before applying (Subxon is the only one with any collections: 37,439 ≥ 21,782).

No schema, view, or RPC change. No storage-loss booking, no `close_out_old_stock`, no yield/loss
recomputation — every read path (`stock_on_hand_rows`, `rahbar_stock_snapshot`, "Ombor qoldig'i")
already derives from `finished_pallets.type_id` and `old_kn_pools.opening_kg` live and picked the
correction up automatically. No new balance calculation was written.

### Post-apply verification

- `stock_on_hand_rows` (old-stock, washed): Qand K6 = 1,040, Qand K8 = 230, zero Qand Qizil rows
  remain. Every other washed line unchanged.
- `stock_on_hand_rows` (old-stock, `old_kn` bucket) = `rahbar_stock_snapshot('eski').oldKnByType`,
  identical kg-for-kg: Isfara 36,849, Natural 7,367, Qand 1,669, **Subxon 15,657** (not 37,439 —
  see below).
- 7 `audit_log` rows inserted, one per changed row (3 pallets + 4 pools), `actor = NULL`,
  `action = 'update_correction'`, reason `"physical count reconciliation 16.07.2026 -- stage
  2"` embedded in both `before` and `after`. Verified present and correctly shaped.
- **`rahbar_stock_snapshot('eski').totalKg` = 100,402, not the 122,184 the stage-1 report
  predicted.** Not a bug: `totalKg` sums the live *balance* (`opening_kg − collected − minted`),
  not raw `opening_kg`. Subxon's pool has a real, legitimate 21,782 kg collected on 2026-08-21
  (after the count date, explicitly out of scope for this migration — "Subxon KN's residual
  −763 vs the 21,782 collection question" was accepted as-is per the stage-2 task). Once
  `opening_kg` is anchored to the 16.07.2026 count baseline, that same 21,782 kg necessarily
  nets back out of the balance: 122,184 − 21,782 = 100,402 exactly. The stage-1 prediction
  assumed `opening_kg` flows straight through into `totalKg` unadjusted for existing
  collections, which isn't how the existing (unchanged) balance view works. Flagging here so
  the number isn't mistaken for a failed migration if someone checks the old predicted figure
  later — `stock_on_hand_rows` and `rahbar_stock_snapshot` still agree with each other, and both
  correctly reflect `opening_kg` at the corrected values.
- Ombor qoldig'i (old-stock filter) reads the same `stock_on_hand_rows` view — confirmed
  identical, no separate calculation to diverge.

### Plain-language walkthrough of every changed row

1. `PLT-020826-038-06-1` (720 kg) — product type flipped from Qand Qizil to Qand. Same pallet,
   same barcode, still in stock. Kalibr 6 unchanged.
2. `PLT-020826-038-06-2` (320 kg) — same change, same pallet family.
3. `PLT-020826-038-08-1` (180 kg) — same change, Kalibr 8.
   → After these three: "Qand" old-washed stock now correctly shows 1,040 kg at Kalibr 6 and
   230 kg at Kalibr 8 (matching the 16.07.2026 physical count exactly), and "Qand Qizil" old
   stock shows zero — it was a labeling mistake from opening-stock seeding, not missing or
   extra material.
4. Isfara old-KN pool's book quantity corrected from 56,120 kg down to 36,849 kg (−19,271 kg) to
   match the physical count. No material moved — this only corrects what the system believed
   was in the pool. (Largest correction here; flagged in stage 1 as worth investigating
   further since no dispatch activity explains the original 19,271 kg overstatement.)
5. Subxon old-KN pool's book quantity corrected from 38,202 kg down to 37,439 kg (−763 kg).
   Because 21,782 kg was legitimately collected from this pool on 2026-08-21 (untouched by
   this change), the pool's live balance is now 15,657 kg, not 37,439 kg — that gap is real
   material that already left, not part of this correction.
6. Natural old-KN pool's book quantity corrected from 7,791 kg down to 7,367 kg (−424 kg).
7. Qand old-KN pool's book quantity corrected from 1,584 kg up to 1,669 kg (+85 kg).

### Still open (deliberately out of scope, per the stage-2 task)

- Isfara's 19,271 kg pool correction has no corroborating dispatch record — booked as a
  book-value fix against the physical count per Abdulloh's approval, same footing as the
  2026-08-02 Isfara correction (`old_kn_pools_isfara_correction`), but not independently
  explained.
- Subxon's −763 kg residual (opening_kg 38,202 vs 37,439, net of the 21,782 kg collection) —
  accepted as-is, not investigated further.
