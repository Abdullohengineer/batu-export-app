-- Serial passport: Joriy holat reconciliation + complete dispatch coverage
-- (2026-08-07). Investigation (see DECISIONS.md) found get_serial_passport
-- was built as a chronological EVENT LOG (one section per lifecycle stage)
-- and never computed a rolling BALANCE at all -- unlike stock_on_hand_rows
-- (qoldig'i), which nets received/sent/dispatched/closed-out live on every
-- read. That's why qoldig'i updates and the passport didn't: not staleness,
-- a genuinely missing calculation.
--
-- Reuse, not a third implementation: raw balance already has two
-- independent implementations (stock_on_hand_rows and useMoykaSerials.ts,
-- recorded as a standing hazard in the "Old-stock reconciliation" DECISIONS
-- entry). The "still in storage" figures below are pulled directly FROM
-- stock_on_hand_rows (select ... where serial = p_serial), not recomputed.
--
-- 🚩 New sync hazard, same class, recorded per instruction: the genuine-
-- dispatch predicate (dispatch_manifest + gate_weighings.dir='chiqim' +
-- completed_at is not null) is copied verbatim a THIRD time here
-- (finished_dispatched_total), alongside stock_on_hand_rows' pallet_rows
-- and get_client_report's client_pallets. All three must be kept in sync by
-- hand if this predicate ever changes -- see DECISIONS.md.
--
-- Two independent balances (raw, finished), not one combined equation --
-- raw-sent-to-Moyka vs finished-returned has a real gap (wash yield loss,
-- yield_rows' domain, explicitly out of scope here). Each side's parts sum
-- to exactly its own whole:
--   raw:      receivedKg = sentToMoykaKg + collectedRawKg + storageLossKg + stillInStorageKg
--   finished: returnedKg = dispatchedKg + storageLossKg + consumedKg + voidedKg + stillInStorageKg
-- (consumedKg/voidedKg are the rare mint-consumption/void exits -- included
-- so the equation never has a silent unexplained residual, even for an
-- edge-case serial.)
--
-- Old-raw storage loss is a per-(owner,type) lump on old_stock_closeouts,
-- not a per-serial figure (design was deliberate: "old raw has no single
-- entity to flag"). storageLossKg below is this serial's DERIVED share,
-- computed with the identical formula the close-out itself used
-- (received - sent - collected); honest because it's the same formula, not
-- read out of a stored per-serial column that doesn't exist -- closedAt is
-- included alongside it so the frontend can label it as derived.
--
-- Symptom A (dispatch data missing after CHIQIM submission): the existing
-- dispatch gating was already correct (requires dispatch_manifest, not gate
-- completion). The real gap was that a request which has RESERVED this
-- serial's material (chiqim_line_pallets / chiqim_line_raw_serials) but not
-- yet produced the completed event has nothing on the passport at all --
-- legitimate today, but invisible, while the CHIQIM screen shows it
-- regardless. New pendingDispatches surfaces exactly that gap.
--
-- currentPosition is folded into joriyHolat.finished (per the fold-in
-- decision) rather than kept as a separate, differently-scoped "Joriy
-- holat" section -- a side effect of reuse: stock_on_hand_rows' bucket
-- split (available/band_qilingan/awaiting_lab/qayta_yuvish) also fixes a
-- real gap in the old currentPosition, which silently omitted any pallet
-- awaiting a lab verdict or flagged for rewash from all three of its
-- columns.
create or replace function get_serial_passport(p_serial text)
returns jsonb
language sql
stable
as $function$
with target_line as (
  select kl.serial, kl.order_id, kl.type_id, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
  where kl.serial = p_serial
),
gate_kirim as (
  select gw.*
  from gate_weighings gw, target_line tl
  where gw.dir = 'kirim' and gw.order_id = tl.order_id
  order by gw.stage1_completed_at desc nulls last
  limit 1
),
intake_row as (
  select * from storage_intake where serial = p_serial
),
kirim_lab as (
  select * from lab_results where scope = 'kirim' and parent_serial = p_serial
  order by created_at desc limit 1
),
wc as (
  select * from wash_cycles where serial = p_serial
),
sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from moyka_sends where serial = p_serial
),
cycle_lab as (
  select lr.verdict, lr.moisture_pct, lr.so2_mg_kg, lr.sample_date, lr.sample_photo, lr.note, lr.tested_by
  from wc
  left join lateral (
    select * from lab_results lr2
    where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
    order by lr2.created_at desc
    limit 1
  ) lr on true
),
pallets as (
  select rcr.* from report_chiqim_rows rcr where rcr.serial = p_serial
),
dispatch_ids as (
  select distinct dm.request_id
  from dispatch_manifest dm
  join finished_pallets fp on fp.barcode2 = dm.barcode2
  where fp.serial = p_serial
),
dispatch_gate as (
  select
    di.request_id,
    gw.gruzheny_kg, gw.pustoy_kg, gw.net_kg,
    gw.stage1_completed_at, gw.stage1_created_by, gw.stage1_plate_photo, gw.stage1_scale_photo,
    gw.completed_at, gw.stage2_created_by, gw.stage2_scale_photo, gw.departure_doc_photo
  from dispatch_ids di
  left join lateral (
    select * from gate_weighings gw2
    where gw2.dir = 'chiqim' and gw2.request_id = di.request_id
    order by gw2.completed_at desc nulls last
    limit 1
  ) gw on true
),
dispatch_pallets as (
  select dm.request_id, dm.barcode2, dm.loaded_at, fp.calibre_id, fp.weight_kg
  from dispatch_manifest dm
  join finished_pallets fp on fp.barcode2 = dm.barcode2
  where fp.serial = p_serial
),
raw_dispatches as (
  select rdl.id, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, rdl.loaded_at,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where rdl.serial = p_serial
),
-- Stage 3: what this serial was born from.
mint_pallet_sources as (
  select sms.source_barcode2, fp.weight_kg as book_weight_kg, fp.calibre_id, fp.serial as source_serial
  from serial_mint_sources sms
  join finished_pallets fp on fp.barcode2 = sms.source_barcode2
  where sms.minted_serial = p_serial and sms.source_kind = 'pallet'
),
mint_pool_sources as (
  select sms.source_pool_id, sms.weight_kg, p.type_id
  from serial_mint_sources sms
  join old_kn_pools p on p.id = sms.source_pool_id
  where sms.minted_serial = p_serial and sms.source_kind = 'weight_pool'
),
-- ==========================================================================
-- Joriy holat: raw side.
-- ==========================================================================
raw_received as (
  select rkr.qty_kg as received_kg
  from report_kirim_rows rkr where rkr.serial = p_serial
),
raw_dispatched_total as (
  select coalesce(sum(rdl.net_kg), 0) as kg from raw_dispatch_lines rdl where rdl.serial = p_serial
),
raw_closeout as (
  select osc.closed_at
  from target_line tl2
  join kirim_orders ko2 on ko2.order_id = tl2.order_id
  join old_stock_closeouts osc on osc.kind = 'old_raw' and osc.owner_id = ko2.owner_id and osc.type_id = tl2.type_id
),
raw_still as (
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where serial = p_serial and bucket = 'raw_not_washed'
),
raw_storage_loss as (
  select
    (select closed_at from raw_closeout) as closed_at,
    case when (select closed_at from raw_closeout) is not null
      then greatest(0, coalesce((select received_kg from raw_received), 0) - (select sent_kg from sends_total) - (select kg from raw_dispatched_total))
      else 0
    end as kg
),
-- ==========================================================================
-- Joriy holat: finished side.
-- ==========================================================================
finished_returned_total as (
  select coalesce(sum(weight_kg), 0) as kg from finished_pallets where serial = p_serial
),
finished_dispatched_total as (
  select coalesce(sum(fp.weight_kg), 0) as kg
  from finished_pallets fp
  where fp.serial = p_serial
    and exists (
      select 1 from dispatch_manifest dm3
      join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = dm3.request_id and cgw3.completed_at is not null
      where dm3.barcode2 = fp.barcode2
    )
),
finished_storage_loss_pallets as (
  select fp.barcode2, fp.calibre_id, fp.weight_kg, fp.voided_at
  from finished_pallets fp
  where fp.serial = p_serial and fp.status = 'storage_loss'
),
finished_other_total as (
  select
    coalesce(sum(weight_kg) filter (where status = 'consumed'), 0) as consumed_kg,
    coalesce(sum(weight_kg) filter (where status = 'bekor_qilindi'), 0) as voided_kg
  from finished_pallets where serial = p_serial
),
finished_still as (
  select
    coalesce(sum(qty_kg), 0) as total_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'awaiting_lab'), 0) as awaiting_lab_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'qayta_yuvish'), 0) as needs_rewash_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
),
finished_still_by_calibre as (
  select calibre_id,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket in ('awaiting_lab', 'qayta_yuvish')), 0) as under_review_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
  group by calibre_id
),
storage_loss_events as (
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object('kind', 'old_washed', 'barcode2', slp.barcode2, 'calibreId', slp.calibre_id, 'weightKg', slp.weight_kg, 'voidedAt', slp.voided_at)
        order by slp.barcode2
      ) from finished_storage_loss_pallets slp
    ), '[]'::jsonb)
    ||
    case when (select closed_at from raw_storage_loss) is not null
      then jsonb_build_array(jsonb_build_object(
        'kind', 'old_raw', 'closedAt', (select closed_at from raw_storage_loss), 'weightKg', (select kg from raw_storage_loss),
        'note', 'Bu turdagi eski xom ashyo yakunlandi -- ko''rsatilgan miqdor shu seriyaning taxminiy ulushi'
      ))
      else '[]'::jsonb
    end as events
),
-- Symptom A fix: reserved onto a request but not yet the completed event.
pending_finished as (
  select distinct cr.id as request_id, cr.request_date, cr.plate, cr.driver, clp.barcode2, fp.calibre_id, fp.weight_kg
  from chiqim_line_pallets clp
  join finished_pallets fp on fp.barcode2 = clp.barcode2
  join chiqim_lines cl on cl.id = clp.line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where fp.serial = p_serial
    and clp.released_at is null
    and cr.voided_at is null
    and not exists (select 1 from dispatch_manifest dm4 where dm4.barcode2 = clp.barcode2)
),
pending_raw as (
  select distinct cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from chiqim_line_raw_serials clrs
  join chiqim_lines cl on cl.id = clrs.line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where clrs.serial = p_serial
    and cr.voided_at is null
    and cr.ombor_finished_at is null
    and not exists (select 1 from raw_dispatch_lines rdl2 where rdl2.chiqim_line_id = clrs.line_id and rdl2.serial = p_serial)
),
pending_dispatches as (
  select
    (select coalesce(jsonb_agg(
      jsonb_build_object('kind', 'finished', 'requestId', pf.request_id, 'requestDate', pf.request_date, 'plate', pf.plate, 'driver', pf.driver,
                          'barcode2', pf.barcode2, 'calibreId', pf.calibre_id, 'weightKg', pf.weight_kg)
      order by pf.request_date desc
    ), '[]'::jsonb) from pending_finished pf)
    ||
    (select coalesce(jsonb_agg(
      jsonb_build_object('kind', 'raw', 'requestId', pr.request_id, 'requestDate', pr.request_date, 'plate', pr.plate, 'driver', pr.driver)
      order by pr.request_date desc
    ), '[]'::jsonb) from pending_raw pr)
    as events
)
select jsonb_build_object(
  'serial', p_serial,
  'order', (
    select jsonb_build_object(
      'orderId', ko.order_id, 'ownerId', ko.owner_id, 'ownerName', o.name, 'plate', ko.plate, 'driver', ko.driver,
      'orderDate', ko.order_date, 'declaredQty', tl.declared_qty, 'declaredTotal', ko.declared_total,
      'isMultiLine', tl.line_count > 1, 'targetMoisturePct', tl.target_moisture_pct, 'targetSo2MgKg', tl.target_so2_mg_kg, 'typeId', tl.type_id,
      'docPhoto', ko.doc_photo, 'isOldStock', ko.origin = 'opening_stock',
      'isMinted', ko.origin = 'internal_reprocess'
    )
    from target_line tl
    join kirim_orders ko on ko.order_id = tl.order_id
    left join owners o on o.id = ko.owner_id
  ),
  'effectiveQty', (
    select jsonb_build_object(
      'valueKg', rkr.qty_kg, 'provisional', rkr.provisional,
      'truckVarianceDiffKg', rkr.truck_variance_diff_kg, 'truckVarianceDiffPct', rkr.truck_variance_diff_pct
    )
    from report_kirim_rows rkr where rkr.serial = p_serial
  ),
  'gate', (
    select jsonb_build_object(
      'gruzhenyKg', gk.gruzheny_kg, 'pustoyKg', gk.pustoy_kg, 'netKg', gk.net_kg,
      'stage1CompletedAt', gk.stage1_completed_at, 'stage1CreatedByName', p1.full_name,
      'stage1PlatePhoto', gk.stage1_plate_photo, 'stage1ScalePhoto', gk.stage1_scale_photo,
      'stage2CompletedAt', gk.completed_at, 'stage2CreatedByName', p2.full_name,
      'stage2ScalePhoto', gk.stage2_scale_photo, 'departureDocPhoto', gk.departure_doc_photo
    )
    from gate_kirim gk
    left join profiles p1 on p1.id = gk.stage1_created_by
    left join profiles p2 on p2.id = gk.stage2_created_by
  ),
  'intake', (
    select jsonb_build_object(
      'actualQty', ir.actual_qty, 'confirmedAt', ir.confirmed_at, 'confirmedByName', p3.full_name,
      'barcode1', ir.barcode1, 'pilePhoto', ir.pile_photo, 'komment', ir.komment,
      'boxMassKg', ir.box_mass_kg
    )
    from intake_row ir
    left join profiles p3 on p3.id = ir.confirmed_by
  ),
  'kirimLab', (
    select jsonb_build_object(
      'sampleDate', kl.sample_date, 'moisturePct', kl.moisture_pct, 'so2MgKg', kl.so2_mg_kg,
      'testedByName', p4.full_name, 'samplePhoto', kl.sample_photo, 'note', kl.note
    )
    from kirim_lab kl
    left join profiles p4 on p4.id = kl.tested_by
  ),
  'cycles', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'cycleNo', 1, 'status', wc.status, 'finalLossPct', wc.final_loss_pct, 'sentKg', st.sent_kg,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'barcode2', pl.barcode2, 'calibreId', pl.calibre_id, 'weightKg', pl.qty_kg,
              'palletStatus', pl.pallet_status, 'voidSuccessorBarcodes', pl.void_successor_barcodes
            ) order by pl.barcode2
          ), '[]'::jsonb)
          from pallets pl
        ),
        'lab', (
          select jsonb_build_object(
            'verdict', cl.verdict, 'moisturePct', cl.moisture_pct, 'so2MgKg', cl.so2_mg_kg,
            'sampleDate', cl.sample_date, 'testedByName', p5.full_name, 'samplePhoto', cl.sample_photo, 'note', cl.note
          )
          from cycle_lab cl
          left join profiles p5 on p5.id = cl.tested_by
          where cl.verdict is not null
        )
      )
    ), '[]'::jsonb)
    from wc cross join sends_total st
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'status', cr.status, 'omborFinishedAt', cr.ombor_finished_at, 'omborFinishedByName', p6.full_name,
        'gate', jsonb_build_object(
          'gruzhenyKg', dg.gruzheny_kg, 'pustoyKg', dg.pustoy_kg, 'netKg', dg.net_kg,
          'stage1CompletedAt', dg.stage1_completed_at, 'stage1CreatedByName', p7.full_name,
          'stage1PlatePhoto', dg.stage1_plate_photo, 'stage1ScalePhoto', dg.stage1_scale_photo,
          'stage2CompletedAt', dg.completed_at, 'stage2CreatedByName', p8.full_name,
          'stage2ScalePhoto', dg.stage2_scale_photo, 'departureDocPhoto', dg.departure_doc_photo
        ),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', dp.barcode2, 'calibreId', dp.calibre_id, 'weightKg', dp.weight_kg, 'loadedAt', dp.loaded_at)
            order by dp.loaded_at
          ), '[]'::jsonb)
          from dispatch_pallets dp where dp.request_id = cr.id
        )
      ) order by cr.request_date desc
    ), '[]'::jsonb)
    from dispatch_ids di
    join chiqim_requests cr on cr.id = di.request_id
    left join dispatch_gate dg on dg.request_id = di.request_id
    left join profiles p6 on p6.id = cr.ombor_finished_by
    left join profiles p7 on p7.id = dg.stage1_created_by
    left join profiles p8 on p8.id = dg.stage2_created_by
  ),
  'rawDispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', rd.request_id, 'requestDate', rd.request_date, 'plate', rd.plate, 'driver', rd.driver,
        'weightKg', rd.weight_kg, 'boxMassKg', rd.box_mass_kg, 'netKg', rd.net_kg, 'loadedAt', rd.loaded_at
      ) order by rd.loaded_at desc
    ), '[]'::jsonb)
    from raw_dispatches rd
  ),
  'mintOrigin', (
    select case when (select count(*) from serial_mint_sources where minted_serial = p_serial) = 0
      then null
      else jsonb_build_object(
        'palletCount',  (select count(*) from mint_pallet_sources),
        'bookTotalKg',  (select coalesce(sum(book_weight_kg), 0) from mint_pallet_sources),
        'poolDrawKg',   (select coalesce(sum(weight_kg), 0) from mint_pool_sources),
        'sentWeighedKg',(select sent_kg from sends_total),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', mps.source_barcode2, 'bookWeightKg', mps.book_weight_kg,
                               'calibreId', mps.calibre_id, 'sourceSerial', mps.source_serial)
            order by mps.source_barcode2
          ), '[]'::jsonb) from mint_pallet_sources mps
        )
      )
    end
  ),
  'notes', (
    select coalesce(jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at, 'authorName', pr.full_name)
      order by n.created_at
    ), '[]'::jsonb)
    from notes n
    left join profiles pr on pr.id = n.author
    where n.entity_type = 'moyka' and n.entity_id = p_serial
  ),
  'joriyHolat', jsonb_build_object(
    'raw', jsonb_build_object(
      'receivedKg', coalesce((select received_kg from raw_received), 0),
      'sentToMoykaKg', (select sent_kg from sends_total),
      'collectedRawKg', (select kg from raw_dispatched_total),
      'storageLossKg', (select kg from raw_storage_loss),
      'storageLossClosedAt', (select closed_at from raw_storage_loss),
      'stillInStorageKg', (select kg from raw_still)
    ),
    'finished', jsonb_build_object(
      'returnedKg', (select kg from finished_returned_total),
      'dispatchedKg', (select kg from finished_dispatched_total),
      'storageLossKg', (select coalesce(sum(weight_kg), 0) from finished_storage_loss_pallets),
      'consumedKg', (select consumed_kg from finished_other_total),
      'voidedKg', (select voided_kg from finished_other_total),
      'stillInStorageKg', (select total_kg from finished_still),
      'stillInStorageBreakdown', jsonb_build_object(
        'availableKg', (select available_kg from finished_still),
        'reservedKg', (select reserved_kg from finished_still),
        'awaitingLabKg', (select awaiting_lab_kg from finished_still),
        'needsRewashKg', (select needs_rewash_kg from finished_still)
      ),
      'byCalibre', (
        select coalesce(jsonb_agg(
          jsonb_build_object('calibreId', fsc.calibre_id, 'availableKg', fsc.available_kg, 'reservedKg', fsc.reserved_kg, 'underReviewKg', fsc.under_review_kg)
          order by fsc.calibre_id
        ), '[]'::jsonb)
        from finished_still_by_calibre fsc
      )
    )
  ),
  'storageLossEvents', (select events from storage_loss_events),
  'pendingDispatches', (select events from pending_dispatches)
);
$function$;
