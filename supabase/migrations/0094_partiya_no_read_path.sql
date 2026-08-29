-- Partiya raqami (0093) read-path: thread partiya_no through every SQL
-- object that displays a serial to a role, so Laborator/Ombor/Menejer/
-- Rahbar/Hisobot/passport/client portal can never disagree about a
-- serial's own batch number. Sixteen objects; each just adds one column to
-- an existing kirim_lines join (or, for report_kirim_rows itself, to the
-- kirim_lines join it already has) -- no new joins introduced except where
-- explicitly noted below. Opening_stock/internal_reprocess rows keep
-- reading NULL throughout, same as the column itself.
--
-- First-apply attempt of this migration failed with:
--   ERROR: 42P16: cannot change name of view column "calibre_id" to
--   "partiya_no" (HINT: Use ALTER VIEW ... RENAME COLUMN ...)
-- CREATE OR REPLACE VIEW only allows appending new output columns at the
-- END of the SELECT list -- inserting one in the middle shifts every
-- column after it, which Postgres reads as an (disallowed) implicit
-- rename of each shifted column. Fixed by moving partiya_no to be the
-- LAST column of every view's outer/exposed SELECT list below (CTEs
-- inside a view are not "view columns" and are unaffected by this rule,
-- so partiya_no stays wherever convenient inside them).
--
-- The same restriction applies even harder to the three functions here
-- using RETURNS TABLE (report_kirim_rows_as_of, report_query_page,
-- client_filtered_report_rows): CREATE OR REPLACE FUNCTION refuses ANY
-- change to the OUT-parameter list (RETURNS TABLE is implemented as OUT
-- parameters), regardless of position -- appending one still errors with
-- "cannot change return type of existing function". Those three are
-- therefore DROP FUNCTION + CREATE FUNCTION below instead of CREATE OR
-- REPLACE; their body-internal column order was never a problem (SQL
-- functions weren't the object that failed originally), so only the
-- drop+recreate mechanics changed, not their logic.

-- ============================================================
-- 1. report_kirim_rows: base KIRIM row source. Adds kl.partiya_no to the
--    `lines` CTE (already selects from kirim_lines kl); the outer select
--    appends l.partiya_no as the LAST column (after origin, which was
--    previously last) to satisfy CREATE OR REPLACE VIEW's append-only rule.
-- ============================================================
create or replace view public.report_kirim_rows as
with lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
),
box_mass as (
  select kl.order_id,
    case when bool_and(si_1.serial is not null) then sum(si_1.box_mass_kg) else null end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si_1 on si_1.serial = kl.serial
  group by kl.order_id
)
select
  'kirim'::text as kind, l.serial as row_key, l.serial, null::text as barcode2, l.order_id,
  null::uuid as request_id, ko.owner_id, l.type_id, null::uuid as calibre_id, ko.plate, ko.driver,
  ko.order_date as date_basis, 'order_date'::text as date_basis_source,
  case
    when si.actual_qty is null then l.declared_qty
    when gw.completed_at is null or bm.total_box_mass_kg is null then si.actual_qty
    when l.line_count > 1 then si.actual_qty
    else coalesce(gw.net_kg - bm.total_box_mass_kg, si.actual_qty)
  end as qty_kg,
  case
    when si.actual_qty is null then false
    when gw.completed_at is null or bm.total_box_mass_kg is null then true
    else false
  end as provisional,
  l.declared_qty,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null
       then gw.net_kg - bm.total_box_mass_kg - ko.declared_total else null end as truck_variance_diff_kg,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null and ko.declared_total > 0
       then (gw.net_kg - bm.total_box_mass_kg - ko.declared_total) / ko.declared_total * 100 else null end as truck_variance_diff_pct,
  case when l.line_count = 1 and gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null
            and si.actual_qty is not null and si.actual_qty <> 0
            and es.sent_date is not null and es.sent_date <= (gw.completed_at at time zone 'utc')::date
            and abs((gw.net_kg - bm.total_box_mass_kg - si.actual_qty) / si.actual_qty * 100) > coalesce((select value from settings_limits where key = 'kam_chiqdi_pct'), 5)
       then true else false end as provisional_variance_flag,
  null::integer as wash_cycle, null::text as pallet_status, null::text as lab_verdict,
  l.target_moisture_pct, l.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
  null::text[] as void_successor_barcodes, si.box_mass_kg, ko.origin, l.partiya_no
from lines l
join kirim_orders ko on ko.order_id = l.order_id
left join storage_intake si on si.serial = l.serial
left join box_mass bm on bm.order_id = l.order_id
left join lateral (
  select gw2.net_kg, gw2.completed_at, gw2.stage1_completed_at
  from gate_weighings gw2
  where gw2.dir = 'kirim' and gw2.order_id = l.order_id
  order by gw2.stage1_completed_at desc nulls last
  limit 1
) gw on true
left join lateral (
  select min(ms.sent_date) as sent_date from moyka_sends ms where ms.serial = l.serial
) es on true
left join lateral (
  select lr2.moisture_pct, lr2.so2_mg_kg
  from lab_results lr2
  where lr2.scope = 'kirim' and lr2.parent_serial = l.serial
  order by lr2.created_at desc limit 1
) lr on true
where ko.plate !~~ 'TEST-%';

-- ============================================================
-- 2. report_kirim_rows_as_of: as-of variant of the same view. FUNCTION
--    using RETURNS TABLE -- DROP + CREATE (see header). Body's own column
--    order is free to place partiya_no wherever (kept after type_id, as
--    originally written) since a fresh CREATE isn't constrained.
-- ============================================================
drop function if exists public.report_kirim_rows_as_of(date);

create function public.report_kirim_rows_as_of(p_to date)
 returns TABLE(kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid, partiya_no integer, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, origin text)
 language sql
 stable
as $function$
with
lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
),
box_mass as (
  select kl.order_id,
    case when bool_and(si_1.serial is not null) then sum(si_1.box_mass_kg) else null end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si_1
    on si_1.serial = kl.serial
   and si_1.confirmed_at is not null
   and (si_1.confirmed_at at time zone 'utc')::date <= p_to
  group by kl.order_id
)
select
  'kirim'::text as kind, l.serial as row_key, l.serial, null::text as barcode2, l.order_id,
  null::uuid as request_id, ko.owner_id, l.type_id, l.partiya_no, null::uuid as calibre_id, ko.plate, ko.driver,
  ko.order_date as date_basis, 'order_date'::text as date_basis_source,
  case
    when si.actual_qty is null then l.declared_qty
    when gw.completed_at is null or bm.total_box_mass_kg is null then si.actual_qty
    when l.line_count > 1 then si.actual_qty
    else coalesce(gw.net_kg - bm.total_box_mass_kg, si.actual_qty)
  end as qty_kg,
  case
    when si.actual_qty is null then false
    when gw.completed_at is null or bm.total_box_mass_kg is null then true
    else false
  end as provisional,
  l.declared_qty,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null
       then gw.net_kg - bm.total_box_mass_kg - ko.declared_total else null end as truck_variance_diff_kg,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null and ko.declared_total > 0
       then (gw.net_kg - bm.total_box_mass_kg - ko.declared_total) / ko.declared_total * 100 else null end as truck_variance_diff_pct,
  case when l.line_count = 1 and gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null
            and si.actual_qty is not null and si.actual_qty <> 0
            and es.sent_date is not null and es.sent_date <= (gw.completed_at at time zone 'utc')::date
            and abs((gw.net_kg - bm.total_box_mass_kg - si.actual_qty) / si.actual_qty * 100) > coalesce((select value from settings_limits where key = 'kam_chiqdi_pct'), 5)
       then true else false end as provisional_variance_flag,
  null::integer as wash_cycle, null::text as pallet_status, null::text as lab_verdict,
  l.target_moisture_pct, l.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
  null::text[] as void_successor_barcodes, si.box_mass_kg, ko.origin
from lines l
join kirim_orders ko on ko.order_id = l.order_id
left join storage_intake si
  on si.serial = l.serial
 and si.confirmed_at is not null
 and (si.confirmed_at at time zone 'utc')::date <= p_to
left join box_mass bm on bm.order_id = l.order_id
left join lateral (
  select gw2.net_kg,
         case when gw2.completed_at is not null and (gw2.completed_at at time zone 'utc')::date <= p_to
              then gw2.completed_at else null end as completed_at,
         gw2.stage1_completed_at
  from gate_weighings gw2
  where gw2.dir = 'kirim' and gw2.order_id = l.order_id
  order by gw2.stage1_completed_at desc nulls last
  limit 1
) gw on true
left join lateral (
  select min(ms.sent_date) as sent_date from moyka_sends ms where ms.serial = l.serial
) es on true
left join lateral (
  select lr2.moisture_pct, lr2.so2_mg_kg
  from lab_results lr2
  where lr2.scope = 'kirim' and lr2.parent_serial = l.serial
  order by lr2.created_at desc limit 1
) lr on true
where ko.plate !~~ 'TEST-%';
$function$;

