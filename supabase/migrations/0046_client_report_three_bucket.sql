-- get_client_report: three-bucket raw balance (Xom / Moykada / Tayyor)
-- instead of two, so the raw closing figure subtracts at Moyka SEND
-- (matching stock_on_hand_rows/useMoykaSerials) instead of at wash
-- COMPLETION. Adds a "Moykada" (in-processing) bucket so material sent to
-- Moyka but not yet packed is visible instead of vanishing mid-processing,
-- and adds a self-checking `reconciliation` object so the five-way
-- identity (Xom + Moykada + Tayyor + Loss + raw-dispatched = total
-- received) is verified on every call, not just by hand once. Independently
-- verified (schema review + reconciliation stress test) before shipping --
-- same discipline as the Laborator-v2 and raw-dispatch rewrites, this
-- function's own documented history of one shipped loss-calculation bug
-- (0029's header, cited again at 0036). See DECISIONS.md "Client report
-- three-bucket raw balance".
--
-- Exact equality with stock_on_hand_rows' Xom bucket is architecturally
-- scoped to p_to = today: qoldig'i is an unconditional live snapshot with
-- no period concept, so a report for a genuinely historical p_to answers a
-- different question ("balance as of that past date") by design and will
-- diverge from "balance right now" if anything moved since -- not a defect.

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
  join report_kirim_rows rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  left join storage_intake si on si.serial = kl.serial
  where ko.owner_id = p_owner_id
),
-- Xom (omborda) -- direct per-line snapshots gated on has_intake, matching
-- stock_on_hand_rows' own INNER JOIN to storage_intake exactly, so a
-- declared-but-not-yet-accepted line is invisible in Xom here too (it
-- already counts toward receivedKg below -- that figure is intentionally
-- NOT intake-gated, since "received" answers "did the client's goods
-- arrive," a different question from "is it in tracked raw storage").
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to
),
raw_sent_to_moyka_period_total as (
  select coalesce(sum(sent_during_period_kg), 0) as kg from client_lines
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
-- Moykada -- sent to Moyka but not yet returned as a packed pallet, AS OF
-- p_to. A serial finalized (Tugallash) on or before p_to contributes 0 --
-- no longer "in processing" as of the report's own cutoff, and whatever gap
-- remains between sent and packed is realised loss (processedBreakdown,
-- unchanged below) -- loss comes out of the Moykada->Tayyor transition, not
-- out of raw.
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
  where arrival_date between p_from and p_to group by type_id
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
-- Reconciliation helpers -- cumulative (all-time-as-of-p_to), not
-- period-scoped, and gated has_intake/arrival_date<=p_to to match Xom/
-- Moykada's own scope exactly, so the five terms below are apples-to-apples
-- and sum to a clean identity rather than leaving an unexplained gap.
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
