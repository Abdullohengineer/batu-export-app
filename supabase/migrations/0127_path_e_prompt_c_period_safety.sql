-- Path E prompt (c): period-safety pass. Every loss/moyka consumer that
-- reads wash_cycles/moyka_sends/finished_pallets per-period or as-of-a-
-- date becomes cycle-aware, using the same [opened_at, next cycle's
-- opened_at) window pattern 0124/0126 established -- never closed_at,
-- which is "when Yakunlash was clicked," not "when the next cycle's
-- material actually started arriving" (the same-day close-then-reopen bug
-- 0196 documents).
--
-- Drafted 2026-09-19, pending Abdulloh's review of the full migration SQL,
-- the before/after sample comparisons, and the inventory cross-check
-- findings below. NOT to be applied until that confirmation is given.

begin;

-- 1. kirim_line_loss_asof -- NEW. Cumulative realized loss across every
-- cycle CLOSED by p_to (as-of semantics, unlike kirim_line_loss_range's
-- period-recognition semantics below). Used by client_serial_ledger.

create or replace function public.kirim_line_loss_asof(p_serial text, p_to date)
returns numeric
language sql
stable
as $function$
  with cycles as (
    select id, opened_at, closed_at, lead(opened_at) over (order by cycle_no) as next_opened_at
    from wash_cycles where serial = p_serial
  ),
  closed_by_to as (
    select * from cycles where closed_at is not null and (closed_at at time zone 'utc')::date <= p_to
  )
  select case when not exists (select 1 from closed_by_to) then null else
    (select coalesce(sum(
      coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = p_serial and ms.sent_date >= (cb.opened_at at time zone 'utc')::date and ms.sent_date <= (cb.closed_at at time zone 'utc')::date), 0)
      - (select calibre_kg + kn_kg from client_calibre_split(p_serial, cb.opened_at, case when cb.next_opened_at is null then null else cb.next_opened_at - interval '1 day' end))
    ), 0) from closed_by_to cb)
  end;
$function$;

-- 2. kirim_line_loss_range -- sum only cycles CLOSED within [p_from,p_to],
-- each window-bounded, instead of calling client_serial_loss_kg
-- unconditionally (which after 0126 sums EVERY closed cycle ever, not
-- just ones closed in this period -- would have leaked a cycle closed in
-- an earlier period into a later one the moment it shared any closed
-- cycle with this period).

create or replace function public.kirim_line_loss_range(p_serial text, p_from date, p_to date)
returns numeric
language sql
stable
as $function$
  with cycles as (
    select id, opened_at, closed_at, lead(opened_at) over (order by cycle_no) as next_opened_at
    from wash_cycles where serial = p_serial
  ),
  closed_in_range as (
    select * from cycles where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to
  )
  select case when not exists (select 1 from closed_in_range) then null else
    (select coalesce(sum(
      coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = p_serial and ms.sent_date >= (cir.opened_at at time zone 'utc')::date and ms.sent_date <= (cir.closed_at at time zone 'utc')::date), 0)
      - (select calibre_kg + kn_kg from client_calibre_split(p_serial, cir.opened_at, case when cir.next_opened_at is null then null else cir.next_opened_at - interval '1 day' end))
    ), 0) from closed_in_range cir)
  end;
$function$;

-- 3. kirim_line_moyka_asof -- was `exists(closed_at is not null and
-- closed_at <= p_to) -> 0`, which stayed true under multi-cycle even while
-- a LATER cycle was genuinely active. Now: find the cycle active AT p_to
-- (latest cycle whose opened_at <= p_to); 0 if none exists or it's closed
-- by p_to; else its own window-bounded sent-output gap.

create or replace function public.kirim_line_moyka_asof(p_serial text, p_to date)
returns numeric
language sql
stable
as $function$
  with active as (
    select opened_at, closed_at from wash_cycles
    where serial = p_serial and (opened_at at time zone 'utc')::date <= p_to
    order by opened_at desc limit 1
  )
  select case
    when not exists (select 1 from active) then 0
    when (select closed_at from active) is not null and ((select closed_at from active) at time zone 'utc')::date <= p_to then 0
    else greatest(0,
      coalesce((select sum(ms.qty_kg) from moyka_sends ms
                  where ms.serial = p_serial and ms.sent_date >= (select opened_at from active)::date and ms.sent_date <= p_to), 0)
      - coalesce((select sum(r.qty_kg) from report_moyka_output_rows r
                  where r.serial = p_serial
                    and r.date_basis >= (select opened_at from active)::date
                    and r.date_basis <= p_to
                    and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
                    and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
               ), 0)
    )
  end;
$function$;

