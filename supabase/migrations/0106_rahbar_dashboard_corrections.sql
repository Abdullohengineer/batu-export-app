-- Prompt 15: Rahbar dashboard corrections.
--
-- Three changes to rahbar_dashboard_ledger + one addition to
-- rahbar_stock_snapshot. Nothing else is touched: stock_on_hand_rows,
-- get_client_report and yield_rows are explicitly out of bounds and are not
-- modified here (get_client_report carries a related defect -- see the
-- "REACH" note below -- reported, deliberately not fixed in this pass).
--
-- ============================================================
-- 1. THE DOUBLE-COUNT, AND WHEN IT STARTED
--
-- processed_output joined finished_pallets with no filter at all. It has
-- been that way since the function was first written -- 0068, commit
-- 0491e46, 2026-08-12 -- so this is an 18-day-old defect in the original
-- dashboard, NOT a consequence of any recent work.
--
-- Reconstructed against real rows, using the cohort rule that was actually
-- live at each date (0068's status='final' gate) and respecting voided_at,
-- so a pallet only double-counts once it has really been voided:
--
--     p_to        reported   should be   overstated
--     2026-08-18     3,340      3,340          0
--     2026-08-19     3,340      3,340          0
--     2026-08-20    15,820      7,910      7,910   <-- first appearance
--     2026-08-25    16,840      8,930      7,910
--     2026-08-27    27,020     19,110      7,910
--     2026-08-28    49,940     25,480     24,460
--
-- It first appeared on 2026-08-20 -- the first voided_at in the table -- at
-- which point output was reported at exactly TWICE reality. It stepped to
-- 24,460 kg on 08-28 when a second batch of 16,550 kg was voided. The
-- 08-28 dispatch is coincident with that step, not its cause.
--
-- ============================================================
-- 2. WHY EACH EXCLUSION, INDIVIDUALLY (real counts, whole table, today)
--
--   bekor_qilindi   41 rows   24,460 kg   ALL 41 sit on closed serials
--     Void-and-remint: the pallet was re-registered at the same weight
--     under a new barcode, and BOTH rows are present. The live row is the
--     same physical product. Counting both states the material twice -- it
--     is the entire 24,460 kg overstatement. Nothing physical is dropped:
--     every kilogram removed here is still counted via its replacement row.
--
--   storage_loss     0 rows        0 kg
--     🚩 EXCLUDED ANYWAY, AND THIS IS THE ONE THAT IS ARGUABLY WRONG.
--     There are no such rows today, so this has zero effect on any current
--     figure and cannot be validated against data. But the semantics matter
--     for the first time it fires: product written off in storage DID come
--     out of Moyka and was real production. Excluding it from
--     processed_output therefore changes a HISTORICAL PRODUCTION figure,
--     not just a stock figure -- past output will appear to shrink when a
--     write-off happens later. It is excluded here only to keep Ledger B
--     and Ledger C counting an identical pallet set (the whole point of the
--     fix); the alternative -- exclude it from stock but keep it in
--     production -- is defensible and arguably more correct, but it would
--     make the two ledgers disagree again by exactly the written-off
--     amount. Flagged for a decision, not settled by this migration.
--     Revisit before the first storage_loss row exists.
--
--   mint-consumed    2 rows    1,040 kg   both status='consumed'
--     PLT-020826-034-04-1 (720 kg) and -04-2 (320 kg), serial 020826-034,
--     origin opening_stock, minted into serial 240826-001. This material
--     did not leave the building: it was re-minted into a new serial and is
--     counted there instead. Counting both the source pallet and the minted
--     serial's own output would double it. Both rows are opening_stock, so
--     under the dashboard's default 'yangi' scope they are already excluded
--     by origin -- which is why excluding them changes nothing today.
--
--   NET EFFECT: no exclusion here drops material that physically existed
--   and left the building. bekor_qilindi is superseded-in-place,
--   mint-consumed is counted-elsewhere, storage_loss is empty and flagged.
--
-- ============================================================
-- 3. BASIS B for Tayyor kalibrli (approved)
--
-- processed_lines gated on wash_cycles.closed_at falling inside the period
-- (note: the brief said status='final'; 0101 replaced that with closed_at
-- on 2026-08-29 -- same intent, different column). That dropped every
-- serial still open at period end. For August: 1 serial, 7,345 kg input and
-- 7,330 kg output invisible -- which is precisely the 7,330 kg
-- moykadaSnapshot.residualKg has been reporting as unexplained slack.
--
-- After: Ledger B output = 40,190 kg = Ledger C producedKg, exactly. The
-- two halves of the RPC stop contradicting each other and the residual
-- should reach 0.
--
-- ============================================================
-- REACH of the same defect, reported not fixed (out of bounds this pass):
--   * rahbar_dashboard_ledger lines 28-29 (output_before_from_kg /
--     output_as_of_to_kg) are also unfiltered. They feed the raw ledger's
--     opening/closing and moykadaSnapshot. NOT changed here -- the approved
--     scope is processed_output/processed_lines only.
--   * get_client_report line 20 has the identical unfiltered subquery
--     feeding raw.moykadaKg, and it is CLIENT-FACING. Measured for Global
--     Export: understated by 462 kg at p_to=2026-08-22, 482 kg at 08-25 and
--     865 kg at 08-28. Zero today only because every affected serial has
--     since closed. On the do-not-change list, so untouched.
--   * Correctly filtered already, for contrast: pallet_base (Ledger C),
--     client_pallet_base, rahbar_stock_snapshot's moyka_lines, and
--     kirim_line_state.

-- ============================================================
-- 5. rahbar_dashboard_ledger -- reproduced verbatim from 0104 apart from
--    processed_lines (Basis B) and processed_output (exclusion set).
-- ============================================================
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
    wc.closed_at,
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
  left join wash_cycles wc on wc.serial = kl.serial
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
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
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg) end
  ), 0) as kg
  from lines where arrival_date <= p_to and has_intake
),
moyka_opening_total as (
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date < p_from then 0
         else greatest(0, sent_before_from_kg - output_before_from_kg) end
  ), 0) as kg
  from lines where arrival_date < p_from and has_intake
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
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  -- Basis B (2026-08-30): a serial counts as processed in this period if it
  -- RETURNED OUTPUT in the period, not if it was closed in it. The closed_at
  -- gate silently dropped every serial still open at period end -- 7,345 kg
  -- of input and 7,330 kg of output for August alone -- which is exactly the
  -- slack moykadaSnapshot.residualKg has been reporting. Same exclusion set
  -- as pallet_base, so "has output" means output that still exists as of
  -- p_to (see processed_output below for why each exclusion is there).
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
  -- 2026-08-30 double-count fix. This join carried NO filter of any kind
  -- from the day it was written (0068, 2026-08-12), so every pallet a
  -- processed serial ever had was counted -- including ones voided and
  -- re-registered at the same weights. First manifested 2026-08-20 (7,910 kg,
  -- output reported at exactly 2x reality) and reached 24,460 kg by 08-28.
  -- It also had no period bound, so a serial's whole life was attributed to
  -- whichever period it happened to qualify in.
  --
  -- The exclusion set is pallet_base's, verbatim, not a new one -- so Ledger
  -- B and Ledger C now count the same pallets and their outputs reconcile.
  -- Each exclusion is date-aware (`<= p_to`) for the same reason pallet_base
  -- is: a pallet voided AFTER the period still legitimately counts as that
  -- period's output.
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

