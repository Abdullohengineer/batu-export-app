-- Surface box mass (tara) in report tables and the serial passport, and
-- rename net figures to "Netto" for consistency. Purely additive columns --
-- storage_intake.box_mass_kg was already captured (0034_kirim_box_mass.sql)
-- and already used internally for the net calc; this just exposes the raw
-- value that was already joined but never selected. No change to how any
-- weight is calculated.

-- report_kirim_rows: storage_intake `si` is already joined, box_mass_kg is
-- this SERIAL's own tara (not the order-level total_box_mass_kg used
-- internally for the truck-variance calc -- a different, order-level
-- aggregate that stays untouched).
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
  null::text[] as void_successor_barcodes,
  si.box_mass_kg as box_mass_kg
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
  null::text[] as void_successor_barcodes,
  null::numeric as box_mass_kg
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

-- report_rows: rebuild to include the new box_mass_kg column in both branches
create or replace view report_rows as
select
  kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg,
  truck_variance_diff_pct, provisional_variance_flag, wash_cycle, pallet_status, lab_verdict,
  target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_kirim_rows
union all
select
  kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg,
  truck_variance_diff_pct, provisional_variance_flag, wash_cycle, pallet_status, lab_verdict,
  target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_chiqim_rows;

-- report_totals: return shape changes (new 4th column) -- must drop first.
drop function report_totals(text, date, date, uuid, uuid, uuid, text, text, text, text, text, text, text);
create function report_totals(p_direction text, p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text)
returns table(total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara numeric)
language sql stable
as $function$
  select
    count(*),
    coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0),
    coalesce(sum(case when kind = 'chiqim' then qty_kg else 0 end), 0),
    coalesce(sum(box_mass_kg), 0)
  from report_filtered_rows(
    p_direction, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
  );
$function$;

-- stock_on_hand_rows: raw_rows already joins storage_intake `si`; finished
-- pallets never have their own box mass (already deducted upstream at the
-- raw stage), so pallet_rows gets a null column, matching the task's own
-- "finished pallets show --" instruction.
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
    lr.moisture_pct,
    null::numeric as box_mass_kg
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
    kirim_lr.moisture_pct,
    r.box_mass_kg
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
  pallet_rows.moisture_pct,
  pallet_rows.box_mass_kg
from pallet_rows
union all
select
  raw_rows.bucket, raw_rows.row_key, raw_rows.serial, raw_rows.barcode2, raw_rows.owner_id,
  raw_rows.type_id, raw_rows.calibre_id, raw_rows.qty_kg, raw_rows.anchor_date,
  current_date - raw_rows.anchor_date as days_held,
  (current_date - raw_rows.anchor_date) > 90 as aged_90,
  raw_rows.moisture_pct,
  raw_rows.box_mass_kg
from raw_rows;

-- get_serial_passport: intake_row already does `select * from storage_intake`,
-- so ir.box_mass_kg is already available -- one new additive key.
create or replace function get_serial_passport(p_serial text)
returns jsonb
language sql stable
as $function$
with target_line as (
  select kl.serial, kl.order_id, kl.type_id, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
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
  select rcr.*
  from report_chiqim_rows rcr
  where rcr.serial = p_serial
),
dispatch_ids as (
  select distinct dm.request_id
  from dispatch_manifest dm
  join finished_pallets fp on fp.barcode2 = dm.barcode2
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
  select dm.request_id, dm.barcode2, dm.loaded_at, fp.calibre_id, fp.weight_kg
  from dispatch_manifest dm
  join finished_pallets fp on fp.barcode2 = dm.barcode2
  where fp.serial = p_serial
),
current_position as (
  select
    p.calibre_id,
    sum(case when p.pallet_status = 'omborda' then p.qty_kg else 0 end) as in_stock_kg,
    sum(case when p.pallet_status = 'band_qilingan' then p.qty_kg else 0 end) as reserved_kg,
    sum(case when p.pallet_status = 'jonatilgan' then p.qty_kg else 0 end) as collected_kg
  from pallets p
  where p.pallet_status <> 'bekor_qilingan'
  group by p.calibre_id
)
select jsonb_build_object(
  'serial', p_serial,
  'order', (
    select jsonb_build_object(
      'orderId', ko.order_id, 'ownerId', ko.owner_id, 'ownerName', o.name, 'plate', ko.plate, 'driver', ko.driver,
      'orderDate', ko.order_date, 'declaredQty', tl.declared_qty, 'declaredTotal', ko.declared_total,
      'isMultiLine', tl.line_count > 1, 'targetMoisturePct', tl.target_moisture_pct, 'targetSo2MgKg', tl.target_so2_mg_kg, 'typeId', tl.type_id,
      'docPhoto', ko.doc_photo
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
    from report_kirim_rows rkr
    where rkr.serial = p_serial
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
        'cycleNo', 1, 'status', wc.status, 'finalLossPct', wc.final_loss_pct, 'sentKg', st.sent_kg,
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
  'currentPosition', (
    select coalesce(jsonb_agg(
      jsonb_build_object('calibreId', cp.calibre_id, 'inStockKg', cp.in_stock_kg, 'reservedKg', cp.reserved_kg, 'collectedKg', cp.collected_kg)
      order by cp.calibre_id
    ), '[]'::jsonb)
    from current_position cp
  )
);
$function$;
