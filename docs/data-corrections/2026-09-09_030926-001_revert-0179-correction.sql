-- Revert of 030926-001's leg of docs/decisions/0179 — that correction was based on
-- incomplete information. The 6 pallets it voided were actually correct: they represent
-- two production sessions combined (an earlier session the user had forgotten about + a
-- recent session), not a data-entry error. docs/decisions/0180.
--
-- Un-voids the 6 original pallets back to in_stock, voids the KN-4 (550kg) pallet 0179
-- inserted. 040926-002's correction (also part of 0179) is untouched — only correct, real
-- bookings there.
--
-- Dry-run (BEGIN...ROLLBACK) executed and shown to the user before applying for real.
-- Verified after applying: kirim_line_calibre_output, get_serial_passport (returnedKg/
-- byCalibre/voidedKg), report_moyka_output_rows_by_serial (Hisobot MOYKADAN) all match the
-- pre-0179 original state; wash cycle still active/open/unrealized (untouched throughout).

DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_reason text := 'Revert of previous correction — original bookings were correct (docs/decisions/0180 reverts 0179''s 030926-001 leg)';
BEGIN

  FOR v_before, v_after IN
    SELECT row_to_json(fp)::jsonb, NULL::jsonb FROM finished_pallets fp
    WHERE fp.barcode2 IN ('PLT-030926-001-01-1','PLT-030926-001-02-1','PLT-030926-001-04-1',
                           'PLT-030926-001-KN-1','PLT-030926-001-KN-2','PLT-030926-001-KN-3')
  LOOP
    UPDATE finished_pallets SET status='in_stock', voided_at=NULL WHERE barcode2 = (v_before->>'barcode2') RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
    INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
    VALUES ('finished_pallets', v_before->>'barcode2', NULL, 'update_correction',
      v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());
  END LOOP;

  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-030926-001-KN-4';
  UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = 'PLT-030926-001-KN-4' RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-030926-001-KN-4', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

END $$;
