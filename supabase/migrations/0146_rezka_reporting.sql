-- Rezka build, Prompt 4 of 4 (2026-09-28): the reporting layer -- Hisobot
-- Rezka rows, dashboard/qoldiq Rezkada figure, passport Rezka block.
-- Decision: docs/decisions/0226-*. No new balance calculation: every figure
-- below re-reads an existing source (report_kirim_rows' effective_qty
-- ladder, report_moyka_output_rows' pallet status/exclusions,
-- report_chiqim_rows_v2's consumption rows, rezka_sends, rezka_kn_draws,
-- rezka_cycles with close_rezka_cycle_serial's own window rule).
--
-- R1 choice: a PARALLEL view, report_rezka_rows, shaped exactly like
-- report_rows_v2 (same columns, same order) and fed by the same sources, NOT
-- new columns on report_rows_v2. Every engine function returns
-- SETOF report_rows_v2, so widening that row type would force a rewrite of
-- all of them; a parallel view with the same shape slots into
-- report_filtered_rows_v2 as one more UNION branch. Tashqi kirim rows are
-- report_kirim_rows rows (the effective_qty ladder is reused, not copied).
-- Manba / parent barcodes / Rezka serial state travel through the existing
-- per-page enrichment (report_page_enrich), keyed by serial, like the Moyka
-- serial state already does.
--
-- Group rule: p_directions null/empty keeps meaning "every Oddiy kind" --
-- so every existing caller is unchanged -- and Rezka kinds appear ONLY when
-- asked for by name. Rezka lines are removed from every Oddiy kind:
-- 'kirim' (Tashqi Rezka lines), 'moyka_output' (Standard pallets) and the
-- 'chiqim' dispatch component (Standard consumption). Xom dispatch of Tashqi
-- Rezka raw stays Oddiy 'chiqim_raw' (decision: Rezka chiqim = consumption
-- on Rezka PALLETS).
--
-- TEST exclusion: every report source already drops TEST- plates. A Rezka
-- serial is test data when its own order plate is TEST-, or -- for an Ichki
-- mint, whose own plate is always 'QAYTA-ISHLASH' -- when any parent
-- Konditerka pallet came from a TEST- order.

-- ------------------------------------------------------------------
-- 1. Helpers
-- ------------------------------------------------------------------
create or replace function public.rezka_serial_is_test(p_serial text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
      select 1 from kirim_lines kl join kirim_orders ko on ko.order_id = kl.order_id
      where kl.serial = p_serial and ko.plate like 'TEST-%'
    )
    or exists (
      select 1
      from rezka_kn_draws d
      join finished_pallets fp on fp.barcode2 = d.barcode2
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
      where d.minted_serial = p_serial and ko.plate like 'TEST-%'
    )
$$;

-- Per-serial Rezka state, lifetime. rezkada uses close_rezka_cycle_serial's
-- own rule (0141): per OPEN cycle, sends since opened_at minus non-void
-- pallets since opened_at, SIGNED (a gain is negative, never floored).
-- Rezkadan chiqgan is NOT here: kirim_line_report_bundle_set's
-- state_moykadan_chiqgan already sums a serial's own non-void, non-lost,
-- non-mint-source pallets -- for a Rezka serial that IS its Rezka output.
create or replace function public.rezka_serial_state_set(p_serials text[])
returns table(serial text, manba text, parents jsonb, rezkaga_yuborilgan numeric, rezkada numeric)
language sql
stable
set search_path to 'public'
as $$
  select
    s.serial,
    case when ko.origin = 'internal_reprocess' then 'ichki' else 'tashqi' end,
    (
      select coalesce(jsonb_agg(jsonb_build_object('barcode2', d.barcode2, 'qtyKg', d.qty_kg, 'sourceSerial', fp.serial)
               order by d.drawn_at, d.barcode2), '[]'::jsonb)
      from rezka_kn_draws d join finished_pallets fp on fp.barcode2 = d.barcode2
      where d.minted_serial = s.serial
    ),
    coalesce((select sum(rs.qty_kg) from rezka_sends rs where rs.serial = s.serial), 0),
    coalesce((
      select sum(
        coalesce((select sum(rs.qty_kg) from rezka_sends rs where rs.serial = rc.serial and rs.sent_date >= rc.opened_at::date), 0)
        - coalesce((select sum(fp.weight_kg) from finished_pallets fp
                    where fp.serial = rc.serial and fp.status <> 'bekor_qilindi' and fp.received_date >= rc.opened_at::date), 0)
      )
      from rezka_cycles rc
      where rc.serial = s.serial and rc.closed_at is null
    ), 0)
  from (select distinct u as serial from unnest(p_serials) u) s
  join kirim_lines kl on kl.serial = s.serial and kl.process = 'rezka'
  join kirim_orders ko on ko.order_id = kl.order_id
$$;

-- ------------------------------------------------------------------
-- 2. report_rezka_rows -- same shape as report_rows_v2
-- ------------------------------------------------------------------
create or replace view public.report_rezka_rows with (security_invoker = true) as
with rz as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, ko.owner_id, ko.origin, ko.plate, ko.driver
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  where kl.process = 'rezka' and not rezka_serial_is_test(kl.serial)
)
-- Rezka kirim, Tashqi: the report_kirim_rows row itself (arrival date,
-- effective_qty ladder, tara, variance) re-kinded. row_key prefix
-- 'rezka-kirim-' marks Tashqi for the totals rule (report_totals).
select 'rezka_kirim'::text as kind, 'rezka-kirim-' || r.row_key as row_key, r.serial, r.barcode2, r.order_id,
  r.request_id, r.owner_id, r.type_id, r.calibre_id, r.plate, r.driver, r.date_basis, r.date_basis_source, r.qty_kg,
  r.provisional, r.declared_qty, r.truck_variance_diff_kg, r.truck_variance_diff_pct, r.provisional_variance_flag,
  r.wash_cycle, r.pallet_status, r.lab_verdict, r.target_moisture_pct, r.target_so2_mg_kg, r.moisture_pct,
  r.so2_mg_kg, r.void_successor_barcodes, r.box_mass_kg, r.partiya_no
