-- Reports were showing the wrong "Sana" (gate-weighing / intake-confirm
-- timestamps instead of the date the Menejer actually typed on the KIRIM/
-- CHIQIM form) -- the serial passport already reads the correct entered
-- field (kirim_orders.order_date / chiqim_requests.request_date). Point
-- every report at the same field. Surgical: only date_basis/anchor_date/
-- departure_date columns change; qty_kg/provisional/truck_variance logic
-- (which correctly still depends on gate weighings for weight authority,
-- §2.16) is untouched.

create or replace view report_kirim_rows as
with lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
), box_mass as (
  select kl.order_id,
    case when bool_and(si.serial is not null) then sum(si.box_mass_kg) else null::numeric end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si on si.serial = kl.serial
  group by kl.order_id
)
select
  'kirim'::text as kind,
  l.serial as row_key,
  l.serial,
  null::text as barcode2,
  l.order_id,
  null::uuid as request_id,
  ko.owner_id,
  l.type_id,
  null::uuid as calibre_id,
  ko.plate,
  ko.driver,
  ko.order_date as date_basis,
  'order_date'::text as date_basis_source,
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
  case
    when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null
      then gw.net_kg - bm.total_box_mass_kg - ko.declared_total
    else null::numeric
  end as truck_variance_diff_kg,
  case
    when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null and ko.declared_total > 0::numeric
      then (gw.net_kg - bm.total_box_mass_kg - ko.declared_total) / ko.declared_total * 100::numeric
    else null::numeric
  end as truck_variance_diff_pct,
  case
    when l.line_count = 1 and gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null
      and si.actual_qty is not null and si.actual_qty <> 0::numeric and es.sent_date is not null
      and es.sent_date <= (gw.completed_at at time zone 'utc')::date
      and abs((gw.net_kg - bm.total_box_mass_kg - si.actual_qty) / si.actual_qty * 100::numeric) > coalesce(
        (select settings_limits.value from settings_limits where settings_limits.key = 'kam_chiqdi_pct'::text), 5::numeric)
      then true
    else false
  end as provisional_variance_flag,
  null::integer as wash_cycle,
  null::text as pallet_status,
  null::text as lab_verdict,
  l.target_moisture_pct,
  l.target_so2_mg_kg,
  lr.moisture_pct,
  lr.so2_mg_kg,
  null::text[] as void_successor_barcodes
from lines l
join kirim_orders ko on ko.order_id = l.order_id
left join storage_intake si on si.serial = l.serial
left join box_mass bm on bm.order_id = l.order_id
left join lateral (
  select gw2.net_kg, gw2.completed_at, gw2.stage1_completed_at
  from gate_weighings gw2
  where gw2.dir = 'kirim'::direction and gw2.order_id = l.order_id
  order by gw2.stage1_completed_at desc nulls last
  limit 1
) gw on true
left join lateral (
  select min(ms.sent_date) as sent_date from moyka_sends ms where ms.serial = l.serial
) es on true
left join lateral (
  select lr2.moisture_pct, lr2.so2_mg_kg
  from lab_results lr2
  where lr2.scope = 'kirim'::direction and lr2.parent_serial = l.serial
  order by lr2.created_at desc
  limit 1
) lr on true
where ko.plate !~~ 'TEST-%'::text;

create or replace view report_chiqim_rows as
select
  'chiqim'::text as kind,
  fp.barcode2 as row_key,
  fp.serial,
  fp.barcode2,
  kl.order_id,
  dm.request_id,
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
    when dm.request_id is not null then
      case when cgw.completed_at is not null then 'jonatilgan'::text else 'band_qilingan'::text end
    else 'omborda'::text
  end as pallet_status,
  lr.verdict as lab_verdict,
  kl.target_moisture_pct,
  kl.target_so2_mg_kg,
  lr.moisture_pct,
  lr.so2_mg_kg,
  null::text[] as void_successor_barcodes
