-- Old-KN collections were never surfaced in any report: old_kn_collections
-- records the draw and old_kn_pools' balance drops correctly, but there was
-- no report row -- a client collecting old Konditirskiy was invisible in
-- Hisobot and the client report. Explicitly deferred at Stage 2 (see
-- DECISIONS.md "Opening stock Stage 2: collect old-washed, old-KN, old-raw"),
-- picked up now.
--
-- Mirrors report_raw_dispatch_rows' shape exactly (same 27-column report_rows
-- shape, nulls where a concept doesn't apply -- no serial, no barcode2, no
-- calibre, no box mass). One deliberate deviation from the raw-dispatch
-- precedent: owner_id/type_id come from old_kn_pools (the material's true
-- owner), not chiqim_requests -- there is no kirim_orders-equivalent table
-- to source them from the way raw dispatch does via the serial's own order.

create or replace view report_old_kn_rows as
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
  null::numeric as box_mass_kg
from old_kn_collections okc
join old_kn_pools okp on okp.id = okc.pool_id
join chiqim_lines cl on cl.id = okc.chiqim_line_id
join chiqim_requests cr on cr.id = cl.request_id
where coalesce(cr.plate, '') !~~ 'TEST-%';

-- report_rows: fourth UNION ALL arm.
create or replace view report_rows as
select report_kirim_rows.kind, report_kirim_rows.row_key, report_kirim_rows.serial, report_kirim_rows.barcode2,
       report_kirim_rows.order_id, report_kirim_rows.request_id, report_kirim_rows.owner_id, report_kirim_rows.type_id,
       report_kirim_rows.calibre_id, report_kirim_rows.plate, report_kirim_rows.driver, report_kirim_rows.date_basis,
       report_kirim_rows.date_basis_source, report_kirim_rows.qty_kg, report_kirim_rows.provisional, report_kirim_rows.declared_qty,
       report_kirim_rows.truck_variance_diff_kg, report_kirim_rows.truck_variance_diff_pct, report_kirim_rows.provisional_variance_flag,
       report_kirim_rows.wash_cycle, report_kirim_rows.pallet_status, report_kirim_rows.lab_verdict, report_kirim_rows.target_moisture_pct,
       report_kirim_rows.target_so2_mg_kg, report_kirim_rows.moisture_pct, report_kirim_rows.so2_mg_kg,
       report_kirim_rows.void_successor_barcodes, report_kirim_rows.box_mass_kg
from report_kirim_rows where report_kirim_rows.origin = 'delivery'
union all
select report_chiqim_rows.kind, report_chiqim_rows.row_key, report_chiqim_rows.serial, report_chiqim_rows.barcode2,
       report_chiqim_rows.order_id, report_chiqim_rows.request_id, report_chiqim_rows.owner_id, report_chiqim_rows.type_id,
       report_chiqim_rows.calibre_id, report_chiqim_rows.plate, report_chiqim_rows.driver, report_chiqim_rows.date_basis,
       report_chiqim_rows.date_basis_source, report_chiqim_rows.qty_kg, report_chiqim_rows.provisional, report_chiqim_rows.declared_qty,
       report_chiqim_rows.truck_variance_diff_kg, report_chiqim_rows.truck_variance_diff_pct, report_chiqim_rows.provisional_variance_flag,
       report_chiqim_rows.wash_cycle, report_chiqim_rows.pallet_status, report_chiqim_rows.lab_verdict, report_chiqim_rows.target_moisture_pct,
       report_chiqim_rows.target_so2_mg_kg, report_chiqim_rows.moisture_pct, report_chiqim_rows.so2_mg_kg,
       report_chiqim_rows.void_successor_barcodes, report_chiqim_rows.box_mass_kg