-- kirim_line_moyka_range -- NOT rewritten. Inspected live: it has no
-- closed_at gating at all (confirmed via pg_get_functiondef before this
-- migration) -- its to_moyka_kg/from_moyka_kg are pure period-flow sums
-- (how much moved during [p_from,p_to]), legitimately cycle-agnostic by
-- construction, same as moyka_sends' own event-log nature. The task's own
-- premise that it shared kirim_line_moyka_asof's exists()-zero-out bug
-- did not hold on inspection -- flagged rather than silently "fixing" a
-- function that isn't broken.

-- 4. get_client_report -- client_lines' wash_cycles join changed from a
-- plain join (fans out under multi-cycle, corrupting every downstream
-- aggregate) to a LATERAL "latest cycle" subquery, safe for every field
-- that still reads it (quality_record's delivered_lab display, completed_
-- date). The actual loss/moyka figures (loss_totals, loss_output,
-- moykada_total, capped_by_serial) no longer read that field at all --
-- they use a new cycles_all CTE (one row per real (serial,cycle) pair,
-- each with its own [opened_at, next_opened_at) window), so a serial with
-- two cycles closing in the same wide reporting period correctly
-- contributes two independent, separately-windowed rows instead of one
-- fanned-out/corrupted one.

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
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date between p_from and p_to) as sent_during_period_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date < p_from) as rezka_sent_before_from_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date <= p_to) as rezka_sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
    lc.id as wash_cycle_id,
    lc.closed_at,
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
  left join lateral (
    select wc.id, wc.closed_at from wash_cycles wc where wc.serial = kl.serial order by wc.cycle_no desc limit 1
  ) lc on true
  left join storage_intake si
    on si.serial = kl.serial
   and si.confirmed_at is not null
   and (si.confirmed_at at time zone 'utc')::date <= p_to
  where ko.owner_id = p_owner_id
),
cycles_all as (
  select
    kl.serial, wc.id as cycle_id, wc.cycle_no, wc.opened_at, wc.closed_at,
    lead(wc.opened_at) over (partition by kl.serial order by wc.cycle_no) as next_opened_at
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join wash_cycles wc on wc.serial = kl.serial
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
active_cycle_at_to as (
  select distinct on (serial) serial, opened_at, closed_at
  from cycles_all
  where (opened_at at time zone 'utc')::date <= p_to
  order by serial, opened_at desc
),
moykada_total as (
  select coalesce(sum(greatest(0,
    coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = ac.serial and ms.sent_date >= (ac.opened_at at time zone 'utc')::date and ms.sent_date <= p_to), 0)
    - coalesce((select sum(fp.weight_kg) from finished_pallets fp where fp.serial = ac.serial and fp.status <> 'bekor_qilindi' and fp.received_date >= (ac.opened_at at time zone 'utc')::date and fp.received_date <= p_to), 0)
  )), 0) as kg
  from active_cycle_at_to ac
  where ac.closed_at is null or (ac.closed_at at time zone 'utc')::date > p_to
),
loss_totals as (
  select
    ca.serial, ca.cycle_id, ca.opened_at, ca.next_opened_at,
    coalesce((select sum(ms.qty_kg) from moyka_sends ms
              where ms.serial = ca.serial
                and ms.sent_date >= (ca.opened_at at time zone 'utc')::date
                and ms.sent_date <= (ca.closed_at at time zone 'utc')::date), 0) as sent_kg
  from cycles_all ca
  join client_lines cl on cl.serial = ca.serial
  where ca.closed_at is not null
    and (ca.closed_at at time zone 'utc')::date between p_from and p_to
    and cl.origin != 'opening_stock'
),
loss_output as (
  select
    lt.serial, lt.cycle_id,
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg
  from loss_totals lt
  join finished_pallets fp on fp.serial = lt.serial
  join calibres c on c.id = fp.calibre_id
  where fp.received_date >= (lt.opened_at at time zone 'utc')::date
    and (lt.next_opened_at is null or fp.received_date < (lt.next_opened_at at time zone 'utc')::date)
  group by lt.serial, lt.cycle_id
),
capped_by_serial as (
  select cbs.serial, cbs.actual_sent_kg, cl.effective_qty as effective_qty_kg,
    least(cbs.actual_sent_kg, cl.effective_qty) as capped_sent_kg,
    greatest(0, cbs.actual_sent_kg - cl.effective_qty) as overage_kg
  from (select serial, sum(sent_kg) as actual_sent_kg from loss_totals group by serial) cbs
  join client_lines cl on cl.serial = cbs.serial
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
loss_main as (
  select
    (select coalesce(sum(actual_sent_kg), 0) from capped_by_serial) as sent_kg,
    (select coalesce(sum(calibre_kg), 0) from loss_output) as calibre_kg,
    (select coalesce(sum(konditirskiy_kg), 0) from loss_output) as konditirskiy_kg
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
    'processedKg', (select coalesce(sum(capped_sent_kg), 0) from capped_by_serial),
    'processedActualSentKg', (select coalesce(sum(actual_sent_kg), 0) from capped_by_serial),
    'processedOverageKg', (select coalesce(sum(overage_kg), 0) from capped_by_serial),
    'rawDispatchedKg', (select kg from raw_dispatch_total),
    'moykadaKg', (select kg from moykada_total),
    'cappedSerials', (
      select coalesce(jsonb_agg(
        jsonb_build_object('serial', cbs.serial, 'actualSentKg', cbs.actual_sent_kg, 'effectiveQtyKg', cbs.effective_qty_kg, 'overageKg', cbs.overage_kg)
        order by cbs.serial
      ), '[]'::jsonb)
      from capped_by_serial cbs where cbs.overage_kg > 0
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
        ) order by rt.type_id
      ), '[]'::jsonb)
      from (select distinct type_id from client_lines) rt
      left join (select type_id, coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg from client_lines where arrival_date < p_from and has_intake and not closed_before_from group by type_id) rot on rot.type_id = rt.type_id
      left join (select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to and origin = 'delivery' group by type_id) rrt on rrt.type_id = rt.type_id
      left join (select type_id, coalesce(sum(sent_during_period_kg), 0) as kg from client_lines group by type_id) rsmt on rsmt.type_id = rt.type_id
      left join (select cl.type_id, coalesce(sum(cbs.capped_sent_kg), 0) as kg from capped_by_serial cbs join client_lines cl on cl.serial = cbs.serial group by cl.type_id) rpt on rpt.type_id = rt.type_id
      left join (select type_id, coalesce(sum(net_kg), 0) as kg from raw_dispatch_events where request_date between p_from and p_to group by type_id) rdt on rdt.type_id = rt.type_id
      left join (select cl.type_id, coalesce(sum(greatest(0,
          coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = ac.serial and ms.sent_date >= (ac.opened_at at time zone 'utc')::date and ms.sent_date <= p_to), 0)
          - coalesce((select sum(fp.weight_kg) from finished_pallets fp where fp.serial = ac.serial and fp.status <> 'bekor_qilindi' and fp.received_date >= (ac.opened_at at time zone 'utc')::date and fp.received_date <= p_to), 0)
        )), 0) as kg
        from active_cycle_at_to ac join client_lines cl on cl.serial = ac.serial
        where ac.closed_at is null or (ac.closed_at at time zone 'utc')::date > p_to
        group by cl.type_id) mbt on mbt.type_id = rt.type_id
      left join (select type_id, coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to group by type_id) rct on rct.type_id = rt.type_id
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

