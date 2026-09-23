-- Rezka build, Prompt 1 of 4 (2026-09-23) -- part 3: the two period
-- ledgers that carry a finished-pallet balance (Ledger C in
-- rahbar_dashboard_ledger, and get_client_report's finished block) learn
-- about rezka_kn_draws, and rahbar_stock_snapshot gets its Rezka split back.
-- Decisions: docs/decisions/0220-* (draw ledger), 0221-* (snapshot
-- regression). Bodies below are the LIVE definitions as of 2026-09-23
-- (0137 for rahbar_dashboard_ledger; 0127 lineage for get_client_report;
-- 0137 for rahbar_stock_snapshot) with only the marked edits.
--
-- LEDGER C / CLIENT FINISHED. A Rezka draw is neither production nor a
-- dispatch: it is its own outflow. Each ledger's `pallets` union gets a
-- third branch (draw rows, out_kind='rezka', dated drawn_at) beside the
-- existing still-here and departure branches; the still-here weight nets
-- out draws exactly like it nets out departures. Consequences:
--   producedKg   -- unchanged (the pieces still sum to the full pallet)
--   dispatchedKg -- unchanged (filtered to out_kind='chiqim')
--   rezkaDrawnKg -- NEW, the period's draws
--   closingKg    -- opening + produced - dispatched - rezkaDrawn
-- so the identity still closes and Rezka never sits inside a Moyka/CHIQIM
-- figure. Ledger B (processed/loss) is untouched: draws don't change what
-- Moyka produced.
--
-- SNAPSHOT (R5). 0076 split "Rezka KN" out of konditirskiyKg; the very next
-- rewrite, 0080_rahbar_stock_snapshot_moykada, rebuilt the function from
-- the pre-0076 body and silently dropped it, and every later rewrite
-- (0086, 0101, 0102, 0106, 0112, 0120, 0127, 0137) inherited the loss.
-- Restored: konditirskiyKg excludes is_rezka_output; rezkaKnKg = finished
-- Rezka-output pallets; rezkaRawKg = unsent raw on process='rezka' serials
-- (moved OUT of rawKg -- Rezka figures never sit inside Moyka figures, so
-- totalKg is unchanged by the move). Internal (Ichki) Rezka serials add 0
-- to rezkaRawKg by construction: no storage_intake row, and they are sent
-- in full at mint time.

-- ------------------------------------------------------------------
-- 1. rahbar_dashboard_ledger
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rahbar_dashboard_ledger(p_from date, p_to date, p_scope text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$

with ms_bf as (select serial, sum(qty_kg) kg from moyka_sends where sent_date < p_from group by serial),
ms_to as (select serial, sum(qty_kg) kg from moyka_sends where sent_date <= p_to group by serial),
rz_bf as (select serial, sum(qty_kg) kg from rezka_sends where sent_date < p_from group by serial),
rz_to as (select serial, sum(qty_kg) kg from rezka_sends where sent_date <= p_to group by serial),
rd_bf as (select rdl.serial, sum(rdl.net_kg) kg from raw_dispatch_lines rdl
  join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id
  join chiqim_requests cr3 on cr3.id = cl3.request_id
  where cr3.request_date < p_from group by rdl.serial),
rd_to as (select rdl.serial, sum(rdl.net_kg) kg from raw_dispatch_lines rdl
  join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id
  join chiqim_requests cr3 on cr3.id = cl3.request_id
  where cr3.request_date <= p_to group by rdl.serial),
fp_bf as (select serial, sum(weight_kg) kg from finished_pallets where received_date < p_from group by serial),
fp_to as (select serial, sum(weight_kg) kg from finished_pallets where received_date <= p_to group by serial),
co_bf as (select distinct owner_id, type_id from old_stock_closeouts
  where kind = 'old_raw' and (closed_at at time zone 'utc')::date < p_from),
co_to as (select distinct owner_id, type_id from old_stock_closeouts
  where kind = 'old_raw' and (closed_at at time zone 'utc')::date <= p_to),
lines as (
  select
    kl.serial, kl.type_id, ko.origin,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date,
    (si.serial is not null) as has_intake,
    lc.closed_at,
    coalesce(ms_bf.kg, 0) as sent_before_from_kg,
    coalesce(ms_to.kg, 0) as sent_as_of_to_kg,
    coalesce(rz_bf.kg, 0) as rezka_sent_before_from_kg,
    coalesce(rz_to.kg, 0) as rezka_sent_as_of_to_kg,
    coalesce(rd_bf.kg, 0) as dispatched_before_from_kg,
    coalesce(rd_to.kg, 0) as dispatched_as_of_to_kg,
    (co_bf.owner_id is not null) as closed_before_from,
    (co_to.owner_id is not null) as closed_as_of_to,
    coalesce(fp_bf.kg, 0) as output_before_from_kg,
    coalesce(fp_to.kg, 0) as output_as_of_to_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join lateral (
    select wc.closed_at from wash_cycles wc where wc.serial = kl.serial order by wc.cycle_no desc limit 1
  ) lc on true
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  left join ms_bf on ms_bf.serial = kl.serial
  left join ms_to on ms_to.serial = kl.serial
  left join rz_bf on rz_bf.serial = kl.serial
  left join rz_to on rz_to.serial = kl.serial
  left join rd_bf on rd_bf.serial = kl.serial
  left join rd_to on rd_to.serial = kl.serial
  left join fp_bf on fp_bf.serial = kl.serial
  left join fp_to on fp_to.serial = kl.serial
  left join co_bf on co_bf.owner_id = ko.owner_id and co_bf.type_id = kl.type_id
  left join co_to on co_to.owner_id = ko.owner_id and co_to.type_id = kl.type_id
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
-- 0143: Rezka internal KN draws, their own outflow kind
pallet_rezka_draws as (
  select
    d.barcode2,
    (d.drawn_at at time zone 'utc')::date as draw_date,
    d.qty_kg as weight_kg
  from rezka_kn_draws d
  join pallet_base pb on pb.barcode2 = d.barcode2
  where (d.drawn_at at time zone 'utc')::date <= p_to
),
pallet_drawn_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from pallet_rezka_draws
  group by barcode2
),
pallets as (
  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    greatest(0, pb.weight_kg - coalesce(pdt.kg, 0) - coalesce(pdr.kg, 0)) as weight_kg,
    pb.received_date, pb.origin,
    null::date as departure_date,
    null::text as out_kind
  from pallet_base pb
  left join pallet_departed_total pdt on pdt.barcode2 = pb.barcode2
  left join pallet_drawn_total pdr on pdr.barcode2 = pb.barcode2

  union all

  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    pd.weight_kg,
    pb.received_date, pb.origin,
    pd.departure_date,
    'chiqim'::text as out_kind
  from pallet_departures pd
  join pallet_base pb on pb.barcode2 = pd.barcode2

  union all

  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    prd.weight_kg,
    pb.received_date, pb.origin,
    prd.draw_date,
    'rezka'::text as out_kind
  from pallet_rezka_draws prd
  join pallet_base pb on pb.barcode2 = prd.barcode2
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
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where out_kind = 'chiqim' and departure_date between p_from and p_to
),
finished_rezka_drawn_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where out_kind = 'rezka' and departure_date between p_from and p_to
),
finished_dispatched_by_calibre_type as (
  select type_id, calibre_id, coalesce(sum(weight_kg), 0) as kg
  from pallets where out_kind = 'chiqim' and departure_date between p_from and p_to
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
    'rezkaDrawnKg', (select kg from finished_rezka_drawn_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total)
               - (select kg from finished_dispatched_total) - (select kg from finished_rezka_drawn_total)
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

-- ------------------------------------------------------------------
-- 2. get_client_report (finished block only changes)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_client_report(p_owner_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
-- 0143: Rezka internal KN draws, their own outflow kind
client_pallet_rezka_draws as (
  select
    d.barcode2,
    (d.drawn_at at time zone 'utc')::date as draw_date,
    d.qty_kg as weight_kg
  from rezka_kn_draws d
  join client_pallet_base cpb on cpb.barcode2 = d.barcode2
  where (d.drawn_at at time zone 'utc')::date <= p_to
),
client_pallet_drawn_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from client_pallet_rezka_draws
  group by barcode2
),
client_pallets as (
  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    greatest(0, cpb.weight_kg - coalesce(cpdt.kg, 0) - coalesce(cpdr.kg, 0)) as weight_kg,
    cpb.received_date, cpb.origin,
    null::date as departure_date,
    null::text as out_kind
  from client_pallet_base cpb
  left join client_pallet_departed_total cpdt on cpdt.barcode2 = cpb.barcode2
  left join client_pallet_drawn_total cpdr on cpdr.barcode2 = cpb.barcode2

  union all

  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    cpd.weight_kg,
    cpb.received_date, cpb.origin,
    cpd.departure_date,
    'chiqim'::text as out_kind
  from client_pallet_departures cpd
  join client_pallet_base cpb on cpb.barcode2 = cpd.barcode2

  union all

  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    crd.weight_kg,
    cpb.received_date, cpb.origin,
    crd.draw_date,
    'rezka'::text as out_kind
  from client_pallet_rezka_draws crd
  join client_pallet_base cpb on cpb.barcode2 = crd.barcode2
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
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where out_kind = 'chiqim' and departure_date between p_from and p_to
),
finished_rezka_drawn_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where out_kind = 'rezka' and departure_date between p_from and p_to
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
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where out_kind = 'chiqim' and departure_date between p_from and p_to group by calibre_id
),
finished_rezka_drawn_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where out_kind = 'rezka' and departure_date between p_from and p_to group by calibre_id
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
      or exists (select 1 from client_pallets cp where cp.serial = cl.serial and cp.out_kind = 'chiqim' and cp.departure_date between p_from and p_to)
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
    'rezkaDrawnKg', (select kg from finished_rezka_drawn_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total)
               - (select kg from finished_dispatched_total) - (select kg from finished_rezka_drawn_total),
    'byCalibre', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'calibreId', fc.calibre_id,
          'openingKg', coalesce(fo.kg, 0), 'producedKg', coalesce(fp2.kg, 0), 'dispatchedKg', coalesce(fd.kg, 0),
          'rezkaDrawnKg', coalesce(frd.kg, 0),
          'closingKg', coalesce(fo.kg, 0) + coalesce(fp2.kg, 0) - coalesce(fd.kg, 0) - coalesce(frd.kg, 0)
        )
      ), '[]'::jsonb)
      from finished_calibres fc
      left join finished_opening_by_calibre fo on fo.calibre_id = fc.calibre_id
      left join finished_produced_by_calibre fp2 on fp2.calibre_id = fc.calibre_id
      left join finished_dispatched_by_calibre fd on fd.calibre_id = fc.calibre_id
      left join finished_rezka_drawn_by_calibre frd on frd.calibre_id = fc.calibre_id
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