-- ============================================================
-- 3. report_chiqim_rows: already joins kirim_lines kl -- append
--    kl.partiya_no as the LAST column (after box_mass_kg, which was
--    previously last).
-- ============================================================
create or replace view public.report_chiqim_rows as
select 'chiqim'::text as kind,
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    kl.order_id,
    latest.request_id,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    coalesce(cr.plate, ''::text) as plate,
    coalesce(cr.driver, ''::text) as driver,
    cr.request_date as date_basis,
    null::text as date_basis_source,
    fp.weight_kg as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
    case
        when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
        when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
        when fp.status = 'storage_loss'::pallet_status then 'saqlashda_yoqolgan'::text
        when coalesce(consumed.departed_kg, 0) >= fp.weight_kg then 'jonatilgan'::text
        when coalesce(consumed.departed_kg, 0) > 0 or coalesce(consumed.pending_kg, 0) > 0 then 'band_qilingan'::text
        else 'omborda'::text
    end as pallet_status,
    lr.verdict as lab_verdict,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    lr.moisture_pct,
    lr.so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    kl.partiya_no
   from finished_pallets fp
     join kirim_lines kl on kl.serial = fp.serial
     join kirim_orders ko on ko.order_id = kl.order_id
     left join lateral (
       select
         sum(c.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
         sum(c.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
       from chiqim_pallet_consumption c
       join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
       join chiqim_requests cr2 on cr2.id = cl2.request_id
       left join lateral (
         select cgw3.completed_at from gate_weighings cgw3
         where cgw3.dir = 'chiqim'::direction and cgw3.request_id = cr2.id
         order by cgw3.completed_at desc nulls last limit 1
       ) cgwx on true
       where c.barcode2 = fp.barcode2
     ) consumed on true
     left join lateral (
       select cl3.request_id
       from chiqim_pallet_consumption c3
       join chiqim_lines cl3 on cl3.id = c3.chiqim_line_id
       where c3.barcode2 = fp.barcode2
       order by c3.created_at desc limit 1
     ) latest on true
     left join chiqim_requests cr on cr.id = latest.request_id
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial
         limit 1) wc on true
     left join lateral ( select lr3.verdict,
            lr3.moisture_pct,
            lr3.so2_mg_kg
           from lab_results lr3
          where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
          order by lr3.created_at desc
         limit 1) lr on true
  where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 4. report_moyka_output_rows: same join, same edit -- kl.partiya_no
--    appended as the LAST column.
-- ============================================================
create or replace view public.report_moyka_output_rows as
 select 'moyka_output'::text as kind,
    'moyka-output-'::text || fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    kl.order_id,
    latest.request_id,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    null::text as plate,
    null::text as driver,
    fp.received_date as date_basis,
    'received_date'::text as date_basis_source,
    fp.weight_kg as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
        case
            when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
            when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
            when fp.status = 'storage_loss'::pallet_status then 'saqlashda_yoqolgan'::text
            when coalesce(consumed.departed_kg, 0) >= fp.weight_kg then 'jonatilgan'::text
            when coalesce(consumed.departed_kg, 0) > 0 or coalesce(consumed.pending_kg, 0) > 0 then 'band_qilingan'::text
            else 'omborda'::text
        end as pallet_status,
    lr.verdict as lab_verdict,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    lr.moisture_pct,
    lr.so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    kl.partiya_no
   from finished_pallets fp
     join kirim_lines kl on kl.serial = fp.serial
     join kirim_orders ko on ko.order_id = kl.order_id
     left join lateral (
       select
         sum(c.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
         sum(c.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
       from chiqim_pallet_consumption c
       join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
       join chiqim_requests cr2 on cr2.id = cl2.request_id
       left join lateral (
         select cgw3.completed_at from gate_weighings cgw3
         where cgw3.dir = 'chiqim'::direction and cgw3.request_id = cr2.id
         order by cgw3.completed_at desc nulls last limit 1
       ) cgwx on true
       where c.barcode2 = fp.barcode2
     ) consumed on true
     left join lateral (
       select cl3.request_id
       from chiqim_pallet_consumption c3
       join chiqim_lines cl3 on cl3.id = c3.chiqim_line_id
       where c3.barcode2 = fp.barcode2
       order by c3.created_at desc limit 1
     ) latest on true
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial
         limit 1) wc on true
     left join lateral ( select lr2.verdict,
            lr2.moisture_pct,
            lr2.so2_mg_kg
           from lab_results lr2
          where lr2.scope = 'chiqim'::direction and lr2.wash_cycle_id = wc.id
          order by lr2.created_at desc
         limit 1) lr on true
  where ko.plate !~~ 'TEST-%'::text;

-- ============================================================
-- 5. report_moyka_send_rows: already joins kirim_lines kl -- append
--    kl.partiya_no as the LAST column.
-- ============================================================
create or replace view public.report_moyka_send_rows as
 select 'moyka_send'::text as kind,
    ms.id::text as row_key,
    ms.serial,
    null::text as barcode2,
    kl.order_id,
    null::uuid as request_id,
    ko.owner_id,
    kl.type_id,
    null::uuid as calibre_id,
    null::text as plate,
    null::text as driver,
    ms.sent_date as date_basis,
    'sent_date'::text as date_basis_source,
    ms.qty_kg,
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
    kl.partiya_no
   from moyka_sends ms
     join kirim_lines kl on kl.serial = ms.serial
     join kirim_orders ko on ko.order_id = kl.order_id
  where ko.plate !~~ 'TEST-%'::text;

-- ============================================================
-- 6. report_raw_dispatch_rows: already joins kirim_lines kl -- append
--    kl.partiya_no as the LAST column.
-- ============================================================
create or replace view public.report_raw_dispatch_rows as
 select 'chiqim_raw'::text as kind,
    rdl.id::text as row_key,
    rdl.serial,
    null::text as barcode2,
    kl.order_id,
    cl.request_id,
    ko.owner_id,
    cl.type_id,
    null::uuid as calibre_id,
    coalesce(cr.plate, ''::text) as plate,
    coalesce(cr.driver, ''::text) as driver,
    cr.request_date as date_basis,
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
  where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 7. report_old_kn_rows: no serial at all -- null::int, appended as the
--    LAST column for shape consistency with the other five kinds in the
--    union below.
-- ============================================================
create or replace view public.report_old_kn_rows as
 select 'chiqim_old_kn'::text as kind,
    okc.id::text as row_key,
    null::text as serial,
    null::text as barcode2,
    null::uuid as order_id,
    cl.request_id,
    okp.owner_id,
    okp.type_id,
    null::uuid as calibre_id,
    coalesce(cr.plate, ''::text) as plate,
    coalesce(cr.driver, ''::text) as driver,
    cr.request_date as date_basis,
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
    null::int as partiya_no
   from old_kn_collections okc
     join old_kn_pools okp on okp.id = okc.pool_id
     join chiqim_lines cl on cl.id = okc.chiqim_line_id
     join chiqim_requests cr on cr.id = cl.request_id
  where coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 8. report_rows_v2: the union view every Hisobot query ultimately reads
--    (report_filtered_rows returns SETOF report_rows_v2, so it inherits
--    the new column automatically once this view has it -- no separate
--    edit needed there). Each of the six branches now exposes
--    partiya_no as its own LAST column (see views 1, 3-7 above), so this
--    view's own outer select also appends partiya_no last, per branch.
-- ============================================================
create or replace view public.report_rows_v2 as
 SELECT report_kirim_rows.kind,
    report_kirim_rows.row_key,
    report_kirim_rows.serial,
    report_kirim_rows.barcode2,
    report_kirim_rows.order_id,
    report_kirim_rows.request_id,
    report_kirim_rows.owner_id,
    report_kirim_rows.type_id,
    report_kirim_rows.calibre_id,
    report_kirim_rows.plate,
    report_kirim_rows.driver,
    report_kirim_rows.date_basis,
    report_kirim_rows.date_basis_source,
    report_kirim_rows.qty_kg,
    report_kirim_rows.provisional,
    report_kirim_rows.declared_qty,
    report_kirim_rows.truck_variance_diff_kg,
    report_kirim_rows.truck_variance_diff_pct,
    report_kirim_rows.provisional_variance_flag,
    report_kirim_rows.wash_cycle,
    report_kirim_rows.pallet_status,
    report_kirim_rows.lab_verdict,
    report_kirim_rows.target_moisture_pct,
    report_kirim_rows.target_so2_mg_kg,
    report_kirim_rows.moisture_pct,
    report_kirim_rows.so2_mg_kg,
    report_kirim_rows.void_successor_barcodes,
    report_kirim_rows.box_mass_kg,
    report_kirim_rows.partiya_no
   FROM report_kirim_rows
  WHERE report_kirim_rows.origin = 'delivery'::text
UNION ALL
 SELECT report_chiqim_rows.kind,
    report_chiqim_rows.row_key,
    report_chiqim_rows.serial,
    report_chiqim_rows.barcode2,
    report_chiqim_rows.order_id,
    report_chiqim_rows.request_id,
    report_chiqim_rows.owner_id,
    report_chiqim_rows.type_id,
    report_chiqim_rows.calibre_id,
    report_chiqim_rows.plate,
    report_chiqim_rows.driver,
    report_chiqim_rows.date_basis,
    report_chiqim_rows.date_basis_source,
    report_chiqim_rows.qty_kg,
    report_chiqim_rows.provisional,
    report_chiqim_rows.declared_qty,
    report_chiqim_rows.truck_variance_diff_kg,
    report_chiqim_rows.truck_variance_diff_pct,
    report_chiqim_rows.provisional_variance_flag,
    report_chiqim_rows.wash_cycle,
    report_chiqim_rows.pallet_status,
    report_chiqim_rows.lab_verdict,
    report_chiqim_rows.target_moisture_pct,
    report_chiqim_rows.target_so2_mg_kg,
    report_chiqim_rows.moisture_pct,
    report_chiqim_rows.so2_mg_kg,
    report_chiqim_rows.void_successor_barcodes,
    report_chiqim_rows.box_mass_kg,
    report_chiqim_rows.partiya_no
   FROM report_chiqim_rows
UNION ALL
 SELECT report_raw_dispatch_rows.kind,
    report_raw_dispatch_rows.row_key,
    report_raw_dispatch_rows.serial,
    report_raw_dispatch_rows.barcode2,
    report_raw_dispatch_rows.order_id,
    report_raw_dispatch_rows.request_id,
    report_raw_dispatch_rows.owner_id,
    report_raw_dispatch_rows.type_id,
    report_raw_dispatch_rows.calibre_id,
    report_raw_dispatch_rows.plate,
    report_raw_dispatch_rows.driver,
    report_raw_dispatch_rows.date_basis,
    report_raw_dispatch_rows.date_basis_source,
    report_raw_dispatch_rows.qty_kg,
    report_raw_dispatch_rows.provisional,
    report_raw_dispatch_rows.declared_qty,
    report_raw_dispatch_rows.truck_variance_diff_kg,
    report_raw_dispatch_rows.truck_variance_diff_pct,
    report_raw_dispatch_rows.provisional_variance_flag,
    report_raw_dispatch_rows.wash_cycle,
    report_raw_dispatch_rows.pallet_status,
    report_raw_dispatch_rows.lab_verdict,
    report_raw_dispatch_rows.target_moisture_pct,
    report_raw_dispatch_rows.target_so2_mg_kg,
    report_raw_dispatch_rows.moisture_pct,
    report_raw_dispatch_rows.so2_mg_kg,
    report_raw_dispatch_rows.void_successor_barcodes,
    report_raw_dispatch_rows.box_mass_kg,
    report_raw_dispatch_rows.partiya_no
   FROM report_raw_dispatch_rows
UNION ALL
 SELECT report_old_kn_rows.kind,
    report_old_kn_rows.row_key,
    report_old_kn_rows.serial,
    report_old_kn_rows.barcode2,
    report_old_kn_rows.order_id,
    report_old_kn_rows.request_id,
    report_old_kn_rows.owner_id,
    report_old_kn_rows.type_id,
    report_old_kn_rows.calibre_id,
    report_old_kn_rows.plate,
    report_old_kn_rows.driver,
    report_old_kn_rows.date_basis,
    report_old_kn_rows.date_basis_source,
    report_old_kn_rows.qty_kg,
    report_old_kn_rows.provisional,
    report_old_kn_rows.declared_qty,
    report_old_kn_rows.truck_variance_diff_kg,
    report_old_kn_rows.truck_variance_diff_pct,
    report_old_kn_rows.provisional_variance_flag,
    report_old_kn_rows.wash_cycle,
    report_old_kn_rows.pallet_status,
    report_old_kn_rows.lab_verdict,
    report_old_kn_rows.target_moisture_pct,
    report_old_kn_rows.target_so2_mg_kg,
    report_old_kn_rows.moisture_pct,
    report_old_kn_rows.so2_mg_kg,
    report_old_kn_rows.void_successor_barcodes,
    report_old_kn_rows.box_mass_kg,
    report_old_kn_rows.partiya_no
   FROM report_old_kn_rows
UNION ALL
 SELECT report_moyka_send_rows.kind,
    report_moyka_send_rows.row_key,
    report_moyka_send_rows.serial,
    report_moyka_send_rows.barcode2,
    report_moyka_send_rows.order_id,
    report_moyka_send_rows.request_id,
    report_moyka_send_rows.owner_id,
    report_moyka_send_rows.type_id,
    report_moyka_send_rows.calibre_id,
    report_moyka_send_rows.plate,
    report_moyka_send_rows.driver,
    report_moyka_send_rows.date_basis,
    report_moyka_send_rows.date_basis_source,
    report_moyka_send_rows.qty_kg,
    report_moyka_send_rows.provisional,
    report_moyka_send_rows.declared_qty,
    report_moyka_send_rows.truck_variance_diff_kg,
    report_moyka_send_rows.truck_variance_diff_pct,
    report_moyka_send_rows.provisional_variance_flag,
    report_moyka_send_rows.wash_cycle,
    report_moyka_send_rows.pallet_status,
    report_moyka_send_rows.lab_verdict,
    report_moyka_send_rows.target_moisture_pct,
    report_moyka_send_rows.target_so2_mg_kg,
    report_moyka_send_rows.moisture_pct,
    report_moyka_send_rows.so2_mg_kg,
    report_moyka_send_rows.void_successor_barcodes,
    report_moyka_send_rows.box_mass_kg,
    report_moyka_send_rows.partiya_no
   FROM report_moyka_send_rows
UNION ALL
 SELECT report_moyka_output_rows.kind,
    report_moyka_output_rows.row_key,
    report_moyka_output_rows.serial,
    report_moyka_output_rows.barcode2,
    report_moyka_output_rows.order_id,
    report_moyka_output_rows.request_id,
    report_moyka_output_rows.owner_id,
    report_moyka_output_rows.type_id,
    report_moyka_output_rows.calibre_id,
    report_moyka_output_rows.plate,
    report_moyka_output_rows.driver,
    report_moyka_output_rows.date_basis,
    report_moyka_output_rows.date_basis_source,
    report_moyka_output_rows.qty_kg,
    report_moyka_output_rows.provisional,
    report_moyka_output_rows.declared_qty,
    report_moyka_output_rows.truck_variance_diff_kg,
    report_moyka_output_rows.truck_variance_diff_pct,
    report_moyka_output_rows.provisional_variance_flag,
    report_moyka_output_rows.wash_cycle,
    report_moyka_output_rows.pallet_status,
    report_moyka_output_rows.lab_verdict,
    report_moyka_output_rows.target_moisture_pct,
    report_moyka_output_rows.target_so2_mg_kg,
    report_moyka_output_rows.moisture_pct,
    report_moyka_output_rows.so2_mg_kg,
    report_moyka_output_rows.void_successor_barcodes,
    report_moyka_output_rows.box_mass_kg,
    report_moyka_output_rows.partiya_no
   FROM report_moyka_output_rows;

-- ============================================================
-- 9. report_query_page: FUNCTION using RETURNS TABLE -- DROP + CREATE
--    (see header). Body is `select f.*, s.qabul_qilingan, ...` where f.*
--    is report_filtered_rows(...) i.e. report_rows_v2's own column order
--    (now ending ...box_mass_kg, partiya_no), so the RETURNS TABLE list
--    places partiya_no right after box_mass_kg -- immediately before the
--    kirim_line_state() columns that get appended by the join -- to stay
--    positionally aligned with what the body actually produces.
-- ============================================================
drop function if exists public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer);

create function public.report_query_page(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 returns TABLE(kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric)
 language sql
 stable
as $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, s.moykaga_yuborilgan, s.moykada, s.moykadan_chiqgan, s.xom_jonatilgan, s.olib_ketilgan
  from (
    select * from report_filtered_rows(p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id, p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status)
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null;
$function$;

-- ============================================================
-- 10. stock_on_hand_rows: partiya_no threaded through pallet_base ->
--     lab_bucketed -> pallet_rows (both branches), report_kirim_rows'
--     own new column reused via its `r` alias for raw_rows, null::int for
--     old_kn_rows (no serial) -- all fine at any position inside the CTEs.
--     The exposed 3-way UNION ALL at the end appends partiya_no as the
--     LAST column (after weight_is_estimate, previously last).
-- ============================================================
create or replace view public.stock_on_hand_rows as
 WITH pallet_base AS (
         SELECT fp.barcode2,
            fp.serial,
            ko.owner_id,
            fp.type_id,
            kl.partiya_no,
            fp.calibre_id,
            fp.received_date,
            fp.is_old_stock,
            fp.weight_is_estimate,
            lr.verdict,
            lr.moisture_pct AS lab_moisture_pct,
            wc.id AS wash_cycle_id
           FROM finished_pallets fp
             JOIN kirim_lines kl ON kl.serial = fp.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             LEFT JOIN LATERAL ( SELECT wc2.id
                   FROM wash_cycles wc2
                  WHERE wc2.serial = fp.serial
                 LIMIT 1) wc ON true
             LEFT JOIN LATERAL ( SELECT lr3.verdict,
                    lr3.moisture_pct
                   FROM lab_results lr3
                  WHERE lr3.scope = 'chiqim'::direction AND lr3.wash_cycle_id = wc.id
                  ORDER BY lr3.created_at DESC
                 LIMIT 1) lr ON true
          WHERE fp.status = 'in_stock'::pallet_status AND ko.plate !~~ 'TEST-%'::text
        ), lab_bucketed AS (
         SELECT
                CASE
                    WHEN pallet_base.verdict = 'qayta_yuvish'::text THEN 'qayta_yuvish'::text
                    WHEN pallet_base.verdict IS NULL THEN 'awaiting_lab'::text
                    ELSE NULL::text
                END AS forced_bucket,
            pallet_base.barcode2,
            pallet_base.serial,
            pallet_base.owner_id,
            pallet_base.type_id,
            pallet_base.partiya_no,
            pallet_base.calibre_id,
            pallet_base.received_date,
            pallet_base.is_old_stock,
            pallet_base.weight_is_estimate,
            pallet_base.lab_moisture_pct
           FROM pallet_base
        ), consumed_by_pallet AS (
         SELECT c.barcode2,
            sum(c.qty_kg) FILTER (WHERE cgw.completed_at IS NOT NULL) AS departed_kg,
            sum(c.qty_kg) FILTER (WHERE cgw.completed_at IS NULL) AS pending_kg
           FROM chiqim_pallet_consumption c
             JOIN chiqim_lines cl ON cl.id = c.chiqim_line_id
             JOIN chiqim_requests cr ON cr.id = cl.request_id
             LEFT JOIN LATERAL ( SELECT cgw2.completed_at
                   FROM gate_weighings cgw2
                  WHERE cgw2.dir = 'chiqim'::direction AND cgw2.request_id = cr.id
                  ORDER BY cgw2.completed_at DESC NULLS LAST
                 LIMIT 1) cgw ON true
          WHERE cr.plate !~~ 'TEST-%'::text
          GROUP BY c.barcode2
        ), pallet_qty AS (
         SELECT fp.barcode2,
            fp.weight_kg,
            COALESCE(cbp.departed_kg, 0::numeric) AS departed_kg,
            COALESCE(cbp.pending_kg, 0::numeric) AS pending_kg
           FROM finished_pallets fp
             LEFT JOIN consumed_by_pallet cbp ON cbp.barcode2 = fp.barcode2
        ), pallet_rows AS (
         SELECT COALESCE(lb.forced_bucket, 'available'::text) AS bucket,
            lb.barcode2 AS row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            GREATEST(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg) AS qty_kg,
            lb.received_date AS anchor_date,
            lb.lab_moisture_pct AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no
           FROM lab_bucketed lb
             JOIN pallet_qty pq ON pq.barcode2 = lb.barcode2
          WHERE GREATEST(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg) > 0::numeric OR lb.forced_bucket IS NOT NULL
        UNION ALL
         SELECT 'band_qilingan'::text AS bucket,
            lb.barcode2 || ':band'::text AS row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            pq.pending_kg AS qty_kg,
            lb.received_date AS anchor_date,
            lb.lab_moisture_pct AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no
           FROM lab_bucketed lb
             JOIN pallet_qty pq ON pq.barcode2 = lb.barcode2
          WHERE lb.forced_bucket IS NULL AND pq.pending_kg > 0::numeric
        ), raw_rows AS (
         SELECT 'raw_not_washed'::text AS bucket,
            r.row_key,
            r.serial,
            NULL::text AS barcode2,
            r.owner_id,
            r.type_id,
            NULL::uuid AS calibre_id,
            r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric) AS qty_kg,
            r.date_basis AS anchor_date,
            kirim_lr.moisture_pct,
            r.box_mass_kg,
            r.origin = 'opening_stock'::text AS is_old_stock,
            false AS weight_is_estimate,
            r.partiya_no
           FROM report_kirim_rows r
             JOIN storage_intake si ON si.serial = r.serial
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(ms.qty_kg), 0::numeric) AS total_sent
                   FROM moyka_sends ms
                  WHERE ms.serial = r.serial) sent ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rs.qty_kg), 0::numeric) AS total_rezka_sent
                   FROM rezka_sends rs
                  WHERE rs.serial = r.serial) rezka ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rdl.net_kg), 0::numeric) AS total_raw
                   FROM raw_dispatch_lines rdl
                  WHERE rdl.serial = r.serial) raw ON true
             LEFT JOIN LATERAL ( SELECT lr4.moisture_pct
                   FROM lab_results lr4
                  WHERE lr4.scope = 'kirim'::direction AND lr4.parent_serial = r.serial
                  ORDER BY lr4.created_at DESC
                 LIMIT 1) kirim_lr ON true
          WHERE (r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric)) > 0::numeric AND NOT (EXISTS ( SELECT 1
                   FROM old_stock_closeouts osc
                  WHERE osc.kind = 'old_raw'::text AND osc.owner_id = r.owner_id AND osc.type_id = r.type_id))
        ), old_kn_rows AS (
         SELECT 'old_kn'::text AS bucket,
            p.id::text AS row_key,
            NULL::text AS serial,
            NULL::text AS barcode2,
            p.owner_id,
            p.type_id,
            NULL::uuid AS calibre_id,
            p.opening_kg - COALESCE(c.collected, 0::numeric) - COALESCE(m.minted, 0::numeric) AS qty_kg,
            NULL::date AS anchor_date,
            NULL::numeric AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            true AS is_old_stock,
            NULL::boolean AS weight_is_estimate,
            NULL::int AS partiya_no
           FROM old_kn_pools p
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(oc.collected_kg), 0::numeric) AS collected
                   FROM old_kn_collections oc
                  WHERE oc.pool_id = p.id) c ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(sms.weight_kg), 0::numeric) AS minted
                   FROM serial_mint_sources sms
                  WHERE sms.source_kind = 'weight_pool'::text AND sms.source_pool_id = p.id) m ON true
          WHERE (p.opening_kg - COALESCE(c.collected, 0::numeric) - COALESCE(m.minted, 0::numeric)) > 0::numeric AND p.closed_at IS NULL
        )
 SELECT pallet_rows.bucket,
    pallet_rows.row_key,
    pallet_rows.serial,
    pallet_rows.barcode2,
    pallet_rows.owner_id,
    pallet_rows.type_id,
    pallet_rows.calibre_id,
    pallet_rows.qty_kg,
    pallet_rows.anchor_date,
    CURRENT_DATE - pallet_rows.anchor_date AS days_held,
    (CURRENT_DATE - pallet_rows.anchor_date) > 90 AS aged_90,
    pallet_rows.moisture_pct,
    pallet_rows.box_mass_kg,
    pallet_rows.is_old_stock,
    pallet_rows.weight_is_estimate,
    pallet_rows.partiya_no
   FROM pallet_rows