from report_kirim_rows r
join rz on rz.serial = r.serial
where r.origin = 'delivery'
union all
-- Rezka kirim, Ichki: one row per mint, dated by the draw, qty = kg drawn.
select 'rezka_kirim', 'rezka-mint-' || rz.serial, rz.serial, null, rz.order_id, null, rz.owner_id, rz.type_id, null,
  rz.plate, rz.driver, (min(d.drawn_at) at time zone 'utc')::date, 'drawn_at', sum(d.qty_kg), false, null, null, null,
  false, null, null, null, null, null, null, null, null, null, rz.partiya_no
from rz
join rezka_kn_draws d on d.minted_serial = rz.serial
where rz.origin = 'internal_reprocess'
group by rz.serial, rz.order_id, rz.owner_id, rz.type_id, rz.plate, rz.driver, rz.partiya_no
union all
-- Rezkaga yuborildi: one row per rezka_sends row (an Ichki mint's own send
-- appears here too, by design).
select 'rezka_send', 'rezka-send-' || rs.id::text, rz.serial, null, rz.order_id, null, rz.owner_id, rz.type_id, null,
  null, null, rs.sent_date, 'sent_date', rs.qty_kg, false, null, null, null, false, null, null, null, null, null,
  null, null, null, null, rz.partiya_no
from rezka_sends rs
join rz on rz.serial = rs.serial
union all
-- Rezkadan chiqdi: per pallet, straight from report_moyka_output_rows (the
-- one finished_pallets reader with the pallet-status CASE); the per-serial
-- grouping and "same exclusions as Moykadan chiqgan" happen in the filter.
select 'rezka_output', 'rezka-output-' || m.barcode2, m.serial, m.barcode2, m.order_id, m.request_id, m.owner_id,
  m.type_id, m.calibre_id, m.plate, m.driver, m.date_basis, m.date_basis_source, m.qty_kg, m.provisional,
  m.declared_qty, m.truck_variance_diff_kg, m.truck_variance_diff_pct, m.provisional_variance_flag, m.wash_cycle,
  m.pallet_status, m.lab_verdict, m.target_moisture_pct, m.target_so2_mg_kg, m.moisture_pct, m.so2_mg_kg,
  m.void_successor_barcodes, m.box_mass_kg, m.partiya_no
