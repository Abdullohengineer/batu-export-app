-- Client report (SPEC.md §3.2.7, first real body -- previously a reserved
-- placeholder). One RPC returning a single client's whole balance/quality/
-- dispatch picture for one period, as a JSONB document -- same "one RPC, one
-- round trip, heterogeneous shape" precedent get_serial_passport already
-- established (0027_serial_passport.sql).
--
-- 🔒 Deliberate date-basis exception (§3.2.3 amendment, confirmed with the
-- user): "received" and "dispatched" use arrival/departure dates exactly as
-- §3.2.3 already defines for Hisobot rows (KIRIM -> gate stage 1, CHIQIM ->
-- gate stage 2). "Davrda qayta ishlangan" (the RAW-balance deduction) does
-- NOT use moyka_sends.sent_date -- it uses cycle 1's own COMPLETION date
-- (min(finished_pallets.received_date) for wash_cycle=1). Labelled on the
-- report UI and in SPEC.md so a future maintainer doesn't "fix" it back to
-- sent_date.
--
-- 🔒 Re-wash is NOT raw (§2.13, confirmed with the user): effective_qty
-- (§2.16, via report_kirim_rows) is fixed once per serial and nothing
-- downstream ever changes it. "Davrda qayta ishlangan" is derived from
-- wash_cycle=1 ONLY, always, regardless of how many later cycles that
-- serial goes through -- a re-wash re-send never adds to it a second time.
-- Also capped at effective_qty (least(...)) so the balance can never show
-- more processed than was ever received -- and when that cap actually
-- engages (confirmed against real data: it does), the overage is surfaced
-- explicitly (processedActualSentKg/processedOverageKg/cappedSerials)
-- rather than silently clamped. See fixture stories 13-14 (2026-07-21
-- addendum) for both edge cases this migration now covers.
--
-- 🔒 Loss accumulates across every cycle (confirmed with the user): cycle
-- 1's loss and cycle 2's loss are both real and both belong to the serial,
-- each measured against ITS OWN cycle's sent quantity (cycle 2's loss is
-- measured against the re-wash input, never the original gate net --
-- existing Step 8 behaviour, unchanged). Hand-verified against story 4
-- (Toshkent, re-wash): raw consumed once = 4,100 kg; live (non-voided)
-- calibre output = 2,450 kg (cycle 1's 3,000 kg was voided and excluded --
-- summing it here as well as cycle 2's real output would double the
-- material); Konditirskiy = 900 kg (both cycles, never voided, §2.13
-- additive); total loss (both cycles) = 750 kg. 2,450+900+750 = 4,100 kg
-- exactly -- confirms voided cycle-1 output must be excluded from the
-- CALIBRE/KONDITIRSKIY breakdown even though its LOSS stays counted (loss
-- is fixed at the moment a cycle completes; calibre output is superseded
-- the moment it's voided and replaced by whatever the next cycle produces).
--
-- 🔒 Cross-period re-wash (confirmed with the user, resolves a real gap):
-- when cycle 1 (raw consumption) and a later cycle complete in DIFFERENT
-- reporting periods, that later cycle's loss/output is attributed to the
-- period IT completed in, not retroactively folded into the period its raw
-- was originally consumed in -- reports are generated fresh from live data
-- on demand (§3.5), not frozen snapshots; attributing it backward would mean
-- a period's report changes after the fact whenever a later re-wash
-- concludes, silently disagreeing with a copy already given to the client.
-- Surfaced instead as its own explicitly cross-referenced line
-- (raw.crossPeriodRewash) so the arithmetic is explained, not broken -- see
-- fixture story 13.
--
-- Voided (`bekor_qilindi`) pallets are excluded from every STOCK figure
-- (opening/produced/dispatched/closing finished balance) -- matches
-- stock_on_hand_rows' own convention, a voided pallet isn't legitimate
-- current stock.
--
-- "Held, not departed" (§3.2.5/§3.2.6 precedent, reused here): a pallet only
-- leaves the finished balance once its claiming dispatch's CHIQIM gate stage
-- 2 actually completes. Merely being scanned onto a manifest (band_qilingan)
-- never removes it -- passport, stock-on-hand, and this report all derive
-- "departed" the identical way.

create or replace function get_client_report(p_owner_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
as $$
with
-- One row per kirim_line (raw) for this client, enriched with effective_qty
-- (report_kirim_rows, §2.16 -- never actual_qty/declared), cycle-1 send
-- total (both actual and capped-at-effective_qty), and cycle-1 completion
-- date. Deliberately wash_cycle=1 ONLY -- see migration-header comment.
client_lines as (
  select
    kl.serial,
    kl.type_id,
    ko.plate,
    ko.driver,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty,
    rkr.date_basis as arrival_date,
    rkr.provisional,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.wash_cycle = 1) as cycle1_sent_actual_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.wash_cycle = 1),
      rkr.qty_kg
    ) as cycle1_sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial and fp.wash_cycle = 1) as cycle1_completed_date
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows rkr on rkr.serial = kl.serial
  where ko.owner_id = p_owner_id
),
raw_opening_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date < p_from and (cycle1_completed_date is null or cycle1_completed_date >= p_from)
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date between p_from and p_to
),
raw_processed_total as (
  select coalesce(sum(cycle1_sent_capped_kg), 0) as kg from client_lines
  where cycle1_completed_date between p_from and p_to
),
raw_processed_actual_total as (
  select coalesce(sum(cycle1_sent_actual_kg), 0) as kg from client_lines
  where cycle1_completed_date between p_from and p_to
),
capped_serials as (
  select serial, cycle1_sent_actual_kg as actual_sent_kg, effective_qty as effective_qty_kg,
         cycle1_sent_actual_kg - cycle1_sent_capped_kg as overage_kg
  from client_lines
  where cycle1_completed_date between p_from and p_to
    and cycle1_sent_actual_kg > cycle1_sent_capped_kg
),
raw_types as (
  select distinct type_id from client_lines
),
raw_opening_by_type as (
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date < p_from and (cycle1_completed_date is null or cycle1_completed_date >= p_from)
  group by type_id
),
raw_received_by_type as (
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date between p_from and p_to
  group by type_id
),
raw_processed_by_type as (
  select type_id, coalesce(sum(cycle1_sent_capped_kg), 0) as kg from client_lines
  where cycle1_completed_date between p_from and p_to
  group by type_id
),
-- Every FINAL cycle (any cycle_no) for this client's serials, with its own
-- completion date, own sent quantity, and TWO output splits:
--   all_*         -- every pallet that cycle ever produced, voided or not --
--                    used ONLY to compute that cycle's own loss (a fixed
--                    historical fact, unaffected by later voiding).
--   live_*        -- only currently-in_stock pallets -- used for the
--                    calibre/Konditirskiy BREAKDOWN, so a voided cycle's
--                    superseded output is never double-counted alongside
--                    whatever later cycle actually replaced it.
client_cycles as (
  select
    kl.serial,
    wc.cycle_no,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial and fp.wash_cycle = wc.cycle_no) as completed_date,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.wash_cycle = wc.cycle_no) as sent_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = kl.serial and fp.wash_cycle = wc.cycle_no and not c.is_numberless) as all_calibre_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = kl.serial and fp.wash_cycle = wc.cycle_no and c.is_numberless) as all_konditirskiy_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = kl.serial and fp.wash_cycle = wc.cycle_no and fp.status = 'in_stock' and not c.is_numberless) as live_calibre_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = kl.serial and fp.wash_cycle = wc.cycle_no and fp.status = 'in_stock' and c.is_numberless) as live_konditirskiy_kg,
    cl.cycle1_completed_date
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join wash_cycles wc on wc.serial = kl.serial
  join client_lines cl on cl.serial = kl.serial
  where ko.owner_id = p_owner_id and wc.status = 'final'
),
loss_period_cycles as (
  select *, (cycle_no = 1 or (cycle1_completed_date between p_from and p_to)) as in_period_consistent
  from client_cycles
  where completed_date between p_from and p_to
),
loss_main as (
  select
    coalesce(sum(live_calibre_kg), 0) as calibre_kg,
    coalesce(sum(live_konditirskiy_kg), 0) as konditirskiy_kg,
    coalesce(sum(sent_kg), 0) - coalesce(sum(all_calibre_kg), 0) - coalesce(sum(all_konditirskiy_kg), 0) as loss_kg,
    coalesce(sum(sent_kg), 0) as sent_kg
  from loss_period_cycles
  where in_period_consistent
),
-- A cycle that completed THIS period but whose serial's raw was consumed in
-- a DIFFERENT (earlier) period -- shown as its own cross-referenced line,
-- never folded into loss_main above.
cross_period_cycles as (
  select * from loss_period_cycles where not in_period_consistent
),
-- Every non-voided finished pallet ever produced for this client, with its
-- departure date (CHIQIM gate stage 2 completion via its claiming dispatch,
-- if any and if actually completed -- band_qilingan has a claim but no
-- completed departure_date, so it correctly stays "held").
client_pallets as (
  select
    fp.barcode2,
    fp.serial,
    fp.calibre_id,
    fp.weight_kg,
    fp.received_date,
    (
      select (cgw.completed_at at time zone 'utc')::date
      from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      where dm.barcode2 = fp.barcode2
      order by cgw.completed_at desc nulls last
      limit 1
    ) as departure_date
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where ko.owner_id = p_owner_id
    and fp.status = 'in_stock'
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where received_date < p_from and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where received_date between p_from and p_to
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where departure_date between p_from and p_to
),
finished_calibres as (
  select distinct calibre_id from client_pallets
),
finished_opening_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where received_date < p_from and (departure_date is null or departure_date >= p_from)
  group by calibre_id
),
finished_produced_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where received_date between p_from and p_to
  group by calibre_id
),
finished_dispatched_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where departure_date between p_from and p_to
  group by calibre_id
),
-- §3.5 Section B (quality record) -- one row per serial with ANY activity
-- in the period: arrived, processed (its cycle 1 completed), a later cycle
-- completed, or dispatched. NOT arrival-only (confirmed with the user) -- a
-- serial that arrived in an earlier period but was only collected this
-- period must still show its delivered reading on THIS report.
quality_record as (
  select
    cl.serial,
    cl.type_id,
    cl.plate,
    cl.driver,
    cl.arrival_date,
    cl.target_moisture_pct,
    cl.target_so2_mg_kg,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = cl.serial
      order by lr.created_at desc limit 1
    ) as intake_lab,
    (
      select jsonb_build_object(
        'moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'verdict', lr.verdict,
        'cycleNo', wc.cycle_no, 'sampleDate', lr.sample_date
      )
      from lab_results lr
      join wash_cycles wc on wc.id = lr.wash_cycle_id
      where lr.scope = 'chiqim' and wc.serial = cl.serial
      order by wc.cycle_no desc, lr.created_at desc limit 1
    ) as delivered_lab
  from client_lines cl
  where cl.arrival_date between p_from and p_to
     or cl.cycle1_completed_date between p_from and p_to
     or exists (select 1 from client_cycles cc where cc.serial = cl.serial and cc.completed_date between p_from and p_to)
     or exists (select 1 from client_pallets cp where cp.serial = cl.serial and cp.departure_date between p_from and p_to)
),
-- Collapsed detail (requirement C): dispatch trips departing in the period.
period_dispatch_ids as (
  select distinct cr.id as request_id
  from chiqim_requests cr
  join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  where cr.owner_id = p_owner_id
    and (cgw.completed_at at time zone 'utc')::date between p_from and p_to
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
      'lossKg', (select loss_kg from loss_main),
      'lossPct', case when (select sent_kg from loss_main) > 0
                 then round((select loss_kg from loss_main) / (select sent_kg from loss_main) * 100, 1)
                 else 0 end
    ),
    'crossPeriodRewash', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'serial', cpc.serial,
          'cycleNo', cpc.cycle_no,
          'completedDate', cpc.completed_date,
          'rawConsumedDate', cpc.cycle1_completed_date,
          'sentKg', cpc.sent_kg,
          'calibreKg', cpc.live_calibre_kg,
          'konditirskiyKg', cpc.live_konditirskiy_kg,
          'lossKg', cpc.sent_kg - cpc.all_calibre_kg - cpc.all_konditirskiy_kg,
          'lossPct', case when cpc.sent_kg > 0 then round((cpc.sent_kg - cpc.all_calibre_kg - cpc.all_konditirskiy_kg) / cpc.sent_kg * 100, 1) else 0 end
        ) order by cpc.completed_date
      ), '[]'::jsonb)
      from cross_period_cycles cpc
    ),
    'byType', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'typeId', rt.type_id,
          'openingKg', coalesce(rot.kg, 0),
          'receivedKg', coalesce(rrt.kg, 0),
          'processedKg', coalesce(rpt.kg, 0),
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
          'openingKg', coalesce(fo.kg, 0),
          'producedKg', coalesce(fp2.kg, 0),
          'dispatchedKg', coalesce(fd.kg, 0),
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
        'serial', qr.serial,
        'typeId', qr.type_id,
        'plate', qr.plate,
        'driver', qr.driver,
        'arrivalDate', qr.arrival_date,
        'targetMoisturePct', qr.target_moisture_pct,
        'targetSo2MgKg', qr.target_so2_mg_kg,
        'intakeLab', qr.intake_lab,
        'deliveredLab', qr.delivered_lab
      ) order by qr.arrival_date
    ), '[]'::jsonb)
    from quality_record qr
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id,
        'requestDate', cr.request_date,
        'plate', cr.plate,
        'driver', cr.driver,
        'departedAt', cgw.completed_at,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', dm.barcode2, 'serial', fp.serial, 'calibreId', fp.calibre_id, 'weightKg', fp.weight_kg)
            order by dm.barcode2
          ), '[]'::jsonb)
          from dispatch_manifest dm
          join finished_pallets fp on fp.barcode2 = dm.barcode2
          where dm.request_id = cr.id
        )
      ) order by cgw.completed_at desc
    ), '[]'::jsonb)
    from period_dispatch_ids pdi
    join chiqim_requests cr on cr.id = pdi.request_id
    join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  )
);
$$;

grant execute on function get_client_report(uuid, date, date) to authenticated;