UNION ALL
 SELECT raw_rows.bucket,
    raw_rows.row_key,
    raw_rows.serial,
    raw_rows.barcode2,
    raw_rows.owner_id,
    raw_rows.type_id,
    raw_rows.calibre_id,
    raw_rows.qty_kg,
    raw_rows.anchor_date,
    CURRENT_DATE - raw_rows.anchor_date AS days_held,
    (CURRENT_DATE - raw_rows.anchor_date) > 90 AS aged_90,
    raw_rows.moisture_pct,
    raw_rows.box_mass_kg,
    raw_rows.is_old_stock,
    raw_rows.weight_is_estimate,
    raw_rows.partiya_no
   FROM raw_rows
UNION ALL
 SELECT old_kn_rows.bucket,
    old_kn_rows.row_key,
    old_kn_rows.serial,
    old_kn_rows.barcode2,
    old_kn_rows.owner_id,
    old_kn_rows.type_id,
    old_kn_rows.calibre_id,
    old_kn_rows.qty_kg,
    old_kn_rows.anchor_date,
    NULL::integer AS days_held,
    false AS aged_90,
    old_kn_rows.moisture_pct,
    old_kn_rows.box_mass_kg,
    old_kn_rows.is_old_stock,
    old_kn_rows.weight_is_estimate,
    old_kn_rows.partiya_no
   FROM old_kn_rows;