from report_moyka_output_rows m
join rz on rz.serial = m.serial
union all
-- Rezka chiqim: consumption on Rezka pallets, departed requests only,
-- dated EXACTLY like the Oddiy dispatch rows -- report_chiqim_rows_v2's own
-- date_basis, which is the departure date (chiqim_departed_at, utc), not
-- request_date (that was the retired v1 report_chiqim_rows). One date basis
-- for dispatch across both groups (product-owner decision, 2026-09-28).
select 'rezka_chiqim', 'rezka-chiqim-' || c.row_key, c.serial, c.barcode2, c.order_id, c.request_id, c.owner_id,
  c.type_id, c.calibre_id, c.plate, c.driver, c.date_basis, 'departed_at', c.qty_kg, c.provisional,
  c.declared_qty, c.truck_variance_diff_kg, c.truck_variance_diff_pct, c.provisional_variance_flag, c.wash_cycle,
  c.pallet_status, c.lab_verdict, c.target_moisture_pct, c.target_so2_mg_kg, c.moisture_pct, c.so2_mg_kg,
  c.void_successor_barcodes, c.box_mass_kg, c.partiya_no
from report_chiqim_rows_v2 c
join rz on rz.serial = c.serial
where chiqim_departed_at(c.request_id) is not null;

-- ------------------------------------------------------------------
-- 3. Oddiy sources drop Rezka lines (live bodies, one clause each)
-- ------------------------------------------------------------------
create or replace function public.report_moyka_output_rows_by_serial(p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_serial text, p_partiya_no integer, p_status text, p_lab_verdict text)
 returns setof report_rows_v2
 language sql
 stable
as $function$
  select
    'moyka_output'::text as kind,
    'moyka-output-serial-' || r.serial || '-' || p_from::text || '-' || p_to::text as row_key,
    r.serial,
    null::text as barcode2,
    (array_agg(r.order_id))[1] as order_id,
    null::uuid as request_id,
    (array_agg(r.owner_id))[1] as owner_id,
    (array_agg(r.type_id))[1] as type_id,
    null::uuid as calibre_id,
    null::text as plate,
    null::text as driver,
    max(r.date_basis) as date_basis,
    'received_date'::text as date_basis_source,
    coalesce(sum(r.qty_kg) filter (
      where r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
        and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
    ), 0) as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
    null::text as pallet_status,
    null::text as lab_verdict,
    null::numeric as target_moisture_pct,
    null::numeric as target_so2_mg_kg,
    null::numeric as moisture_pct,
    null::numeric as so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    min(r.partiya_no) as partiya_no
  from report_moyka_output_rows r
  where r.date_basis between p_from and p_to
    and (p_owner_id is null or r.owner_id = p_owner_id)
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%')
    and (p_partiya_no is null or r.partiya_no = p_partiya_no)
    and (p_status is null or p_status = '' or r.pallet_status = p_status)
    and (p_lab_verdict is null or p_lab_verdict = ''
         or (p_lab_verdict = 'tekshirilmagan' and r.lab_verdict is null)
         or r.lab_verdict = p_lab_verdict)
    and not exists (select 1 from kirim_lines kx where kx.serial = r.serial and kx.process = 'rezka')
  group by r.serial
$function$;

create or replace function public.report_dispatch_rows_v2(p_kinds text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer)
 returns setof report_rows_v2
 language sql
 stable
