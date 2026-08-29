-- Partiya raqami filter, part 2: report_totals(text[],...) (the plural
-- overload the app actually calls) still called report_filtered_rows
-- without p_partiya_no, so the totals strip would silently ignore the new
-- filter and always sum the FULL unfiltered set -- a real correctness bug
-- once the filter ships, not just a missing nice-to-have. Adds the same
-- p_partiya_no integer default null param, DROP + CREATE (signature
-- change, same reasoning as 0096).
drop function if exists public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text);

create function public.report_totals(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer default null)
 returns TABLE(total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric, total_kg_from_moyka numeric, state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric)
 language sql
 stable
as $function$
  with filtered as materialized (
    select * from report_filtered_rows(p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id, p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no)
  ),
  movement as (
    select
      count(*) as total_count,
      coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn') then qty_kg else 0 end), 0) as total_kg_out,
      coalesce(sum(case when kind = 'kirim' then box_mass_kg else 0 end), 0) as total_kg_tara_in,
      coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0) as total_kg_tara_out,
      coalesce(sum(declared_qty), 0) as total_declared,
      coalesce(sum(case when kind = 'kirim' then least(qty_kg, declared_qty) else 0 end), 0) as total_hisobiy,
      coalesce(sum(case when kind = 'moyka_send' then qty_kg else 0 end), 0) as total_kg_to_moyka,
      coalesce(sum(case when kind = 'moyka_output' then qty_kg else 0 end), 0) as total_kg_from_moyka
    from filtered
  ),
  distinct_serials as (select distinct serial from filtered where serial is not null),
  state as (
    select
      count(*) as state_serial_count,
      coalesce(sum(s.qabul_qilingan), 0) as state_qabul_qilingan,
      coalesce(sum(s.omborda_qoldi), 0) as state_omborda_qoldi,
      coalesce(sum(s.moykaga_yuborilgan), 0) as state_moykaga_yuborilgan,
      coalesce(sum(s.moykada), 0) as state_moykada,
      coalesce(sum(s.moykadan_chiqgan), 0) as state_moykadan_chiqgan,
      coalesce(sum(s.xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(s.olib_ketilgan), 0) as state_olib_ketilgan
    from distinct_serials ds cross join lateral kirim_line_state(ds.serial) s
  )
  select movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in, movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy, movement.total_kg_to_moyka, movement.total_kg_from_moyka, state.state_serial_count, state.state_qabul_qilingan, state.state_omborda_qoldi, state.state_moykaga_yuborilgan, state.state_moykada, state.state_moykadan_chiqgan, state.state_xom_jonatilgan, state.state_olib_ketilgan
  from movement, state;
$function$;