from report_chiqim_rows
union all
select report_raw_dispatch_rows.kind, report_raw_dispatch_rows.row_key, report_raw_dispatch_rows.serial, report_raw_dispatch_rows.barcode2,
       report_raw_dispatch_rows.order_id, report_raw_dispatch_rows.request_id, report_raw_dispatch_rows.owner_id, report_raw_dispatch_rows.type_id,
       report_raw_dispatch_rows.calibre_id, report_raw_dispatch_rows.plate, report_raw_dispatch_rows.driver, report_raw_dispatch_rows.date_basis,
       report_raw_dispatch_rows.date_basis_source, report_raw_dispatch_rows.qty_kg, report_raw_dispatch_rows.provisional, report_raw_dispatch_rows.declared_qty,
       report_raw_dispatch_rows.truck_variance_diff_kg, report_raw_dispatch_rows.truck_variance_diff_pct, report_raw_dispatch_rows.provisional_variance_flag,
       report_raw_dispatch_rows.wash_cycle, report_raw_dispatch_rows.pallet_status, report_raw_dispatch_rows.lab_verdict, report_raw_dispatch_rows.target_moisture_pct,
       report_raw_dispatch_rows.target_so2_mg_kg, report_raw_dispatch_rows.moisture_pct, report_raw_dispatch_rows.so2_mg_kg,
       report_raw_dispatch_rows.void_successor_barcodes, report_raw_dispatch_rows.box_mass_kg
from report_raw_dispatch_rows
union all
select report_old_kn_rows.kind, report_old_kn_rows.row_key, report_old_kn_rows.serial, report_old_kn_rows.barcode2,
       report_old_kn_rows.order_id, report_old_kn_rows.request_id, report_old_kn_rows.owner_id, report_old_kn_rows.type_id,
       report_old_kn_rows.calibre_id, report_old_kn_rows.plate, report_old_kn_rows.driver, report_old_kn_rows.date_basis,
       report_old_kn_rows.date_basis_source, report_old_kn_rows.qty_kg, report_old_kn_rows.provisional, report_old_kn_rows.declared_qty,
       report_old_kn_rows.truck_variance_diff_kg, report_old_kn_rows.truck_variance_diff_pct, report_old_kn_rows.provisional_variance_flag,
       report_old_kn_rows.wash_cycle, report_old_kn_rows.pallet_status, report_old_kn_rows.lab_verdict, report_old_kn_rows.target_moisture_pct,
       report_old_kn_rows.target_so2_mg_kg, report_old_kn_rows.moisture_pct, report_old_kn_rows.so2_mg_kg,
       report_old_kn_rows.void_successor_barcodes, report_old_kn_rows.box_mass_kg
from report_old_kn_rows;

-- report_filtered_rows: direction-filter arm added preemptively (this is the
-- exact bug raw dispatch shipped with -- filtering Hisobot to CHIQIM
-- specifically made every raw row vanish because this structural early-return
-- had no arm for the new kind). Detail-filter gating arm mirrors chiqim_raw's
-- shape exactly (no calibre/barcode2/wash_cycle/lab_verdict concept).
create or replace function report_filtered_rows(p_direction text, p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text)
returns setof report_rows
language sql
stable
as $function$
  select r.*
  from report_rows r
  where (p_direction = 'both' or r.kind = p_direction
         or (p_direction = 'chiqim' and r.kind = 'chiqim_raw')
         or (p_direction = 'chiqim' and r.kind = 'chiqim_old_kn'))
    and (
      r.kind = 'chiqim'
      or (r.kind = 'kirim' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
      or (r.kind = 'chiqim_raw' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = ''))
      or (r.kind = 'chiqim_old_kn' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = ''))
    )
    and (
      (r.date_basis is not null and r.date_basis between p_from and p_to)
      or (r.date_basis is null and p_status is not null and p_status <> '' and r.pallet_status = p_status)
    )
    and (p_status is null or p_status = '' or r.pallet_status = p_status)
    and (p_owner_id is null or r.owner_id = p_owner_id)
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_calibre_id is null or r.calibre_id = p_calibre_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%')
    and (p_barcode2 is null or p_barcode2 = '' or r.barcode2 ilike '%' || p_barcode2 || '%')
    and (p_plate is null or p_plate = '' or r.plate ilike '%' || p_plate || '%')
    and (p_driver is null or p_driver = '' or r.driver ilike '%' || p_driver || '%')
    and (
      p_wash_cycle is null or p_wash_cycle = ''
      or (p_wash_cycle = '1' and r.wash_cycle = 1)
      or (p_wash_cycle = '2+' and r.wash_cycle >= 2)
    )
    and (
      p_lab_verdict is null or p_lab_verdict = ''
      or (p_lab_verdict = 'tekshirilmagan' and r.lab_verdict is null)
      or r.lab_verdict = p_lab_verdict
    );
$function$;