as $function$
  with components as (
    select 'chiqim'::text as comp_kind, request_id, owner_id, type_id, calibre_id, serial, barcode2, wash_cycle, lab_verdict, pallet_status, partiya_no, qty_kg
    from report_chiqim_rows_v2
    where date_basis between p_from and p_to
      and not exists (select 1 from kirim_lines kx where kx.serial = report_chiqim_rows_v2.serial and kx.process = 'rezka')
    union all
    select 'chiqim_raw', request_id, owner_id, type_id, null::uuid, serial, null::text, null::integer, null::text, 'jonatilgan'::text, partiya_no, qty_kg
    from report_raw_dispatch_rows_v2
    where date_basis between p_from and p_to
    union all
    select 'chiqim_old_kn', request_id, owner_id, type_id, null::uuid, null::text, null::text, null::integer, null::text, 'jonatilgan'::text, partiya_no, qty_kg
    from report_old_kn_rows_v2
    where date_basis between p_from and p_to
  ),
  matched as (
    select *,
      chiqim_component_is_match(
        comp_kind, calibre_id, barcode2, wash_cycle, lab_verdict, pallet_status, serial, type_id, partiya_no,
        p_kinds, p_calibre_id, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_serial, p_type_id, p_partiya_no
      ) as is_match
    from components
  )
  select
    'chiqim_dispatch'::text as kind,
    'dispatch-' || cr.id::text as row_key,
    null::text as serial,
    null::text as barcode2,
    null::uuid as order_id,
    cr.id as request_id,
    cr.owner_id,
    null::uuid as type_id,
    null::uuid as calibre_id,
    coalesce(cr.plate, '') as plate,
    coalesce(cr.driver, '') as driver,
    (chiqim_departed_at(cr.id) at time zone 'utc')::date as date_basis,
    null::text as date_basis_source,
    coalesce(sum(m.qty_kg) filter (where m.is_match), 0) as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
    null::text as pallet_status,
    null::text as lab_verdict,
    null::numeric as target_moisture_pct,
    null::numeric as target_so2_mg_kg,
    null::numeric as moisture_pct,
    null::numeric as so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    null::integer as partiya_no
  from chiqim_requests cr
  join matched m on m.request_id = cr.id
  where chiqim_departed_at(cr.id) is not null
    and (chiqim_departed_at(cr.id) at time zone 'utc')::date between p_from and p_to
    and (p_owner_id is null or cr.owner_id = p_owner_id)
    and (p_plate is null or p_plate = '' or cr.plate ilike '%' || p_plate || '%')
    and (p_driver is null or p_driver = '' or cr.driver ilike '%' || p_driver || '%')
    and coalesce(cr.plate, '') not like 'TEST-%'
  group by cr.id, cr.owner_id, cr.plate, cr.driver
  having bool_or(m.is_match);
$function$;

-- ------------------------------------------------------------------
-- 4. report_filtered_rows_v2 -- Oddiy branches + Rezka branches
-- ------------------------------------------------------------------
create or replace function public.report_filtered_rows_v2(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer default null::integer)
 returns setof report_rows_v2
 language sql
 stable