-- 5. rahbar_dashboard_ledger -- same shape of fix as get_client_report
-- (LATERAL latest-cycle for the plain wc.closed_at field; cycles_all +
-- active_cycle_at_to/active_cycle_before_from for the real figures).
-- moyka_in_process/moyka_opening_total rewritten off the active-cycle
-- pattern (same rule as kirim_line_moyka_asof, evaluated at p_to and
-- p_from respectively). processed_lines' sent_capped_kg base sum is now
-- the active-at-p_to cycle's own window-bounded sends, capped at
-- effective_qty; the 0108 open-cycle subtraction is unchanged in shape.

create or replace function public.rahbar_dashboard_ledger(p_from date, p_to date, p_scope text)
returns jsonb
language sql
stable
as $function$
with lines as (
  select
    kl.serial, kl.type_id, ko.origin,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date,
    (si.serial is not null) as has_intake,
    lc.closed_at,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date < p_from) as rezka_sent_before_from_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date <= p_to) as rezka_sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date < p_from
    ) as closed_before_from,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date <= p_to
    ) as closed_as_of_to,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date < p_from) as output_before_from_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join lateral (
    select wc.closed_at from wash_cycles wc where wc.serial = kl.serial order by wc.cycle_no desc limit 1
  ) lc on true
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
cycles_all as (
  select
    kl.serial, wc.id as cycle_id, wc.cycle_no, wc.opened_at, wc.closed_at,
    lead(wc.opened_at) over (partition by kl.serial order by wc.cycle_no) as next_opened_at
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join wash_cycles wc on wc.serial = kl.serial
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
active_cycle_at_to as (
  select distinct on (serial) serial, opened_at, closed_at
  from cycles_all
  where (opened_at at time zone 'utc')::date <= p_to
  order by serial, opened_at desc
),
active_cycle_before_from as (
  select distinct on (serial) serial, opened_at, closed_at
  from cycles_all
  where (opened_at at time zone 'utc')::date < p_from
  order by serial, opened_at desc
),
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from lines where arrival_date < p_from and has_intake and not closed_before_from
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from lines where arrival_date between p_from and p_to and has_intake
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
raw_storage_loss_period as (
  select coalesce(sum(osc.book_remaining_kg), 0) as kg
  from old_stock_closeouts osc
  where osc.kind = 'old_raw'
    and (osc.closed_at at time zone 'utc')::date between p_from and p_to
    and (p_scope = 'hammasi' or p_scope = 'eski')
),
moyka_in_process as (
  select coalesce(sum(greatest(0,
    coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = ac.serial and ms.sent_date >= (ac.opened_at at time zone 'utc')::date and ms.sent_date <= p_to), 0)
    - coalesce((select sum(fp.weight_kg) from finished_pallets fp where fp.serial = ac.serial and fp.received_date <= p_to), 0)
  )), 0) as kg
  from active_cycle_at_to ac
  join lines l on l.serial = ac.serial
  where l.arrival_date <= p_to and l.has_intake
    and (ac.closed_at is null or (ac.closed_at at time zone 'utc')::date > p_to)
),
moyka_opening_total as (
  select coalesce(sum(greatest(0,
    coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = ac.serial and ms.sent_date >= (ac.opened_at at time zone 'utc')::date and ms.sent_date < p_from), 0)
    - coalesce((select sum(fp.weight_kg) from finished_pallets fp where fp.serial = ac.serial and fp.received_date < p_from), 0)
  )), 0) as kg
  from active_cycle_before_from ac
  join lines l on l.serial = ac.serial
  where l.arrival_date < p_from and l.has_intake
    and (ac.closed_at is null or (ac.closed_at at time zone 'utc')::date >= p_from)
),
moyka_send_events as (
  select ms.id, ms.serial, ms.sent_date, ms.qty_kg
  from moyka_sends ms
  join kirim_lines kl on kl.serial = ms.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
raw_dispatch_events as (
  select rdl.id, rdl.serial, cr.request_date, rdl.net_kg
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join kirim_lines kl on kl.serial = rdl.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
moyka_sent_period_total as (
  select coalesce(sum(qty_kg), 0) as kg from moyka_send_events where sent_date between p_from and p_to
),
raw_dispatch_period_total as (
  select coalesce(sum(net_kg), 0) as kg from raw_dispatch_events where request_date between p_from and p_to
),
processed_lines as (
  select
    kl.serial, kl.type_id,
    least(
      coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date >= (ac.opened_at at time zone 'utc')::date and ms.sent_date <= p_to), 0),
      rkr.qty_kg
    )
    - case when ac.closed_at is null or (ac.closed_at at time zone 'utc')::date > p_to
           then greatest(0,
             coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date >= (ac.opened_at at time zone 'utc')::date and ms.sent_date <= p_to), 0)
           - coalesce((select sum(fp.weight_kg) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to), 0))
           else 0 end as sent_capped_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  join active_cycle_at_to ac on ac.serial = kl.serial
  where exists (
      select 1 from finished_pallets fp2
      where fp2.serial = kl.serial
        and fp2.received_date between p_from and p_to
        and not (fp2.status = 'bekor_qilindi' and (fp2.voided_at is null or (fp2.voided_at at time zone 'utc')::date <= p_to))
        and not (fp2.status = 'storage_loss' and (fp2.voided_at is null or (fp2.voided_at at time zone 'utc')::date <= p_to))
        and not exists (
          select 1 from serial_mint_sources sms
          where sms.source_barcode2 = fp2.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to
        )
    )
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
processed_output as (
  select
    pl.type_id, fp.calibre_id,
    coalesce(sum(fp.weight_kg), 0) as output_kg
  from processed_lines pl
  join finished_pallets fp on fp.serial = pl.serial
  where fp.received_date between p_from and p_to
    and not (fp.status = 'bekor_qilindi' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
    and not (fp.status = 'storage_loss' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to
    )
  group by pl.type_id, fp.calibre_id
),
processed_total as (
  select coalesce(sum(sent_capped_kg), 0) as kg from processed_lines
),
processed_calibre_total as (
  select coalesce(sum(po.output_kg), 0) as kg from processed_output po join calibres c on c.id = po.calibre_id where not c.is_numberless
),
processed_konditirskiy_total as (
  select coalesce(sum(po.output_kg), 0) as kg from processed_output po join calibres c on c.id = po.calibre_id where c.is_numberless
),
processed_loss_total as (
  select
    (select kg from processed_total)
    - (select kg from processed_calibre_total)
    - (select kg from processed_konditirskiy_total) as kg
),
pallet_base as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, kl.type_id, fp.weight_kg, fp.received_date, ko.origin
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where fp.received_date <= p_to
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to
    )
    and not (fp.status = 'bekor_qilindi' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
    and not (fp.status = 'storage_loss' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
),
pallet_departures as (
  select
    c.barcode2,
    (cgw.completed_at at time zone 'utc')::date as departure_date,
    c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join pallet_base pb on pb.barcode2 = c.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
  where cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
),
pallet_departed_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from pallet_departures
  group by barcode2
),
pallets as (
  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    greatest(0, pb.weight_kg - coalesce(pdt.kg, 0)) as weight_kg,
    pb.received_date, pb.origin,
    null::date as departure_date
  from pallet_base pb
  left join pallet_departed_total pdt on pdt.barcode2 = pb.barcode2

  union all

  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    pd.weight_kg,
    pb.received_date, pb.origin,
    pd.departure_date
  from pallet_departures pd
  join pallet_base pb on pb.barcode2 = pd.barcode2
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where (received_date < p_from or origin = 'opening_stock') and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where received_date between p_from and p_to and origin != 'opening_stock'
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets where departure_date between p_from and p_to
),
finished_dispatched_by_calibre_type as (
  select type_id, calibre_id, coalesce(sum(weight_kg), 0) as kg
  from pallets where departure_date between p_from and p_to
  group by type_id, calibre_id
),
bucket_size as (
  select case when (p_to - p_from) <= 31 then 1 else 7 end as days
),
buckets as (
  select gs::date as bucket_start
  from bucket_size bs, generate_series(p_from, p_to, (bs.days || ' days')::interval) gs
),
chart_kirdi as (
  select b.bucket_start, coalesce(sum(l.effective_qty), 0) as kg
  from buckets b
  left join lines l on l.arrival_date >= b.bucket_start and l.arrival_date < b.bucket_start + (select days from bucket_size)
    and l.arrival_date between p_from and p_to and l.has_intake
  group by b.bucket_start
),
chart_chiqgan as (
  select b.bucket_start, coalesce(sum(mse.qty_kg), 0) as kg
  from buckets b
  left join moyka_send_events mse on mse.sent_date >= b.bucket_start and mse.sent_date < b.bucket_start + (select days from bucket_size)
    and mse.sent_date between p_from and p_to
  group by b.bucket_start
),
chart_vozvrat as (
  select b.bucket_start, coalesce(sum(rde.net_kg), 0) as kg
  from buckets b
  left join raw_dispatch_events rde on rde.request_date >= b.bucket_start and rde.request_date < b.bucket_start + (select days from bucket_size)
    and rde.request_date between p_from and p_to
  group by b.bucket_start
),
raw_identity_residual as (
  select (select kg from raw_opening_total) + (select kg from raw_received_total)
       - (select kg from raw_dispatch_period_total) - (select kg from moyka_sent_period_total)
       - (select kg from raw_storage_loss_period) - (select kg from raw_closing_total) as kg
),
moyka_identity_residual as (
  select (select kg from moyka_opening_total) + (select kg from moyka_sent_period_total)
       - (select kg from processed_total) - (select kg from moyka_in_process) as kg
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to, 'scope', p_scope, 'bucketDays', (select days from bucket_size)),
  'raw', jsonb_build_object(
    'openingKg', (select kg from raw_opening_total),
    'receivedKg', (select kg from raw_received_total),
    'dispatchedKg', (select kg from raw_dispatch_period_total),
    'sentToMoykaKg', (select kg from moyka_sent_period_total),
    'storageLossKg', (select kg from raw_storage_loss_period),
    'closingKg', (select kg from raw_closing_total),
    'residualKg', (select kg from raw_identity_residual),
    'residualNote', 'diagnostic only, formulas unchanged -- opening+received-dispatched-sentToMoyka-storageLoss-closing; nonzero only when a line was sent/dispatched for more than its own effective raw qty (raw_closing_total''s floor absorbs the excess). Render only when nonzero.'
  ),
  'moykadaSnapshot', jsonb_build_object(
    'openingKg', (select kg from moyka_opening_total),
    'closingKg', (select kg from moyka_in_process),
    'asOfDate', p_to,
    'residualKg', (select kg from moyka_identity_residual),
    'note', 'point-in-time balances (opening as of p_from, closing as of p_to), not period flows -- not part of either ledger''s own closing identity. Together with raw.sentToMoykaKg and moyka.processedKg they form Ledger B''s own identity: openingKg + sentToMoykaKg - processedKg = closingKg. residualKg is that identity''s diagnostic slack, exact except in the same over-send edge case as raw.residualKg -- see migration header "Known edge case". Render only when nonzero.'
  ),
  'moyka', jsonb_build_object(
    'processedKg', (select kg from processed_total),
    'calibreKg', (select kg from processed_calibre_total),
    'konditirskiyKg', (select kg from processed_konditirskiy_total),
    'lossKg', (select kg from processed_loss_total),
    'lossPct', case when (select kg from processed_total) > 0
      then round((select kg from processed_loss_total) / (select kg from processed_total) * 100, 1)
      else 0 end
  ),
  'finished', jsonb_build_object(
    'openingKg', (select kg from finished_opening_total),
    'producedKg', (select kg from finished_produced_total),
    'dispatchedKg', (select kg from finished_dispatched_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total) - (select kg from finished_dispatched_total)
  ),
  'byCalibreType', jsonb_build_object(
    'processed', (
      select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', output_kg)), '[]'::jsonb)
      from processed_output
    ),
    'dispatched', (
      select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', kg)), '[]'::jsonb)
      from finished_dispatched_by_calibre_type
    )
  ),
  'chart', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'bucketStart', k.bucket_start,
        'kirdiKg', k.kg,
        'chiqganKg', c.kg,
        'vozvratKg', v.kg
      ) order by k.bucket_start
    ), '[]'::jsonb)
    from chart_kirdi k
    join chart_chiqgan c on c.bucket_start = k.bucket_start
    join chart_vozvrat v on v.bucket_start = k.bucket_start
  )
);
$function$;