-- ------------------------------------------------------------------
-- 3. rahbar_stock_snapshot -- Rezka split restored (lost in 0080)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rahbar_stock_snapshot(p_scope text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with all_rows as materialized (
  select * from stock_on_hand_rows
),
scoped as (
  select * from all_rows
  where (p_scope = 'hammasi'
      or (p_scope = 'yangi' and not is_old_stock)
      or (p_scope = 'eski' and is_old_stock))
),
rezka_serials as (
  select serial from kirim_lines where process = 'rezka'
),
raw_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped
  where bucket = 'raw_not_washed' and serial not in (select serial from rezka_serials)
),
rezka_raw_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped
  where bucket = 'raw_not_washed' and serial in (select serial from rezka_serials)
),
finished_calibred_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and not c.is_numberless
),
finished_konditirskiy_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and c.is_numberless and not c.is_rezka_output
),
finished_rezka_kn_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and c.is_rezka_output
),
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from all_rows where bucket = 'old_kn'
),
old_kn_by_type as (
  select s.type_id, pt.name as type_name, coalesce(sum(s.qty_kg), 0) as kg
  from all_rows s
  join product_types pt on pt.id = s.type_id
  where s.bucket = 'old_kn'
  group by s.type_id, pt.name
),
moyka_serials as (
  select kl.serial
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  where exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
active_cycle as (
  select distinct on (wc.serial) wc.serial, wc.opened_at, wc.closed_at
  from wash_cycles wc
  where wc.serial in (select serial from moyka_serials)
    and (wc.opened_at at time zone 'utc')::date <= current_date
  order by wc.serial, wc.opened_at desc
),
sends_since as (
  select a.serial, coalesce(sum(ms.qty_kg), 0) kg
  from active_cycle a
  left join moyka_sends ms
    on ms.serial = a.serial and ms.sent_date >= a.opened_at::date and ms.sent_date <= current_date
  group by a.serial
),
outs_since as (
  select a.serial, coalesce(sum(r.qty_kg), 0) kg
  from active_cycle a
  left join report_moyka_output_rows r
    on r.serial = a.serial and r.date_basis >= a.opened_at::date and r.date_basis <= current_date
   and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
   and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
  group by a.serial
),
moykada_total as (
  select coalesce(sum(
    case when a.closed_at is not null and (a.closed_at at time zone 'utc')::date <= current_date then 0
         else greatest(0, coalesce(s.kg, 0) - coalesce(o.kg, 0)) end), 0) as kg
  from active_cycle a
  left join sends_since s on s.serial = a.serial
  left join outs_since o on o.serial = a.serial
),
by_type as (
  select type_id, coalesce(sum(qty_kg), 0) as kg from scoped group by type_id
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
  'rezkaRawKg', (select kg from rezka_raw_total),
  'rezkaKnKg', (select kg from finished_rezka_kn_total),
  'oldKnKg', (select kg from old_kn_total),
  'moykadaKg', (select kg from moykada_total),
  'oldKnNote', 'pool stock -- not backed by finished_pallets, structurally outside Ledger C''s coverage; shown separately, never reconciled against it',
  'totalKg', (select kg from raw_total) + (select kg from finished_calibred_total)
             + (select kg from finished_konditirskiy_total) + (select kg from old_kn_total)
             + (select kg from moykada_total)
             + (select kg from rezka_raw_total) + (select kg from finished_rezka_kn_total),
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