as $function$
  select r.*
  from (select 1 where p_directions is null or array_length(p_directions, 1) is null or p_directions && array['kirim', 'moyka_send']) gate
  cross join lateral (
    select r.*
    from report_rows_v2 r
    where r.kind in ('kirim', 'moyka_send')
      and (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
      and (
        (r.kind = 'kirim' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
        or (r.kind = 'moyka_send' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
      )
      and (r.date_basis is not null and r.date_basis between p_from and p_to)
      and (p_owner_id is null or r.owner_id = p_owner_id)
      and (p_type_id is null or r.type_id = p_type_id)
      and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%')
      and (p_plate is null or p_plate = '' or r.plate ilike '%' || p_plate || '%')
      and (p_driver is null or p_driver = '' or r.driver ilike '%' || p_driver || '%')
      and (p_partiya_no is null or r.partiya_no = p_partiya_no)
      -- Rezka Prompt 4: Tashqi Rezka lines are Rezka kirim, never Oddiy.
      and not exists (select 1 from kirim_lines kx where kx.serial = r.serial and kx.process = 'rezka')
  ) r

  union all

  select *
  from report_dispatch_rows_v2(
    case
      when p_directions is null or array_length(p_directions, 1) is null then null
      else array(select unnest(p_directions) intersect select unnest(array['chiqim','chiqim_raw','chiqim_old_kn']))
    end,
    p_from, p_to, p_owner_id, p_type_id, p_calibre_id, p_serial, p_barcode2, p_plate, p_driver,
    p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
  )
  where p_directions is null or array_length(p_directions, 1) is null
     or p_directions && array['chiqim', 'chiqim_raw', 'chiqim_old_kn']

  union all

  select r2.*
  from (select 1 where p_directions is null or array_length(p_directions, 1) is null or 'moyka_output' = any(p_directions)) gate2
  cross join lateral (
    select *
    from report_moyka_output_rows_by_serial(p_from, p_to, p_owner_id, p_type_id, p_serial, p_partiya_no, p_status, p_lab_verdict)
    where p_calibre_id is null
      and (p_barcode2 is null or p_barcode2 = '')
      and (p_wash_cycle is null or p_wash_cycle = '')
  ) r2

  union all

  -- REZKA: only when a Rezka kind is asked for by name. No lab and no wash
  -- cycle on this path, so either filter set excludes every Rezka row.
  -- Rezka kirim / yuborildi: movement rows, like kirim / moyka_send.
  select z.*
  from report_rezka_rows z
  where p_directions && array['rezka_kirim', 'rezka_send']
    and z.kind = any(p_directions)
    and z.kind in ('rezka_kirim', 'rezka_send')
    and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_status is null or p_status = '')
    and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '')
    and z.date_basis between p_from and p_to
    and (p_owner_id is null or z.owner_id = p_owner_id)
    and (p_type_id is null or z.type_id = p_type_id)
    and (p_serial is null or p_serial = '' or z.serial ilike '%' || p_serial || '%')
    and (p_plate is null or p_plate = '' or z.plate ilike '%' || p_plate || '%')
    and (p_driver is null or p_driver = '' or z.driver ilike '%' || p_driver || '%')
    and (p_partiya_no is null or z.partiya_no = p_partiya_no)

  union all

  -- Rezkadan chiqdi: per serial per period, the moyka_output-by-serial
  -- shape and the same exclusion set (void, storage-lost, mint source).
  select
    'rezka_output'::text, 'rezka-output-serial-' || z.serial || '-' || p_from::text || '-' || p_to::text, z.serial,
    null::text, (array_agg(z.order_id))[1], null::uuid, (array_agg(z.owner_id))[1], (array_agg(z.type_id))[1],
    (array_agg(z.calibre_id))[1], null::text, null::text, max(z.date_basis), 'received_date'::text,
    coalesce(sum(z.qty_kg) filter (
      where z.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
        and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = z.barcode2)
    ), 0),
    false, null::numeric, null::numeric, null::numeric, false, null::integer, null::text, null::text,
    null::numeric, null::numeric, null::numeric, null::numeric, null::text[], null::numeric, min(z.partiya_no)
  from report_rezka_rows z
  where 'rezka_output' = any(p_directions)
    and z.kind = 'rezka_output'
    and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '')
    and z.date_basis between p_from and p_to
    and (p_owner_id is null or z.owner_id = p_owner_id)
    and (p_type_id is null or z.type_id = p_type_id)
    and (p_calibre_id is null or z.calibre_id = p_calibre_id)
    and (p_barcode2 is null or p_barcode2 = '' or z.barcode2 ilike '%' || p_barcode2 || '%')
    and (p_status is null or p_status = '' or z.pallet_status = p_status)
    and (p_serial is null or p_serial = '' or z.serial ilike '%' || p_serial || '%')
    and (p_partiya_no is null or z.partiya_no = p_partiya_no)
  group by z.serial

  union all

  -- Rezka chiqim: per (request, serial) -- a serial so the row carries its
  -- serial-state (olib ketilgan); departed only, dated by departure (same
  -- basis as the Oddiy chiqim_dispatch row).
  select
    'rezka_chiqim'::text, 'rezka-chiqim-' || z.request_id::text || '-' || z.serial, z.serial, null::text,
    (array_agg(z.order_id))[1], z.request_id, (array_agg(z.owner_id))[1], (array_agg(z.type_id))[1],
    (array_agg(z.calibre_id))[1], (array_agg(z.plate))[1], (array_agg(z.driver))[1], max(z.date_basis),
    'departed_at'::text, sum(z.qty_kg), false, null::numeric, null::numeric, null::numeric, false, null::integer,
    'jonatilgan'::text, null::text, null::numeric, null::numeric, null::numeric, null::numeric, null::text[],
    null::numeric, min(z.partiya_no)
  from report_rezka_rows z
  where 'rezka_chiqim' = any(p_directions)
    and z.kind = 'rezka_chiqim'
    and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '')
    and z.date_basis between p_from and p_to
    and (p_owner_id is null or z.owner_id = p_owner_id)
    and (p_type_id is null or z.type_id = p_type_id)
    and (p_calibre_id is null or z.calibre_id = p_calibre_id)
    and (p_barcode2 is null or p_barcode2 = '' or z.barcode2 ilike '%' || p_barcode2 || '%')
    and (p_serial is null or p_serial = '' or z.serial ilike '%' || p_serial || '%')
    and (p_plate is null or p_plate = '' or z.plate ilike '%' || p_plate || '%')
    and (p_driver is null or p_driver = '' or z.driver ilike '%' || p_driver || '%')
    and (p_partiya_no is null or z.partiya_no = p_partiya_no)
  group by z.request_id, z.serial;
