-- 0107: rahbar_dashboard_ledger -- stop booking an OPEN wash cycle's
--       unreturned balance as washing loss.
--
-- ============================================================
-- SYMPTOM
-- ============================================================
-- Rahbar's dashboard reported 1,447 kg of washing loss on the default view
-- (boshidan 2026-07-15 -> today, scope "yangi"). Every other surface in the
-- app says 1,432 kg. `yield_rows` returns 1,432 across 10 serials.
--
-- ============================================================
-- CAUSE
-- ============================================================
-- processed_lines credits the FULL amount ever sent to Moyka
-- (least(sum(moyka_sends), effective_qty)), while processed_output counts
-- only pallets that have actually come back. For a serial mid-wash the
-- difference is not loss -- it is product still sitting in Moyka. Nothing
-- subtracted it.
--
-- Per-serial, on live data at 2026-08-31 (sent -> returned -> booked as loss):
--
--   150826-001   7,947 -> 7,380 ->  567    closed 2026-08-29
--   290726-071   1,912 -> 1,670 ->  242    closed
--   050826-001   6,460 -> 6,240 ->  220    closed
--   110826-001   7,320 -> 7,170 ->  150    closed
--   280726-029   2,218 -> 2,160 ->   58    closed
--   290726-072   2,203 -> 2,150 ->   53    closed
--   290726-068   2,320 -> 2,270 ->   50    closed
--   290726-069   2,255 -> 2,210 ->   45    closed
--   290726-070     617 ->   590 ->   27    closed
--   240826-001   1,040 -> 1,020 ->   20    closed
--                                 ------
--                                  1,432   <- what every other surface reports
--   110826-002   7,345 -> 7,330 ->   15    closed_at IS NULL, STILL OPEN
--                                 ------
--                                  1,447   <- what the dashboard reported
--
-- The one serial with an open wash cycle is the entire discrepancy.
-- `yield_rows` never sees it: its finished_serials CTE gates on
-- `closed_at is not null`. rahbar_dashboard_ledger had no such gate.
--
-- ============================================================
-- ATTRIBUTION -- this is 0106's, not a long-standing defect
-- ============================================================
-- Before 0106 (2026-08-30), processed_lines qualified on
-- wash_cycles.closed_at falling inside the period, which implicitly excluded
-- open cycles. 0106 moved it to Basis B (qualify on output-in-period) to fix
-- a real and larger problem -- that same serial's 7,345 kg of input and
-- 7,330 kg of output were invisible to Ledger B entirely, which 0106's own
-- header names. Basis B is correct and stands. But dropping the closed_at
-- qualifier also dropped the only thing preventing an open cycle's
-- unreturned balance from being read as loss. 0107 restores that protection
-- without giving up Basis B: the serial still counts, only its unreturned
-- balance does not count as loss.
--
-- ============================================================
-- IT WAS ALSO A DOUBLE COUNT
-- ============================================================
-- moyka_in_process (feeding moykadaSnapshot.closingKg, 24,030 kg) already
-- counts an open cycle's unreturned balance as stock -- by design. So those
-- 15 kg were reported twice: once as loss, once as available stock in Moyka.
--
-- That is what moykadaSnapshot.residualKg has been reading as -15. When 0106
-- went in the residual moved 7,330 -> -15 and I predicted it would reach 0;
-- it did not, and the remaining -15 was the double count, not slack. 0107
-- closes it.
--
-- ============================================================
-- FIX
-- ============================================================
-- Subtract the still-unreturned balance from sent_capped_kg when the wash
-- cycle is open AS OF p_to. The `(closed_at)::date > p_to` half covers
-- historical periods: a serial closed today but open at some past p_to gets
-- the same treatment when that period is viewed. On today's rows that half
-- changes no number -- see "HISTORICAL PERIODS" below, where it is measured
-- rather than assumed.
--
-- The subtraction's two subqueries mirror moyka_in_process's formula exactly
-- -- same date bounds, and deliberately no pallet-status filter -- so the
-- two sides cannot drift apart and reopen the double count. Chosen over
-- giving this side pallet_base's exclusion set unilaterally: symmetry with
-- the figure it has to reconcile against is what keeps the residual at 0.
-- If either side ever gains an exclusion set, the other must gain the same
-- one in the same commit.
--
-- ============================================================
-- MEASURED, live, boshidan (2026-07-15 -> 2026-08-31), scope "yangi"
-- ============================================================
--                                before      after
--   moyka.processedKg            41,637     41,622
--   moyka.lossKg                  1,447      1,432   = yield_rows, exactly
--   moyka.lossPct                   3.5%       3.4%
--   moykadaSnapshot.residualKg      -15          0
--
-- calibreKg (33,820) and konditirskiyKg (6,370) are untouched -- the fix is
-- entirely on the input side of the loss subtraction.
--
-- ============================================================
-- HISTORICAL PERIODS -- measured, and the guard is a NO-OP today
-- ============================================================
-- The `(closed_at at time zone 'utc')::date > p_to` half of the guard is
-- there so a serial that is closed NOW but was open at some past p_to gets
-- the same treatment when that past period is viewed. That is the correct
-- behaviour, but on today's data it changes nothing: measured before/after
-- across p_to = 08-11, 08-15, 08-18, 08-20, 08-24, 08-29, 08-31 (from
-- 2026-07-15, scope "yangi"), the numbers move ONLY at 08-29 and 08-31.
--
--   p_to        loss before 0107   loss after 0107
--   2026-08-18       -1,428            -1,428      (unchanged)
--   2026-08-20          462               462      (unchanged)
--   2026-08-24          462               462      (unchanged)
--   2026-08-29        1,447             1,432      <- changed
--   2026-08-31        1,447             1,432      <- changed
--
-- Stated explicitly per CLAUDE.md's rule about exclusions that only appear
-- to work because the data does not currently overlap: this guard is
-- deliberate and load-bearing for future periods, it is simply unexercised
-- by the rows that exist today. It is not an accident being passed off as a
-- filter.
--
-- ============================================================
-- PRE-EXISTING ANOMALIES SEEN WHILE MEASURING -- NOT this migration's,
-- NOT fixed here
-- ============================================================
--   * p_to = 2026-08-18 reports NEGATIVE loss, -1,428 kg. Identical before
--     and after 0107 (table above), so 0107 neither causes nor fixes it.
--     Cause is the mixed time basis already logged in DECISIONS.md
--     (2026-08-30): sent_capped_kg counts ALL-TIME moyka sends while the
--     output it is compared against is period-bounded, so a period whose
--     output outruns its own in-period sends goes negative. Recording the
--     negative-loss instance here as new evidence of that defect's reach --
--     the logged entry did not have a case this stark.
--   * p_to = 2026-08-24 reports moykadaSnapshot.residualKg = 1,040, also
--     identical before and after.
--   * raw.residualKg reads -1,040 on the current period, before and after.
--     raw_identity_residual does not reference processed_lines at all, so it
--     is untouched by this migration. Flagged, not fixed.
--
-- ============================================================
-- NOT CHANGED (unchanged from 0106's own reported-not-fixed list)
-- ============================================================
--   * rahbar_dashboard_ledger's output_before_from_kg / output_as_of_to_kg
--     are still unfiltered for pallet status.
--   * get_client_report has the identical unfiltered subquery feeding
--     raw.moykadaKg, and it is CLIENT-FACING. Still on the do-not-change
--     list. NOTE: get_client_report computes loss per serial from closed
--     wash cycles, so it does NOT have this migration's defect -- checked,
--     not assumed.
--   * The mixed time-basis defect (DECISIONS.md 2026-08-30) is untouched.
--
-- Reproduced verbatim from 0106 apart from processed_lines' subtraction.
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
    )
    -- 2026-08-31: subtract what has NOT come back yet from a wash cycle that
    -- is still open as of p_to. See this migration's header for the full
    -- reasoning; in short, Basis B (0106) correctly brought open serials into
    -- Ledger B but credited their FULL send against partial output, booking
    -- the unreturned balance as loss. That balance is stock sitting in Moyka,
    -- and moyka_in_process already counts it as such -- so it was reported
    -- twice, and processed_loss_total was overstated by exactly that amount.
    --
    -- The two subqueries below mirror moyka_in_process's formula EXACTLY
    -- (same date bounds, same lack of a pallet-status filter) so the two
    -- cannot drift apart and reopen the double count. If one side ever gains
    -- an exclusion set, the other must gain the same one in the same commit.
    - case when wc.closed_at is null or (wc.closed_at at time zone 'utc')::date > p_to
           then greatest(0,
             (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
               where ms.serial = kl.serial and ms.sent_date <= p_to)
           - (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp
               where fp.serial = kl.serial and fp.received_date <= p_to))
           else 0 end as sent_capped_kg
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