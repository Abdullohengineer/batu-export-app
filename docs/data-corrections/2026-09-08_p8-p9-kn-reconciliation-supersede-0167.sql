-- P8/P9 KN reconciliation — supersedes 0167 (docs/decisions/0178-2026-09-08-p8-p9-kn-reconciliation-supersede-0167.md)
--
-- 0167 (docs/decisions/0167-2026-09-08-p8-p9-moyka-batch-reconciliation-110826-003-180826-001.md)
-- used a wrong P8 baseline (assumed P8's pre-existing K2/KN pallets were correct at 830/1,290
-- when the real paper log says K2=760 and P8 never had a KN-1 pallet at all — it was booked in
-- error and never physically existed). This correction:
--   Step 1: reverts 0167 in full (un-void its 3 voided P9 originals, void the 6 rows it inserted)
--   Step 2: fixes the two pre-existing P8 errors found on top of that (K2 830->760, void phantom KN-1)
--   Step 3: applies the real KN skew between P8 and P9 on the corrected baseline
--
-- Dry-run (BEGIN...ROLLBACK) executed and shown to the user for each step before this was applied
-- for real. Applied 2026-09-08 via a single DO block so every write gets a paired audit_log row.
--
-- Verified after applying: kirim_line_calibre_output, get_serial_passport (returnedKg/byCalibre),
-- moyka_sends (unchanged), report_moyka_output_rows_by_serial (Hisobot MOYKADAN) all match target
-- exactly; SerialPassportModal.tsx's bekor_qilingan filter (from 0167) still excludes voided rows
-- from the passport pallet list.

DO $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_reason text := 'P8/P9 KN reconciliation supersede (docs/decisions/0178): revert 0167, fix two pre-existing P8 errors, apply new KN skew';
BEGIN

  -- ===== STEP 1: revert 0167 =====
  -- un-void 3 P9 originals
  FOR v_before, v_after IN
    SELECT row_to_json(fp)::jsonb, NULL::jsonb FROM finished_pallets fp
    WHERE fp.barcode2 IN ('PLT-180826-001-04-2','PLT-180826-001-06-1','PLT-180826-001-KN-2')
  LOOP
    UPDATE finished_pallets SET status='in_stock', voided_at=NULL WHERE barcode2 = (v_before->>'barcode2') RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
    INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
    VALUES ('finished_pallets', v_before->>'barcode2', NULL, 'update_correction',
      v_before || jsonb_build_object('reason', v_reason || ' :: step1 un-void'),
      v_after  || jsonb_build_object('reason', v_reason || ' :: step1 un-void'), now());
  END LOOP;

  -- void 6 rows the 0167 correction inserted
  FOR v_before, v_after IN
    SELECT row_to_json(fp)::jsonb, NULL::jsonb FROM finished_pallets fp
    WHERE fp.barcode2 IN ('PLT-180826-001-04-3','PLT-180826-001-06-2','PLT-180826-001-KN-3',
                           'PLT-110826-003-04-3','PLT-110826-003-06-1','PLT-110826-003-KN-3')
  LOOP
    UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = (v_before->>'barcode2') RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
    INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
    VALUES ('finished_pallets', v_before->>'barcode2', NULL, 'update_correction',
      v_before || jsonb_build_object('reason', v_reason || ' :: step1 void 0167 insert'),
      v_after  || jsonb_build_object('reason', v_reason || ' :: step1 void 0167 insert'), now());
  END LOOP;

  -- ===== STEP 2: fix two pre-existing P8 errors =====
  -- void wrong K2 (830)
  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-110826-003-02-1';
  UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = 'PLT-110826-003-02-1' RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-110826-003-02-1', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason || ' :: step2 void wrong K2 (830, real 760)'),
    v_after  || jsonb_build_object('reason', v_reason || ' :: step2 void wrong K2 (830, real 760)'), now());

  -- insert corrected K2 (760)
  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-110826-003-02-2', serial, type_id, calibre_id, 760, received_date, 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-110826-003-02-1'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-110826-003-02-2', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason || ' :: step2 insert corrected K2 (760, paper log)'),
    v_after || jsonb_build_object('reason', v_reason || ' :: step2 insert corrected K2 (760, paper log)'), now());

  -- void phantom KN-1 (680), no replacement
  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-110826-003-KN-1';
  UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = 'PLT-110826-003-KN-1' RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-110826-003-KN-1', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason || ' :: step2 void phantom KN-1 (680, never physically existed, paper log shows only KN-2)'),
    v_after  || jsonb_build_object('reason', v_reason || ' :: step2 void phantom KN-1 (680, never physically existed, paper log shows only KN-2)'), now());

  -- ===== STEP 3: KN skew =====
  -- void P8 KN-2 (610)
  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-110826-003-KN-2';
  UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = 'PLT-110826-003-KN-2' RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-110826-003-KN-2', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason || ' :: step3 void P8 KN pre-skew (610)'),
    v_after  || jsonb_build_object('reason', v_reason || ' :: step3 void P8 KN pre-skew (610)'), now());

  -- insert P8 KN 1,260 dated 2026-09-03
  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-110826-003-KN-4', serial, type_id, calibre_id, 1260, DATE '2026-09-03', 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-110826-003-KN-2'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-110826-003-KN-4', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason || ' :: step3 insert P8 KN post-skew (1,260, P8 finish date 2026-09-03)'),
    v_after || jsonb_build_object('reason', v_reason || ' :: step3 insert P8 KN post-skew (1,260, P8 finish date 2026-09-03)'), now());

  -- void P9 KN-1 (490) and KN-2 (1430)
  FOR v_before, v_after IN
    SELECT row_to_json(fp)::jsonb, NULL::jsonb FROM finished_pallets fp
    WHERE fp.barcode2 IN ('PLT-180826-001-KN-1','PLT-180826-001-KN-2')
  LOOP
    UPDATE finished_pallets SET status='bekor_qilindi', voided_at=now() WHERE barcode2 = (v_before->>'barcode2') RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
    INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
    VALUES ('finished_pallets', v_before->>'barcode2', NULL, 'update_correction',
      v_before || jsonb_build_object('reason', v_reason || ' :: step3 void P9 KN pre-skew (1,920 combined)'),
      v_after  || jsonb_build_object('reason', v_reason || ' :: step3 void P9 KN pre-skew (1,920 combined)'), now());
  END LOOP;

  -- insert P9 KN 1,270 dated 2026-09-05
  INSERT INTO finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate, voided_at, created_at)
  SELECT 'PLT-180826-001-KN-4', serial, type_id, calibre_id, 1270, DATE '2026-09-05', 'in_stock', created_by, is_old_stock, weight_is_estimate, NULL, now()
  FROM finished_pallets WHERE barcode2 = 'PLT-180826-001-KN-1'
  RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-180826-001-KN-4', NULL, 'insert_correction',
    jsonb_build_object('reason', v_reason || ' :: step3 insert P9 KN post-skew (1,270, mixing date 2026-09-05)'),
    v_after || jsonb_build_object('reason', v_reason || ' :: step3 insert P9 KN post-skew (1,270, mixing date 2026-09-05)'), now());

END $$;