$function$;

-- ------------------------------------------------------------------
-- 5. report_totals -- Rezka movement + state (return type widens: drop/create)
-- ------------------------------------------------------------------
drop function public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer);
create function public.report_totals(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer default null::integer)
 returns table(total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric, total_kg_from_moyka numeric, state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric,
   total_kg_to_rezka numeric, total_kg_from_rezka numeric, state_rezkaga_yuborilgan numeric, state_rezkada numeric)
 language sql
 stable
as $function$
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
      -- Totals rule (Prompt 4): Tashqi Rezka kirim and Rezka chiqim crossed
      -- the gate and count; Ichki kirim ('rezka-mint-'), yuborildi and
      -- chiqdi are internal and do not.
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
grant execute on function public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 6. report_page_enrich -- + Manba, parents, Rezka state (drop/create)
-- ------------------------------------------------------------------
drop function public.report_page_enrich(text[], text[], date, date, text[], uuid, uuid, text, text, text, text, text, integer);
create function public.report_page_enrich(p_serials text[], p_dispatch_keys text[], p_from date, p_to date, p_directions text[], p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer)
 returns table(row_type text, key text, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric, dispatch_k1 numeric, dispatch_k2 numeric, dispatch_k3 numeric, dispatch_k4 numeric, dispatch_k5 numeric, dispatch_k6 numeric, dispatch_k7 numeric, dispatch_k8 numeric, dispatch_kn numeric,
   rezka_manba text, rezka_parents jsonb, state_rezkaga_yuborilgan numeric, state_rezkada numeric)
 language sql
 stable
as $function$
  select 'bundle'::text, b.serial, b.state_qabul_qilingan, b.state_omborda_qoldi,
    b.moyka_range_to_moyka_kg, b.moyka_asof, b.moyka_range_from_moyka_kg,
    b.state_xom_jonatilgan, b.state_olib_ketilgan,
    b.calibre_output_k1, b.calibre_output_k2, b.calibre_output_k3, b.calibre_output_k4,
    b.calibre_output_k5, b.calibre_output_k6, b.calibre_output_k7, b.calibre_output_k8,
    b.calibre_output_kn, b.loss_range,
    b.state_moykaga_yuborilgan, b.state_moykadan_chiqgan,
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric,
    rz.manba, rz.parents, rz.rezkaga_yuborilgan, rz.rezkada
  from kirim_line_report_bundle_set(p_serials, p_from, p_to) b
  left join rezka_serial_state_set(p_serials) rz on rz.serial = b.serial
  where p_serials is not null and array_length(p_serials, 1) is not null
  union all
  select 'dispatch'::text, m.request_id::text,
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
    null::numeric, null::numeric, null::numeric, null::numeric,
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '01'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '02'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '03'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '04'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '05'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '06'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '07'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = '08'), 0), 0),
    nullif(coalesce(sum(m.qty_kg) filter (where m.is_match and m.calibre_code = 'KN'), 0), 0),
    null::text, null::jsonb, null::numeric, null::numeric
  from (
    select r.request_id, r.qty_kg, cal.code as calibre_code,
      chiqim_component_is_match(
        'chiqim'::text, r.calibre_id, r.barcode2, r.wash_cycle, r.lab_verdict,
        r.pallet_status, r.serial, r.type_id, r.partiya_no,
        p_directions, p_calibre_id, p_barcode2, p_wash_cycle, p_lab_verdict,
        p_status, p_serial, p_type_id, p_partiya_no
      ) as is_match
    from report_chiqim_rows_v2 r
    left join calibres cal on cal.id = r.calibre_id
    where r.request_id = any (select k::uuid from unnest(coalesce(p_dispatch_keys, '{}'::text[])) k)
      and r.date_basis between p_from and p_to
  ) m
  group by m.request_id;
