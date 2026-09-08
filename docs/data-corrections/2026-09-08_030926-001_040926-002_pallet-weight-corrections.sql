-- Serial 040926-002 (K1/KN data entry error) and serial 030926-001 (K1/K2/K4/KN
-- output correction, wash cycle still open) — docs/decisions/0179.
--
-- 040926-002: booked K1=4,820/KN=780 (loss 950kg/14.50%); paper log says K1=4,530/KN=1,690
-- (loss 330kg/5.04%). Pure within-serial data entry fix, no cross-serial movement.
--
-- 030926-001: wash cycle OPEN (closed_at null), most material still in moyka. Booked output
-- was wrong across K1/K2/K4/KN; paper log says K2=720, K4=1,610, KN=550, no K1, with 5,412kg
-- still in moyka. Cycle stays open — no loss finalized by this correction.
--
-- Dry-run (BEGIN...ROLLBACK) executed and shown to the user for both serials before applying.
-- Applied 2026-09-08 in one DO block so every write gets a paired audit_log row (13 total: 6
-- for 040926-002, 7 for 030926-001). Preconditions checked before writing: no downstream
-- references (chiqim_pallet_consumption / serial_mint_sources / lab_results.sampled_pallet)
-- on any of the 10 voided pallets across both serials; 030926-001's wash_cycles row confirmed
-- status='active', closed_at/finalized_at null.
--
-- Verified after applying: kirim_line_calibre_output, get_serial_passport (returnedKg/
-- byCalibre), report_moyka_output_rows_by_serial (Hisobot MOYKADAN) all match target exactly
-- for both serials; 030926-001's wash cycle still active/open/unrealized (untouched by this
-- correction); SerialPassportModal.tsx's bekor_qilingan filter still excludes voided pallets.

DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_reason_040 text := 'Serial 040926-002 K1/KN correction (data entry error): booked K1 4,820/KN 780, real paper log K1 4,530/KN 1,690';
  v_reason_030 text := 'Serial 030926-001 output correction (wash cycle open, data entry error): real output so far per paper log K2 720/K4 1,610/KN 550, no K1';
BEGIN

  -- ===== 040926-002 =====
  FOR v_before, v_after IN
    SELECT row_to_json(fp)::jsonb, NULL::jsonb FROM finished_pallets fp
    WHERE fp.barcode2 IN ('PLT-040926-002-01-1','PLT-040926-002-01-2','PLT-040926-002-KN-1','PLT-040926-002-KN-2')
  LOOP
    UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = (v_before->>'barcode2') RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
    INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
    VALUES ('finished_pallets', v_before->>'barcode2', NULL, 'update_correction',
      v_before || jsonb_build_object('reason', v_reason_040), v_after || jsonb_build_object('reason', v_reason_040), now());
  END LOOP;

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-040926-002-01-3', serial, type_id, calibre_id, 4530, received_date, 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-040926-002-01-1'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-040926-002-01-3', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason_040), v_after || jsonb_build_object('reason', v_reason_040), now());

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-040926-002-KN-3', serial, type_id, calibre_id, 1690, received_date, 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-040926-002-KN-1'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-040926-002-KN-3', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason_040), v_after || jsonb_build_object('reason', v_reason_040), now());

  -- ===== 030926-001 =====
  FOR v_before, v_after IN
    SELECT row_to_json(fp)::jsonb, NULL::jsonb FROM finished_pallets fp
    WHERE fp.barcode2 IN ('PLT-030926-001-01-1','PLT-030926-001-02-1','PLT-030926-001-04-1',
                           'PLT-030926-001-KN-1','PLT-030926-001-KN-2','PLT-030926-001-KN-3')
  LOOP
    UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = (v_before->>'barcode2') RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
    INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
    VALUES ('finished_pallets', v_before->>'barcode2', NULL, 'update_correction',
      v_before || jsonb_build_object('reason', v_reason_030), v_after || jsonb_build_object('reason', v_reason_030), now());
  END LOOP;

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-030926-001-KN-4', serial, type_id, calibre_id, 550, received_date, 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-030926-001-KN-1'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-030926-001-KN-4', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason_030), v_after || jsonb_build_object('reason', v_reason_030), now());

END $$;