from finished_pallets fp
join kirim_lines kl on kl.serial = fp.serial
join kirim_orders ko on ko.order_id = kl.order_id
left join lateral (
  select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1
) dm on true
left join chiqim_requests cr on cr.id = dm.request_id
left join lateral (
  select cgw2.completed_at
  from gate_weighings cgw2
  where cgw2.dir = 'chiqim'::direction and cgw2.request_id = dm.request_id
  order by cgw2.completed_at desc nulls last
  limit 1
) cgw on true
left join lateral (
  select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
) wc on true
left join lateral (
  select lr3.verdict, lr3.moisture_pct, lr3.so2_mg_kg
  from lab_results lr3
  where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
  order by lr3.created_at desc
  limit 1
) lr on true
where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

create or replace view stock_on_hand_rows as
with pallet_rows as (
  select
    case
      when lr.verdict = 'qayta_yuvish'::text then 'qayta_yuvish'::text
      when lr.verdict is null then 'awaiting_lab'::text
      when dm.request_id is not null then 'band_qilingan'::text
      else 'available'::text
    end as bucket,
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    fp.weight_kg as qty_kg,
    fp.received_date as anchor_date,
    lr.moisture_pct
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (
    select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1
  ) dm on true
  left join chiqim_requests cr on cr.id = dm.request_id
  left join lateral (
    select cgw2.completed_at
    from gate_weighings cgw2
    where cgw2.dir = 'chiqim'::direction and cgw2.request_id = dm.request_id
    order by cgw2.completed_at desc nulls last
    limit 1
  ) cgw on true
  left join lateral (
    select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
  ) wc on true
  left join lateral (
    select lr3.verdict, lr3.moisture_pct
    from lab_results lr3
    where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc
    limit 1
  ) lr on true
  where fp.status = 'in_stock'::pallet_status
    and not (dm.request_id is not null and cgw.completed_at is not null)
    and ko.plate !~~ 'TEST-%'::text
    and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text
), raw_rows as (
  select
    'raw_not_washed'::text as bucket,
    r.row_key,
    r.serial,
    null::text as barcode2,
    r.owner_id,
    r.type_id,
    null::uuid as calibre_id,
    r.qty_kg - coalesce(sent.total_sent, 0::numeric) as qty_kg,
    r.date_basis as anchor_date,
    kirim_lr.moisture_pct
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (
    select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent from moyka_sends ms where ms.serial = r.serial
  ) sent on true
  left join lateral (
    select lr4.moisture_pct
    from lab_results lr4
    where lr4.scope = 'kirim'::direction and lr4.parent_serial = r.serial
    order by lr4.created_at desc
    limit 1
  ) kirim_lr on true
  where (r.qty_kg - coalesce(sent.total_sent, 0::numeric)) > 0::numeric
)
select
  pallet_rows.bucket, pallet_rows.row_key, pallet_rows.serial, pallet_rows.barcode2, pallet_rows.owner_id,
  pallet_rows.type_id, pallet_rows.calibre_id, pallet_rows.qty_kg, pallet_rows.anchor_date,
  current_date - pallet_rows.anchor_date as days_held,
  (current_date - pallet_rows.anchor_date) > 90 as aged_90,
  pallet_rows.moisture_pct
from pallet_rows
union all
select
  raw_rows.bucket, raw_rows.row_key, raw_rows.serial, raw_rows.barcode2, raw_rows.owner_id,
  raw_rows.type_id, raw_rows.calibre_id, raw_rows.qty_kg, raw_rows.anchor_date,
  current_date - raw_rows.anchor_date as days_held,
  (current_date - raw_rows.anchor_date) > 90 as aged_90,
  raw_rows.moisture_pct
from raw_rows;