-- 6. client_serial_ledger -- was one is_final/gap_kg pair (existence check
-- with no p_to_date bound at all, and an unbounded whole-serial gap once
-- true). Replaced with kirim_line_moyka_asof (vPererabotkeKg) and the new
-- kirim_line_loss_asof (poteryaKg) -- both already cycle-correct. Under
-- multi-cycle these can now BOTH be non-zero at once (a closed cycle's
-- booked loss and a later open cycle's own in-process balance are not
-- mutually exclusive, unlike the old single-gap design). Deliberate
-- display change: vPererabotkeKg now reads 0 (never null) when nothing is
-- in process, matching kirim_line_moyka_asof's own convention -- the old
-- code rendered null in that case (mutually exclusive with poteryaKg).

create or replace function public.client_serial_ledger(p_from_date date, p_to_date date, p_product_type_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with
me as (select my_owner_id() as owner_id),
scoped as (
  select rkr.*
  from report_kirim_rows_as_of(p_to_date) rkr, me
  where rkr.owner_id = me.owner_id
    and rkr.origin = 'delivery'
    and rkr.date_basis between p_from_date and p_to_date
    and not rkr.provisional
    and (p_product_type_id is null or rkr.type_id = p_product_type_id)
),
serial_base as (
  select
    s.serial, s.type_id, s.partiya_no, s.date_basis, s.declared_qty, s.qty_kg as netto_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl
       join chiqim_lines cl on cl.id = rdl.chiqim_line_id
       join chiqim_requests cr on cr.id = cl.request_id
     where rdl.serial = s.serial and cr.request_date <= p_to_date) as vozvrat_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
     where ms.serial = s.serial and ms.sent_date <= p_to_date) as moyka_kg,
    kirim_line_moyka_asof(s.serial, p_to_date) as v_pererabotke_kg,
    kirim_line_loss_asof(s.serial, p_to_date) as poterya_kg
  from scoped s
),
pallet_base as (
  select fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg
  from finished_pallets fp
  join serial_base sb on sb.serial = fp.serial
  where fp.received_date <= p_to_date
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to_date
    )
    and not (fp.status = 'bekor_qilindi' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to_date))
    and not (fp.status = 'storage_loss' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to_date))
),
output_by_calibre as (
  select pb.serial, pb.calibre_id, c.label, c.code, c.sort_order, c.is_numberless,
         sum(pb.weight_kg) as kg
  from pallet_base pb join calibres c on c.id = pb.calibre_id
  group by pb.serial, pb.calibre_id, c.label, c.code, c.sort_order, c.is_numberless
),
output_by_serial as (
  select serial,
         coalesce(sum(kg) filter (where not is_numberless), 0) as calibre_kg,
         coalesce(sum(kg) filter (where is_numberless), 0) as kn_kg
  from output_by_calibre group by serial
),
dispatch_events as (
  select fp.serial, cr.request_date, cr.plate, fp.calibre_id, c.label, c.code, c.sort_order,
         sum(cpc.qty_kg) as kg
  from chiqim_pallet_consumption cpc
  join chiqim_lines cl on cl.id = cpc.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = cpc.barcode2
  join serial_base sb on sb.serial = fp.serial
  join calibres c on c.id = fp.calibre_id
  where chiqim_departed_at(cr.id) is not null
    and (chiqim_departed_at(cr.id) at time zone 'utc')::date <= p_to_date
  group by fp.serial, cr.request_date, cr.plate, fp.calibre_id, c.label, c.code, c.sort_order
),
dispatch_by_serial as (
  select serial, coalesce(sum(kg), 0) as kg from dispatch_events group by serial
),
rows_built as (
  select
    sb.serial, sb.type_id, sb.partiya_no, sb.date_basis, sb.declared_qty, sb.netto_kg,
    sb.vozvrat_kg, sb.moyka_kg, sb.v_pererabotke_kg, sb.poterya_kg,
    coalesce(os.calibre_kg, 0) as calibre_kg,
    coalesce(os.kn_kg, 0) as kn_kg,
    coalesce(os.calibre_kg, 0) + coalesce(os.kn_kg, 0) as processed_kg,
    coalesce(db.kg, 0) as dispatched_kg
  from serial_base sb
  left join output_by_serial os on os.serial = sb.serial
  left join dispatch_by_serial db on db.serial = sb.serial
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'serial', r.serial,
      'typeId', r.type_id,
      'partiyaNo', r.partiya_no,
      'date', r.date_basis,
      'declaredQtyKg', r.declared_qty,
      'nettoKg', r.netto_kg,
      'vozvratKg', r.vozvrat_kg,
      'raznitsaKg', r.declared_qty - r.netto_kg,
      'moykaKg', r.moyka_kg,
      'vPererabotkeKg', r.v_pererabotke_kg,
      'poteryaKg', r.poterya_kg,
      'itogoPererabotkaKg', r.processed_kg,
      'otgruzkaKg', r.dispatched_kg,
      'ostatokSyryaKg', r.netto_kg - r.vozvrat_kg - r.moyka_kg,
      'ostatokGotovoyKg', r.processed_kg - r.dispatched_kg,
      'calibres', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'calibreId', oc.calibre_id, 'label', oc.label, 'code', oc.code, 'kg', oc.kg, 'isNumberless', oc.is_numberless
        ) order by oc.sort_order), '[]'::jsonb)
        from output_by_calibre oc where oc.serial = r.serial
      ),
      'dispatches', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'date', de.request_date, 'plate', de.plate, 'calibreId', de.calibre_id,
          'label', de.label, 'code', de.code, 'kg', de.kg
        ) order by de.request_date, de.sort_order), '[]'::jsonb)
        from dispatch_events de where de.serial = r.serial
      )
    ) order by r.date_basis, r.serial), '[]'::jsonb)
    from rows_built r
  ),
  'totals', (
    select jsonb_build_object(
      'declaredQtyKg', coalesce(sum(r.declared_qty), 0),
      'nettoKg', coalesce(sum(r.netto_kg), 0),
      'vozvratKg', coalesce(sum(r.vozvrat_kg), 0),
      'raznitsaKg', coalesce(sum(r.netto_kg - r.declared_qty), 0),
      'moykaKg', coalesce(sum(r.moyka_kg), 0),
      'vPererabotkeKg', coalesce(sum(r.v_pererabotke_kg), 0),
      'poteryaKg', coalesce(sum(r.poterya_kg), 0),
      'itogoPererabotkaKg', coalesce(sum(r.processed_kg), 0),
      'otgruzkaKg', coalesce(sum(r.dispatched_kg), 0),
      'ostatokSyryaKg', coalesce(sum(r.netto_kg - r.vozvrat_kg - r.moyka_kg), 0),
      'ostatokGotovoyKg', coalesce(sum(r.processed_kg - r.dispatched_kg), 0),
      'serialCount', count(*)
    )
    from rows_built r
  )
);
$function$;

