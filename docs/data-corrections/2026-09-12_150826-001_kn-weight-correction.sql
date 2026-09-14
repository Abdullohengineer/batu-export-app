-- Correct KN weight on serial 150826-001 (Isfara P3) -- 170 kg overage was a data-entry
-- error, never physically existed. docs/decisions/0183.
--
-- Wash cycle CLOSED (closed_at 2026-08-29 10:10:35), not reopened by this correction.
-- Same closed-cycle handling established in docs/decisions/0182 (P8/P9 add missing KN):
-- finished_pallets has no schema dependency on wash_cycles.closed_at, and
-- final_loss_pct/finalized_at are confirmed dead columns (nothing recomputes from them) --
-- no special handling needed, no cache to update.
--
-- K4 pallet PLT-150826-001-04-1 (4,260kg, passport-derived status band_qilingan/reserved)
-- untouched -- confirmed unrelated: separate pallet row, no relationship to KN-1/KN-2.
--
-- Confirmed before writing: cycle closed_at set; PLT-150826-001-KN-1 has zero downstream
-- references (chiqim_pallet_consumption, serial_mint_sources, lab_results.sampled_pallet).
--
-- Dry-run (BEGIN...ROLLBACK) executed and shown to the user before applying for real.
-- Verified after applying: kirim_line_calibre_output, get_serial_passport (returnedKg/
-- byCalibre/lossKg/isRealized), report_moyka_output_rows_by_serial (Hisobot MOYKADAN), and
-- yield_rows all match; K4's band_qilingan status and dispatched/available split unchanged;
-- wash_cycles confirmed unchanged (cycle stayed closed).

DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_reason text := 'Correct KN weight -- 170 kg overage was data-entry error, never physical';
BEGIN

  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-150826-001-KN-1';
  UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = 'PLT-150826-001-KN-1' RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-150826-001-KN-1', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-150826-001-KN-2', serial, type_id, calibre_id, 1250, received_date, 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-150826-001-KN-1'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-150826-001-KN-2', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

END $$;