-- ============================================================
-- 11. wip_rows: raw_not_sent/provisional_weight reuse report_kirim_rows'
--     own r.partiya_no; moyka_not_returned/awaiting_lab/so2_pending join
--     kirim_lines kl directly -- kl.partiya_no; chiqim_open has no
--     serial -- null::int. All fine at any position inside the CTEs;
--     the exposed 6-way UNION ALL appends partiya_no as the LAST column
--     (after threshold_days, previously last).
-- ============================================================
create or replace view public.wip_rows as
 WITH limits AS (
         SELECT ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'raw_idle_days'::text) AS raw_idle_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'moyka_idle_days'::text) AS moyka_idle_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'tahlil_kechikdi_days'::text) AS tahlil_kechikdi_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'sulfur_overdue_days'::text) AS sulfur_overdue_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'chiqim_idle_days'::text) AS chiqim_idle_days
        ), raw_not_sent AS (
         SELECT 'raw_not_sent'::text AS wip_kind,
            r.row_key,
            r.serial,
            NULL::uuid AS request_id,
            r.owner_id,
            r.type_id,
            CURRENT_DATE - (si.confirmed_at AT TIME ZONE 'utc'::text)::date AS days_waiting,
            l.raw_idle_days::integer AS threshold_days,
            r.partiya_no
           FROM report_kirim_rows r
             JOIN storage_intake si ON si.serial = r.serial
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(ms.qty_kg), 0::numeric) AS total_sent
                   FROM moyka_sends ms
                  WHERE ms.serial = r.serial) sent ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rs.qty_kg), 0::numeric) AS total_rezka_sent
                   FROM rezka_sends rs
                  WHERE rs.serial = r.serial) rezka ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rdl.net_kg), 0::numeric) AS total_raw
                   FROM raw_dispatch_lines rdl
                  WHERE rdl.serial = r.serial) raw ON true
             CROSS JOIN limits l
          WHERE (r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric)) > 0::numeric AND r.origin <> 'opening_stock'::text AND (CURRENT_DATE - (si.confirmed_at AT TIME ZONE 'utc'::text)::date)::numeric > l.raw_idle_days
        ), moyka_not_returned AS (
         SELECT 'moyka_not_returned'::text AS wip_kind,
            ms_first.serial AS row_key,
            ms_first.serial,
            NULL::uuid AS request_id,
            ko.owner_id,
            kl.type_id,
            CURRENT_DATE - ms_first.first_sent_date AS days_waiting,
            l.moyka_idle_days::integer AS threshold_days,
            kl.partiya_no
           FROM ( SELECT moyka_sends.serial,
                    min(moyka_sends.sent_date) AS first_sent_date
                   FROM moyka_sends
                  GROUP BY moyka_sends.serial) ms_first
             JOIN kirim_lines kl ON kl.serial = ms_first.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             CROSS JOIN LATERAL kirim_line_state(ms_first.serial) kls(qabul_qilingan, omborda_qoldi, moykaga_yuborilgan, moykada, moykadan_chiqgan, xom_jonatilgan, olib_ketilgan)
             CROSS JOIN limits l
          WHERE kls.moykada > 0::numeric AND ko.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - ms_first.first_sent_date)::numeric > l.moyka_idle_days
        ), awaiting_lab AS (
         SELECT 'awaiting_lab'::text AS wip_kind,
            wc.serial AS row_key,
            wc.serial,
            NULL::uuid AS request_id,
            ko.owner_id,
            kl.type_id,
            CURRENT_DATE - ms_first.sent_date AS days_waiting,
            l.tahlil_kechikdi_days::integer AS threshold_days,
            kl.partiya_no
           FROM wash_cycles wc
             JOIN kirim_lines kl ON kl.serial = wc.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             JOIN LATERAL ( SELECT min(ms2.sent_date) AS sent_date
                   FROM moyka_sends ms2
                  WHERE ms2.serial = wc.serial) ms_first ON true
             CROSS JOIN limits l
          WHERE NOT (EXISTS ( SELECT 1
                   FROM lab_results lr
                  WHERE lr.scope = 'chiqim'::direction AND lr.wash_cycle_id = wc.id)) AND ko.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - ms_first.sent_date)::numeric > l.tahlil_kechikdi_days
        ), so2_pending AS (
         SELECT 'so2_pending'::text AS wip_kind,
            wc.serial AS row_key,
            wc.serial,
            NULL::uuid AS request_id,
            ko.owner_id,
            kl.type_id,
            CURRENT_DATE - lr.sample_date AS days_waiting,
            l.sulfur_overdue_days::integer AS threshold_days,
            kl.partiya_no
           FROM wash_cycles wc
             JOIN kirim_lines kl ON kl.serial = wc.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             JOIN LATERAL ( SELECT lr2.sample_date,
                    lr2.status
                   FROM lab_results lr2
                  WHERE lr2.scope = 'chiqim'::direction AND lr2.wash_cycle_id = wc.id
                  ORDER BY lr2.created_at DESC
                 LIMIT 1) lr ON true
             CROSS JOIN limits l
          WHERE lr.status = 'moisture_in'::text AND kl.is_sulfured IS DISTINCT FROM false AND ko.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - lr.sample_date)::numeric > l.sulfur_overdue_days
        ), chiqim_open AS (
         SELECT 'chiqim_open'::text AS wip_kind,
            cr.id::text AS row_key,
            NULL::text AS serial,
            cr.id AS request_id,
            cr.owner_id,
            NULL::uuid AS type_id,
            CURRENT_DATE - (cr.created_at AT TIME ZONE 'utc'::text)::date AS days_waiting,
            l.chiqim_idle_days::integer AS threshold_days,
            NULL::int AS partiya_no
           FROM chiqim_requests cr
             LEFT JOIN LATERAL ( SELECT cgw_1.completed_at
                   FROM gate_weighings cgw_1
                  WHERE cgw_1.dir = 'chiqim'::direction AND cgw_1.request_id = cr.id
                  ORDER BY cgw_1.completed_at DESC NULLS LAST
                 LIMIT 1) cgw ON true
             CROSS JOIN limits l
          WHERE NOT (cr.ombor_finished_at IS NOT NULL AND cgw.completed_at IS NOT NULL) AND cr.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - (cr.created_at AT TIME ZONE 'utc'::text)::date)::numeric > l.chiqim_idle_days
        ), provisional_weight AS (
         SELECT 'provisional_weight'::text AS wip_kind,
            r.row_key,
            r.serial,
            NULL::uuid AS request_id,
            r.owner_id,
            r.type_id,
            NULL::integer AS days_waiting,
            NULL::integer AS threshold_days,
            r.partiya_no
           FROM report_kirim_rows r
          WHERE r.provisional
        )
 SELECT raw_not_sent.wip_kind,
    raw_not_sent.row_key,
    raw_not_sent.serial,
    raw_not_sent.request_id,
    raw_not_sent.owner_id,
    raw_not_sent.type_id,
    raw_not_sent.days_waiting,
    raw_not_sent.threshold_days,
    raw_not_sent.partiya_no
   FROM raw_not_sent
UNION ALL
 SELECT moyka_not_returned.wip_kind,
    moyka_not_returned.row_key,
    moyka_not_returned.serial,
    moyka_not_returned.request_id,
    moyka_not_returned.owner_id,
    moyka_not_returned.type_id,
    moyka_not_returned.days_waiting,
    moyka_not_returned.threshold_days,
    moyka_not_returned.partiya_no
   FROM moyka_not_returned
UNION ALL
 SELECT awaiting_lab.wip_kind,
    awaiting_lab.row_key,
    awaiting_lab.serial,
    awaiting_lab.request_id,
    awaiting_lab.owner_id,
    awaiting_lab.type_id,
    awaiting_lab.days_waiting,
    awaiting_lab.threshold_days,
    awaiting_lab.partiya_no
   FROM awaiting_lab
