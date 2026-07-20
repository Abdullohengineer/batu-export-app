-- Demo data for evaluating the Hisobot reporting layer (SPEC.md v1.10 §3.2).
-- Written 2026-07-20. See docs/DECISIONS.md "Demo data for reporting pilot"
-- for the full rationale. NOT TEST-prefixed on purpose -- the reporting
-- engine's isTestPlate() filter (reportQuery.ts) excludes any TEST- plate,
-- so this data uses ordinary-looking plates/drivers to remain visible.
--
-- Removability: every row this script creates is reachable from one of the
-- FOUR owners it creates below (Boysun/Farg'ona/Samarqand/Toshkent), which
-- exist ONLY for this seed and are referenced by nothing else in the system
-- at the time this was written. supabase/seed/demo-data-2026-07-20-cleanup.sql
-- removes exactly this data, scoped by those owner_ids, in dependency order.
--
-- Eight "stories" (KIRIM orders), spread 2026-05-04 to 2026-07-16 (~3 months):
--   1. Boysun / Subxon / single-line / sulfur target / fully dispatched incl. Konditirskiy
--   2. Farg'ona / Isfara / single-line / natural (no SO2) / partially dispatched, 2 pallets left in stock
--   3. Samarqand / Subxon+Qand qizil / MULTI-line / one line dispatched, other line's pallets awaiting CHIQIM lab
--   4. Toshkent / Subxon / single-line / RE-WASH (cycle 1 qayta_yuvish -> cycle 2 o'tdi) / Konditirskiy pallets from BOTH cycles, never dispatched
--   5. Boysun / Isfara+Subxon / MULTI-line / one line dispatched, other line's pallets lab-passed but left in stock
--   6. Farg'ona / Qand qizil / single-line / natural / RE-WASH #2 (cycle 1 qayta_yuvish -> cycle 2 o'tdi)
--   7. Samarqand / Subxon / single-line / raw never sent to Moyka (still-in-storage raw stock)
--   8. Toshkent / Isfara / single-line / gate stage 2 NOT done (provisional effective_qty), KIRIM lab not yet done
--   9. Samarqand / Isfara / single-line / cycle 1 FAILS lab (qayta_yuvish) and is NOT yet re-sent -- a real
--      WIP state the stuck-items view needs: distinct from stories 4/6, which show the re-wash already done

do $$
declare
  -- master data (confirmed live before writing this script)
  v_owner_boysun uuid;
  v_owner_fargona uuid;
  v_owner_samarqand uuid;
  v_owner_toshkent uuid;
  v_type_subxon uuid := '48aebd73-1de9-4edb-802a-ad38e197fc7e';
  v_type_isfara uuid := 'b6295a21-df2f-4eef-9c79-de7bc701ee94';
  v_type_qandqizil uuid := '35c5c93a-d5be-410e-8694-fac3a7ab861b';
  v_cal4 uuid := '930b7b1b-4069-46ef-b9d6-dbe657c38aa0';
  v_cal6 uuid := '7fc8a3a9-a347-499b-8475-150060605bd6';
  v_cal8 uuid := 'a8a7bdd0-5385-48fe-9fd6-89056bf42492';
  v_calkn uuid := '445fd28d-1f1a-4612-950b-3d5bc7b541ac';
  -- standing test-role profiles, the non-"TEST "-prefixed pair where one
  -- exists (menejer/qorovul/ombor) -- these are the only real accounts in
  -- the system (CLAUDE.md "Testing workflow"); "TEST Laborator" is used for
  -- lab actor since no second laborator profile exists.
  v_menejer uuid := '3af19338-832f-43f0-b155-9fe9fa39d325';
  v_qorovul uuid := '18e63e91-c070-48b7-8682-a30a346125d8';
  v_ombor uuid := '221c936a-da1c-4c94-9295-01ff6d745889';
  v_laborator uuid := '29842f0a-3941-4569-bc37-128c96e43bcc';

  -- per-story working variables
  v_order_id uuid;
  v_serial text;
  v_serial_b text;
  v_gate_id uuid;
  v_cycle1 uuid;
  v_cycle2 uuid;
  v_request_id uuid;
begin
  -- === Demo clients (owners) -- brand new, exist only for this seed ===
  insert into owners (name, active) values ('Boysun Quritilgan Mevalar', true) returning id into v_owner_boysun;
  insert into owners (name, active) values ('Farg''ona Eksport Guruhi', true) returning id into v_owner_fargona;
  insert into owners (name, active) values ('Samarqand Meva Kompaniyasi', true) returning id into v_owner_samarqand;
  insert into owners (name, active) values ('Toshkent Agro Savdo', true) returning id into v_owner_toshkent;

  -- ============================================================
  -- STORY 1 -- Boysun / Subxon / single-line / sulfur target / fully dispatched
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-05-04', '01A123BB', 'Aziz Karimov', v_owner_boysun, 5000, 'qabul_qilindi', v_menejer, '2026-05-04 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_subxon, 5000, 10, 50)
    returning serial into v_serial;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 6700, 1500, v_qorovul, '2026-05-04 07:30:00+00', v_qorovul, '2026-05-04 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by)
    values (v_serial, '2026-05-04 09:30:00+00', 5000, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-05-05', 11, 45, v_laborator, 'complete', '2026-05-05 10:00:00+00');
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by)
    values (v_serial, 1, '2026-05-05', 5200, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct)
    values (v_serial, 1, 'final', 1.9) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-1', v_serial, 1, v_type_subxon, v_cal6, 1800, '2026-05-08', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-06-2', v_serial, 1, v_type_subxon, v_cal6, 1800, '2026-05-08', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-04-1', v_serial, 1, v_type_subxon, v_cal4, 900, '2026-05-08', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-KN1', v_serial, 1, v_type_subxon, v_calkn, 600, '2026-05-08', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle1, 'PLT-' || v_serial || '-06-1', '2026-05-09', 8, 42, v_laborator, 'complete', 'o_tdi', '2026-05-09 11:00:00+00');
  insert into chiqim_requests (request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by)
    values ('2026-05-10', '01A987ZZ', 'Bekzod Yusupov', v_owner_boysun, 'olib_ketildi', v_menejer, '2026-05-10 06:00:00+00', '2026-05-10 08:00:00+00', v_ombor)
    returning id into v_request_id;
  insert into dispatch_manifest (request_id, barcode2, loaded_at) values
    (v_request_id, 'PLT-' || v_serial || '-06-1', '2026-05-10 07:30:00+00'),
    (v_request_id, 'PLT-' || v_serial || '-06-2', '2026-05-10 07:35:00+00'),
    (v_request_id, 'PLT-' || v_serial || '-04-1', '2026-05-10 07:40:00+00'),
    (v_request_id, 'PLT-' || v_serial || '-KN1', '2026-05-10 07:45:00+00');
  insert into gate_weighings (dir, request_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('chiqim', v_request_id, 1400, 6500, v_qorovul, '2026-05-10 08:30:00+00', v_qorovul, '2026-05-10 09:15:00+00');

  -- ============================================================
  -- STORY 2 -- Farg'ona / Isfara / single-line / natural / partially dispatched
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-05-18', '10B234CC', 'Davron Ismoilov', v_owner_fargona, 3000, 'qabul_qilindi', v_menejer, '2026-05-18 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_isfara, 3000, 12, null)
    returning serial into v_serial;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 4200, 1100, v_qorovul, '2026-05-18 07:30:00+00', v_qorovul, '2026-05-18 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by)
    values (v_serial, '2026-05-18 09:30:00+00', 3000, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-05-19', 14, null, v_laborator, 'complete', '2026-05-19 10:00:00+00');
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by)
    values (v_serial, 1, '2026-05-19', 3100, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct)
    values (v_serial, 1, 'final', 6.5) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-1', v_serial, 1, v_type_isfara, v_cal6, 1000, '2026-05-22', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-06-2', v_serial, 1, v_type_isfara, v_cal6, 1000, '2026-05-22', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-08-1', v_serial, 1, v_type_isfara, v_cal8, 900, '2026-05-22', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle1, 'PLT-' || v_serial || '-06-1', '2026-05-23', 9, null, v_laborator, 'complete', 'o_tdi', '2026-05-23 11:00:00+00');
  insert into chiqim_requests (request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by)
    values ('2026-05-25', '10B555XX', 'Sardor Rashidov', v_owner_fargona, 'olib_ketildi', v_menejer, '2026-05-25 06:00:00+00', '2026-05-25 08:00:00+00', v_ombor)
    returning id into v_request_id;
  insert into dispatch_manifest (request_id, barcode2, loaded_at) values
    (v_request_id, 'PLT-' || v_serial || '-06-1', '2026-05-25 07:30:00+00');
  insert into gate_weighings (dir, request_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('chiqim', v_request_id, 1000, 4200, v_qorovul, '2026-05-25 08:30:00+00', v_qorovul, '2026-05-25 09:00:00+00');

  -- ============================================================
  -- STORY 3 -- Samarqand / Subxon + Qand qizil / MULTI-line
  -- lineA dispatched; lineB's pallets awaiting CHIQIM lab (no lab_results yet)
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-06-01', '20C345DD', 'Jasur Toshpulatov', v_owner_samarqand, 3500, 'qabul_qilindi', v_menejer, '2026-06-01 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_subxon, 2000, 10, 45)
    returning serial into v_serial;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_qandqizil, 1500, null, null)
    returning serial into v_serial_b;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 5300, 1700, v_qorovul, '2026-06-01 07:30:00+00', v_qorovul, '2026-06-01 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by)
    values (v_serial, '2026-06-01 09:30:00+00', 2000, v_ombor);
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by)
    values (v_serial_b, '2026-06-01 09:35:00+00', 1500, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-06-02', 10, 48, v_laborator, 'complete', '2026-06-02 10:00:00+00');
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial_b, v_serial_b, '2026-06-02', 13, null, v_laborator, 'complete', '2026-06-02 10:05:00+00');
  -- lineA
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial, 1, '2026-06-02', 2000, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial, 1, 'final', 5.0) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-1', v_serial, 1, v_type_subxon, v_cal6, 1000, '2026-06-05', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-08-1', v_serial, 1, v_type_subxon, v_cal8, 900, '2026-06-05', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle1, 'PLT-' || v_serial || '-06-1', '2026-06-06', 8, 44, v_laborator, 'complete', 'o_tdi', '2026-06-06 11:00:00+00');
  insert into chiqim_requests (request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by)
    values ('2026-06-06', '20C777YY', 'Aziz Karimov', v_owner_samarqand, 'olib_ketildi', v_menejer, '2026-06-06 06:00:00+00', '2026-06-06 08:00:00+00', v_ombor)
    returning id into v_request_id;
  insert into dispatch_manifest (request_id, barcode2, loaded_at) values
    (v_request_id, 'PLT-' || v_serial || '-06-1', '2026-06-06 07:30:00+00'),
    (v_request_id, 'PLT-' || v_serial || '-08-1', '2026-06-06 07:35:00+00');
  insert into gate_weighings (dir, request_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('chiqim', v_request_id, 1000, 2900, v_qorovul, '2026-06-06 08:30:00+00', v_qorovul, '2026-06-06 09:00:00+00');
  -- lineB -- Tugallash done, pallets in_stock, deliberately NO chiqim lab_results yet (awaiting lab)
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial_b, 1, '2026-06-03', 1500, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial_b, 1, 'final', 10.0);
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial_b || '-04-1', v_serial_b, 1, v_type_qandqizil, v_cal4, 700, '2026-06-07', 'in_stock', v_ombor),
    ('PLT-' || v_serial_b || '-06-1', v_serial_b, 1, v_type_qandqizil, v_cal6, 650, '2026-06-07', 'in_stock', v_ombor);

  -- ============================================================
  -- STORY 4 -- Toshkent / Subxon / single-line / RE-WASH, Konditirskiy from BOTH cycles
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-06-10', '30D456EE', 'Bekzod Yusupov', v_owner_toshkent, 4000, 'qabul_qilindi', v_menejer, '2026-06-10 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_subxon, 4000, 10, 40)
    returning serial into v_serial;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 5400, 1300, v_qorovul, '2026-06-10 07:30:00+00', v_qorovul, '2026-06-10 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by)
    values (v_serial, '2026-06-10 09:30:00+00', 4000, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-06-11', 13, 55, v_laborator, 'complete', '2026-06-11 10:00:00+00');
  -- cycle 1: fails lab, gets voided (except Konditirskiy)
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial, 1, '2026-06-11', 4100, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial, 1, 'final', 14.6) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-1', v_serial, 1, v_type_subxon, v_cal6, 1500, '2026-06-13', 'bekor_qilindi', v_ombor),
    ('PLT-' || v_serial || '-06-2', v_serial, 1, v_type_subxon, v_cal6, 1500, '2026-06-13', 'bekor_qilindi', v_ombor),
    ('PLT-' || v_serial || '-KN1', v_serial, 1, v_type_subxon, v_calkn, 500, '2026-06-13', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle1, 'PLT-' || v_serial || '-06-1', '2026-06-14', 13, 55, v_laborator, 'complete', 'qayta_yuvish', '2026-06-14 11:00:00+00');
  -- cycle 2: re-wash of the voided 3000kg, passes
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial, 2, '2026-06-15', 3000, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial, 2, 'final', 5.0) returning id into v_cycle2;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-08-1', v_serial, 2, v_type_subxon, v_cal8, 1300, '2026-06-17', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-06-3', v_serial, 2, v_type_subxon, v_cal6, 1150, '2026-06-17', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-KN2', v_serial, 2, v_type_subxon, v_calkn, 400, '2026-06-17', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle2, 'PLT-' || v_serial || '-08-1', '2026-06-18', 9, 38, v_laborator, 'complete', 'o_tdi', '2026-06-18 11:00:00+00');
  insert into chiqim_requests (request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by)
    values ('2026-06-18', '30D999FF', 'Davron Ismoilov', v_owner_toshkent, 'olib_ketildi', v_menejer, '2026-06-18 06:00:00+00', '2026-06-18 08:00:00+00', v_ombor)
    returning id into v_request_id;
  insert into dispatch_manifest (request_id, barcode2, loaded_at) values
    (v_request_id, 'PLT-' || v_serial || '-08-1', '2026-06-18 07:30:00+00'),
    (v_request_id, 'PLT-' || v_serial || '-06-3', '2026-06-18 07:35:00+00');
  insert into gate_weighings (dir, request_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('chiqim', v_request_id, 1000, 3450, v_qorovul, '2026-06-18 08:30:00+00', v_qorovul, '2026-06-18 09:00:00+00');
  -- both Konditirskiy pallets (cycle 1's and cycle 2's) deliberately left in_stock, never dispatched

  -- ============================================================
  -- STORY 5 -- Boysun / Isfara + Subxon / MULTI-line
  -- lineA dispatched; lineB lab-passed but left in stock
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-06-22', '01A222GG', 'Sardor Rashidov', v_owner_boysun, 2200, 'qabul_qilindi', v_menejer, '2026-06-22 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_isfara, 1000, 11, null)
    returning serial into v_serial;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_subxon, 1200, 10, 45)
    returning serial into v_serial_b;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 3700, 1400, v_qorovul, '2026-06-22 07:30:00+00', v_qorovul, '2026-06-22 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by) values (v_serial, '2026-06-22 09:30:00+00', 1000, v_ombor);
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by) values (v_serial_b, '2026-06-22 09:35:00+00', 1200, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-06-23', 12, null, v_laborator, 'complete', '2026-06-23 10:00:00+00');
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial_b, v_serial_b, '2026-06-23', 9, 47, v_laborator, 'complete', '2026-06-23 10:05:00+00');
  -- lineA
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial, 1, '2026-06-23', 1000, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial, 1, 'final', 5.0) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-1', v_serial, 1, v_type_isfara, v_cal6, 950, '2026-06-25', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle1, 'PLT-' || v_serial || '-06-1', '2026-06-26', 8, null, v_laborator, 'complete', 'o_tdi', '2026-06-26 11:00:00+00');
  insert into chiqim_requests (request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by)
    values ('2026-06-27', '01A333HH', 'Jasur Toshpulatov', v_owner_boysun, 'olib_ketildi', v_menejer, '2026-06-27 06:00:00+00', '2026-06-27 08:00:00+00', v_ombor)
    returning id into v_request_id;
  insert into dispatch_manifest (request_id, barcode2, loaded_at) values
    (v_request_id, 'PLT-' || v_serial || '-06-1', '2026-06-27 07:30:00+00');
  insert into gate_weighings (dir, request_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('chiqim', v_request_id, 1000, 1950, v_qorovul, '2026-06-27 08:30:00+00', v_qorovul, '2026-06-27 09:00:00+00');
  -- lineB -- lab-passed, deliberately NOT dispatched (still in storage)
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial_b, 1, '2026-06-24', 1200, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial_b, 1, 'final', 4.2) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial_b || '-04-1', v_serial_b, 1, v_type_subxon, v_cal4, 550, '2026-06-27', 'in_stock', v_ombor),
    ('PLT-' || v_serial_b || '-06-1', v_serial_b, 1, v_type_subxon, v_cal6, 600, '2026-06-27', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial_b, v_cycle1, 'PLT-' || v_serial_b || '-04-1', '2026-06-28', 10, 43, v_laborator, 'complete', 'o_tdi', '2026-06-28 11:00:00+00');

  -- ============================================================
  -- STORY 6 -- Farg'ona / Qand qizil / single-line / natural / RE-WASH #2
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-07-02', '10B678JJ', 'Aziz Karimov', v_owner_fargona, 2500, 'qabul_qilindi', v_menejer, '2026-07-02 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_qandqizil, 2500, 12, null)
    returning serial into v_serial;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 3700, 1100, v_qorovul, '2026-07-02 07:30:00+00', v_qorovul, '2026-07-02 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by) values (v_serial, '2026-07-02 09:30:00+00', 2500, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-07-03', 14, null, v_laborator, 'complete', '2026-07-03 10:00:00+00');
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial, 1, '2026-07-03', 2600, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial, 1, 'final', 23.1) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-1', v_serial, 1, v_type_qandqizil, v_cal6, 1000, '2026-07-05', 'bekor_qilindi', v_ombor),
    ('PLT-' || v_serial || '-06-2', v_serial, 1, v_type_qandqizil, v_cal6, 1000, '2026-07-05', 'bekor_qilindi', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle1, 'PLT-' || v_serial || '-06-1', '2026-07-06', 14, null, v_laborator, 'complete', 'qayta_yuvish', '2026-07-06 11:00:00+00');
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial, 2, '2026-07-06', 2000, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial, 2, 'final', 5.0) returning id into v_cycle2;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-3', v_serial, 2, v_type_qandqizil, v_cal6, 1000, '2026-07-08', 'in_stock', v_ombor),
    ('PLT-' || v_serial || '-08-1', v_serial, 2, v_type_qandqizil, v_cal8, 900, '2026-07-08', 'in_stock', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle2, 'PLT-' || v_serial || '-06-3', '2026-07-08', 9, null, v_laborator, 'complete', 'o_tdi', '2026-07-08 11:00:00+00');
  insert into chiqim_requests (request_date, plate, driver, owner_id, status, created_by, created_at, ombor_finished_at, ombor_finished_by)
    values ('2026-07-08', '10B111KK', 'Bekzod Yusupov', v_owner_fargona, 'olib_ketildi', v_menejer, '2026-07-08 06:00:00+00', '2026-07-08 08:00:00+00', v_ombor)
    returning id into v_request_id;
  insert into dispatch_manifest (request_id, barcode2, loaded_at) values
    (v_request_id, 'PLT-' || v_serial || '-06-3', '2026-07-08 07:30:00+00'),
    (v_request_id, 'PLT-' || v_serial || '-08-1', '2026-07-08 07:35:00+00');
  insert into gate_weighings (dir, request_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('chiqim', v_request_id, 1000, 2900, v_qorovul, '2026-07-08 08:30:00+00', v_qorovul, '2026-07-08 09:00:00+00');

  -- ============================================================
  -- STORY 7 -- Samarqand / Subxon / single-line / raw still in storage (never sent to Moyka)
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-07-10', '20C789LL', 'Davron Ismoilov', v_owner_samarqand, 3500, 'qabul_qilindi', v_menejer, '2026-07-10 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_subxon, 3500, 10, 35)
    returning serial into v_serial;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 4700, 1100, v_qorovul, '2026-07-10 07:30:00+00', v_qorovul, '2026-07-10 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by) values (v_serial, '2026-07-10 09:30:00+00', 3500, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-07-11', 10, 33, v_laborator, 'complete', '2026-07-11 10:00:00+00');
  -- deliberately no moyka_sends row -- raw remainder sits in storage

  -- ============================================================
  -- STORY 8 -- Toshkent / Isfara / single-line / gate stage 2 NOT done (provisional), KIRIM lab not yet done
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-07-16', '30D890MM', 'Sardor Rashidov', v_owner_toshkent, 1800, 'kutilmoqda', v_menejer, '2026-07-16 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_isfara, 1800, null, null)
    returning serial into v_serial;
  insert into gate_weighings (dir, order_id, gruzheny_kg, stage1_created_by, stage1_completed_at)
    values ('kirim', v_order_id, 2900, v_qorovul, '2026-07-16 07:30:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by) values (v_serial, '2026-07-16 08:00:00+00', 1800, v_ombor);
  -- deliberately no lab_results row -- KIRIM check still awaiting

  -- ============================================================
  -- STORY 9 -- Samarqand / Isfara / single-line / cycle 1 FAILS lab,
  -- flagged qayta_yuvish, NOT yet re-sent -- WIP state: awaiting Ombor
  -- to initiate the re-wash (stories 4/6 show the re-wash ALREADY done;
  -- this one shows the moment right after the fail, before it starts)
  -- ============================================================
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, status, created_by, created_at)
    values ('2026-07-14', '20C901NN', 'Jasur Toshpulatov', v_owner_samarqand, 2800, 'qabul_qilindi', v_menejer, '2026-07-14 07:00:00+00')
    returning order_id into v_order_id;
  insert into kirim_lines (order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg)
    values (v_order_id, v_type_isfara, 2800, 10, 40)
    returning serial into v_serial;
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_created_by, stage1_completed_at, stage2_created_by, completed_at)
    values ('kirim', v_order_id, 3900, 1000, v_qorovul, '2026-07-14 07:30:00+00', v_qorovul, '2026-07-14 09:00:00+00');
  insert into storage_intake (serial, confirmed_at, actual_qty, confirmed_by)
    values (v_serial, '2026-07-14 09:30:00+00', 2800, v_ombor);
  insert into lab_results (scope, parent_serial, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, created_at)
    values ('kirim', v_serial, v_serial, '2026-07-15', 13, 52, v_laborator, 'complete', '2026-07-15 10:00:00+00');
  insert into moyka_sends (serial, wash_cycle, sent_date, qty_kg, created_by) values (v_serial, 1, '2026-07-15', 2900, v_ombor);
  insert into wash_cycles (serial, cycle_no, status, final_loss_pct) values (v_serial, 1, 'final', 15.5) returning id into v_cycle1;
  insert into finished_pallets (barcode2, serial, wash_cycle, type_id, calibre_id, weight_kg, received_date, status, created_by) values
    ('PLT-' || v_serial || '-06-1', v_serial, 1, v_type_isfara, v_cal6, 1300, '2026-07-17', 'bekor_qilindi', v_ombor),
    ('PLT-' || v_serial || '-08-1', v_serial, 1, v_type_isfara, v_cal8, 1150, '2026-07-17', 'bekor_qilindi', v_ombor);
  insert into lab_results (scope, parent_serial, wash_cycle_id, sampled_pallet, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, created_at)
    values ('chiqim', v_serial, v_cycle1, 'PLT-' || v_serial || '-06-1', '2026-07-18', 13, 51, v_laborator, 'complete', 'qayta_yuvish', '2026-07-18 11:00:00+00');
  -- deliberately NO cycle 2 -- still awaiting Ombor to re-send, no chiqim_requests/dispatch either

  raise notice 'Demo data seeded: owners=% % % %', v_owner_boysun, v_owner_fargona, v_owner_samarqand, v_owner_toshkent;
end $$;