-- get_client_report: same fix applied to dispatch-side period bucketing
-- (client_pallets.departure_date, period_dispatch_ids) -- confirmed with
-- the user to keep the whole report internally consistent (raw side
-- already flips to order_date via report_kirim_rows above). The "must have
-- actually gate-departed" gate (cgw.completed_at is not null) is preserved
-- explicitly since it was previously implicit in the date comparison itself.
create or replace function get_client_report(p_owner_id uuid, p_from date, p_to date)
returns jsonb
language sql stable
as $function$
with
client_lines as (
  select
    kl.serial, kl.type_id, ko.plate, ko.driver, kl.target_moisture_pct, kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date, rkr.provisional,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_actual_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
    wc.id as wash_cycle_id, wc.status as wash_cycle_status
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  where ko.owner_id = p_owner_id
),
raw_opening_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date < p_from and (completed_date is null or completed_date >= p_from)
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to
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
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date < p_from and (completed_date is null or completed_date >= p_from)
  group by type_id
),
raw_received_by_type as (
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date between p_from and p_to group by type_id
),
raw_processed_by_type as (
  select type_id, coalesce(sum(sent_capped_kg), 0) as kg from client_lines
  where completed_date between p_from and p_to group by type_id
),
loss_totals as (
  select cl.serial, cl.sent_actual_kg
  from client_lines cl
  where cl.wash_cycle_status = 'final' and cl.completed_date between p_from and p_to
),
loss_output as (
  select
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg
  from loss_totals lt
  join finished_pallets fp on fp.serial = lt.serial
  join calibres c on c.id = fp.calibre_id
),
loss_main as (
  select
    (select coalesce(sum(sent_actual_kg), 0) from loss_totals) as sent_kg,
    (select coalesce(calibre_kg, 0) from loss_output) as calibre_kg,
    (select coalesce(konditirskiy_kg, 0) from loss_output) as konditirskiy_kg
),
client_pallets as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg, fp.received_date,
    (
      select cr.request_date
      from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      join chiqim_requests cr on cr.id = dm.request_id
      where dm.barcode2 = fp.barcode2 and cgw.completed_at is not null
      order by cgw.completed_at desc nulls last
      limit 1
    ) as departure_date
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where ko.owner_id = p_owner_id and fp.status = 'in_stock'
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where received_date < p_from and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets where received_date between p_from and p_to
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets where departure_date between p_from and p_to
),
finished_calibres as (select distinct calibre_id from client_pallets),
finished_opening_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where received_date < p_from and (departure_date is null or departure_date >= p_from) group by calibre_id
),
finished_produced_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets where received_date between p_from and p_to group by calibre_id
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
  where cl.arrival_date between p_from and p_to
     or cl.completed_date between p_from and p_to
     or exists (select 1 from client_pallets cp where cp.serial = cl.serial and cp.departure_date between p_from and p_to)
),
period_dispatch_ids as (
  select distinct cr.id as request_id
  from chiqim_requests cr
  join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  where cr.owner_id = p_owner_id and cgw.completed_at is not null and cr.request_date between p_from and p_to
)
select jsonb_build_object(
  'owner', (select jsonb_build_object('id', id, 'name', name) from owners where id = p_owner_id),
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'raw', jsonb_build_object(
    'openingKg', (select kg from raw_opening_total),
    'receivedKg', (select kg from raw_received_total),
    'processedKg', (select kg from raw_processed_total),
    'processedActualSentKg', (select kg from raw_processed_actual_total),
    'processedOverageKg', (select kg from raw_processed_actual_total) - (select kg from raw_processed_total),
    'cappedSerials', (
      select coalesce(jsonb_agg(
        jsonb_build_object('serial', cs.serial, 'actualSentKg', cs.actual_sent_kg, 'effectiveQtyKg', cs.effective_qty_kg, 'overageKg', cs.overage_kg)
        order by cs.serial
      ), '[]'::jsonb)
      from capped_serials cs
    ),
    'closingKg', (select kg from raw_opening_total) + (select kg from raw_received_total) - (select kg from raw_processed_total),
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
          'openingKg', coalesce(rot.kg, 0), 'receivedKg', coalesce(rrt.kg, 0), 'processedKg', coalesce(rpt.kg, 0),
          'closingKg', coalesce(rot.kg, 0) + coalesce(rrt.kg, 0) - coalesce(rpt.kg, 0)
        )
      ), '[]'::jsonb)
      from raw_types rt
      left join raw_opening_by_type rot on rot.type_id = rt.type_id
      left join raw_received_by_type rrt on rrt.type_id = rt.type_id
      left join raw_processed_by_type rpt on rpt.type_id = rt.type_id
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
