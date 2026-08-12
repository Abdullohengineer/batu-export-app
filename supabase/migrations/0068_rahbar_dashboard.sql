-- Rahbar "Bosh sahifa" dashboard rebuild (2026-08-12, revised 2026-08-13),
-- per mockup docs/mockups/BATU-Rahbar-dashboard-v3.html. Replaces the
-- trends/ranking/product-mix dashboard (rahbar_monthly_trends/
-- rahbar_client_ranking/rahbar_product_mix, unchanged, untouched by this
-- migration) with a stock-reconciliation view: live zaxira snapshot + a
-- period ledger that ties opening -> closing exactly (except one documented
-- edge case, see "Known edge case" below).
--
-- ============================================================================
-- SYNC-TWIN OF get_client_report (0065_old_stock_closeout.sql). This
-- function's raw/finished CTEs are get_client_report's own client_lines/
-- client_pallets shape, factory-wide instead of per-owner, scope-filtered on
-- kirim_orders.origin instead of unfiltered. Deliberate duplication, per
-- direct instruction -- NOT refactored into a shared helper. If
-- get_client_report's formulas ever change, the corresponding CTE below
-- must be hand-updated to match, or the two will silently drift. Mapping:
--   get_client_report CTE          -> rahbar_dashboard_ledger CTE
--   client_lines                   -> lines
--   raw_opening_total              -> raw_opening_total
--   raw_closing_total              -> raw_closing_total
--   raw_received_total             -> raw_received_total (no explicit
--                                      origin='delivery' re-filter needed --
--                                      `lines` is already scope-filtered at
--                                      its own source, unlike get_client_
--                                      report's unfiltered client_lines)
--   moykada_total                  -> moyka_in_process / moyka_opening_total
--                                      (see "Moykada" below -- now evaluated
--                                      at both p_from and p_to)
--   cumulative_storage_loss_total  -> raw_storage_loss_period
--   raw_processed_total/loss_main  -> processed_lines/processed_output/
--                                      processed_total/processed_*_total
--                                      (renamed "Yuvib tugallangan" --
--                                      completion-date basis, see below)
--   client_pallets                 -> pallets
--   finished_opening_total         -> finished_opening_total
--   finished_produced_total        -> finished_produced_total
--   finished_dispatched_total      -> finished_dispatched_total
-- See DECISIONS.md "Rahbar dashboard: sync-twin of get_client_report".
--
-- KNOWN EDGE CASE, found live during this revision's testing, NOT fixed
-- (do not force it -- get_client_report has the identical characteristic
-- and is explicitly out of scope): raw_opening_total/raw_closing_total
-- floor each line's balance at greatest(0, ...), so a line sent (or
-- dispatched) for MORE than its own effective raw qty (rkr.qty_kg) never
-- goes negative. raw_received_total and moyka_sent_period_total, by
-- contrast, sum the actual UNCAPPED amounts. When a line is over-sent, the
-- floor silently absorbs the excess: opening + kirdi - vozvrat - moykaga
-- can undershoot closing by exactly (uncapped sent - rkr.qty_kg) for that
-- line. Verified live with a disposable fixture (600 kg declared, 900 kg
-- sent): naive closing = -300, floored closing = 0, and the identity's LHS
-- came in 300 kg under actual closing, byte-for-byte the over-send amount
-- (raw.residualKg reads -300 for this fixture in isolation -- negative
-- because sentToMoyka is a subtracted term in this formula's own direction;
-- Ledger B's residual for the identical case reads +300, see below -- same
-- root cause, opposite sign, not an inconsistency).
-- The same 300 kg residual shows up in the new Moykada opening/closing
-- identity below, for the identical reason (see that section). NOT fixed
-- here -- capping raw_received_total/moyka_sent_period_total to match the
-- floor would be a new, unconfirmed gating scheme, and get_client_report's
-- identical formula is explicitly out of scope for this task. Instead
-- (2026-08-14), surfaced as a diagnostic: raw.residualKg and
-- moykadaSnapshot.residualKg (see raw_identity_residual/
-- moyka_identity_residual near the bottom, pure arithmetic on the CTEs
-- above, no balance formula touched). Both are 0 on all real data today.
-- See DECISIONS.md for the follow-up note.
-- ============================================================================
--
-- "Moykada" -- now TWO snapshots, opening (as of p_from) and closing (as of
-- p_to), giving Ledger B its own identity: opening Moykada + moykaga
-- yuborilgan (period) - yuvib tugallangan (period) = closing Moykada.
-- Verified live with a disposable straddle fixture (one line sent partly
-- before p_from and finalized inside the period, one line sent inside the
-- period and still unfinalized at p_to): opening 500 + sent 700 - processed
-- 800 = 400 = closing, exactly. NOT sourced from wip_rows -- checked first:
-- wip_rows (0050_opening_stock_stage2_collection.sql:154-233, confirmed
-- current) has no weight/kg column at all, and its moyka_not_returned kind
-- only includes wash cycles already PAST the moyka_idle_days threshold
-- (SPEC.md §3.2.9: "an exceptions list, not a history or a snapshot of
-- stock" -- by design). It structurally cannot supply "kg currently in
-- Moyka." get_client_report's own moykada_total CTE (0065) is the correct
-- existing source, evaluated at two dates instead of one: for each line, 0
-- if its wash cycle finalized by the as-of date, else
-- greatest(0, sent_as_of_date_kg - output_as_of_date_kg). Still zero new
-- derivation -- a different already-verified formula, at two points in
-- time. This identity shares the exact same over-send floor characteristic
-- as Ledger A's (see "Known edge case" above) -- verified live with a
-- second disposable fixture (600 kg declared, 900 kg sent, no send before
-- p_from): opening 0 + sent 900 - processed 600 (capped) = 300, but actual
-- closing = 0. Residual = 300 kg, exactly the over-send amount. Not forced;
-- reported as-is.
--
-- Scope (Yangi/Eski/Hammasi) maps to kirim_orders.origin:
--   Yangi    -> origin in ('delivery', 'internal_reprocess')
--   Eski     -> origin = 'opening_stock'
--   Hammasi  -> unfiltered
-- Internal_reprocess counts as Yangi because Stage 3 deliberately set
-- is_old_stock = false on re-wash output (0054/0055) -- that pallet is
-- current sellable stock produced today, not old stock. Confirmed live: no
-- internal_reprocess kirim_orders exist yet, so this is reasoned from the
-- mint RPC's own stated intent (0055:105-108), not yet exercised on real
-- data.
--
-- rahbar_stock_snapshot: a BALANCE view (stock_on_hand_rows) -- per
-- CLAUDE.md's origin-filtering rule, balance views are usually left
-- unfiltered by origin (opening stock is real stock); here the scope
-- selector is an explicit user-facing slice of that same balance by the
-- existing is_old_stock column, not an accidental origin leak.
--
-- Old KN pool stock is its OWN figure (oldKnKg), separate from the
-- Konditirskiy tile, NOT folded in. Reason unchanged from the prior draft:
-- old_kn_collections/old_kn_pools have no serial/barcode2/finished_pallets
-- link at all (confirmed: old_kn_collections' only columns are
-- id/chiqim_line_id/pool_id/collected_kg/collected_at/created_by), so
-- Ledger C below, being entirely finished_pallets-based, structurally
-- cannot reflect old-KN pool activity -- folding it into Konditirskiy would
-- silently disagree with Ledger C under Eski/Hammasi scope. But the prior
-- draft's response to that (dropping old_kn from the snapshot entirely)
-- was reversed on review: that hid ~103,936 kg of real client-owned stock
-- from the owner's dashboard, which is the worse error. Kept separate and
-- explicitly labeled as pool stock instead -- included in totalKg and
-- byType, but never claimed as part of Ledger C's coverage.
create or replace function rahbar_stock_snapshot(p_scope text)
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
-- Old KN pool stock -- restored as its own figure (2026-08-13). See header
-- comment above for why this is kept separate from Konditirskiy rather
-- than folded in or dropped.
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'old_kn'
),
by_type as (
  select type_id, coalesce(sum(qty_kg), 0) as kg
  from scoped
  group by type_id
)
select jsonb_build_object(
  'rawKg', (select kg from raw_total),
  'finishedCalibredKg', (select kg from finished_calibred_total),
  'konditirskiyKg', (select kg from finished_konditirskiy_total),
  'oldKnKg', (select kg from old_kn_total),
  'oldKnNote', 'pool stock -- not backed by finished_pallets, structurally outside Ledger C''s coverage; shown separately, never reconciled against it',
  'totalKg', (select kg from raw_total) + (select kg from finished_calibred_total)
             + (select kg from finished_konditirskiy_total) + (select kg from old_kn_total),
  'byType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_type
  ),
  'distinctTypeCount', (select count(*) from by_type)
);
$function$;