UNION ALL
 SELECT so2_pending.wip_kind,
    so2_pending.row_key,
    so2_pending.serial,
    so2_pending.request_id,
    so2_pending.owner_id,
    so2_pending.type_id,
    so2_pending.days_waiting,
    so2_pending.threshold_days,
    so2_pending.partiya_no
   FROM so2_pending
UNION ALL
 SELECT chiqim_open.wip_kind,
    chiqim_open.row_key,
    chiqim_open.serial,
    chiqim_open.request_id,
    chiqim_open.owner_id,
    chiqim_open.type_id,
    chiqim_open.days_waiting,
    chiqim_open.threshold_days,
    chiqim_open.partiya_no
   FROM chiqim_open
UNION ALL
 SELECT provisional_weight.wip_kind,
    provisional_weight.row_key,
    provisional_weight.serial,
    provisional_weight.request_id,
    provisional_weight.owner_id,
    provisional_weight.type_id,
    provisional_weight.days_waiting,
    provisional_weight.threshold_days,
    provisional_weight.partiya_no
   FROM provisional_weight;

-- ============================================================
-- 12. yield_rows: partiya_no added to serial_base (already joins
--     kirim_lines kl), re-selected into finished_serials (which reselects
--     named columns rather than serial_base.*) -- fine at any position
--     inside the CTEs. The exposed final select appends fs.partiya_no as
--     the LAST column (after calibre_mix, previously last).
-- ============================================================
create or replace view public.yield_rows as
 WITH serial_base AS (
         SELECT kl.serial,
            kl.type_id,
            kl.partiya_no,
            ko.owner_id,
            ko.plate,
            ko.driver,
            rkr.qty_kg AS effective_qty,
            ( SELECT COALESCE(sum(ms.qty_kg), 0::numeric) AS "coalesce"
                   FROM moyka_sends ms
                  WHERE ms.serial = kl.serial) AS raw_consumed_kg,
            wc.id AS wash_cycle_id,
            wc.status AS wash_cycle_status
           FROM kirim_lines kl
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             JOIN report_kirim_rows rkr ON rkr.serial = kl.serial
             LEFT JOIN wash_cycles wc ON wc.serial = kl.serial
          WHERE ko.plate !~~ 'TEST-%'::text AND ko.origin <> 'opening_stock'::text
        ), finished_serials AS (
         SELECT serial_base.serial,
            serial_base.type_id,
            serial_base.partiya_no,
            serial_base.owner_id,
            serial_base.plate,
            serial_base.driver,
            serial_base.effective_qty,
            serial_base.raw_consumed_kg,
            serial_base.wash_cycle_id,
            serial_base.wash_cycle_status
           FROM serial_base
          WHERE serial_base.raw_consumed_kg > 0::numeric
        ), output AS (
         SELECT fs_1.serial,
            COALESCE(sum(fp.weight_kg) FILTER (WHERE NOT c.is_numberless), 0::numeric) AS calibre_kg,
            COALESCE(sum(fp.weight_kg) FILTER (WHERE c.is_numberless), 0::numeric) AS konditirskiy_kg,
            min(fp.received_date) AS completed_date
           FROM finished_serials fs_1
             LEFT JOIN finished_pallets fp ON fp.serial = fs_1.serial
             LEFT JOIN calibres c ON c.id = fp.calibre_id
          GROUP BY fs_1.serial
        ), rewash_flag AS (
         SELECT fs_1.serial,
            (EXISTS ( SELECT 1
                   FROM lab_results lr
                  WHERE lr.wash_cycle_id = fs_1.wash_cycle_id AND lr.scope = 'chiqim'::direction AND lr.verdict = 'qayta_yuvish'::text)) AS rewashed
           FROM finished_serials fs_1
        ), calibre_breakdown AS (
         SELECT fs_1.serial,
            fp.calibre_id,
            sum(fp.weight_kg) AS kg
           FROM finished_serials fs_1
             JOIN finished_pallets fp ON fp.serial = fs_1.serial
          GROUP BY fs_1.serial, fp.calibre_id
        ), lab_readings AS (
         SELECT fs_1.serial,
            ( SELECT lr.moisture_pct
                   FROM lab_results lr
                  WHERE lr.scope = 'kirim'::direction AND lr.parent_serial = fs_1.serial
                  ORDER BY lr.created_at DESC
                 LIMIT 1) AS intake_moisture_pct,
            ( SELECT lr.moisture_pct
                   FROM lab_results lr
                  WHERE lr.scope = 'chiqim'::direction AND lr.wash_cycle_id = fs_1.wash_cycle_id
                  ORDER BY lr.created_at DESC
                 LIMIT 1) AS delivered_moisture_pct
           FROM finished_serials fs_1
        )
 SELECT fs.serial,
    fs.type_id,
    fs.owner_id,
    fs.plate,
    fs.driver,
    fs.effective_qty AS raw_received_kg,
    fs.raw_consumed_kg,
    fs.raw_consumed_kg - fs.effective_qty AS raw_overage_kg,
    o.completed_date,
    1 AS max_cycle_no,
    rf.rewashed,
    o.calibre_kg AS live_calibre_kg,
    o.konditirskiy_kg AS live_konditirskiy_kg,
    o.calibre_kg + o.konditirskiy_kg AS output_kg,
    fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg AS loss_kg,
        CASE
            WHEN fs.raw_consumed_kg > 0::numeric THEN round((fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1)
            ELSE 0::numeric
        END AS loss_pct,
        CASE
            WHEN fs.raw_consumed_kg > 0::numeric THEN round((o.calibre_kg + o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1)
            ELSE 0::numeric
        END AS gross_yield_pct,
    lab.intake_moisture_pct,
    lab.delivered_moisture_pct,
    lab.intake_moisture_pct IS NOT NULL AND lab.delivered_moisture_pct IS NOT NULL AS dry_matter_available,
        CASE
            WHEN lab.intake_moisture_pct IS NOT NULL THEN round(fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric), 1)
            ELSE NULL::numeric
        END AS dry_matter_in_kg,
        CASE
            WHEN lab.delivered_moisture_pct IS NOT NULL THEN round((o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric), 1)
            ELSE NULL::numeric
        END AS dry_matter_out_kg,
        CASE
            WHEN lab.intake_moisture_pct IS NOT NULL AND lab.delivered_moisture_pct IS NOT NULL AND (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) > 0::numeric THEN round((fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric) - (o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric)) / (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS true_loss_pct,
    ( SELECT COALESCE(jsonb_agg(jsonb_build_object('calibreId', cb.calibre_id, 'kg', cb.kg, 'pct',
                CASE
                    WHEN (o.calibre_kg + o.konditirskiy_kg) > 0::numeric THEN round(cb.kg / (o.calibre_kg + o.konditirskiy_kg) * 100::numeric, 1)
                    ELSE 0::numeric
                END) ORDER BY cb.kg DESC), '[]'::jsonb) AS "coalesce"
           FROM calibre_breakdown cb
          WHERE cb.serial = fs.serial) AS calibre_mix,
    fs.partiya_no
   FROM finished_serials fs
     JOIN output o ON o.serial = fs.serial
     JOIN rewash_flag rf ON rf.serial = fs.serial
     JOIN lab_readings lab ON lab.serial = fs.serial;

-- ============================================================
-- 13. get_serial_passport: JSONB-returning function -- unaffected by the
--     RETURNS TABLE restriction, CREATE OR REPLACE works fine. target_line
--     CTE adds kl.partiya_no; the 'order' sub-object gets 'partiyaNo'
--     alongside the other order-level fields it already builds from
--     target_line tl.
-- ============================================================
create or replace function public.get_serial_passport(p_serial text)
 returns jsonb
 language sql
 stable
as $function$
with target_line as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
  where kl.serial = p_serial
),
gate_kirim as (
  select gw.*
  from gate_weighings gw, target_line tl
  where gw.dir = 'kirim' and gw.order_id = tl.order_id
  order by gw.stage1_completed_at desc nulls last
  limit 1
),
intake_row as (
  select * from storage_intake where serial = p_serial
),
kirim_lab as (
  select * from lab_results where scope = 'kirim' and parent_serial = p_serial
  order by created_at desc limit 1
),
wc as (
  select * from wash_cycles where serial = p_serial
),
sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from moyka_sends where serial = p_serial
),
rezka_sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from rezka_sends where serial = p_serial
),
cycle_lab as (
  select lr.verdict, lr.moisture_pct, lr.so2_mg_kg, lr.sample_date, lr.sample_photo, lr.note, lr.tested_by
  from wc
  left join lateral (
    select * from lab_results lr2
    where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
    order by lr2.created_at desc
    limit 1
  ) lr on true
),
pallets as (
  select rcr.* from report_chiqim_rows rcr where rcr.serial = p_serial
),
dispatch_ids as (
  select distinct cl.request_id
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
dispatch_gate as (
  select
    di.request_id,
    gw.gruzheny_kg, gw.pustoy_kg, gw.net_kg,
    gw.stage1_completed_at, gw.stage1_created_by, gw.stage1_plate_photo, gw.stage1_scale_photo,
    gw.completed_at, gw.stage2_created_by, gw.stage2_scale_photo, gw.departure_doc_photo
  from dispatch_ids di
  left join lateral (
    select * from gate_weighings gw2
    where gw2.dir = 'chiqim' and gw2.request_id = di.request_id
    order by gw2.completed_at desc nulls last
    limit 1
  ) gw on true
),
dispatch_pallets as (
  select cl.request_id, c.barcode2, c.created_at as loaded_at, fp.calibre_id, c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
raw_dispatches as (
  select rdl.id, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, rdl.loaded_at,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where rdl.serial = p_serial
),
mint_pallet_sources as (
  select sms.source_barcode2, fp.weight_kg as book_weight_kg, fp.calibre_id, fp.serial as source_serial
  from serial_mint_sources sms
  join finished_pallets fp on fp.barcode2 = sms.source_barcode2
  where sms.minted_serial = p_serial and sms.source_kind = 'pallet'
),
mint_pool_sources as (
  select sms.source_pool_id, sms.weight_kg, p.type_id
  from serial_mint_sources sms
  join old_kn_pools p on p.id = sms.source_pool_id
  where sms.minted_serial = p_serial and sms.source_kind = 'weight_pool'
),
raw_received as (
  select rkr.qty_kg as received_kg
  from report_kirim_rows rkr where rkr.serial = p_serial
),
raw_dispatched_total as (
  select coalesce(sum(rdl.net_kg), 0) as kg from raw_dispatch_lines rdl where rdl.serial = p_serial
),
raw_closeout as (
  select osc.closed_at
  from target_line tl2
  join kirim_orders ko2 on ko2.order_id = tl2.order_id
  join old_stock_closeouts osc on osc.kind = 'old_raw' and osc.owner_id = ko2.owner_id and osc.type_id = tl2.type_id
),
raw_still as (
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where serial = p_serial and bucket = 'raw_not_washed'
),
raw_storage_loss as (
  select
    (select closed_at from raw_closeout) as closed_at,
    case when (select closed_at from raw_closeout) is not null
      then greatest(0, coalesce((select received_kg from raw_received), 0) - (select sent_kg from sends_total) - (select sent_kg from rezka_sends_total) - (select kg from raw_dispatched_total))
      else 0
    end as kg
),
finished_returned_total as (
  select coalesce(sum(weight_kg), 0) as kg from finished_pallets where serial = p_serial
),
finished_dispatched_total as (
  select coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and exists (
      select 1 from gate_weighings cgw3
      where cgw3.dir = 'chiqim' and cgw3.request_id = cr.id and cgw3.completed_at is not null
    )
),
finished_dispatched_by_calibre as (
  select cl.calibre_id, coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and exists (
      select 1 from gate_weighings cgw4
      where cgw4.dir = 'chiqim' and cgw4.request_id = cr.id and cgw4.completed_at is not null
    )
  group by cl.calibre_id
),
finished_storage_loss_pallets as (
  select fp.barcode2, fp.calibre_id, fp.weight_kg, fp.voided_at
  from finished_pallets fp
  where fp.serial = p_serial and fp.status = 'storage_loss'
),
finished_other_total as (
  select
    coalesce(sum(weight_kg) filter (where status = 'consumed'), 0) as consumed_kg,
    coalesce(sum(weight_kg) filter (where status = 'bekor_qilindi'), 0) as voided_kg
  from finished_pallets where serial = p_serial
),
finished_still as (
  select
    coalesce(sum(qty_kg), 0) as total_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'awaiting_lab'), 0) as awaiting_lab_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'qayta_yuvish'), 0) as needs_rewash_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
),
finished_still_by_calibre as (
  select calibre_id,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket in ('awaiting_lab', 'qayta_yuvish')), 0) as under_review_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
  group by calibre_id
),
storage_loss_events as (
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object('kind', 'old_washed', 'barcode2', slp.barcode2, 'calibreId', slp.calibre_id, 'weightKg', slp.weight_kg, 'voidedAt', slp.voided_at)
        order by slp.barcode2
      ) from finished_storage_loss_pallets slp
    ), '[]'::jsonb)
    ||
    case when (select closed_at from raw_storage_loss) is not null
      then jsonb_build_array(jsonb_build_object(
        'kind', 'old_raw', 'closedAt', (select closed_at from raw_storage_loss), 'weightKg', (select kg from raw_storage_loss),
        'note', 'Bu turdagi eski xom ashyo yakunlandi -- ko''rsatilgan miqdor shu seriyaning taxminiy ulushi'
      ))
      else '[]'::jsonb
    end as events
),
pending_raw as (
  select distinct cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from chiqim_line_raw_serials clrs
  join chiqim_lines cl on cl.id = clrs.line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where clrs.serial = p_serial
    and cr.voided_at is null
    and cr.ombor_finished_at is null
    and not exists (select 1 from raw_dispatch_lines rdl2 where rdl2.chiqim_line_id = clrs.line_id and rdl2.serial = p_serial)
),
pending_dispatches as (
  select
    (select coalesce(jsonb_agg(
      jsonb_build_object('kind', 'raw', 'requestId', pr.request_id, 'requestDate', pr.request_date, 'plate', pr.plate, 'driver', pr.driver)
      order by pr.request_date desc
    ), '[]'::jsonb) from pending_raw pr)
    as events
)
select jsonb_build_object(
  'serial', p_serial,
  'order', (
    select jsonb_build_object(
      'orderId', ko.order_id, 'ownerId', ko.owner_id, 'ownerName', o.name, 'plate', ko.plate, 'driver', ko.driver,
      'orderDate', ko.order_date, 'declaredQty', tl.declared_qty, 'declaredTotal', ko.declared_total,
      'isMultiLine', tl.line_count > 1, 'targetMoisturePct', tl.target_moisture_pct, 'targetSo2MgKg', tl.target_so2_mg_kg, 'typeId', tl.type_id,
      'partiyaNo', tl.partiya_no,
      'docPhoto', ko.doc_photo, 'isOldStock', ko.origin = 'opening_stock',
      'isMinted', ko.origin = 'internal_reprocess'
    )
    from target_line tl
    join kirim_orders ko on ko.order_id = tl.order_id
    left join owners o on o.id = ko.owner_id
  ),
  'effectiveQty', (
    select jsonb_build_object(
      'valueKg', rkr.qty_kg, 'provisional', rkr.provisional,
      'truckVarianceDiffKg', rkr.truck_variance_diff_kg, 'truckVarianceDiffPct', rkr.truck_variance_diff_pct
    )
    from report_kirim_rows rkr where rkr.serial = p_serial
  ),
  'gate', (
    select jsonb_build_object(
      'gruzhenyKg', gk.gruzheny_kg, 'pustoyKg', gk.pustoy_kg, 'netKg', gk.net_kg,
      'stage1CompletedAt', gk.stage1_completed_at, 'stage1CreatedByName', p1.full_name,
      'stage1PlatePhoto', gk.stage1_plate_photo, 'stage1ScalePhoto', gk.stage1_scale_photo,
      'stage2CompletedAt', gk.completed_at, 'stage2CreatedByName', p2.full_name,
      'stage2ScalePhoto', gk.stage2_scale_photo, 'departureDocPhoto', gk.departure_doc_photo
    )
    from gate_kirim gk
    left join profiles p1 on p1.id = gk.stage1_created_by
    left join profiles p2 on p2.id = gk.stage2_created_by
  ),
  'intake', (
    select jsonb_build_object(
      'actualQty', ir.actual_qty, 'confirmedAt', ir.confirmed_at, 'confirmedByName', p3.full_name,
      'barcode1', ir.barcode1, 'pilePhoto', ir.pile_photo, 'komment', ir.komment,
      'boxMassKg', ir.box_mass_kg
    )
    from intake_row ir
    left join profiles p3 on p3.id = ir.confirmed_by
  ),
  'kirimLab', (
    select jsonb_build_object(
      'sampleDate', kl.sample_date, 'moisturePct', kl.moisture_pct, 'so2MgKg', kl.so2_mg_kg,
      'testedByName', p4.full_name, 'samplePhoto', kl.sample_photo, 'note', kl.note
    )
    from kirim_lab kl
    left join profiles p4 on p4.id = kl.tested_by
  ),
  'cycles', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'cycleNo', 1,
        'inMoykaKg', greatest(0, st.sent_kg - (select kg from finished_returned_total)),
        'lossKg', st.sent_kg - (select kg from finished_returned_total),
        'sentKg', st.sent_kg,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'barcode2', pl.barcode2, 'calibreId', pl.calibre_id, 'weightKg', pl.qty_kg,
              'palletStatus', pl.pallet_status, 'voidSuccessorBarcodes', pl.void_successor_barcodes
            ) order by pl.barcode2
          ), '[]'::jsonb)
          from pallets pl
        ),
        'lab', (
          select jsonb_build_object(
            'verdict', cl.verdict, 'moisturePct', cl.moisture_pct, 'so2MgKg', cl.so2_mg_kg,
            'sampleDate', cl.sample_date, 'testedByName', p5.full_name, 'samplePhoto', cl.sample_photo, 'note', cl.note
          )
          from cycle_lab cl
          left join profiles p5 on p5.id = cl.tested_by
          where cl.verdict is not null
        )
      )
    ), '[]'::jsonb)
    from wc cross join sends_total st
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'status', cr.status, 'omborFinishedAt', cr.ombor_finished_at, 'omborFinishedByName', p6.full_name,
        'gate', jsonb_build_object(
          'gruzhenyKg', dg.gruzheny_kg, 'pustoyKg', dg.pustoy_kg, 'netKg', dg.net_kg,
          'stage1CompletedAt', dg.stage1_completed_at, 'stage1CreatedByName', p7.full_name,
          'stage1PlatePhoto', dg.stage1_plate_photo, 'stage1ScalePhoto', dg.stage1_scale_photo,
          'stage2CompletedAt', dg.completed_at, 'stage2CreatedByName', p8.full_name,
          'stage2ScalePhoto', dg.stage2_scale_photo, 'departureDocPhoto', dg.departure_doc_photo
        ),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', dp.barcode2, 'calibreId', dp.calibre_id, 'weightKg', dp.weight_kg, 'loadedAt', dp.loaded_at)
            order by dp.loaded_at
          ), '[]'::jsonb)
          from dispatch_pallets dp where dp.request_id = cr.id
        )
      ) order by cr.request_date desc
    ), '[]'::jsonb)
    from dispatch_ids di
    join chiqim_requests cr on cr.id = di.request_id
    left join dispatch_gate dg on dg.request_id = di.request_id
    left join profiles p6 on p6.id = cr.ombor_finished_by
    left join profiles p7 on p7.id = dg.stage1_created_by
    left join profiles p8 on p8.id = dg.stage2_created_by
  ),
  'dispatchedByCalibre', (
    select coalesce(jsonb_agg(
      jsonb_build_object('calibreId', fdbc.calibre_id, 'kg', fdbc.kg)
      order by fdbc.calibre_id
    ), '[]'::jsonb)
    from finished_dispatched_by_calibre fdbc
  ),
  'rawDispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', rd.request_id, 'requestDate', rd.request_date, 'plate', rd.plate, 'driver', rd.driver,
        'weightKg', rd.weight_kg, 'boxMassKg', rd.box_mass_kg, 'netKg', rd.net_kg, 'loadedAt', rd.loaded_at
      ) order by rd.loaded_at desc
    ), '[]'::jsonb)
    from raw_dispatches rd
  ),
  'mintOrigin', (
    select case when (select count(*) from serial_mint_sources where minted_serial = p_serial) = 0
      then null
      else jsonb_build_object(
        'palletCount',  (select count(*) from mint_pallet_sources),
        'bookTotalKg',  (select coalesce(sum(book_weight_kg), 0) from mint_pallet_sources),
        'poolDrawKg',   (select coalesce(sum(weight_kg), 0) from mint_pool_sources),
        'sentWeighedKg',(select sent_kg from sends_total) + (select sent_kg from rezka_sends_total),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', mps.source_barcode2, 'bookWeightKg', mps.book_weight_kg,
                               'calibreId', mps.calibre_id, 'sourceSerial', mps.source_serial)
            order by mps.source_barcode2
          ), '[]'::jsonb) from mint_pallet_sources mps
        )
      )
    end
  ),
  'notes', (
    select coalesce(jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at, 'authorName', pr.full_name)
      order by n.created_at
    ), '[]'::jsonb)
    from notes n
    left join profiles pr on pr.id = n.author
    where n.entity_type = 'moyka' and n.entity_id = p_serial
  ),
  'joriyHolat', jsonb_build_object(
    'raw', jsonb_build_object(
      'receivedKg', coalesce((select received_kg from raw_received), 0),
      'sentToMoykaKg', (select sent_kg from sends_total),
      'collectedRawKg', (select kg from raw_dispatched_total),
      'storageLossKg', (select kg from raw_storage_loss),
      'storageLossClosedAt', (select closed_at from raw_storage_loss),
      'stillInStorageKg', (select kg from raw_still)
    ),
    'finished', jsonb_build_object(
      'returnedKg', (select kg from finished_returned_total),
      'dispatchedKg', (select kg from finished_dispatched_total),
      'storageLossKg', (select coalesce(sum(weight_kg), 0) from finished_storage_loss_pallets),
      'consumedKg', (select consumed_kg from finished_other_total),
      'voidedKg', (select voided_kg from finished_other_total),
      'stillInStorageKg', (select total_kg from finished_still),
      'stillInStorageBreakdown', jsonb_build_object(
        'availableKg', (select available_kg from finished_still),
        'reservedKg', (select reserved_kg from finished_still),
        'awaitingLabKg', (select awaiting_lab_kg from finished_still),
        'needsRewashKg', (select needs_rewash_kg from finished_still)
      ),
      'byCalibre', (
        select coalesce(jsonb_agg(
          jsonb_build_object('calibreId', fsc.calibre_id, 'availableKg', fsc.available_kg, 'reservedKg', fsc.reserved_kg, 'underReviewKg', fsc.under_review_kg)
          order by fsc.calibre_id
        ), '[]'::jsonb)
        from finished_still_by_calibre fsc
      )
    )
  ),
  'storageLossEvents', (select events from storage_loss_events),
  'pendingDispatches', (select events from pending_dispatches)
);
$function$;

