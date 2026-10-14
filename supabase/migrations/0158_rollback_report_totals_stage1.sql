-- URGENT ROLLBACK (2026-10-12): migration 0157's report_totals rewrite
-- broke Hisobot and client KIRIM (report not loading in production).
-- Reverts report_totals (text[] overload) to its exact pre-0157 body,
-- captured live via pg_get_functiondef immediately before 0157 was applied
-- (matches the last migration that actually defined this function,
-- 0146_rezka_reporting.sql -- 0153/0154 only mention report_totals in
-- comments, confirmed via grep).
--
-- serial_state view is left in place, per instruction -- nothing live
-- references it once this rollback is applied.
--
-- Diagnosing why Stage 1 broke production is explicitly out of scope here.
-- See a follow-up decision log entry / task for that investigation.

CREATE OR REPLACE FUNCTION public.report_totals(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer DEFAULT NULL::integer)
 RETURNS TABLE(total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric, total_kg_from_moyka numeric, state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric, total_kg_to_rezka numeric, total_kg_from_rezka numeric, state_rezkaga_yuborilgan numeric, state_rezkada numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with filtered as materialized (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
  ),
  movement as (
    select
      count(*) as total_count,
      coalesce(sum(case when kind = 'kirim' or (kind = 'rezka_kirim' and row_key like 'rezka-kirim-%') then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn', 'chiqim_dispatch', 'rezka_chiqim') then qty_kg else 0 end), 0) as total_kg_out,
      coalesce(sum(case when kind = 'kirim' or (kind = 'rezka_kirim' and row_key like 'rezka-kirim-%') then box_mass_kg else 0 end), 0) as total_kg_tara_in,
      coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0) as total_kg_tara_out,
      coalesce(sum(declared_qty), 0) as total_declared,
      coalesce(sum(case when kind = 'kirim' or (kind = 'rezka_kirim' and row_key like 'rezka-kirim-%') then least(qty_kg, declared_qty) else 0 end), 0) as total_hisobiy,
      coalesce(sum(case when kind = 'moyka_send' then qty_kg else 0 end), 0) as total_kg_to_moyka,
      coalesce(sum(case when kind = 'moyka_output' then qty_kg else 0 end), 0) as total_kg_from_moyka,
      coalesce(sum(case when kind = 'rezka_send' then qty_kg else 0 end), 0) as total_kg_to_rezka,
      coalesce(sum(case when kind = 'rezka_output' then qty_kg else 0 end), 0) as total_kg_from_rezka
    from filtered
  ),
  distinct_serials as (
    select distinct serial from filtered where serial is not null
  ),
  bundled as (
    select b.*
    from kirim_line_report_bundle_set((select array_agg(serial) from distinct_serials), p_from, p_to) b
  ),
  rezka_state as (
    select coalesce(sum(rs.rezkaga_yuborilgan), 0) as rezkaga_yuborilgan, coalesce(sum(rs.rezkada), 0) as rezkada
    from rezka_serial_state_set((select array_agg(serial) from distinct_serials)) rs
  ),
  agg as (
    select
      count(*) as state_serial_count,
      coalesce(sum(state_qabul_qilingan), 0) as state_qabul_qilingan,
      coalesce(sum(state_omborda_qoldi), 0) as state_omborda_qoldi,
      coalesce(sum(state_xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(state_olib_ketilgan), 0) as state_olib_ketilgan,
      coalesce(sum(state_moykaga_yuborilgan), 0) as state_moykaga_yuborilgan_lifetime,
      coalesce(sum(state_moykadan_chiqgan), 0) as state_moykadan_chiqgan_lifetime,
      coalesce(sum(moyka_asof), 0) as state_moykada,
      coalesce(sum(moyka_range_to_moyka_kg), 0) as state_moykaga_yuborilgan,
      coalesce(sum(moyka_range_from_moyka_kg), 0) as state_moykadan_chiqgan,
      coalesce(sum(calibre_output_k1), 0) as state_k1,
      coalesce(sum(calibre_output_k2), 0) as state_k2,
      coalesce(sum(calibre_output_k3), 0) as state_k3,
      coalesce(sum(calibre_output_k4), 0) as state_k4,
      coalesce(sum(calibre_output_k5), 0) as state_k5,
      coalesce(sum(calibre_output_k6), 0) as state_k6,
      coalesce(sum(calibre_output_k7), 0) as state_k7,
      coalesce(sum(calibre_output_k8), 0) as state_k8,
      coalesce(sum(calibre_output_kn), 0) as state_kn,
      coalesce(sum(loss_range), 0) as state_yoqotish
    from bundled
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    agg.state_serial_count, agg.state_qabul_qilingan, agg.state_omborda_qoldi,
    agg.state_moykaga_yuborilgan, agg.state_moykada, agg.state_moykadan_chiqgan,
    agg.state_xom_jonatilgan, agg.state_olib_ketilgan,
    agg.state_k1, agg.state_k2, agg.state_k3, agg.state_k4,
    agg.state_k5, agg.state_k6, agg.state_k7, agg.state_k8,
    agg.state_kn,
    agg.state_yoqotish,
    agg.state_moykaga_yuborilgan_lifetime, agg.state_moykadan_chiqgan_lifetime,
    movement.total_kg_to_rezka, movement.total_kg_from_rezka,
    rezka_state.rezkaga_yuborilgan, rezka_state.rezkada
  from movement, agg, rezka_state;
$function$;
