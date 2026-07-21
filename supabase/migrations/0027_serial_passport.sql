-- Serial passport (SPEC.md §3.2.5, first real body -- previously just a
-- forward-reference from §3.2). One RPC returning the full lifecycle of one
-- parent serial as a single JSONB document: order, gate, intake (+ the
-- KIRIM descriptive lab check, which §5.5.2 names as feeding the passport),
-- effective quantity, every wash cycle (1..N, including voided pallets and
-- their successors), every dispatch this serial contributed to, and current
-- position by calibre.
--
-- Reads underlying tables directly -- NOT through Ombor's finished-goods
-- view (useMoykaOutput.ts), which SPEC.md §5.3's own v1.10 amendment
-- explicitly flags as active-cycle-only and explicitly excludes the
-- passport from that limitation. Reuses report_kirim_rows/report_chiqim_rows
-- (0026_report_server_side_query.sql) for the two derivations that would
-- otherwise need a THIRD implementation (effective_qty, pallet_status +
-- void-successor lookup) -- those views are not scoped to "active cycle
-- only" at all (they read every finished_pallets row unconditionally), so
-- reusing them here does not reintroduce the limitation being fixed.
--
-- 🔒 Consequence, confirmed deliberate: reusing those two views also
-- inherits their TEST- exclusion, so get_serial_passport('TEST-...') comes
-- back with order/gate/intake/kirimLab populated (those CTEs read raw
-- tables directly) but effectiveQty null and cycles[].pallets/
-- currentPosition empty. Harmless in production -- a TEST- serial never
-- appears in Hisobot in the first place, so there is no row to click
-- through to its passport from. If a FUTURE e2e test exercises this RPC
-- directly (not just through the Hisobot UI) with a seeded fixture, it
-- must use uniqueRealLookingPlate(), not the default uniqueTestId() --
-- the same lesson reporting-query-engine.spec.ts and
-- report-effective-qty-parity.spec.ts already had to learn for the same
-- reason.