$function$;
grant execute on function public.report_page_enrich(text[], text[], date, date, text[], uuid, uuid, text, text, text, text, text, integer) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 7. rahbar_stock_snapshot -- + rezkadaKg (wrapper; the 0143 body is kept
--    verbatim as rahbar_stock_snapshot_core, not retyped)
-- ------------------------------------------------------------------
alter function public.rahbar_stock_snapshot(text) rename to rahbar_stock_snapshot_core;
create function public.rahbar_stock_snapshot(p_scope text)
returns jsonb
language sql
stable
as $$
  -- rezkadaKg: Rezka is never old stock, so the figure is scope-independent
  -- (same as rezkaRawKg/rezkaKnKg in the core body). TEST serials excluded
  -- like every other snapshot key (stock_on_hand_rows drops TEST- plates).
  select rahbar_stock_snapshot_core(p_scope) || jsonb_build_object(
    'rezkadaKg', (
      select coalesce(sum(s.rezkada), 0)
      from rezka_serial_state_set(array(
        select kl.serial from kirim_lines kl where kl.process = 'rezka' and not rezka_serial_is_test(kl.serial)
      )) s
    )
  )
$$;
grant execute on function public.rahbar_stock_snapshot(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 8. get_serial_passport -- + rezkaDrawsOut (parent KN serials) and rezka
--    (Rezka serials). Wrapper; the 17k-char live body is kept verbatim as
--    get_serial_passport_core, not retyped.
-- ------------------------------------------------------------------
alter function public.get_serial_passport(text) rename to get_serial_passport_core;
create function public.get_serial_passport(p_serial text)
returns jsonb
language sql
stable
as $$
  select get_serial_passport_core(p_serial) || jsonb_build_object(
    -- Parent Konditerka serial: "Rezkaga yuborilgan KN: X kg -> serial S",
    -- one entry per draw (= per minted serial), pallets listed inside.
    'rezkaDrawsOut', (
      select coalesce(jsonb_agg(x order by x->>'drawnAt'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'mintedSerial', d.minted_serial,
          'kg', sum(d.qty_kg),
          'drawnAt', min(d.drawn_at),
          'pallets', jsonb_agg(jsonb_build_object('barcode2', d.barcode2, 'qtyKg', d.qty_kg) order by d.barcode2)
        ) as x
        from rezka_kn_draws d
        join finished_pallets fp on fp.barcode2 = d.barcode2
        where fp.serial = p_serial
        group by d.minted_serial
      ) draws
    ),
    -- Rezka serial: provenance, arrival/mint time, sent / received /
    -- Rezkada-or-Ortiqcha per cycle. Dispatches stay in the core
    -- 'dispatches' key (generic over the serial's pallets); no lab block.
    'rezka', (
      select case when kl.process <> 'rezka' then null else jsonb_build_object(
        'provenance', case when ko.origin = 'internal_reprocess' then 'ichki' else 'tashqi' end,
        'arrivedAt', case when ko.origin = 'internal_reprocess' then null else (
          select gw.completed_at from gate_weighings gw
          where gw.dir = 'kirim' and gw.order_id = ko.order_id
          order by gw.stage1_completed_at desc nulls last limit 1
        ) end,
        'mintedAt', (select min(d.drawn_at) from rezka_kn_draws d where d.minted_serial = p_serial),
        'parents', rs.parents,
        'sentKg', rs.rezkaga_yuborilgan,
        'receivedKg', coalesce((select sum(fp.weight_kg) from finished_pallets fp
                                where fp.serial = p_serial and fp.status <> 'bekor_qilindi'), 0),
        'rezkadaKg', rs.rezkada,
        'cycles', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'cycleNo', rc.cycle_no, 'openedAt', rc.opened_at, 'closedAt', rc.closed_at,
            'sentKg', w.sent_kg, 'receivedKg', w.recv_kg,
            -- open: Rezkada (signed); closed: realized, signed (negative = Ortiqcha)
            'rezkadaKg', case when rc.closed_at is null then w.sent_kg - w.recv_kg else 0 end,
            'yoqotishKg', case when rc.closed_at is not null then w.sent_kg - w.recv_kg else null end
          ) order by rc.cycle_no), '[]'::jsonb)
          from rezka_cycles rc
          left join lateral (
            select
              coalesce((select sum(s.qty_kg) from rezka_sends s where s.serial = rc.serial
                        and s.sent_date >= rc.opened_at::date
                        and (nx.opened_at is null or s.sent_date < nx.opened_at::date)), 0) as sent_kg,
              coalesce((select sum(fp.weight_kg) from finished_pallets fp where fp.serial = rc.serial
                        and fp.status <> 'bekor_qilindi' and fp.received_date >= rc.opened_at::date
                        and (nx.opened_at is null or fp.received_date < nx.opened_at::date)), 0) as recv_kg
            from (select min(rc2.opened_at) as opened_at from rezka_cycles rc2
                  where rc2.serial = rc.serial and rc2.cycle_no > rc.cycle_no) nx
          ) w on true
          where rc.serial = p_serial
        )
      ) end
      from kirim_lines kl
      join kirim_orders ko on ko.order_id = kl.order_id
      left join rezka_serial_state_set(array[p_serial]) rs on rs.serial = kl.serial
      where kl.serial = p_serial
    )
  )
