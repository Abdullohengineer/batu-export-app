-- Serial 040926-002: revise the K1/KN split within the already-corrected total from
-- docs/decisions/0179. docs/decisions/0181.
--
-- 0179 corrected 040926-002's total output/loss (K1 4,820/KN 780 -> K1 4,530/KN 1,690,
-- output 6,220, loss 330kg/5.04%) but the K1/KN split itself was still wrong per a closer
-- read of the paper log: real split is K1=4,930/KN=1,290 (same total output 6,220, same
-- loss 330kg/5.04% — only a 400kg shift between the two kalibres).
--
-- The task that requested this named the pre-0179 barcodes (PLT-040926-002-01-1/-01-2/
-- -KN-1/-KN-2), which were already voided by 0179 and are not the live active pallets.
-- Confirmed with the user before writing: void the CURRENT active pallets
-- (PLT-040926-002-01-3 4,530kg, PLT-040926-002-KN-3 1,690kg) instead, and insert the new
-- split. Wash cycle confirmed closed (closed_at 2026-09-08 14:06:44), final_loss_pct/
-- finalized_at both null (nothing cached to update); yield_rows is a live view
-- (migration 0030) over finished_pallets, so it recomputes automatically.
--
-- Dry-run (BEGIN...ROLLBACK) executed and shown to the user before applying for real.
-- Verified after applying: kirim_line_calibre_output, get_serial_passport (returnedKg/
-- byCalibre/lossKg), report_moyka_output_rows_by_serial (Hisobot MOYKADAN), and yield_rows
-- (output_kg/loss_kg/loss_pct/calibre_mix) all match the corrected split.

DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_reason text := 'Serial 040926-002 K1/KN split correction (revises 0179''s already-applied split): booked K1 4,530/KN 1,690, real paper log K1 4,930/KN 1,290 (docs/decisions/0181)';
BEGIN

  FOR v_before, v_after IN
    SELECT row_to_json(fp)::jsonb, NULL::jsonb FROM finished_pallets fp
    WHERE fp.barcode2 IN ('PLT-040926-002-01-3','PLT-040926-002-KN-3')
  LOOP
    UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = (v_before->>'barcode2') RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
    INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
    VALUES ('finished_pallets', v_before->>'barcode2', NULL, 'update_correction',
      v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());
  END LOOP;

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-040926-002-01-4', serial, type_id, calibre_id, 4930, received_date, 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-040926-002-01-3'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-040926-002-01-4', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-040926-002-KN-4', serial, type_id, calibre_id, 1290, received_date, 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-040926-002-KN-3'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-040926-002-KN-4', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

END $$;