create or replace function get_serial_passport(p_serial text)
returns jsonb
language sql
stable
security invoker
as $$
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
cycles as (
  select * from wash_cycles where serial = p_serial
),
sends_by_cycle as (
  select wash_cycle, sum(qty_kg) as sent_kg
  from moyka_sends where serial = p_serial
  group by wash_cycle
),
cycle_lab as (
  select c.cycle_no, lr.verdict, lr.moisture_pct, lr.so2_mg_kg, lr.sample_date, lr.sample_photo, lr.note, lr.tested_by
  from cycles c
  left join lateral (
    select * from lab_results lr2
    where lr2.scope = 'chiqim' and lr2.wash_cycle_id = c.id
    order by lr2.created_at desc
    limit 1
  ) lr on true
),
-- report_chiqim_rows is NOT active-cycle-scoped -- every finished_pallets
-- row for this serial, every cycle, voided included (pallet_status and
-- void_successor_barcodes already correctly derived there).
pallets as (
  select rcr.*
  from report_chiqim_rows rcr
  where rcr.serial = p_serial
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
-- Three states, not two (§5.4: a manifest-scanned pallet is deducted from
-- AVAILABLE stock the instant it's scanned, well before gate stage 2 -- but
-- deducted-from-available is not the same as physically gone. A pallet
-- reserved on a truck still on site is neither "in storage" (it's spoken
-- for) nor "collected" (it hasn't left) -- the client report reads this
-- same three-way split for "held for client", which must include
-- reserved-but-not-departed, not just departed.
current_position as (
  select
    p.calibre_id,
    sum(case when p.pallet_status = 'omborda' then p.qty_kg else 0 end) as in_stock_kg,
    sum(case when p.pallet_status = 'band_qilingan' then p.qty_kg else 0 end) as reserved_kg,
    sum(case when p.pallet_status = 'jonatilgan' then p.qty_kg else 0 end) as collected_kg
  from pallets p
  where p.pallet_status <> 'bekor_qilingan'
  group by p.calibre_id
)
select jsonb_build_object(
  'serial', p_serial,
  'order', (
    select jsonb_build_object(
      'orderId', ko.order_id,
      'ownerId', ko.owner_id,
      'ownerName', o.name,
      'plate', ko.plate,
      'driver', ko.driver,
      'orderDate', ko.order_date,
      'declaredQty', tl.declared_qty,
      'declaredTotal', ko.declared_total,
      'isMultiLine', tl.line_count > 1,
      'targetMoisturePct', tl.target_moisture_pct,
      'targetSo2MgKg', tl.target_so2_mg_kg,
      'typeId', tl.type_id
    )
    from target_line tl
    join kirim_orders ko on ko.order_id = tl.order_id
    left join owners o on o.id = ko.owner_id
  ),
  'effectiveQty', (
    select jsonb_build_object(
      'valueKg', rkr.qty_kg,
      'provisional', rkr.provisional,
      'truckVarianceDiffKg', rkr.truck_variance_diff_kg,
      'truckVarianceDiffPct', rkr.truck_variance_diff_pct
    )
    from report_kirim_rows rkr
    where rkr.serial = p_serial
  ),
  'gate', (
    select jsonb_build_object(
      'gruzhenyKg', gk.gruzheny_kg,
      'pustoyKg', gk.pustoy_kg,
      'netKg', gk.net_kg,
      'stage1CompletedAt', gk.stage1_completed_at,
      'stage1CreatedByName', p1.full_name,
      'stage1PlatePhoto', gk.stage1_plate_photo,
      'stage1ScalePhoto', gk.stage1_scale_photo,
      'stage2CompletedAt', gk.completed_at,
      'stage2CreatedByName', p2.full_name,
      'stage2ScalePhoto', gk.stage2_scale_photo,
      'departureDocPhoto', gk.departure_doc_photo
    )
    from gate_kirim gk
    left join profiles p1 on p1.id = gk.stage1_created_by
    left join profiles p2 on p2.id = gk.stage2_created_by
  ),
  'intake', (
    select jsonb_build_object(
      'actualQty', ir.actual_qty,
      'confirmedAt', ir.confirmed_at,
      'confirmedByName', p3.full_name,
      'barcode1', ir.barcode1,
      'pilePhoto', ir.pile_photo,
      'komment', ir.komment
    )
    from intake_row ir
    left join profiles p3 on p3.id = ir.confirmed_by
  ),
  'kirimLab', (
    select jsonb_build_object(
      'sampleDate', kl.sample_date,
      'moisturePct', kl.moisture_pct,
      'so2MgKg', kl.so2_mg_kg,
      'testedByName', p4.full_name,
      'samplePhoto', kl.sample_photo,
      'note', kl.note
    )
    from kirim_lab kl
    left join profiles p4 on p4.id = kl.tested_by
  ),
  'cycles', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'cycleNo', c.cycle_no,
        'status', c.status,
        'finalLossPct', c.final_loss_pct,
        'sentKg', coalesce(sbc.sent_kg, 0),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'barcode2', pl.barcode2,
              'calibreId', pl.calibre_id,
              'weightKg', pl.qty_kg,
              'palletStatus', pl.pallet_status,
              'voidSuccessorBarcodes', pl.void_successor_barcodes
            ) order by pl.barcode2
          ), '[]'::jsonb)
          from pallets pl where pl.wash_cycle = c.cycle_no
        ),
        'lab', (
          select jsonb_build_object(
            'verdict', cl.verdict,
            'moisturePct', cl.moisture_pct,
            'so2MgKg', cl.so2_mg_kg,
            'sampleDate', cl.sample_date,
            'testedByName', p5.full_name,
            'samplePhoto', cl.sample_photo,
            'note', cl.note
          )
          from cycle_lab cl
          left join profiles p5 on p5.id = cl.tested_by
          where cl.cycle_no = c.cycle_no and cl.verdict is not null
        )
      ) order by c.cycle_no
    ), '[]'::jsonb)
    from cycles c
    left join sends_by_cycle sbc on sbc.wash_cycle = c.cycle_no
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id,
        'requestDate', cr.request_date,
        'plate', cr.plate,
        'driver', cr.driver,
        'status', cr.status,
        'omborFinishedAt', cr.ombor_finished_at,
        'omborFinishedByName', p6.full_name,
        'gate', jsonb_build_object(
          'gruzhenyKg', dg.gruzheny_kg,
          'pustoyKg', dg.pustoy_kg,
          'netKg', dg.net_kg,
          'stage1CompletedAt', dg.stage1_completed_at,
          'stage1CreatedByName', p7.full_name,
          'stage1PlatePhoto', dg.stage1_plate_photo,
          'stage1ScalePhoto', dg.stage1_scale_photo,
          'stage2CompletedAt', dg.completed_at,
          'stage2CreatedByName', p8.full_name,
          'stage2ScalePhoto', dg.stage2_scale_photo,
          'departureDocPhoto', dg.departure_doc_photo
        ),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'barcode2', dp.barcode2,
              'calibreId', dp.calibre_id,
              'weightKg', dp.weight_kg,
              'loadedAt', dp.loaded_at
            ) order by dp.loaded_at
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
  'currentPosition', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'calibreId', cp.calibre_id,
        'inStockKg', cp.in_stock_kg,
        'reservedKg', cp.reserved_kg,
        'collectedKg', cp.collected_kg
      ) order by cp.calibre_id
    ), '[]'::jsonb)
    from current_position cp
  )
);
$$;

grant execute on function get_serial_passport(text) to authenticated;

-- Supporting index -- wash_cycles has no index on serial yet (kirim_lines,
-- storage_intake, finished_pallets, moyka_sends, lab_results were already
-- covered by 0026's indexes).
create index if not exists idx_wash_cycles_serial on wash_cycles (serial);
