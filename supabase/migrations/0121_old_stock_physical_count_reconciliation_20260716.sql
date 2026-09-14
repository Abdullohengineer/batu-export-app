-- Old-stock physical count reconciliation (stage 2 of 2) -- applies the corrections
-- identified read-only in docs/old-stock-reconciliation-stage1-report.md, comparing
-- live old-stock figures against the 16.07.2026 physical count. docs/decisions/0186.
--
-- Two kinds of change, both pure data corrections, no schema/view/RPC change:
--
-- 1. Qand Qizil -> Qand relabel (3 pallets, all under the single opening-stock serial
--    020826-038). Confirmed before writing: all 3 are status='in_stock', voided_at is
--    null, and have zero rows in chiqim_pallet_consumption, serial_mint_sources,
--    dispatch_manifest, or lab_results.sampled_pallet -- safe to retype, no downstream
--    reference breaks. Same barcodes, same serial -- no void, no insert. This was a
--    seed-time mislabel: combining Qand + Qand Qizil at K6/K8 already matched the
--    physical count exactly (K6: 0+1,040=1,040; K8: 50+180=230) before this migration.
--
-- 2. old_kn_pools.opening_kg correction for 4 pools (Isfara, Subxon, Natural, Qand) --
--    opening_kg only, collections/serial_mint_sources untouched. old_kn_pools has one
--    relevant constraint (opening_kg >= 0, no DB-level tie to collections); confirmed
--    by hand that new opening_kg >= existing collected+minted for every pool (Subxon is
--    the only one with any collections: 37,439 >= 21,782). Isfara's pool was already
--    corrected once before (migration 20260822043820, old_kn_pools_isfara_correction,
--    56,359 -> 56,120) -- this is the same kind of book-value fix against the 16.07.2026
--    physical count, not a design change.
--
-- Out of scope, confirmed not needed here: no yield/loss recomputation (finished_pallets
-- has no trigger/cache depending on type_id or old_kn_pools.opening_kg -- every consumer
-- reads live, same as migration 0182's closed-cycle note), no storage_loss booking, no
-- close_out_old_stock, no new balance calculation (every read path -- stock_on_hand_rows,
-- rahbar_stock_snapshot, Ombor qoldig'i -- already derives from these two tables live and
-- picks the correction up automatically).
--
-- Dry-run reviewed with the user before applying for real (see chat transcript).

DO $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_reason text := 'physical count reconciliation 16.07.2026 -- stage 2';
  v_qand_type_id uuid := (select id from product_types where name = 'Qand');
BEGIN

  -- 1. Relabel: Qand Qizil -> Qand, 3 pallets under serial 020826-038
  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-020826-038-06-1';
  UPDATE finished_pallets SET type_id = v_qand_type_id WHERE barcode2 = 'PLT-020826-038-06-1'
    RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-020826-038-06-1', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-020826-038-06-2';
  UPDATE finished_pallets SET type_id = v_qand_type_id WHERE barcode2 = 'PLT-020826-038-06-2'
    RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-020826-038-06-2', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  SELECT row_to_json(fp)::jsonb INTO v_before FROM finished_pallets fp WHERE fp.barcode2 = 'PLT-020826-038-08-1';
  UPDATE finished_pallets SET type_id = v_qand_type_id WHERE barcode2 = 'PLT-020826-038-08-1'
    RETURNING row_to_json(finished_pallets)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('finished_pallets', 'PLT-020826-038-08-1', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  -- 2. old_kn_pools.opening_kg corrections (opening_kg only, collections untouched)
  SELECT row_to_json(p)::jsonb INTO v_before FROM old_kn_pools p WHERE p.id = 'c788e71e-3c24-45f5-b360-96796350a38d'; -- Isfara
  UPDATE old_kn_pools SET opening_kg = 36849 WHERE id = 'c788e71e-3c24-45f5-b360-96796350a38d'
    RETURNING row_to_json(old_kn_pools)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('old_kn_pools', 'c788e71e-3c24-45f5-b360-96796350a38d', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  SELECT row_to_json(p)::jsonb INTO v_before FROM old_kn_pools p WHERE p.id = 'b3aedb92-90dc-43b3-84eb-33af207b81d2'; -- Subxon
  UPDATE old_kn_pools SET opening_kg = 37439 WHERE id = 'b3aedb92-90dc-43b3-84eb-33af207b81d2'
    RETURNING row_to_json(old_kn_pools)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('old_kn_pools', 'b3aedb92-90dc-43b3-84eb-33af207b81d2', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  SELECT row_to_json(p)::jsonb INTO v_before FROM old_kn_pools p WHERE p.id = '53490ad6-6cc8-44c3-95e5-a107000fdea5'; -- Natural
  UPDATE old_kn_pools SET opening_kg = 7367 WHERE id = '53490ad6-6cc8-44c3-95e5-a107000fdea5'
    RETURNING row_to_json(old_kn_pools)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('old_kn_pools', '53490ad6-6cc8-44c3-95e5-a107000fdea5', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

  SELECT row_to_json(p)::jsonb INTO v_before FROM old_kn_pools p WHERE p.id = '10169b1f-4ac8-4836-ba39-d46cb1e833d2'; -- Qand
  UPDATE old_kn_pools SET opening_kg = 1669 WHERE id = '10169b1f-4ac8-4836-ba39-d46cb1e833d2'
    RETURNING row_to_json(old_kn_pools)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('old_kn_pools', '10169b1f-4ac8-4836-ba39-d46cb1e833d2', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

END $$;