-- ============================================================
-- 14. get_client_report: JSONB-returning function -- unaffected by the
--     RETURNS TABLE restriction. client_lines CTE adds kl.partiya_no;
--     quality_record CTE (already selects named columns from client_lines
--     cl, not cl.*) adds cl.partiya_no; the qualityRecord jsonb_agg gets
--     'partiyaNo' alongside its other per-arrival fields.
-- ============================================================
create or replace function public.get_client_report(p_owner_id uuid, p_from date, p_to date)
 returns jsonb
 language sql
 stable
as $function$
with
client_lines as (
  select
    kl.serial, kl.type_id, kl.partiya_no, ko.plate, ko.driver, kl.target_moisture_pct, kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date, rkr.provisional, rkr.origin,
    (si.serial is not null) as has_intake,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_actual_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date between p_from and p_to) as sent_during_period_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date < p_from) as rezka_sent_before_from_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date <= p_to) as rezka_sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
    wc.id as wash_cycle_id,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date < p_from
    ) as closed_before_from,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date <= p_to
    ) as closed_as_of_to
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  left join storage_intake si
    on si.serial = kl.serial
   and si.confirmed_at is not null
   and (si.confirmed_at at time zone 'utc')::date <= p_to
  where ko.owner_id = p_owner_id
),
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake and not closed_before_from
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to and origin = 'delivery'
),
raw_sent_to_moyka_period_total as (
  select coalesce(sum(sent_during_period_kg), 0) as kg from client_lines
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
moykada_total as (
  select coalesce(sum(greatest(0, sent_as_of_to_kg - output_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
raw_processed_total as (
  select coalesce(sum(sent_capped_kg), 0) as kg from client_lines where completed_date between p_from and p_to
),
raw_processed_actual_total as (
  select coalesce(sum(sent_actual_kg), 0) as kg from client_lines where completed_date between p_from and p_to
),
capped_serials as (
  select serial, sent_actual_kg as actual_sent_kg, effective_qty as effective_qty_kg, sent_actual_kg - sent_capped_kg as overage_kg
  from client_lines
  where completed_date between p_from and p_to and sent_actual_kg > sent_capped_kg
),
raw_types as (select distinct type_id from client_lines),
raw_opening_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake and not closed_before_from group by type_id
),
raw_received_by_type as (
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date between p_from and p_to and origin = 'delivery' group by type_id
),
raw_sent_to_moyka_by_type as (
  select type_id, coalesce(sum(sent_during_period_kg), 0) as kg from client_lines group by type_id
),
raw_closing_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to group by type_id
),
moykada_by_type as (
  select type_id, coalesce(sum(greatest(0, sent_as_of_to_kg - output_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake group by type_id
),
raw_processed_by_type as (
  select type_id, coalesce(sum(sent_capped_kg), 0) as kg from client_lines
  where completed_date between p_from and p_to group by type_id
),
raw_dispatch_events as (
  select rdl.id, rdl.serial, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, cl.type_id,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where cr.owner_id = p_owner_id
),
raw_dispatch_total as (
  select coalesce(sum(net_kg), 0) as kg from raw_dispatch_events where request_date between p_from and p_to
),
raw_dispatch_by_type as (
  select type_id, coalesce(sum(net_kg), 0) as kg from raw_dispatch_events
  where request_date between p_from and p_to group by type_id
),
old_kn_events as (
  select okc.id, okc.collected_kg, cl.type_id,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from old_kn_collections okc
  join old_kn_pools okp on okp.id = okc.pool_id
  join chiqim_lines cl on cl.id = okc.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where okp.owner_id = p_owner_id
),
old_kn_collected_total as (
  select coalesce(sum(collected_kg), 0) as kg from old_kn_events where request_date between p_from and p_to
),
storage_loss_events as (
  select osc.kind, osc.type_id, osc.book_remaining_kg, osc.closed_at
  from old_stock_closeouts osc
  where osc.owner_id = p_owner_id
),
storage_loss_total as (
  select coalesce(sum(book_remaining_kg), 0) as kg from storage_loss_events
  where (closed_at at time zone 'utc')::date between p_from and p_to
),
cumulative_storage_loss_total as (
  select coalesce(sum(book_remaining_kg), 0) as kg from old_stock_closeouts
  where kind = 'old_raw' and owner_id = p_owner_id and (closed_at at time zone 'utc')::date <= p_to
),
loss_totals as (
  select cl.serial, cl.sent_actual_kg
  from client_lines cl
  where cl.completed_date between p_from and p_to
    and cl.origin != 'opening_stock'
),
loss_output as (
  select
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg
  from loss_totals lt
  join finished_pallets fp on fp.serial = lt.serial
  join calibres c on c.id = fp.calibre_id
  where fp.received_date <= p_to
),
loss_main as (
  select
    (select coalesce(sum(sent_actual_kg), 0) from loss_totals) as sent_kg,
    (select coalesce(calibre_kg, 0) from loss_output) as calibre_kg,
    (select coalesce(konditirskiy_kg, 0) from loss_output) as konditirskiy_kg
),
cumulative_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_output_total as (
  select coalesce(sum(output_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_loss_total as (
  select coalesce(sum(sent_as_of_to_kg - output_as_of_to_kg), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
cumulative_raw_dispatched_total as (
  select coalesce(sum(dispatched_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
client_pallet_base as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg, fp.received_date, ko.origin
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where ko.owner_id = p_owner_id
    and fp.received_date <= p_to
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2
        and (sms.created_at at time zone 'utc')::date <= p_to
    )
    and not (
      fp.status = 'bekor_qilindi'
      and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to)
    )
    and not (
      fp.status = 'storage_loss'
      and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to)
    )
),
client_pallet_departures as (
  -- One row per consumption portion whose OWN request's gate has completed
  -- by p_to -- a claimed-but-not-yet-gate-completed portion stays invisible
  -- here, matching the old dispatch_manifest-membership-alone-does-nothing
  -- behavior exactly.
  select
    c.barcode2,
    (cgw.completed_at at time zone 'utc')::date as departure_date,
    c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join client_pallet_base cpb on cpb.barcode2 = c.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  where cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
),
client_pallet_departed_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from client_pallet_departures
  group by barcode2
),
client_pallets as (
  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    greatest(0, cpb.weight_kg - coalesce(cpdt.kg, 0)) as weight_kg,
    cpb.received_date, cpb.origin,
    null::date as departure_date
  from client_pallet_base cpb
  left join client_pallet_departed_total cpdt on cpdt.barcode2 = cpb.barcode2

  union all

  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    cpd.weight_kg,
    cpb.received_date, cpb.origin,
    cpd.departure_date
  from client_pallet_departures cpd
  join client_pallet_base cpb on cpb.barcode2 = cpd.barcode2
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where (received_date < p_from or origin = 'opening_stock')
    and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where received_date between p_from and p_to and origin != 'opening_stock'
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets where departure_date between p_from and p_to
),
finished_calibres as (select distinct calibre_id from client_pallets),
finished_opening_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where (received_date < p_from or origin = 'opening_stock')
    and (departure_date is null or departure_date >= p_from) group by calibre_id
),
finished_produced_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where received_date between p_from and p_to and origin != 'opening_stock' group by calibre_id
),
finished_dispatched_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets where departure_date between p_from and p_to group by calibre_id
),
quality_record as (
  select
    cl.serial, cl.type_id, cl.partiya_no, cl.plate, cl.driver, cl.arrival_date, cl.target_moisture_pct, cl.target_so2_mg_kg,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = cl.serial
      order by lr.created_at desc limit 1
    ) as intake_lab,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'verdict', lr.verdict, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = cl.wash_cycle_id
      order by lr.created_at desc limit 1
    ) as delivered_lab
  from client_lines cl
  where cl.origin != 'opening_stock'
    and (
      cl.arrival_date between p_from and p_to
      or cl.completed_date between p_from and p_to
      or exists (select 1 from client_pallets cp where cp.serial = cl.serial and cp.departure_date between p_from and p_to)
    )
),
period_dispatch_ids as (
  select distinct cr.id as request_id
  from chiqim_requests cr
  join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  where cr.owner_id = p_owner_id
    and cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
    and cr.request_date between p_from and p_to
)
select jsonb_build_object(
  'owner', (select jsonb_build_object('id', id, 'name', name) from owners where id = p_owner_id),
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'raw', jsonb_build_object(
    'openingKg', (select kg from raw_opening_total),
    'receivedKg', (select kg from raw_received_total),
    'sentToMoykaKg', (select kg from raw_sent_to_moyka_period_total),
    'processedKg', (select kg from raw_processed_total),
    'processedActualSentKg', (select kg from raw_processed_actual_total),
    'processedOverageKg', (select kg from raw_processed_actual_total) - (select kg from raw_processed_total),
    'rawDispatchedKg', (select kg from raw_dispatch_total),
    'moykadaKg', (select kg from moykada_total),
    'cappedSerials', (
      select coalesce(jsonb_agg(
        jsonb_build_object('serial', cs.serial, 'actualSentKg', cs.actual_sent_kg, 'effectiveQtyKg', cs.effective_qty_kg, 'overageKg', cs.overage_kg)
        order by cs.serial
      ), '[]'::jsonb)
      from capped_serials cs
    ),
    'closingKg', (select kg from raw_closing_total),
    'processedBreakdown', jsonb_build_object(
      'calibreKg', (select calibre_kg from loss_main),
      'konditirskiyKg', (select konditirskiy_kg from loss_main),
      'lossKg', (select sent_kg - calibre_kg - konditirskiy_kg from loss_main),
      'lossPct', case when (select sent_kg from loss_main) > 0
                 then round((select sent_kg - calibre_kg - konditirskiy_kg from loss_main) / (select sent_kg from loss_main) * 100, 1)
                 else 0 end
    ),
    'byType', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'typeId', rt.type_id,
          'openingKg', coalesce(rot.kg, 0), 'receivedKg', coalesce(rrt.kg, 0),
          'sentToMoykaKg', coalesce(rsmt.kg, 0),
          'processedKg', coalesce(rpt.kg, 0),
          'rawDispatchedKg', coalesce(rdt.kg, 0),
          'moykadaKg', coalesce(mbt.kg, 0),
          'closingKg', coalesce(rct.kg, 0)
        )
      ), '[]'::jsonb)
      from raw_types rt
      left join raw_opening_by_type rot on rot.type_id = rt.type_id
      left join raw_received_by_type rrt on rrt.type_id = rt.type_id
      left join raw_sent_to_moyka_by_type rsmt on rsmt.type_id = rt.type_id
      left join raw_processed_by_type rpt on rpt.type_id = rt.type_id
      left join raw_dispatch_by_type rdt on rdt.type_id = rt.type_id
      left join moykada_by_type mbt on mbt.type_id = rt.type_id
      left join raw_closing_by_type rct on rct.type_id = rt.type_id
    ),
    'dispatches', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'requestId', rde.request_id, 'requestDate', rde.request_date, 'plate', rde.plate, 'driver', rde.driver,
          'serial', rde.serial, 'weightKg', rde.weight_kg, 'boxMassKg', rde.box_mass_kg, 'netKg', rde.net_kg
        ) order by rde.request_date desc
      ), '[]'::jsonb)
      from raw_dispatch_events rde
      where rde.request_date between p_from and p_to
    ),
    'reconciliation', jsonb_build_object(
      'totalReceivedKg', (select kg from cumulative_received_total),
      'xomKg', (select kg from raw_closing_total),
      'moykadaKg', (select kg from moykada_total),
      'cumulativeOutputKg', (select kg from cumulative_output_total),
      'cumulativeLossKg', (select kg from cumulative_loss_total),
      'cumulativeRawDispatchedKg', (select kg from cumulative_raw_dispatched_total),
      'cumulativeStorageLossKg', (select kg from cumulative_storage_loss_total),
      'balancesKg', (select kg from cumulative_received_total)
        - (select kg from raw_closing_total)
        - (select kg from cumulative_output_total) - (select kg from cumulative_loss_total)
        - (select kg from cumulative_raw_dispatched_total) - (select kg from cumulative_storage_loss_total)
    )
  ),
  'oldKn', jsonb_build_object(
    'collectedKg', (select kg from old_kn_collected_total),
    'collections', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'requestId', oke.request_id, 'requestDate', oke.request_date, 'plate', oke.plate, 'driver', oke.driver,
          'typeId', oke.type_id, 'collectedKg', oke.collected_kg
        ) order by oke.request_date desc
      ), '[]'::jsonb)
      from old_kn_events oke where oke.request_date between p_from and p_to
    )
  ),
  'storageLoss', jsonb_build_object(
    'totalKg', (select kg from storage_loss_total),
    'lines', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', sle.kind, 'typeId', sle.type_id,
          'closedDate', (sle.closed_at at time zone 'utc')::date, 'bookRemainingKg', sle.book_remaining_kg
        ) order by sle.closed_at desc
      ), '[]'::jsonb)
      from storage_loss_events sle
      where (sle.closed_at at time zone 'utc')::date between p_from and p_to
    )
  ),
  'finished', jsonb_build_object(
    'openingKg', (select kg from finished_opening_total),
    'producedKg', (select kg from finished_produced_total),
    'dispatchedKg', (select kg from finished_dispatched_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total) - (select kg from finished_dispatched_total),
    'byCalibre', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'calibreId', fc.calibre_id,
          'openingKg', coalesce(fo.kg, 0), 'producedKg', coalesce(fp2.kg, 0), 'dispatchedKg', coalesce(fd.kg, 0),
          'closingKg', coalesce(fo.kg, 0) + coalesce(fp2.kg, 0) - coalesce(fd.kg, 0)
        )
      ), '[]'::jsonb)
      from finished_calibres fc
      left join finished_opening_by_calibre fo on fo.calibre_id = fc.calibre_id
      left join finished_produced_by_calibre fp2 on fp2.calibre_id = fc.calibre_id
      left join finished_dispatched_by_calibre fd on fd.calibre_id = fc.calibre_id
    )
  ),
  'qualityRecord', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'serial', qr.serial, 'typeId', qr.type_id, 'partiyaNo', qr.partiya_no, 'plate', qr.plate, 'driver', qr.driver,
        'arrivalDate', qr.arrival_date, 'targetMoisturePct', qr.target_moisture_pct, 'targetSo2MgKg', qr.target_so2_mg_kg,
        'intakeLab', qr.intake_lab, 'deliveredLab', qr.delivered_lab
      ) order by qr.arrival_date
    ), '[]'::jsonb)
    from quality_record qr
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'departedAt', cgw.completed_at,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', c.barcode2, 'serial', fp.serial, 'calibreId', fp.calibre_id, 'weightKg', c.qty_kg)
            order by c.barcode2
          ), '[]'::jsonb)
          from chiqim_pallet_consumption c
          join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
          join finished_pallets fp on fp.barcode2 = c.barcode2
          where cl2.request_id = cr.id
        )
      ) order by cgw.completed_at desc
    ), '[]'::jsonb)
    from period_dispatch_ids pdi
    join chiqim_requests cr on cr.id = pdi.request_id
    join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  )
);
$function$;

