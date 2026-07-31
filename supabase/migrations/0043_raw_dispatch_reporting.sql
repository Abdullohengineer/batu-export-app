-- Raw dispatch reporting: a new report_rows kind for raw-dispatch events
-- (no finished_pallets anchor, so it can't be a report_chiqim_rows row),
-- and get_client_report's third closing-balance term + raw-taken-vs-washed
-- shown distinctly. Split from 0042 (schema + stock_on_hand_rows/wip_rows)
-- on purpose -- this is the loss/reporting arithmetic this project has
-- already shipped one real bug in (0029's own header, cited again at the
-- Laborator-v2 reporting rewrite, 0036) -- hand-verified against seeded
-- data before shipping, not applied blind. See DECISIONS.md "Raw dispatch".

-- ============================================================
-- 1. report_raw_dispatch_rows -- one row per raw_dispatch_lines entry,
--    same granularity convention as the other two (KIRIM = one kirim_lines
--    row, CHIQIM = one finished_pallets row).
-- ============================================================
create or replace view report_raw_dispatch_rows as
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
  cr.request_date as date_basis,
  null::text as date_basis_source,
  rdl.net_kg as qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  null::integer as wash_cycle,
  -- raw_dispatch_lines is written only at Ombor's finish click (see 0042) --
  -- a row existing at all means it already departed. Reuses the existing
  -- pallet-status vocabulary rather than inventing a raw-only status, so the
  -- Hisobot status filter picks it up for free.
  'jonatilgan'::text as pallet_status,
  null::text as lab_verdict,
  null::numeric as target_moisture_pct,
  null::numeric as target_so2_mg_kg,
  null::numeric as moisture_pct,
  null::numeric as so2_mg_kg,
  null::text[] as void_successor_barcodes,
  rdl.box_mass_kg as box_mass_kg
from raw_dispatch_lines rdl
join chiqim_lines cl on cl.id = rdl.chiqim_line_id
join chiqim_requests cr on cr.id = cl.request_id
join kirim_lines kl on kl.serial = rdl.serial
join kirim_orders ko on ko.order_id = kl.order_id
where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 2. report_rows -- three-way union now.
-- ============================================================
create or replace view report_rows as
select kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg,
  truck_variance_diff_pct, provisional_variance_flag, wash_cycle, pallet_status, lab_verdict,
  target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_kirim_rows
union all
select kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg,
  truck_variance_diff_pct, provisional_variance_flag, wash_cycle, pallet_status, lab_verdict,
  target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_chiqim_rows
union all
select kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg,
  truck_variance_diff_pct, provisional_variance_flag, wash_cycle, pallet_status, lab_verdict,
  target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_raw_dispatch_rows;

-- ============================================================
-- 3. report_filtered_rows -- chiqim_raw gated by the same four structural
--    filters as kirim (calibre/barcode2/wash-cycle/lab-verdict -- a raw row
--    has none of these), but NOT by status -- a raw row's status is real
--    ('jonatilgan') and should stay findable, same as a pallet's.
-- ============================================================
create or replace function report_filtered_rows(
  p_direction text,
  p_from date,
  p_to date,
  p_owner_id uuid,
  p_type_id uuid,
  p_calibre_id uuid,
  p_serial text,
  p_barcode2 text,
  p_plate text,
  p_driver text,
  p_wash_cycle text,
  p_lab_verdict text,
  p_status text
)
returns setof report_rows
language sql
stable
security invoker
as $$
  select r.*
  from report_rows r
  where (p_direction = 'both' or r.kind = p_direction)
    and (
      r.kind = 'chiqim'
      or (
        r.kind = 'kirim'
        and p_calibre_id is null
        and (p_barcode2 is null or p_barcode2 = '')
        and (p_wash_cycle is null or p_wash_cycle = '')
        and (p_lab_verdict is null or p_lab_verdict = '')
        and (p_status is null or p_status = '')
      )
      or (
        r.kind = 'chiqim_raw'
        and p_calibre_id is null
        and (p_barcode2 is null or p_barcode2 = '')
        and (p_wash_cycle is null or p_wash_cycle = '')
        and (p_lab_verdict is null or p_lab_verdict = '')
      )
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
$$;

-- ============================================================
-- 4. report_totals -- total_kg_out now includes chiqim_raw; total_kg_tara
--    SPLIT into total_kg_tara_in/total_kg_tara_out (2026-07-31 feedback):
--    KIRIM tara (boxes in) and raw-dispatch tara (boxes out) are unrelated
--    quantities that happened to share one column -- summed together on a
--    "both directions" view that number meant nothing. Return shape
--    changes, so drop first (same as 0041's own box_mass_kg addition).
-- ============================================================
drop function report_totals(text, date, date, uuid, uuid, uuid, text, text, text, text, text, text, text);
create function report_totals(
  p_direction text, p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text
)
returns table (total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric)
language sql
stable
security invoker
as $$
  select
    count(*),
    coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0),
    coalesce(sum(case when kind in ('chiqim', 'chiqim_raw') then qty_kg else 0 end), 0),
    coalesce(sum(case when kind = 'kirim' then box_mass_kg else 0 end), 0),
    coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0)
  from report_filtered_rows(
    p_direction, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
  );
$$;

grant select on report_raw_dispatch_rows, report_rows to authenticated;
grant execute on function report_filtered_rows(text,date,date,uuid,uuid,uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function report_totals(text,date,date,uuid,uuid,uuid,text,text,text,text,text,text,text) to authenticated;

-- ============================================================
-- 5. get_client_report -- three additions on top of the current (0039)
--    body, everything else byte-identical: raw_dispatch_events/
--    raw_dispatch_total/raw_dispatch_by_type CTEs; a third closing-balance
--    term (both total and per-type); raw.dispatches, a new array sibling to
--    the existing (finished-goods, pallet-based) top-level dispatches, so
--    raw-taken and washed-and-collected are never merged into one list.
--    raw_processed_total/raw_processed_actual_total/capped_serials/loss_*
--    (Moyka-only) and the whole finished.* section are UNCHANGED.
-- ============================================================
create or replace function get_client_report(p_owner_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
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
-- Raw dispatch (2026-07-31) -- the second raw exit, owner-scoped the same
-- way client_pallets already is (by the CHIQIM request's own owner_id).
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
    'rawDispatchedKg', (select kg from raw_dispatch_total),
    'cappedSerials', (
      select coalesce(jsonb_agg(
        jsonb_build_object('serial', cs.serial, 'actualSentKg', cs.actual_sent_kg, 'effectiveQtyKg', cs.effective_qty_kg, 'overageKg', cs.overage_kg)
        order by cs.serial
      ), '[]'::jsonb)
      from capped_serials cs
    ),
    'closingKg', (select kg from raw_opening_total) + (select kg from raw_received_total)
                 - (select kg from raw_processed_total) - (select kg from raw_dispatch_total),
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
          'rawDispatchedKg', coalesce(rdt.kg, 0),
          'closingKg', coalesce(rot.kg, 0) + coalesce(rrt.kg, 0) - coalesce(rpt.kg, 0) - coalesce(rdt.kg, 0)
        )
      ), '[]'::jsonb)
      from raw_types rt
      left join raw_opening_by_type rot on rot.type_id = rt.type_id
      left join raw_received_by_type rrt on rrt.type_id = rt.type_id
      left join raw_processed_by_type rpt on rpt.type_id = rt.type_id
      left join raw_dispatch_by_type rdt on rdt.type_id = rt.type_id
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