-- report_totals: chiqim_old_kn added to total_kg_out. total_kg_tara_out
-- untouched -- old-KN carries no box mass (box_mass_kg is null on these
-- rows), correctly excluded already.
create or replace function report_totals(p_direction text, p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text)
returns table(total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric)
language sql
stable
as $function$
  select
    count(*),
    coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0),
    coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn') then qty_kg else 0 end), 0),
    coalesce(sum(case when kind = 'kirim' then box_mass_kg else 0 end), 0),
    coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0)
  from report_filtered_rows(
    p_direction, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
  );
$function$;

-- get_client_report: new 'oldKn' top-level section, sibling to 'raw'/
-- 'finished' -- old-KN is a distinct product, not raw material, and must
-- never be merged into the raw three-bucket reconciliation (balancesKg
-- stays untouched by design). Two new CTEs (old_kn_events,
-- old_kn_collected_total), one new JSON key. Everything else in the function
-- is byte-identical to the current version.
create or replace function public.get_client_report(p_owner_id uuid, p_from date, p_to date)
 returns jsonb
 language sql
 stable
as $function$
with
client_lines as (
  select
    kl.serial, kl.type_id, ko.plate, ko.driver, kl.target_moisture_pct, kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date, rkr.provisional, rkr.origin,
    (si.serial is not null) as has_intake,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_actual_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date between p_from and p_to) as sent_during_period_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
    wc.id as wash_cycle_id, wc.status as wash_cycle_status, wc.finalized_at
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
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to and origin = 'delivery'
),
raw_sent_to_moyka_period_total as (
  select coalesce(sum(sent_during_period_kg), 0) as kg from client_lines
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
moykada_total as (
  select coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg)
    end
  ), 0) as kg from client_lines where arrival_date <= p_to and has_intake
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
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake group by type_id
),
raw_received_by_type as (
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date between p_from and p_to and origin = 'delivery' group by type_id
),
raw_sent_to_moyka_by_type as (
  select type_id, coalesce(sum(sent_during_period_kg), 0) as kg from client_lines group by type_id
),
raw_closing_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake group by type_id
),
moykada_by_type as (
  select type_id, coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg)
    end
  ), 0) as kg from client_lines where arrival_date <= p_to and has_intake group by type_id
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
loss_totals as (
  select cl.serial, cl.sent_actual_kg
  from client_lines cl
  where cl.wash_cycle_status = 'final'
    and cl.finalized_at is not null
    and (cl.finalized_at at time zone 'utc')::date <= p_to
    and cl.completed_date between p_from and p_to
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
  select coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to
         then greatest(0, sent_as_of_to_kg - output_as_of_to_kg) else 0 end
  ), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_raw_dispatched_total as (
  select coalesce(sum(dispatched_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
client_pallets as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg, fp.received_date, ko.origin,
    (
      select cr.request_date
      from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      join chiqim_requests cr on cr.id = dm.request_id
      where dm.barcode2 = fp.barcode2
        and cgw.completed_at is not null
        and (cgw.completed_at at time zone 'utc')::date <= p_to
      order by cgw.completed_at desc nulls last
      limit 1
    ) as departure_date
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
    cl.serial, cl.type_id, cl.plate, cl.driver, cl.arrival_date, cl.target_moisture_pct, cl.target_so2_mg_kg,
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
      'balancesKg', (select kg from cumulative_received_total)
        - (select kg from raw_closing_total) - (select kg from moykada_total)
        - (select kg from cumulative_output_total) - (select kg from cumulative_loss_total)
        - (select kg from cumulative_raw_dispatched_total)
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
        'serial', qr.serial, 'typeId', qr.type_id, 'plate', qr.plate, 'driver', qr.driver,
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
            jsonb_build_object('barcode2', dm.barcode2, 'serial', fp.serial, 'calibreId', fp.calibre_id, 'weightKg', fp.weight_kg)
            order by dm.barcode2
          ), '[]'::jsonb)
          from dispatch_manifest dm join finished_pallets fp on fp.barcode2 = dm.barcode2
          where dm.request_id = cr.id
        )
      ) order by cgw.completed_at desc
    ), '[]'::jsonb)
    from period_dispatch_ids pdi
    join chiqim_requests cr on cr.id = pdi.request_id
    join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  )
);
$function$;