-- ============================================================
-- 15. client_filtered_report_rows: FUNCTION using RETURNS TABLE -- DROP +
--     CREATE (see header). Body does explicit named selects in each UNION
--     branch (never `*`), so partiya_no's position is self-consistent as
--     long as it matches across branches and the RETURNS TABLE list --
--     kept right after type_id, as originally written, since a fresh
--     CREATE isn't constrained by any prior signature. Four of five
--     branches join kirim_lines kl directly -- kl.partiya_no; chiqim_old_kn
--     has no serial -- null::int.
-- ============================================================
drop function if exists public.client_filtered_report_rows(text[], date, date, uuid, text);

create function public.client_filtered_report_rows(p_directions text[], p_from date, p_to date, p_type_id uuid, p_serial text)
 returns TABLE(kind text, row_key text, serial text, type_id uuid, partiya_no integer, plate text, driver text, date_basis date, qty_kg numeric, declared_qty numeric)
 language sql
 stable
as $function$
  with rows_unfiltered as (
    select 'kirim'::text as kind, kl.serial as row_key, kl.serial, kl.type_id, kl.partiya_no,
           ko.plate, ko.driver, ko.order_date as date_basis,
           kirim_line_effective_qty(kl.serial) as qty_kg, kl.declared_qty
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.origin = 'delivery'
      and ko.plate !~~ 'TEST-%'

    union all

    select 'chiqim'::text, c.id::text, fp.serial, fp.type_id, kl.partiya_no,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           c.qty_kg, null::numeric
    from chiqim_pallet_consumption c
    join finished_pallets fp on fp.barcode2 = c.barcode2
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    join chiqim_lines cl on cl.id = c.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'chiqim_raw'::text, rdl.id::text, rdl.serial, cl.type_id, kl.partiya_no,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           rdl.net_kg, null::numeric
    from raw_dispatch_lines rdl
    join chiqim_lines cl on cl.id = rdl.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    join kirim_lines kl on kl.serial = rdl.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'chiqim_old_kn'::text, okc.id::text, null::text, okp.type_id, null::int,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           okc.collected_kg, null::numeric
    from old_kn_collections okc
    join old_kn_pools okp on okp.id = okc.pool_id
    join chiqim_lines cl on cl.id = okc.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where okp.owner_id = my_owner_id()
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'moyka_output'::text, 'moyka-output-' || fp.barcode2, fp.serial, fp.type_id, kl.partiya_no,
           ko.plate, ko.driver, fp.received_date,
           fp.weight_kg, null::numeric
    from finished_pallets fp
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and ko.origin != 'opening_stock'
  )
  select * from rows_unfiltered r
  where (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
    and r.date_basis is not null and r.date_basis between p_from and p_to
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%');
$function$;

-- ============================================================
-- 16. client_serial_summary: JSONB-returning function -- unaffected by the
--     RETURNS TABLE restriction. owned CTE adds kl.partiya_no; final
--     object gets 'partiyaNo' alongside its other serial-level fields.
-- ============================================================
create or replace function public.client_serial_summary(p_serial text)
 returns jsonb
 language sql
 stable
as $function$
  with owned as (
    select kl.serial, kl.partiya_no, ko.owner_id, ko.order_date
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where kl.serial = p_serial and ko.owner_id = my_owner_id()
  ),
  split as (
    select * from client_calibre_split((select serial from owned))
  ),
  by_calibre as (
    select fp.calibre_id, sum(fp.weight_kg) as kg
    from finished_pallets fp
    join owned o on o.serial = fp.serial
    join calibres c on c.id = fp.calibre_id
    where fp.status not in ('bekor_qilindi', 'storage_loss')
      and not c.is_numberless
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
    group by fp.calibre_id
  )
  select case when (select count(*) from owned) = 0 then null else jsonb_build_object(
    'serial', p_serial,
    'orderDate', (select order_date from owned),
    'partiyaNo', (select partiya_no from owned),
    'byCalibre', (
      select coalesce(jsonb_agg(jsonb_build_object('calibreId', bc.calibre_id, 'weightKg', bc.kg) order by bc.calibre_id), '[]'::jsonb)
      from by_calibre bc
    ),
    'knKg', (select kn_kg from split),
    'lossKg', (select client_serial_loss_kg((select serial from owned)))
  ) end;
$function$;
