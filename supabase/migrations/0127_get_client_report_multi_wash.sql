-- Multi-wash support: get_client_report. Depends on 0124/0125.
-- docs/decisions/0191.
--
-- client_lines stays per-serial (raw material movement -- unaffected by
-- wash boundaries; a pure per-(serial,wash) restructuring of this CTE
-- would double-count raw_opening/raw_closing/the reconciliation identity,
-- since a 2-wash serial's whole-serial effective_qty/sent-before-from/etc
-- would otherwise be summed twice). New client_washes CTE, one row per
-- (serial, wash_no), takes over everything genuinely wash-scoped:
-- moykada_total (live in-process balance -- the OPEN wash only) and the
-- realized-loss side (raw_processed_total/loss_totals/loss_output/
-- loss_main -- every wash that CLOSED in [p_from, p_to], each with its
-- own sent/output, not the serial's lifetime totals).
--
-- KNOWN SIMPLIFICATION, flagged not silently decided: the original capped
-- a serial's period-processed total once against its lifetime
-- effective_qty (sent_capped_kg). Splitting that cap correctly across two
-- periods when a serial's washes close in DIFFERENT periods AND it's
-- simultaneously over its declared raw qty would need a running cap
-- tracked across close order -- a rare compound edge case not worth the
-- risk of a bespoke mechanism. raw_processed_total/loss_main below use
-- each period-closed wash's own uncapped sent_actual_kg; the lifetime
-- overage signal (capped_serials, processedOverageKg) is preserved
-- unchanged -- just no longer split per-period.

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
    -- Whole-serial, wash-agnostic BY DESIGN -- feeds only the reconciliation
    -- identity (mass balance for the serial as a whole), which cares about
    -- total output regardless of which wash produced it. moykada_total
    -- (in-process balance) gets its OWN wash-scoped version on
    -- client_washes below -- this one is not reused there any more.
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
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
  left join storage_intake si
    on si.serial = kl.serial
   and si.confirmed_at is not null
   and (si.confirmed_at at time zone 'utc')::date <= p_to
  where ko.owner_id = p_owner_id
),
client_washes as (
  select
    wc.serial, wc.wash_no, wc.id as wash_cycle_id, wc.closed_at,
    (select coalesce(sum(ms.qty_kg),0) from moyka_sends ms
       where ms.serial = wc.serial and ms.wash_no = wc.wash_no) as sent_actual_kg,
    (select coalesce(sum(ms.qty_kg),0) from moyka_sends ms
       where ms.serial = wc.serial and ms.wash_no = wc.wash_no and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(fp.weight_kg),0) from finished_pallets fp
       where fp.serial = wc.serial and fp.wash_no = wc.wash_no and fp.received_date <= p_to
         and fp.status <> 'bekor_qilindi') as output_as_of_to_kg
  from wash_cycles wc
  join client_lines cl on cl.serial = wc.serial
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
-- Live in-process balance -- the wash still OPEN as of p_to only (a
-- closed wash contributes 0; its gap already became realized loss, see
-- loss_totals below). Mirrors kirim_line_moyka_asof's own logic.
moykada_total as (
  select coalesce(sum(greatest(0, cw.sent_as_of_to_kg - cw.output_as_of_to_kg)), 0) as kg
  from client_washes cw
  join client_lines cl on cl.serial = cw.serial
  where cl.arrival_date <= p_to and cl.has_intake
    and (cw.closed_at is null or (cw.closed_at at time zone 'utc')::date > p_to)
),
-- Realized-loss side: every wash that closed within [p_from, p_to], its
-- own sent (uncapped per-wash -- see file header note).
raw_processed_total as (
  select coalesce(sum(cw.sent_actual_kg), 0) as kg
  from client_washes cw
  where cw.closed_at is not null and (cw.closed_at at time zone 'utc')::date between p_from and p_to
),
raw_processed_actual_total as (
  -- Same figure as raw_processed_total now that capping is no longer
  -- applied per-period (file header note) -- kept as a separate CTE for
  -- API-shape stability (processedActualSentKg/processedOverageKg below).
  select coalesce(sum(cw.sent_actual_kg), 0) as kg
  from client_washes cw
  where cw.closed_at is not null and (cw.closed_at at time zone 'utc')::date between p_from and p_to
),
capped_serials as (
  select cl.serial, cl.sent_actual_kg as actual_sent_kg, cl.effective_qty as effective_qty_kg,
         cl.sent_actual_kg - cl.sent_capped_kg as overage_kg
  from client_lines cl
  where cl.sent_actual_kg > cl.sent_capped_kg
    and exists (
      select 1 from client_washes cw2
      where cw2.serial = cl.serial and cw2.closed_at is not null
        and (cw2.closed_at at time zone 'utc')::date between p_from and p_to
    )
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
  select cl.type_id, coalesce(sum(greatest(0, cw.sent_as_of_to_kg - cw.output_as_of_to_kg)), 0) as kg
  from client_washes cw
  join client_lines cl on cl.serial = cw.serial
  where cl.arrival_date <= p_to and cl.has_intake
    and (cw.closed_at is null or (cw.closed_at at time zone 'utc')::date > p_to)
  group by cl.type_id
),
raw_processed_by_type as (
  select cl.type_id, coalesce(sum(cw.sent_actual_kg), 0) as kg
  from client_washes cw
  join client_lines cl on cl.serial = cw.serial
  where cw.closed_at is not null and (cw.closed_at at time zone 'utc')::date between p_from and p_to
  group by cl.type_id
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
  select cw.serial, cw.wash_no, cw.sent_actual_kg
  from client_washes cw
  join client_lines cl on cl.serial = cw.serial
  where cw.closed_at is not null and (cw.closed_at at time zone 'utc')::date between p_from and p_to
    and cl.origin != 'opening_stock'
),
loss_output as (
  select
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg
  from loss_totals lt
  join finished_pallets fp on fp.serial = lt.serial and fp.wash_no = lt.wash_no
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
  select
    c.barcode2,
    (cgw.completed_at at time zone 'utc')::date as departure_date,
    c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join client_pallet_base cpb on cpb.barcode2 = c.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
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
-- One row per (serial, wash) relevant to the period, LEFT JOINed so a
-- serial that arrived but hasn't been sent to Moyka yet (zero washes)
-- still gets one row with delivered_lab = null, matching the original's
-- coverage of an unwashed-but-arrived serial.
quality_record as (
  select
    cl.serial, cl.type_id, cl.partiya_no, cl.plate, cl.driver, cl.arrival_date, cl.target_moisture_pct, cl.target_so2_mg_kg,
    cw.wash_no,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = cl.serial
      order by lr.created_at desc limit 1
    ) as intake_lab,
    case when cw.wash_cycle_id is null then null else (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'verdict', lr.verdict, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = cw.wash_cycle_id
      order by lr.created_at desc limit 1
    ) end as delivered_lab
  from client_lines cl
  left join client_washes cw on cw.serial = cl.serial
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
  cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
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
        'washNo', qr.wash_no,
        'intakeLab', qr.intake_lab, 'deliveredLab', qr.delivered_lab
      ) order by qr.arrival_date, qr.wash_no
    ), '[]'::jsonb)
    from quality_record qr
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'departedAt', cgw.completed_at,
        'truckType', cr.truck_type,
        'loadedKg', chiqim_request_loaded_kg(cr.id),
        'photos', case when cr.truck_type = 'fura' then (
          select jsonb_build_object('kirdi', fph.kirdi_photo, 'chiqdi', fph.chiqdi_photo)
          from chiqim_fura_photo_paths(cr.id) fph
        ) else null end,
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
    cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
  )
);
$function$;