$$;
grant execute on function public.get_serial_passport(text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 9. report_query_page (the Excel export's full-set read) -- + Manba,
--    parents, Rezka state, same four columns as report_page_enrich so the
--    export carries exactly what the table shows (drop/create: widens).
-- ------------------------------------------------------------------
drop function public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer);
create function public.report_query_page(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_limit integer default 100, p_offset integer default 0, p_partiya_no integer default null::integer)
 returns table(kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric, dispatch_k1 numeric, dispatch_k2 numeric, dispatch_k3 numeric, dispatch_k4 numeric, dispatch_k5 numeric, dispatch_k6 numeric, dispatch_k7 numeric, dispatch_k8 numeric, dispatch_kn numeric,
   rezka_manba text, rezka_parents jsonb, state_rezkaga_yuborilgan numeric, state_rezkada numeric)
 language sql
 stable
as $function$
  with f as materialized (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ),
  b as materialized (
    select ds.serial as b_serial, bb.*
    from (select distinct f.serial from f where f.serial is not null) ds
    cross join lateral kirim_line_report_bundle(ds.serial, p_from, p_to) bb
  ),
  rz as materialized (
    select * from rezka_serial_state_set(array(select distinct f.serial from f where f.serial is not null))
  )
  select f.*, b.state_qabul_qilingan, b.state_omborda_qoldi, b.moyka_range_to_moyka_kg, b.moyka_asof,
         b.moyka_range_from_moyka_kg, b.state_xom_jonatilgan, b.state_olib_ketilgan,
         b.calibre_output_k1, b.calibre_output_k2, b.calibre_output_k3, b.calibre_output_k4, b.calibre_output_k5,
         b.calibre_output_k6, b.calibre_output_k7, b.calibre_output_k8, b.calibre_output_kn,
         b.loss_range,
         b.state_moykaga_yuborilgan, b.state_moykadan_chiqgan,
         cdc.k1, cdc.k2, cdc.k3, cdc.k4, cdc.k5, cdc.k6, cdc.k7, cdc.k8, cdc.kn,
         rz.manba, rz.parents, rz.rezkaga_yuborilgan, rz.rezkada
  from f
  left join b on b.b_serial = f.serial
  left join rz on rz.serial = f.serial
  left join lateral chiqim_dispatch_calibre_breakdown(
    f.request_id, p_directions, p_from, p_to, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
  ) cdc on f.kind = 'chiqim_dispatch'
  order by f.date_basis desc nulls last, f.row_key desc;
$function$;
grant execute on function public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer) to anon, authenticated, service_role;
