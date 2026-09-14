-- Applied 2026-09-14 against project qohoqbapevrcjqxbstxi.
-- Schema-level change (new views/functions + 2 CREATE OR REPLACE rewires),
-- not a data correction — archived here anyway per this session's
-- established convention of archiving every applied SQL change.
--
-- See docs/decisions/0188-2026-09-14-chiqim-regrain-departure-date-
-- dispatch-rollup.md for the full task, the phantom-weight/swallowed-
-- history bug descriptions, the consumer audit, the null-departure rule,
-- and the before/after reconciliation (August, Sep 1-12, full year).
--
-- Three changes, applied together as one _v2 layer alongside the existing
-- (untouched) report_chiqim_rows/report_raw_dispatch_rows/report_old_kn_
-- rows/report_filtered_rows/report_query_page(13-arg)/report_totals(13-arg)
-- objects, which remain live for fetchVoidedBarcodeMatch's own identity
-- lookup (see ChiqimReportRow's comment in reportQuery.ts):
--
-- Change 1 (regrain): report_chiqim_rows_v2/report_raw_dispatch_rows_v2/
-- report_old_kn_rows_v2 anchor on chiqim_pallet_consumption (resp.
-- raw_dispatch_lines/old_kn_collections, which were never grain-buggy) as
-- the FROM, not finished_pallets -- a pallet consumed across N requests now
-- produces N rows, qty_kg is the consumption row's own qty_kg, never book
-- weight. Fixes: (a) "latest touch wins" attributed a pallet's WHOLE book
-- weight to whichever consumption row touched it most recently, silently
-- DROPPING every earlier partial consumption from the report entirely.
--
-- Change 2 (departure-date basis): date_basis on all three _v2 views is
-- chiqim_departed_at(request_id), not chiqim_requests.request_date --
-- applied to raw/old_kn too even though they were immune to the grain bug,
-- for date-basis consistency. Null-departure rows are EXCLUDED, never
-- fall back to request_date (same precedent as report_filtered_rows'
-- existing date_basis IS NULL handling for omborda/band_qilingan pallets).
--
-- Change 3 (rollup): report_dispatch_rows_v2 groups by chiqim_requests.id
-- (the shipment entity), summing p_kinds-matched components with "at least
-- one component matches" semantics (same as report_moyka_output_rows_by_
-- serial's own precedent) -- report_filtered_rows_v2 unions this in place
-- of the old bare chiqim/chiqim_raw/chiqim_old_kn selects, and report_
-- query_page/report_totals (14-arg overloads) are rewired to call it.
--
-- Post-hoc hardening (same day, found during this file's own write-up):
-- report_dispatch_rows_v2's p_kinds match originally read
-- "p_kinds is null or array_length(p_kinds,1) is null or comp_kind = any(p_kinds)".
-- array_length() of an explicitly-empty array is NULL in Postgres (not 0),
-- so an intentionally-empty p_kinds (report_filtered_rows_v2 computes this
-- by intersecting the caller's direction filter against the 3 chiqim kinds
-- -- e.g. directions=['kirim'] alone intersects to {}) was silently treated
-- as "no restriction", matching every component. Confirmed live: calling
-- report_dispatch_rows_v2(array[]::text[], ...) returned 10 rows instead of
-- 0. Currently INERT for every real caller -- report_filtered_rows_v2 wraps
-- the call in its own outer "p_directions && array['chiqim',...]" guard
-- that discards the whole branch whenever the intersection would be empty
-- -- but that's "correct only because the one caller happens to guard
-- first," exactly the kind of exclusion CLAUDE.md's origin-filtering
-- section says to make explicit rather than leave accidental. Fixed at the
-- source: dropped the array_length(...) is null clause so an explicit
-- empty array now means "matches nothing" (only bare null means
-- unrestricted), independent of caller discipline. Verified: empty-array
-- call now returns 0 rows; null-kinds call still returns all 10; August/
-- Sep1-12/full-year totals unchanged (69,151 / 28,970 / 98,121).

-- ============================================================
-- Change 1 + 2: regrained, departure-dated views
-- ============================================================

create or replace view report_chiqim_rows_v2 as
select
  'chiqim'::text as kind,
  c.id::text as row_key,
  fp.serial,
  fp.barcode2,
  kl.order_id,
  cl.request_id,
  ko.owner_id,
  fp.type_id,
  fp.calibre_id,
  coalesce(cr.plate, '') as plate,
  coalesce(cr.driver, '') as driver,
  (chiqim_departed_at(cr.id) at time zone 'utc')::date as date_basis,
  null::text as date_basis_source,
  c.qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  null::integer as wash_cycle,
  case
    when fp.status = 'bekor_qilindi' then 'bekor_qilingan'
    when fp.status = 'consumed' then 'ishlatilgan'
    when fp.status = 'storage_loss' then 'saqlashda_yoqolgan'
    when coalesce(consumed.departed_kg, 0) >= fp.weight_kg then 'jonatilgan'
    when coalesce(consumed.departed_kg, 0) > 0 or coalesce(consumed.pending_kg, 0) > 0 then 'band_qilingan'
    else 'omborda'
  end as pallet_status,
  lr.verdict as lab_verdict,
  kl.target_moisture_pct,
  kl.target_so2_mg_kg,
  lr.moisture_pct,
  lr.so2_mg_kg,
  null::text[] as void_successor_barcodes,
  null::numeric as box_mass_kg,
  kl.partiya_no
from chiqim_pallet_consumption c
join chiqim_lines cl on cl.id = c.chiqim_line_id
join chiqim_requests cr on cr.id = cl.request_id
join finished_pallets fp on fp.barcode2 = c.barcode2
join kirim_lines kl on kl.serial = fp.serial
join kirim_orders ko on ko.order_id = kl.order_id
left join lateral (
  select
    sum(c2.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
    sum(c2.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
  from chiqim_pallet_consumption c2
  join chiqim_lines cl2 on cl2.id = c2.chiqim_line_id
  join chiqim_requests cr2 on cr2.id = cl2.request_id
  left join lateral (select chiqim_departed_at(cr2.id) as completed_at) cgwx on true
  where c2.barcode2 = fp.barcode2
) consumed on true
left join lateral (
  select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
) wc on true
left join lateral (
  select lr3.verdict, lr3.moisture_pct, lr3.so2_mg_kg
  from lab_results lr3
  where lr3.scope = 'chiqim' and lr3.wash_cycle_id = wc.id
  order by lr3.created_at desc
  limit 1
) lr on true
where ko.plate not like 'TEST-%'
  and coalesce(cr.plate, '') not like 'TEST-%';

create or replace view report_raw_dispatch_rows_v2 as
select
  'chiqim_raw'::text as kind,
  rdl.id::text as row_key,
  rdl.serial,
  null::text as barcode2,
  kl.order_id,
  cl.request_id,
  ko.owner_id,
  cl.type_id,
  null::uuid as calibre_id,
  coalesce(cr.plate, '') as plate,
  coalesce(cr.driver, '') as driver,
  (chiqim_departed_at(cr.id) at time zone 'utc')::date as date_basis,
  null::text as date_basis_source,
  rdl.net_kg as qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  null::integer as wash_cycle,
  'jonatilgan'::text as pallet_status,
  null::text as lab_verdict,
  null::numeric as target_moisture_pct,
  null::numeric as target_so2_mg_kg,
  null::numeric as moisture_pct,
  null::numeric as so2_mg_kg,
  null::text[] as void_successor_barcodes,
  rdl.box_mass_kg,
  kl.partiya_no
from raw_dispatch_lines rdl
join chiqim_lines cl on cl.id = rdl.chiqim_line_id
join chiqim_requests cr on cr.id = cl.request_id
join kirim_lines kl on kl.serial = rdl.serial
join kirim_orders ko on ko.order_id = kl.order_id
where ko.plate not like 'TEST-%'
  and coalesce(cr.plate, '') not like 'TEST-%';

create or replace view report_old_kn_rows_v2 as
select
  'chiqim_old_kn'::text as kind,
  okc.id::text as row_key,
  null::text as serial,
  null::text as barcode2,
  null::uuid as order_id,
  cl.request_id,
  okp.owner_id,
  okp.type_id,
  null::uuid as calibre_id,
  coalesce(cr.plate, '') as plate,
  coalesce(cr.driver, '') as driver,
  (chiqim_departed_at(cr.id) at time zone 'utc')::date as date_basis,
  null::text as date_basis_source,
  okc.collected_kg as qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  null::integer as wash_cycle,
  'jonatilgan'::text as pallet_status,
  null::text as lab_verdict,
  null::numeric as target_moisture_pct,
  null::numeric as target_so2_mg_kg,
  null::numeric as moisture_pct,
  null::numeric as so2_mg_kg,
  null::text[] as void_successor_barcodes,
  null::numeric as box_mass_kg,
  null::integer as partiya_no
from old_kn_collections okc
join old_kn_pools okp on okp.id = okc.pool_id
join chiqim_lines cl on cl.id = okc.chiqim_line_id
join chiqim_requests cr on cr.id = cl.request_id
where coalesce(cr.plate, '') not like 'TEST-%';

-- ============================================================
-- Change 3: dispatch rollup (final, post-hardening-fix version)
-- ============================================================

drop function if exists report_dispatch_rows_v2(
  text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text
);

create or replace function report_dispatch_rows_v2(
  p_kinds text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text,
  p_lab_verdict text, p_status text, p_partiya_no integer
) returns setof report_rows_v2
language sql stable as $$
  with components as (
    select 'chiqim'::text as comp_kind, request_id, owner_id, type_id, calibre_id, serial, barcode2, wash_cycle, lab_verdict, pallet_status, partiya_no, qty_kg
    from report_chiqim_rows_v2 where date_basis between p_from and p_to
    union all
    select 'chiqim_raw', request_id, owner_id, type_id, null::uuid, serial, null::text, null::integer, null::text, 'jonatilgan'::text, partiya_no, qty_kg
    from report_raw_dispatch_rows_v2 where date_basis between p_from and p_to
    union all
    select 'chiqim_old_kn', request_id, owner_id, type_id, null::uuid, null::text, null::text, null::integer, null::text, 'jonatilgan'::text, partiya_no, qty_kg
    from report_old_kn_rows_v2 where date_basis between p_from and p_to
  ),
  matched as (
    select *,
      (
        -- p_kinds is an INTERNAL narrowing param (built by intersecting the
        -- caller's direction filter against the 3 chiqim-family kinds in
        -- report_filtered_rows_v2), not a user-facing "[] = all" checkbox
        -- value -- so unlike p_directions elsewhere in this report engine,
        -- an explicitly-empty (non-null) p_kinds here must match NOTHING,
        -- not "no restriction". Deliberately NOT checking
        -- array_length(p_kinds,1) is null: that Postgres quirk (empty
        -- array's length is NULL, not 0) would silently collapse "caller
        -- computed zero overlapping kinds" into "no restriction", matching
        -- every component -- only null itself means unrestricted.
        (p_kinds is null or comp_kind = any(p_kinds))
        and (p_calibre_id is null or calibre_id = p_calibre_id)
        and (p_barcode2 is null or p_barcode2 = '' or barcode2 ilike '%' || p_barcode2 || '%')
        and (p_wash_cycle is null or p_wash_cycle = ''
             or (p_wash_cycle = '1' and wash_cycle = 1) or (p_wash_cycle = '2+' and wash_cycle >= 2))
        and (p_lab_verdict is null or p_lab_verdict = ''
             or (p_lab_verdict = 'tekshirilmagan' and lab_verdict is null) or lab_verdict = p_lab_verdict)
        and (p_status is null or p_status = '' or pallet_status = p_status)
        and (p_serial is null or p_serial = '' or serial ilike '%' || p_serial || '%')
        and (p_type_id is null or type_id = p_type_id)
        and (p_partiya_no is null or partiya_no = p_partiya_no)
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
$$;

-- ============================================================
-- report_filtered_rows_v2: 3-way union (kirim/moyka_send unchanged,
-- chiqim-family routed through the rollup, moyka_output unchanged)
-- ============================================================

create or replace function report_filtered_rows_v2(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text,
  p_lab_verdict text, p_status text, p_partiya_no integer default null
) returns setof report_rows_v2
language sql stable as $$
  -- kirim / moyka_send: unchanged from the pre-existing report_rows_v2 shape.
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

  union all

  -- chiqim / chiqim_raw / chiqim_old_kn: rolled up to one row per dispatch
  -- (2026-09-14, see docs/decisions/0188-...-chiqim-regrain-departure-date-
  -- dispatch-rollup.md). Only queried when the direction filter includes at
  -- least one of the three legacy kind-strings, or no direction restriction
  -- at all -- p_kinds narrows which of the three COMPONENT kinds count
  -- toward is_match/the summed qty_kg, same "at least one component
  -- matches" semantics as every other per-pallet filter here.
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

  select *
  from report_moyka_output_rows_by_serial(p_from, p_to, p_owner_id, p_type_id, p_serial, p_partiya_no, p_status, p_lab_verdict)
  where (p_directions is null or array_length(p_directions, 1) is null or 'moyka_output' = any(p_directions))
    and p_calibre_id is null
    and (p_barcode2 is null or p_barcode2 = '')
    and (p_wash_cycle is null or p_wash_cycle = '');
$$;

-- ============================================================
-- report_query_page / report_totals (14-arg overloads): rewired to call
-- report_filtered_rows_v2 instead of report_filtered_rows. Signatures/
-- return shapes UNCHANGED from before this task -- CREATE OR REPLACE only.
-- ============================================================

create or replace function report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text,
  p_lab_verdict text, p_status text, p_limit integer default 100, p_offset integer default 0,
  p_partiya_no integer default null
) returns table(
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid,
  type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text,
  qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric,
  truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer,
  pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric,
  moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric,
  partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric,
  state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric,
  state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric,
  state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric,
  state_k8 numeric, state_kn numeric, state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
)
language sql stable as $$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, mr.to_moyka_kg, mk.moykada_asof,
         mr.from_moyka_kg, s.xom_jonatilgan, s.olib_ketilgan,
         cor.k1, cor.k2, cor.k3, cor.k4, cor.k5, cor.k6, cor.k7, cor.k8, cor.kn,
         kirim_line_loss_range(f.serial, p_from, p_to),
         s.moykaga_yuborilgan, s.moykadan_chiqgan
  from (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral kirim_line_calibre_output_range(f.serial, p_from, p_to) cor on f.serial is not null
  left join lateral kirim_line_moyka_range(f.serial, p_from, p_to) mr on f.serial is not null
  left join lateral (select kirim_line_moyka_asof(f.serial, p_to) as moykada_asof) mk on f.serial is not null;
$$;

create or replace function report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text,
  p_lab_verdict text, p_status text, p_partiya_no integer default null
) returns table(
  total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric,
  total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric,
  total_kg_from_moyka numeric, state_serial_count bigint, state_qabul_qilingan numeric,
  state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric,
  state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric,
  state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
)
language sql stable as $$
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
      coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn', 'chiqim_dispatch') then qty_kg else 0 end), 0) as total_kg_out,
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
      coalesce(sum(s.xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(s.olib_ketilgan), 0) as state_olib_ketilgan,
      coalesce(sum(s.moykaga_yuborilgan), 0) as state_moykaga_yuborilgan_lifetime,
      coalesce(sum(s.moykadan_chiqgan), 0) as state_moykadan_chiqgan_lifetime
    from distinct_serials ds
    cross join lateral kirim_line_state(ds.serial) s
  ),
  moykada_asof as (
    select coalesce(sum(kirim_line_moyka_asof(ds.serial, p_to)), 0) as state_moykada
    from distinct_serials ds
  ),
  moyka_range as (
    select
      coalesce(sum(mr.to_moyka_kg), 0) as state_moykaga_yuborilgan,
      coalesce(sum(mr.from_moyka_kg), 0) as state_moykadan_chiqgan
    from distinct_serials ds
    cross join lateral kirim_line_moyka_range(ds.serial, p_from, p_to) mr
  ),
  calibre_output as (
    select
      coalesce(sum(co.k1), 0) as state_k1, coalesce(sum(co.k2), 0) as state_k2, coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4, coalesce(sum(co.k5), 0) as state_k5, coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7, coalesce(sum(co.k8), 0) as state_k8, coalesce(sum(co.kn), 0) as state_kn
    from distinct_serials ds
    cross join lateral kirim_line_calibre_output_range(ds.serial, p_from, p_to) co
  ),
  realized_loss as (
    select coalesce(sum(kirim_line_loss_range(ds.serial, p_from, p_to)), 0) as state_yoqotish
    from distinct_serials ds
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    state.state_serial_count, state.state_qabul_qilingan, state.state_omborda_qoldi,
    moyka_range.state_moykaga_yuborilgan, moykada_asof.state_moykada, moyka_range.state_moykadan_chiqgan,
    state.state_xom_jonatilgan, state.state_olib_ketilgan,
    calibre_output.state_k1, calibre_output.state_k2, calibre_output.state_k3, calibre_output.state_k4,
    calibre_output.state_k5, calibre_output.state_k6, calibre_output.state_k7, calibre_output.state_k8,
    calibre_output.state_kn,
    realized_loss.state_yoqotish,
    state.state_moykaga_yuborilgan_lifetime, state.state_moykadan_chiqgan_lifetime
  from movement, state, moykada_asof, moyka_range, calibre_output, realized_loss;
$$;

-- ============================================================
-- Verified live after applying (see decision doc for full detail):
--   - report_dispatch_rows_v2(null, Aug): 69,151 kg
--   - report_dispatch_rows_v2(null, Sep 1-12): exactly 2 lines, 28,970 kg
--     (4b639af5 8,640 + 545883f6 20,330)
--   - report_dispatch_rows_v2(null, full year): 98,121 kg = Aug + Sep
--     (all live dispatch activity falls in Aug-Sep)
--   - Roll-up integrity: all 10 live Aug-Sep dispatch lines' qty_kg equal
--     the sum of their own matching components, exactly, no exceptions.
--   - PLT-110826-002-04-2 (3 requests, 2 months): reports as 3 separate
--     rows (10kg/2026-08-28, 590kg/2026-08-30, 460kg/2026-09-12), summing
--     to 1,060kg = its book weight -- see tests/e2e/chiqim-regrain-
--     dispatch-rollup.spec.ts.
--   - report_totals(['kirim'], full year): total_kg_out = 0 -- confirms
--     Приход (ClientPrihodTab, hardcoded directions:['kirim']) sees no
--     chiqim_dispatch leakage.
--   - Empty-p_kinds hardening: report_dispatch_rows_v2(array[]::text[],...)
--     returns 0 rows (was 10 before the fix); null-kinds call unaffected.
-- ============================================================