grant execute on function rahbar_stock_snapshot(text) to authenticated;

-- rahbar_dashboard_ledger: the period ledger, chart, and calibre bars.
-- Mirrors get_client_report's client_lines/client_pallets shape exactly
-- (report_kirim_rows_as_of for the same no-retroactive-mutation guarantee
-- that migration fixed), factory-wide instead of per-owner, scope-filtered
-- on kirim_orders.origin instead of unfiltered.
create or replace function rahbar_dashboard_ledger(p_from date, p_to date, p_scope text)
returns jsonb
language sql
stable
as $function$
with lines as (
  select
    kl.serial, kl.type_id, ko.origin,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date,
    (si.serial is not null) as has_intake,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
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
    wc.status as wash_cycle_status, wc.finalized_at,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date < p_from) as output_before_from_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  left join wash_cycles wc on wc.serial = kl.serial
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from lines where arrival_date < p_from and has_intake and not closed_before_from
),
-- has_intake-gated, DEVIATING from get_client_report's own raw_received_total
-- (which has no has_intake filter at all). Found live, not theoretical: a
-- real serial arrived within the test period but hadn't been accepted into
-- storage yet (no storage_intake row) -- it counted in "kirdi" while being
-- invisible to raw_closing_total (which DOES require has_intake, inherited
-- unchanged from get_client_report), breaking the opening+kirdi-out=closing
-- identity by exactly that serial's qty_kg. get_client_report has this same
-- latent characteristic (identical unfiltered formula) -- untouched per
-- the standing instruction (see DECISIONS.md follow-up note), but this
-- dashboard's own explicit identity requirement means "kirdi" here must
-- mean "accepted into the warehouse during this period," matching what
-- "closing" already counts. has_intake itself is already gated "as of
-- p_to" (see the `lines` CTE's own storage_intake join condition), the
-- same basis raw_closing_total uses, so this is consistent, not a third
-- gating scheme.
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from lines where arrival_date between p_from and p_to and has_intake
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
-- Storage-loss reconciliation term -- same shape as get_client_report's
-- cumulativeStorageLossKg. Needed because closed_before_from/closed_as_of_to
-- are evaluated at different dates: a type closed mid-period is IN opening
-- (not yet closed at p_from) but OUT of closing (closed by p_to), so the
-- naive opening+received-dispatched-sent formula overshoots closing by
-- exactly the booked amount without this term. (0 today -- no real
-- old_stock_closeouts rows exist yet -- but the formula must hold when one
-- does, not just today.)
raw_storage_loss_period as (
  select coalesce(sum(osc.book_remaining_kg), 0) as kg
  from old_stock_closeouts osc
  where osc.kind = 'old_raw'
    and (osc.closed_at at time zone 'utc')::date between p_from and p_to
    and (p_scope = 'hammasi' or p_scope = 'eski')
    -- old-raw close-outs only ever apply to opening_stock-origin material;
    -- structurally 0 contribution for Yangi scope, no extra join needed.
),
-- "Moykada" closing -- a SNAPSHOT as of p_to (how much is currently
-- mid-wash), not a period flow. Exact copy of get_client_report's own
-- moykada_total (0065): 0 for a line whose wash cycle finalized by p_to,
-- else greatest(0, sent_as_of_to_kg - output_as_of_to_kg).
moyka_in_process as (
  select coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg)
    end
  ), 0) as kg
  from lines where arrival_date <= p_to and has_intake
),
-- "Moykada" opening -- the identical formula, evaluated as of p_from
-- instead of p_to (strictly-before, matching raw_opening_total's own
-- "before p_from" convention). Together with moyka_in_process and the two
-- period totals below, gives Ledger B its own identity:
-- opening + moykaga yuborilgan (period) - yuvib tugallangan (period) = closing.
-- Deliberately NOT wired into either raw or finished ledger's own
-- opening+in-out=closing identity -- see header comment for the verified
-- exception (over-send edge case) and DECISIONS.md.
moyka_opening_total as (
  select coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date < p_from then 0
         else greatest(0, sent_before_from_kg - output_before_from_kg)
    end
  ), 0) as kg
  from lines where arrival_date < p_from and has_intake
),
-- Event-level CTEs: single source for both the ledger totals and the chart
-- buckets below -- one query, referenced everywhere, never summed twice.
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
-- "Yuvib tugallangan" (Ledger B) -- completion-date basis, mirrors
-- get_client_report's raw_processed_total/loss_main exactly (0065:382-483).
-- Deliberately NOT the same figure as moyka_sent_period_total above: a
-- serial sent this week may not complete until next week, and vice versa --
-- get_client_report itself keeps these as two separate figures
-- (sentToMoykaKg vs processedKg), never claims they're equal. This IS the
-- single shared source for the total AND all three components below.
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
  where wc.status = 'final' and wc.finalized_at is not null and (wc.finalized_at at time zone 'utc')::date <= p_to
    and (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) between p_from and p_to
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
-- Finished (tayyor) side -- mirrors get_client_report's client_pallets/
-- finished_opening_total/finished_produced_total/finished_dispatched_total
-- exactly (0065:499-543). No storage-loss reconciliation term needed here --
-- unlike raw, the exclusion is evaluated uniformly "as of p_to" for the
-- whole pallet set (both opening and closing draw from the same filtered
-- `pallets`), so a mid-period storage-loss exclusion self-cancels rather
-- than needing an explicit line (confirmed against DECISIONS.md's own note
-- on why get_client_report itself has no finished-side reconciliation term).
pallets as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, kl.type_id, fp.weight_kg, fp.received_date, ko.origin,
    (
      select cr.request_date
      from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      join chiqim_requests cr on cr.id = dm.request_id
      where dm.barcode2 = fp.barcode2
        and cgw.completed_at is not null and (cgw.completed_at at time zone 'utc')::date <= p_to
      order by cgw.completed_at desc nulls last limit 1
    ) as departure_date
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
-- Chart -- daily buckets when the window is <=31 days, weekly beyond.
bucket_size as (
  select case when (p_to - p_from) <= 31 then 1 else 7 end as days
),
buckets as (
  select gs::date as bucket_start
  from bucket_size bs, generate_series(p_from, p_to, (bs.days || ' days')::interval) gs
),
-- has_intake-gated to match raw_received_total exactly (fixed 2026-08-13 --
-- previously missing, so the chart could show kg the ledger total excludes;
-- found live with a real un-accepted serial, 7,160 kg, confirmed the chart
-- leaked it before this fix and matches raw_received_total after).
chart_kirdi as (
  select b.bucket_start, coalesce(sum(l.effective_qty), 0) as kg
  from buckets b
  left join lines l on l.arrival_date >= b.bucket_start and l.arrival_date < b.bucket_start + (select days from bucket_size)
    and l.arrival_date between p_from and p_to and l.has_intake
  group by b.bucket_start
),
-- Upper-bound guarded to p_to (fixed 2026-08-13 -- previously missing on
-- this CTE and chart_vozvrat below, while chart_kirdi already had it).
-- Weekly buckets whose (p_to - p_from) isn't a multiple of 7 leave the
-- final bucket's naive upper edge (bucket_start + 7 days) past p_to, which
-- let events after p_to leak into the last bucket. Confirmed live: with a
-- 44-day period ending 2026-08-03 and a real event dated 2026-08-05 (3
-- real raw_dispatch_lines rows, 13,627 kg, and a disposable moyka_sends
-- fixture, 300 kg), the unguarded query pulled both into the final bucket;
-- guarded, both correctly show 0, matching their already-bounded ledger
-- totals.
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
-- Diagnostic-only residual lines (added 2026-08-14). Pure arithmetic on the
-- CTEs above -- no balance formula (raw_closing_total's floor,
-- sent_capped_kg's cap, or any other) is touched by this. Both are 0 on
-- all real data today; nonzero only in the over-send edge case documented
-- in the header comment ("Known edge case" / Moykada section), where they
-- surface it on screen instead of leaving it silent. Meant to be rendered
-- only when nonzero -- that gating is a frontend concern, out of scope
-- here; both keys are always present, exact value included.
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

grant execute on function rahbar_dashboard_ledger(date, date, text) to authenticated;