-- 7. client_panel_summary / rahbar_stock_snapshot -- both had the
-- identical structural bug: a raw wash_cycles join (fans out under
-- multi-cycle) feeding a per-line closed_at is null case, with no date
-- bound of any kind on sent_kg/output_kg, gated only on "is there ANY
-- open wash_cycles row" -- under multi-cycle, a fanned-out row for the
-- open cycle would have shown the FULL lifetime gap (including an
-- earlier, already-closed cycle's own booked loss) as "still in Moyka".
-- Neither function takes a date parameter of its own (both were
-- implicitly "right now"); both now delegate to kirim_line_moyka_asof
-- with current_date, already cycle-correct.

create or replace function public.client_panel_summary()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid := my_owner_id();
  v_raw_kg numeric := 0;
  v_finished_kg numeric := 0;
  v_moyka_kg numeric := 0;
  v_old jsonb;
  v_dispatched_kg numeric := 0;
begin
  if v_owner is null then
    return jsonb_build_object(
      'stock', jsonb_build_object('rawKg', 0, 'moykaKg', 0, 'finishedKg', 0, 'oldStockKg', 0),
      'dispatchedKg', 0
    );
  end if;

  select coalesce(sum(qty_kg), 0) into v_raw_kg
  from stock_on_hand_rows
  where owner_id = v_owner and bucket = 'raw_not_washed';

  select coalesce(sum(qty_kg), 0) into v_finished_kg
  from stock_on_hand_rows
  where owner_id = v_owner and barcode2 is not null and not is_old_stock;

  select coalesce(sum(kirim_line_moyka_asof(kl.serial, current_date)), 0) into v_moyka_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  where ko.owner_id = v_owner
    and ko.plate not like 'TEST-%'
    and exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial);

  v_old := client_old_stock_breakdown();

  select coalesce(sum(cl.qty_kg), 0) into v_dispatched_kg
  from chiqim_lines cl
  join chiqim_requests cr on cr.id = cl.request_id
  where cr.owner_id = v_owner
    and cr.plate not like 'TEST-%'
    and chiqim_departed_at(cr.id) is not null;

  return jsonb_build_object(
    'stock', jsonb_build_object(
      'rawKg', v_raw_kg,
      'moykaKg', v_moyka_kg,
      'finishedKg', v_finished_kg,
      'oldStockKg', coalesce((v_old -> 'oldWashed' ->> 'totalKg')::numeric, 0) + coalesce((v_old -> 'oldKn' ->> 'totalKg')::numeric, 0)
    ),
    'dispatchedKg', v_dispatched_kg
  );