-- ============================================================
-- 4. rahbar_stock_snapshot: add byCalibre -- CURRENT STOCK per calibre,
--    for the per-calibre bars.
--
--    The bars were showing a period FLOW (August's output) under a heading
--    a reader takes for a balance. For August that read K4 = 23,570 kg while
--    only 960 kg of K4 is actually in stock -- the rest was dispatched.
--
--    Sourced straight from stock_on_hand_rows via the `scoped` CTE this
--    function already has: the same view Ombor qoldig'i reads, the same
--    scope filter, the same `barcode2 is not null` test the
--    finishedCalibredKg / konditirskiyKg tiles already use. No new balance
--    arithmetic -- this is a GROUP BY over rows the function already reads,
--    and it sums to those two tiles exactly, by construction.
--
--    Added as a new key on an existing jsonb return, so no signature change
--    and no DROP FUNCTION. `byType` is deliberately left in the payload
--    unused after the donut's removal, per instruction.
-- ============================================================
create or replace function public.rahbar_stock_snapshot(p_scope text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'old_kn'
),
moyka_lines as (
  select
    kl.serial,
    wc.closed_at,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_kg,
    -- voided pallets excluded: they are not product that came back from
    -- the wash, and counting them made this subtraction clamp to zero.
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp
      where fp.serial = kl.serial and fp.status <> 'bekor_qilindi') as output_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  left join wash_cycles wc on wc.serial = kl.serial
  where exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
moykada_total as (
  select coalesce(sum(case when closed_at is not null then 0 else greatest(0, sent_kg - output_kg) end), 0) as kg
  from moyka_lines
),
by_type as (
  select type_id, coalesce(sum(qty_kg), 0) as kg
  from scoped
  group by type_id
),
by_calibre as (
  select s.calibre_id, c.is_numberless, coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null
  group by s.calibre_id, c.is_numberless
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
      'calibreId', calibre_id, 'isNumberless', is_numberless, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_calibre
  ),
  'distinctTypeCount', (select count(*) from by_type)
);
$function$;
