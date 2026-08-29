-- Hisobot: output-by-kalibr columns K1-K8 + KN (2026-08-29, Prompt 6). See
-- docs/DECISIONS.md "Hisobot: output-by-kalibr columns" for the full
-- sourcing map and the formula-conflict this migration resolves.
--
-- Live calibres checked before writing this (single category, "O'rik"):
-- codes '01'-'08' (Kalibr 1-8) + 'KN' (Konditirskiy) + 'RKN' (Rezka KN,
-- numberless). finished_pallets grouped by calibre code today: only 01, 02,
-- 04, 06, 08, KN have ever been produced -- RKN has zero finished_pallets
-- rows (Rezka's own KN variant has never gone through the finished-goods
-- pipeline this migration reads). K1-K8 + KN therefore covers 100% of live
-- finished_pallets rows; RKN would silently fall outside these 9 columns if
-- it ever DID appear here -- noted, not fixed (matches its current
-- zero-row reality, not a phantom-row risk the way origin filtering is).
--
-- Per-row value = "total ever produced under that kalibr for that serial"
-- (task's own Requirements text: "available + already-dispatched... the
-- full production picture, not just what's currently sitting in stock").
-- The task's own "before coding" section separately described this as
-- sum(finished_pallets.qty) - sum(chiqim_pallet_consumption.qty_kg), which
-- is actually a DIFFERENT number (the live available balance, i.e.
-- finished_pallet_availability) -- flagging this conflict per CLAUDE.md
-- "stop, report, do not invent a design." Resolved by arithmetic, not
-- guesswork: available + already-dispatched = (produced - consumed) +
-- consumed = produced = sum(finished_pallets.weight_kg), so the
-- Requirements text's own formula collapses to the plain gross-production
-- sum once "already-dispatched" is read as ALL consumption ever (gate-
-- completed or not), not just gate-completed departures. Going with gross
-- production, exactly kirim_line_state's own `moyka_out` figure (migration
-- 0074/0088), split by calibre instead of totalled -- same base_pallets
-- exclusion set (voided/storage-loss pallets and re-wash-consumed pallets
-- excluded), so this is a pure breakdown of a number Hisobot already
-- totals as state_moykadan_chiqgan, not a new balance calculation.

-- ============================================================
-- 1. kirim_line_calibre_output(p_serial) -- per-serial gross production by
--    calibre code. Sibling to kirim_line_state (0074/0088), same
--    base_pallets exclusion set, split by calibre instead of totalled.
-- ============================================================
create or replace function public.kirim_line_calibre_output(p_serial text)
returns table (
  k1 numeric, k2 numeric, k3 numeric, k4 numeric, k5 numeric,
  k6 numeric, k7 numeric, k8 numeric, kn numeric
)
language sql
stable
as $function$
  with base_pallets as (
    select fp.weight_kg, c.code
    from finished_pallets fp
    join calibres c on c.id = fp.calibre_id
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  )
  select
    coalesce(sum(weight_kg) filter (where code = '01'), 0) as k1,
    coalesce(sum(weight_kg) filter (where code = '02'), 0) as k2,
    coalesce(sum(weight_kg) filter (where code = '03'), 0) as k3,
    coalesce(sum(weight_kg) filter (where code = '04'), 0) as k4,
    coalesce(sum(weight_kg) filter (where code = '05'), 0) as k5,
    coalesce(sum(weight_kg) filter (where code = '06'), 0) as k6,
    coalesce(sum(weight_kg) filter (where code = '07'), 0) as k7,
    coalesce(sum(weight_kg) filter (where code = '08'), 0) as k8,
    coalesce(sum(weight_kg) filter (where code = 'KN'), 0) as kn
  from base_pallets;
$function$;

-- ============================================================
-- 2. report_query_page(text[], ...) -- FUNCTION using RETURNS TABLE, so a
--    new output column requires DROP + CREATE (see migration 0094's own
--    header for why CREATE OR REPLACE can't do this). Adds a second LEFT
--    JOIN LATERAL alongside the existing kirim_line_state one; the 9 new
--    columns land at the very end, after state_olib_ketilgan.
-- ============================================================
drop function if exists public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer);

create function public.report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_limit integer default 100, p_offset integer default 0, p_partiya_no integer default null
)
returns table (
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid,
  type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text,
  qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric,
  truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer,
  pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric,
  moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric,
  partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric,
  state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric,
  state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric
)
language sql
stable
as $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, s.moykaga_yuborilgan, s.moykada,
         s.moykadan_chiqgan, s.xom_jonatilgan, s.olib_ketilgan,
         co.k1, co.k2, co.k3, co.k4, co.k5, co.k6, co.k7, co.k8, co.kn
  from (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral kirim_line_calibre_output(f.serial) co on f.serial is not null;
$function$;

-- ============================================================
-- 3. report_totals(text[], ...) -- same DROP + CREATE requirement. New
--    `calibre_output` CTE mirrors the existing `state` CTE exactly: one
--    lateral call per DISTINCT serial in the filtered set (never per row --
--    "the trap" report_totals' own header comment already names), summed.
-- ============================================================
drop function if exists public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer);

create function public.report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_partiya_no integer default null
)
returns table(
  total_count bigint,
  total_kg_in numeric,
  total_kg_out numeric,
  total_kg_tara_in numeric,
  total_kg_tara_out numeric,
  total_declared numeric,
  total_hisobiy numeric,
  total_kg_to_moyka numeric,
  total_kg_from_moyka numeric,
  state_serial_count bigint,
  state_qabul_qilingan numeric,
  state_omborda_qoldi numeric,
  state_moykaga_yuborilgan numeric,
  state_moykada numeric,
  state_moykadan_chiqgan numeric,
  state_xom_jonatilgan numeric,
  state_olib_ketilgan numeric,
  state_k1 numeric,
  state_k2 numeric,
  state_k3 numeric,
  state_k4 numeric,
  state_k5 numeric,
  state_k6 numeric,
  state_k7 numeric,
  state_k8 numeric,
  state_kn numeric
)
language sql
stable
as $function$
  with filtered as materialized (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
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
  distinct_serials as (
    select distinct serial from filtered where serial is not null
  ),
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
    from distinct_serials ds
    cross join lateral kirim_line_state(ds.serial) s
  ),
  calibre_output as (
    select
      coalesce(sum(co.k1), 0) as state_k1,
      coalesce(sum(co.k2), 0) as state_k2,
      coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4,
      coalesce(sum(co.k5), 0) as state_k5,
      coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7,
      coalesce(sum(co.k8), 0) as state_k8,
      coalesce(sum(co.kn), 0) as state_kn
    from distinct_serials ds
    cross join lateral kirim_line_calibre_output(ds.serial) co
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    state.state_serial_count, state.state_qabul_qilingan, state.state_omborda_qoldi,
    state.state_moykaga_yuborilgan, state.state_moykada, state.state_moykadan_chiqgan,
    state.state_xom_jonatilgan, state.state_olib_ketilgan,
    calibre_output.state_k1, calibre_output.state_k2, calibre_output.state_k3, calibre_output.state_k4,
    calibre_output.state_k5, calibre_output.state_k6, calibre_output.state_k7, calibre_output.state_k8,
    calibre_output.state_kn
  from movement, state, calibre_output;
$function$;

grant execute on function public.kirim_line_calibre_output(text) to authenticated;
grant execute on function public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer) to authenticated;
