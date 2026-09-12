-- Add 880 kg of KN output omitted from the 0178 P8/P9 supersede, split to equalize loss %
-- across both serials. docs/decisions/0182.
--
-- Both wash cycles are CLOSED (closed_at set 2026-09-09 ~05:53 UTC, confirmed via the
-- read-only diagnostic that preceded this task) and were confirmed NOT to be reopened by
-- this correction. Purely additive: no existing pallet voided or modified.
--
-- Pre-write checks (see diagnostic + this task's own verification):
--   - finished_pallets has zero triggers and no FK to wash_cycles -- inserting a new active
--     pallet has no dependency on closed_at, works cleanly against a closed cycle.
--   - wash_cycles.final_loss_pct/finalized_at are confirmed dead columns (zero functions
--     reference final_loss_pct; migration 0101 removed the old locked-loss "Tugallash"
--     design in favor of computing loss live everywhere) -- nothing to recompute/cache.
--   - Every consumer (yield_rows, client_serial_loss_kg, get_serial_passport,
--     kirim_line_calibre_output, Hisobot MOYKADAN) derives output/loss live from
--     finished_pallets at query time, so the new totals are picked up automatically.
--
-- P8 (110826-003): KN 1,260 -> 2,010 (+750), output 5,900 -> 6,650, loss 1,290 -> 540 (7.51%).
-- P9 (180826-001): KN 1,270 -> 1,400 (+130), output 7,230 -> 7,360, loss 730 -> 600 (7.54%).
-- Combined KN 2,530 -> 3,410 (+880); combined loss 2,020 -> 1,140.
--
-- Dry-run (BEGIN...ROLLBACK) executed and shown to the user before applying for real.
-- Verified after applying: kirim_line_calibre_output, get_serial_passport (returnedKg/
-- byCalibre/lossKg/isRealized), report_moyka_output_rows_by_serial (Hisobot MOYKADAN), and
-- yield_rows (output_kg/loss_kg/loss_pct) all match; wash_cycles confirmed unchanged
-- (same closed_at timestamps, status/final_loss_pct/finalized_at untouched) -- cycles were
-- never reopened or otherwise modified by this correction.

DO $$
DECLARE
  v_after jsonb;
  v_reason text := 'Add missing KN output to reconciled batch -- 880 kg omitted from previous supersede, equal-loss split';
BEGIN

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-110826-003-KN-5', serial, type_id, calibre_id, 750, DATE '2026-09-03', 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-110826-003-KN-4'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-110826-003-KN-5', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-180826-001-KN-5', serial, type_id, calibre_id, 130, DATE '2026-09-05', 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-180826-001-KN-4'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-180826-001-KN-5', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

END $$;
