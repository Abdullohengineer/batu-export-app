-- Raw-side as-of-date stability for get_client_report (mirrors migration 0058's
-- finished-side fix). Before this migration, client_lines.has_intake and
-- effective_qty read report_kirim_rows LIVE, so a serial ordered inside a
-- closed period but accepted into storage after that period ends
-- retroactively joins the closed period's raw balance every time the report
-- is re-run. This fires on every Ombor intake accept -- closed-period raw
-- figures were never actually stable.
--
-- Fix: report_kirim_rows_as_of(p_to) is a faithful clone of
-- report_kirim_rows's own ladder logic (no reimplementation -- the CASE
-- expressions are copied verbatim) with exactly three joins date-gated:
-- the outer storage_intake join (has_intake / qty_kg / provisional), the
-- box_mass CTE's per-line storage_intake join (the bool_and "were ALL lines
-- on this order accepted as of p_to" gate), and the gate_weighings lateral
-- (nulls out completed_at itself when its date is after p_to, so every
-- CASE branch that already null-checks completed_at inherits the gate for
-- free). Only get_client_report switches to it; wip_rows, stock_on_hand_rows,
-- yield_rows, report_rows, and the three Rahbar functions correctly want
-- live current state and are untouched.

create or replace function report_kirim_rows_as_of(p_to date)
returns table (
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid,
  owner_id uuid, type_id uuid, calibre_id uuid, plate text, driver text,
  date_basis date, date_basis_source text, qty_kg numeric, provisional boolean,
  declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric,
  provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text,
  target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric,
  void_successor_barcodes text[], box_mass_kg numeric, origin text
)
language sql
stable
as $function$
with
lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
),
-- The box_mass bool_and gate: same as-of date predicate as the outer `si`
-- join below, applied to EVERY line on the order before the aggregate runs.
-- A line accepted after p_to reads as si_1.serial IS NULL here, so
-- bool_and(...) correctly comes back false for the whole order -- each
-- individual line's as-of-acceptance state feeds the same bool_and the live
-- view already uses, nothing else changes.
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
  null::text[] as void_successor_barcodes, si.box_mass_kg, ko.origin
from lines l
join kirim_orders ko on ko.order_id = l.order_id
-- Gate 1 (has_intake / qty_kg / provisional): miss the join entirely if
-- acceptance happened after p_to -- si.actual_qty reads NULL, and the
-- existing "not yet accepted" branch fires, unchanged.
left join storage_intake si
  on si.serial = l.serial
 and si.confirmed_at is not null
 and (si.confirmed_at at time zone 'utc')::date <= p_to
left join box_mass bm on bm.order_id = l.order_id
-- Gate 2 (gate stage 2 completion): null out completed_at itself when its
-- date is after p_to. Every CASE branch above already null-checks
-- completed_at before reading net_kg, so nulling it here is sufficient --
-- no need to touch qty_kg/provisional/truck_variance individually.
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
-- NOT as-of-gated (unrelated to has_intake/effective_qty, not read by
-- client_lines, not part of this fix's scope): earliest send date and
-- latest lab reading stay live.
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

-- get_client_report: only the client_lines CTE changes (two lines). Every
-- other CTE, and the entire three-bucket arithmetic, is untouched.
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