end;
$function$;

create or replace function public.rahbar_stock_snapshot(p_scope text)
returns jsonb
language sql
stable
as $function$
with scoped as (
  select *
  from stock_on_hand_rows
  where (p_scope = 'hammasi'
      or (p_scope = 'yangi' and not is_old_stock)
      or (p_scope = 'eski' and is_old_stock))
),
raw_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'raw_not_washed'
),
finished_calibred_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and not c.is_numberless
),
finished_konditirskiy_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and c.is_numberless
),
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where bucket = 'old_kn'
),
old_kn_by_type as (
  select s.type_id, pt.name as type_name, coalesce(sum(s.qty_kg), 0) as kg
  from stock_on_hand_rows s
  join product_types pt on pt.id = s.type_id
  where s.bucket = 'old_kn'
  group by s.type_id, pt.name
),
moyka_lines as (
  select
    kl.serial,
    kirim_line_moyka_asof(kl.serial, current_date) as moykada_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  where exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
moykada_total as (
  select coalesce(sum(moykada_kg), 0) as kg from moyka_lines
),
by_type as (
  select type_id, coalesce(sum(qty_kg), 0) as kg
  from scoped
  group by type_id
),
by_calibre as (
  select s.type_id, s.calibre_id, c.is_numberless, coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null
  group by s.type_id, s.calibre_id, c.is_numberless
)
select jsonb_build_object(
  'rawKg', (select kg from raw_total),
  'finishedCalibredKg', (select kg from finished_calibred_total),
  'konditirskiyKg', (select kg from finished_konditirskiy_total),
  'oldKnKg', (select kg from old_kn_total),
  'moykadaKg', (select kg from moykada_total),
  'oldKnNote', 'pool stock -- not backed by finished_pallets, structurally outside Ledger C''s coverage; shown separately, never reconciled against it',
  'totalKg', (select kg from raw_total) + (select kg from finished_calibred_total)
             + (select kg from finished_konditirskiy_total) + (select kg from old_kn_total)
             + (select kg from moykada_total),
  'byType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_type
  ),
  'byCalibre', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'typeId', type_id, 'calibreId', calibre_id, 'isNumberless', is_numberless, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_calibre
  ),
  'oldKnByType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'typeName', type_name, 'kg', kg) order by kg desc), '[]'::jsonb)
    from old_kn_by_type
  ),
  'distinctTypeCount', (select count(*) from by_type)
);
$function$;

-- 8. lab_turnaround_avg -- earliest send WITHIN the specific cycle a lab
-- result belongs to (bounded below by wc.opened_at), not the whole-serial
-- earliest-ever send. A cycle 2 lab result previously measured turnaround
-- against cycle 1's old send date.

create or replace function public.lab_turnaround_avg()
returns numeric
language sql
stable
as $function$
  select avg(lr.sample_date - ms_first.sent_date)
  from lab_results lr
  join wash_cycles wc on wc.id = lr.wash_cycle_id
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select min(ms2.sent_date) as sent_date from moyka_sends ms2
    where ms2.serial = wc.serial and ms2.sent_date >= (wc.opened_at at time zone 'utc')::date
  ) ms_first on true
  where lr.scope = 'chiqim'
    and ko.plate not like 'TEST-%'
    and ko.origin != 'opening_stock';
$function$;

commit;
