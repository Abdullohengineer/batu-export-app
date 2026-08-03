-- Opening/old stock, Stage 1 (seed). Opening/old stock: schema + reporting-view updates + the seed itself.
-- Scope per the confirmed plan: old-washed + old-raw seeding, the old-KN
-- weight pool, arrival/throughput exclusion for the 6 minted kirim_orders
-- rows, and qoldig'i's is_old_stock/old-KN visibility. Deferred to later
-- stages (not in this file): pallet_status +'consumed', chiqim_lines
-- line_kind widening, old_kn_collections, serial_mint_sources, the mint RPC.

-- ============================================================
-- 1. kirim_orders.origin — the discriminator that keeps opening/internally-
--    reprocessed stock out of arrival/throughput aggregates while staying
--    fully visible everywhere stock BALANCE is computed (report_kirim_rows
--    itself stays unfiltered; only the four "arrival" consumers below add
--    the filter). Positive allowlist (origin = 'delivery'), not a negative
--    exclusion of 'opening_stock' alone, so the Stage 3 re-wash mint's own
--    'internal_reprocess' orders are automatically covered by the same
--    filter with no second exclusion value needed later.
-- ============================================================
alter table kirim_orders add column origin text not null default 'delivery'
  check (origin in ('delivery', 'opening_stock', 'internal_reprocess'));

-- ============================================================
-- 2. finished_pallets markers — independent booleans (not one combined
--    field): a re-washed old-stock pallet is old-stock-derived but NOT an
--    estimate (it was really weighed at receipt), so these two facts must
--    be able to disagree.
-- ============================================================
alter table finished_pallets add column is_old_stock boolean not null default false;
alter table finished_pallets add column weight_is_estimate boolean not null default false;

-- ============================================================
-- 3. old_kn_pools — the weight pool itself. No serial, no kirim_lines
--    involvement at all: Konditirskiy opening stock was never individually
--    tracked, so there is nothing to anchor a serial identity to. Balance is
--    derived (opening_kg minus draws), never stored, matching this
--    codebase's own convention everywhere else (wash_cycles, storage_intake).
--    old_kn_collections (the draw-down events table) is Stage 2 scope —
--    nothing before Stage 2 writes against this pool, so its balance is
--    simply opening_kg for now.
-- ============================================================
create table old_kn_pools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id),
  type_id uuid not null references product_types(id),
  opening_kg numeric not null check (opening_kg >= 0),
  created_at timestamptz not null default now(),
  unique (owner_id, type_id)
);
alter table old_kn_pools enable row level security;
create policy read_all on old_kn_pools for select using (auth.uid() is not null);

-- ============================================================
-- 4. report_kirim_rows gains `origin` — stays otherwise unfiltered (the raw-
--    balance/qoldig'i consumers below need to keep seeing opening stock).
--    Byte-identical to the live definition otherwise (confirmed via
--    pg_get_viewdef before writing this).
-- ============================================================
create or replace view report_kirim_rows as
with lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
), box_mass as (
  select kl.order_id,
         case when bool_and(si_1.serial is not null) then sum(si_1.box_mass_kg) else null::numeric end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si_1 on si_1.serial = kl.serial
  group by kl.order_id
)
select
  'kirim'::text as kind,
  l.serial as row_key, l.serial, null::text as barcode2, l.order_id, null::uuid as request_id,
  ko.owner_id, l.type_id, null::uuid as calibre_id, ko.plate, ko.driver,
  ko.order_date as date_basis, 'order_date'::text as date_basis_source,
  case
    when si.actual_qty is null then l.declared_qty
    when gw.completed_at is null or bm.total_box_mass_kg is null then si.actual_qty
    when l.line_count > 1 then si.actual_qty
    else coalesce(gw.net_kg - bm.total_box_mass_kg, si.actual_qty)
  end as qty_kg,
  case
    when si.actual_qty is null then false
    when gw.completed_at is null or bm.total_box_mass_kg is null then true
    else false
  end as provisional,
  l.declared_qty,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null
       then gw.net_kg - bm.total_box_mass_kg - ko.declared_total
       else null::numeric end as truck_variance_diff_kg,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null and ko.declared_total > 0::numeric
       then (gw.net_kg - bm.total_box_mass_kg - ko.declared_total) / ko.declared_total * 100::numeric
       else null::numeric end as truck_variance_diff_pct,
  case when l.line_count = 1 and gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null
            and si.actual_qty is not null and si.actual_qty <> 0::numeric and es.sent_date is not null
            and es.sent_date <= (gw.completed_at at time zone 'utc')::date
            and abs((gw.net_kg - bm.total_box_mass_kg - si.actual_qty) / si.actual_qty * 100::numeric) > coalesce((select value from settings_limits where key = 'kam_chiqdi_pct'), 5::numeric)
       then true else false end as provisional_variance_flag,
  null::integer as wash_cycle, null::text as pallet_status, null::text as lab_verdict,
  l.target_moisture_pct, l.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
  null::text[] as void_successor_barcodes, si.box_mass_kg,
  ko.origin
from lines l
join kirim_orders ko on ko.order_id = l.order_id
left join storage_intake si on si.serial = l.serial
left join box_mass bm on bm.order_id = l.order_id
left join lateral (
  select gw2.net_kg, gw2.completed_at, gw2.stage1_completed_at
  from gate_weighings gw2
  where gw2.dir = 'kirim'::direction and gw2.order_id = l.order_id
  order by gw2.stage1_completed_at desc nulls last
  limit 1
) gw on true
left join lateral (
  select min(ms.sent_date) as sent_date from moyka_sends ms where ms.serial = l.serial
) es on true
left join lateral (
  select lr2.moisture_pct, lr2.so2_mg_kg from lab_results lr2
  where lr2.scope = 'kirim'::direction and lr2.parent_serial = l.serial
  order by lr2.created_at desc limit 1
) lr on true
where ko.plate !~~ 'TEST-%'::text;

-- ============================================================
-- 5. report_rows — the Hisobot-facing history/event union. Filter applied
--    ONLY on the kirim branch (arrivals); chiqim/raw-dispatch (departures)
--    stay unfiltered — a real truck leaving with old-stock-derived material
--    is a real event and should count. report_rows' own output shape is
--    unchanged (origin is a filter predicate here, not a new output column)
--    so report_query_page/report_totals need no changes at all.
-- ============================================================
create or replace view report_rows as
select kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg, truck_variance_diff_pct,
  provisional_variance_flag, wash_cycle, pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg,
  moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_kirim_rows
where origin = 'delivery'
union all
select kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg, truck_variance_diff_pct,
  provisional_variance_flag, wash_cycle, pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg,
  moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_chiqim_rows
union all
select kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id, plate, driver,
  date_basis, date_basis_source, qty_kg, provisional, declared_qty, truck_variance_diff_kg, truck_variance_diff_pct,
  provisional_variance_flag, wash_cycle, pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg,
  moisture_pct, so2_mg_kg, void_successor_barcodes, box_mass_kg
from report_raw_dispatch_rows;

-- ============================================================
-- 6. Rahbar dashboard — each reads report_kirim_rows DIRECTLY (confirmed via
--    pg_get_functiondef, not assumed), so each needs its own filter; going
--    through report_rows alone would miss all three of these.
-- ============================================================
create or replace function rahbar_monthly_trends()
returns table(month date, volume_in_kg numeric, volume_out_kg numeric, raw_consumed_kg numeric, output_kg numeric,
  gross_yield_pct numeric, gross_loss_pct numeric, dry_matter_true_loss_pct numeric, dry_matter_serial_count bigint,
  yield_serial_count bigint, rewash_rate_pct numeric, rewash_count bigint, utilization_pct numeric, calibre_mix jsonb)
language sql stable as $function$
with cap as (
  select value from settings_limits where key = 'practical_capacity_kg_per_month'
),
months as (
  select distinct date_trunc('month', date_basis)::date as month from report_kirim_rows where date_basis is not null and origin = 'delivery'
  union
  select distinct date_trunc('month', date_basis)::date as month from report_chiqim_rows where date_basis is not null
  union
  select distinct date_trunc('month', completed_date)::date as month from yield_rows where completed_date is not null
),
vol_in as (
  select date_trunc('month', date_basis)::date as month, sum(qty_kg) as kg
  from report_kirim_rows where date_basis is not null and origin = 'delivery' group by 1
),
vol_out as (
  select date_trunc('month', date_basis)::date as month, sum(qty_kg) as kg
  from report_chiqim_rows where date_basis is not null group by 1
),
yield_month as (
  select date_trunc('month', completed_date)::date as month,
    sum(raw_consumed_kg) as raw_consumed_kg, sum(output_kg) as output_kg, sum(loss_kg) as loss_kg,
    count(*) as serial_count, count(*) filter (where rewashed) as rewash_count,
    count(*) filter (where dry_matter_available) as dm_count,
    sum(dry_matter_in_kg) filter (where dry_matter_available) as dm_in_kg,
    sum(dry_matter_out_kg) filter (where dry_matter_available) as dm_out_kg
  from yield_rows where completed_date is not null group by 1
),
calibre_month as (
  select date_trunc('month', y.completed_date)::date as month, cb->>'calibreId' as calibre_id, sum((cb->>'kg')::numeric) as kg
  from yield_rows y, jsonb_array_elements(y.calibre_mix) cb
  where y.completed_date is not null
  group by 1, 2
)
select
  m.month, coalesce(vi.kg, 0), coalesce(vo.kg, 0),
  coalesce(ym.raw_consumed_kg, 0), coalesce(ym.output_kg, 0),
  case when coalesce(ym.raw_consumed_kg, 0) > 0 then round(ym.output_kg / ym.raw_consumed_kg * 100, 1) end,
  case when coalesce(ym.raw_consumed_kg, 0) > 0 then round(ym.loss_kg / ym.raw_consumed_kg * 100, 1) end,
  case when coalesce(ym.dm_in_kg, 0) > 0 then round((ym.dm_in_kg - ym.dm_out_kg) / ym.dm_in_kg * 100, 1) end,
  coalesce(ym.dm_count, 0), coalesce(ym.serial_count, 0),
  case when coalesce(ym.serial_count, 0) > 0 then round(ym.rewash_count::numeric / ym.serial_count * 100, 1) end,
  coalesce(ym.rewash_count, 0),
  case when (select value from cap) is not null and (select value from cap) > 0 and ym.raw_consumed_kg is not null
       then round(ym.raw_consumed_kg / (select value from cap) * 100, 1) end,
  (
    select coalesce(jsonb_agg(jsonb_build_object('calibreId', cm.calibre_id, 'kg', cm.kg,
      'pct', case when coalesce(ym.output_kg, 0) > 0 then round(cm.kg / ym.output_kg * 100, 1) else 0 end) order by cm.kg desc), '[]'::jsonb)
    from calibre_month cm where cm.month = m.month
  )
from months m
left join vol_in vi on vi.month = m.month
left join vol_out vo on vo.month = m.month
left join yield_month ym on ym.month = m.month
order by m.month;
$function$;

create or replace function rahbar_client_ranking(p_from date, p_to date)
returns table(owner_id uuid, owner_name text, received_kg numeric, dispatched_kg numeric)
language sql stable as $function$
  with recv as (
    select owner_id, sum(qty_kg) as kg from report_kirim_rows where date_basis between p_from and p_to and origin = 'delivery' group by owner_id
  ), disp as (
    select owner_id, sum(qty_kg) as kg from report_chiqim_rows where date_basis between p_from and p_to group by owner_id
  )
  select o.id, o.name, coalesce(r.kg, 0), coalesce(d.kg, 0)
  from owners o
  left join recv r on r.owner_id = o.id
  left join disp d on d.owner_id = o.id
  where coalesce(r.kg, 0) > 0 or coalesce(d.kg, 0) > 0
  order by coalesce(r.kg, 0) desc;
$function$;

create or replace function rahbar_product_mix(p_from date, p_to date)
returns table(type_id uuid, received_kg numeric, pct_of_total numeric)
language sql stable as $function$
  with recv as (
    select type_id, sum(qty_kg) as kg from report_kirim_rows where date_basis between p_from and p_to and origin = 'delivery' group by type_id
  ), total as (select coalesce(sum(kg), 0) as kg from recv)
  select r.type_id, r.kg, case when t.kg > 0 then round(r.kg / t.kg * 100, 1) else 0 end
  from recv r cross join total t
  order by r.kg desc;
$function$;

-- ============================================================
-- 7. stock_on_hand_rows — is_old_stock/weight_is_estimate surfaced on the
--    existing pallet/raw buckets, plus a new old_kn bucket. The old_kn
--    bucket reads opening_kg directly (nothing has been collected yet —
--    old_kn_collections doesn't exist until Stage 2, so this CTE gets a
--    small follow-up edit then to subtract draws). Only raw_rows' own
--    is_old_stock derivation and the two new output columns actually
--    change; every other CTE is byte-identical to the live 0046 definition.
-- ============================================================
create or replace view stock_on_hand_rows as
with pallet_rows as (
  select
    case
      when lr.verdict = 'qayta_yuvish'::text then 'qayta_yuvish'::text
      when lr.verdict is null then 'awaiting_lab'::text
      when dm.request_id is not null then 'band_qilingan'::text
      else 'available'::text
    end as bucket,
    fp.barcode2 as row_key, fp.serial, fp.barcode2, ko.owner_id, fp.type_id, fp.calibre_id,
    fp.weight_kg as qty_kg, fp.received_date as anchor_date, lr.moisture_pct, null::numeric as box_mass_kg,
    fp.is_old_stock, fp.weight_is_estimate
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1) dm on true
  left join chiqim_requests cr on cr.id = dm.request_id
  left join lateral (
    select cgw2.completed_at from gate_weighings cgw2
    where cgw2.dir = 'chiqim'::direction and cgw2.request_id = dm.request_id
    order by cgw2.completed_at desc nulls last limit 1
  ) cgw on true
  left join lateral (select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1) wc on true
  left join lateral (
    select lr3.verdict, lr3.moisture_pct from lab_results lr3
    where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc limit 1
  ) lr on true
  where fp.status = 'in_stock'::pallet_status
    and not (dm.request_id is not null and cgw.completed_at is not null)
    and ko.plate !~~ 'TEST-%'::text
    and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text
), raw_rows as (
  select
    'raw_not_washed'::text as bucket, r.row_key, r.serial, null::text as barcode2, r.owner_id, r.type_id,
    null::uuid as calibre_id,
    r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric) as qty_kg,
    r.date_basis as anchor_date, kirim_lr.moisture_pct, r.box_mass_kg,
    (r.origin = 'opening_stock') as is_old_stock, false as weight_is_estimate
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
  left join lateral (select coalesce(sum(rdl.net_kg), 0::numeric) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
  left join lateral (
    select lr4.moisture_pct from lab_results lr4
    where lr4.scope = 'kirim'::direction and lr4.parent_serial = r.serial
    order by lr4.created_at desc limit 1
  ) kirim_lr on true
  where (r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric)) > 0::numeric
), old_kn_rows as (
  select
    'old_kn'::text as bucket, p.id::text as row_key, null::text as serial, null::text as barcode2,
    p.owner_id, p.type_id, null::uuid as calibre_id,
    p.opening_kg as qty_kg,  -- Stage 2 follow-up: subtract Σ old_kn_collections once that table exists
    null::date as anchor_date, null::numeric as moisture_pct, null::numeric as box_mass_kg,
    true as is_old_stock, null::boolean as weight_is_estimate
  from old_kn_pools p
  where p.opening_kg > 0
)
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
  current_date - anchor_date as days_held, (current_date - anchor_date) > 90 as aged_90,
  moisture_pct, box_mass_kg, is_old_stock, weight_is_estimate
from pallet_rows
union all
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
  current_date - anchor_date as days_held, (current_date - anchor_date) > 90 as aged_90,
  moisture_pct, box_mass_kg, is_old_stock, weight_is_estimate
from raw_rows
union all
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
  null::integer as days_held, false as aged_90,
  moisture_pct, box_mass_kg, is_old_stock, weight_is_estimate
from old_kn_rows;

-- ============================================================
-- 7b. rahbar_exceptions — ageing_stock excludes opening stock (2026-08-02
--     feedback): it would flag permanently, forever, with no remediation
--     possible, and a persistent unactionable entry devalues the whole
--     exceptions list. Only the ageing_stock branch changes. Placed AFTER
--     stock_on_hand_rows above, deliberately — it reads that view's new
--     is_old_stock column, which does not exist until section 7 runs.
-- ============================================================
create or replace function rahbar_exceptions()
returns table(exception_kind text, row_key text, owner_id uuid, serial text, type_id uuid, detail jsonb)
language sql stable as $function$
  select 'ageing_stock', s.row_key, s.owner_id, s.serial, s.type_id,
    jsonb_build_object('qtyKg', s.qty_kg, 'daysHeld', s.days_held, 'bucket', s.bucket)
  from stock_on_hand_rows s where s.aged_90 and not s.is_old_stock
  union all
  select 'lab_overdue', w.row_key, w.owner_id, w.serial, w.type_id,
    jsonb_build_object('daysWaiting', w.days_waiting, 'thresholdDays', w.threshold_days, 'wipKind', w.wip_kind)
  from wip_rows w where w.wip_kind in ('awaiting_lab', 'so2_pending')
  union all
  select 'high_loss', y.serial, y.owner_id, y.serial, y.type_id,
    jsonb_build_object('lossPct', y.loss_pct, 'thresholdPct', (select value from settings_limits where key = 'abnormal_loss_pct'), 'rawConsumedKg', y.raw_consumed_kg)
  from yield_rows y
  where y.completed_date >= date_trunc('month', current_date)
    and y.loss_pct > (select value from settings_limits where key = 'abnormal_loss_pct')
  union all
  select 'high_rewash', rw.owner_id::text, rw.owner_id, null, null,
    jsonb_build_object('ratePct', rw.rate_pct, 'thresholdPct', (select value from settings_limits where key = 'high_rewash_rate_pct'), 'serialCount', rw.serial_count, 'rewashCount', rw.rewash_count)
  from (
    select owner_id, count(*) as serial_count, count(*) filter (where rewashed) as rewash_count,
      round(count(*) filter (where rewashed)::numeric / count(*) * 100, 1) as rate_pct
    from yield_rows
    where completed_date >= date_trunc('month', current_date)
    group by owner_id
  ) rw
  where rw.rate_pct > (select value from settings_limits where key = 'high_rewash_rate_pct');
$function$;

-- ============================================================
-- 8. get_client_report — raw_received_total/raw_received_by_type are period
--    ARRIVAL aggregates (same category as Hisobot/Rahbar) and gain the same
--    origin filter. raw_opening_total/raw_closing_total/moykada_total and
--    the reconciliation object are BALANCE figures and must keep including
--    opening stock, so they are NOT touched. Only client_lines (adds
--    origin) and the two received CTEs change; every other CTE is
--    byte-identical to the live 0046 definition.
-- ============================================================
create or replace function get_client_report(p_owner_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
as $function$
with
client_lines as (
  select
    kl.serial, kl.type_id, ko.plate, ko.driver, kl.target_moisture_pct, kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date, rkr.provisional, rkr.origin,
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
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to and origin = 'delivery'
),
raw_sent_to_moyka_period_total as (
  select coalesce(sum(sent_during_period_kg), 0) as kg from client_lines
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
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
  where arrival_date between p_from and p_to and origin = 'delivery' group by type_id
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

-- ============================================================
-- 9. The seed itself. Global Export Company only. Two DIFFERENT anchor
--    shapes, deliberately:
--    - Old washed: kirim_orders + kirim_lines ONLY. No storage_intake — the
--      raw material was never sitting in storage (100% already packed), so
--      giving it a storage_intake row would make it show up a SECOND time
--      as phantom raw stock in qoldig'i. si.actual_qty is null resolves
--      effective_qty to declared_qty, non-provisional (the codebase's own
--      existing "declared-pre-intake -> final, not pending" rule).
--    - Old raw: kirim_orders + kirim_lines + storage_intake + a synthetic
--      completed gate_weighings row (mirrors this session's own established
--      hand-verification-fixture pattern) so effective_qty resolves final,
--      not stuck provisional forever waiting for a gate event that will
--      never happen.
--    Sentinel plate 'ESKI-ZAXIRA' — deliberately NOT 'TEST-%', which
--    report_kirim_rows already filters out entirely.
--    Pallet split: 720 kg per pallet + one remainder pallet per line item
--    (every line item here has a nonzero remainder). wash_cycles + a
--    passing lab_results row minted per old-washed serial so the hard gate
--    doesn't hide it — "immediately collectible," per the task.
-- ============================================================
do $$
declare
  v_owner uuid := '0472be4f-0c2a-4ab8-a327-6da9cba7eec0'; -- Global Export Company
  v_type_subxon uuid := '48aebd73-1de9-4edb-802a-ad38e197fc7e';
  v_type_isfara uuid := 'b6295a21-df2f-4eef-9c79-de7bc701ee94';
  v_type_natural uuid := '8f755555-df93-4de7-b379-5cfd3de8b218';
  v_type_qand uuid := '6543cb13-af80-478f-a509-036e0cafaaa9';
  v_type_qandqizil uuid := '35c5c93a-d5be-410e-8694-fac3a7ab861b';
  v_cal1 uuid := 'cc8afaef-a5da-4492-b275-d3d9be78f1b8';
  v_cal4 uuid := '930b7b1b-4069-46ef-b9d6-dbe657c38aa0';
  v_cal6 uuid := '7fc8a3a9-a347-499b-8475-150060605bd6';
  v_cal8 uuid := 'a8a7bdd0-5385-48fe-9fd6-89056bf42492';
  v_laborator uuid := '29842f0a-3941-4569-bc37-128c96e43bcc'; -- TEST Laborator, confirmed live (demo-data-2026-07-20.sql)

  v_order_id uuid;
  v_serial text;
  v_serial_by_type jsonb := '{}'::jsonb; -- type_key -> minted serial
  v_wc_id uuid;
  rec record;
  v_type_id uuid;
  v_type_key text;
  v_full_pallets int;
  v_remainder numeric;
  v_seq int;
  i int;
begin
  -- === Old washed: one minted serial per product type ===
  for v_type_key, v_type_id in
    select * from (values
      ('subxon', v_type_subxon), ('isfara', v_type_isfara), ('natural', v_type_natural),
      ('qand', v_type_qand), ('qandqizil', v_type_qandqizil)
    ) as t(type_key, type_id)
  loop
    insert into kirim_orders (order_id, order_date, plate, driver, owner_id, declared_total, origin)
    values (gen_random_uuid(), '2025-01-01', 'ESKI-ZAXIRA', 'Ochilish balansi', v_owner, null, 'opening_stock')
    returning order_id into v_order_id;

    -- declared_qty per type = sum of that type's washed line items below
    insert into kirim_lines (order_id, type_id, declared_qty)
    values (
      v_order_id, v_type_id,
      case v_type_key
        when 'subxon' then 30 + 1040 + 11540 + 6260
        when 'isfara' then 1400 + 24120
        when 'natural' then 6550
        when 'qand' then 50
        when 'qandqizil' then 1040 + 180
      end
    )
    returning serial into v_serial;

    v_serial_by_type := v_serial_by_type || jsonb_build_object(v_type_key, v_serial);

    -- Hard gate: a passing current-cycle CHIQIM verdict, so these pallets
    -- are immediately collectible (chiqimScan.ts's labPassed check).
    insert into wash_cycles (serial, status, finalized_at)
    values (v_serial, 'final', '2025-01-01')
    returning id into v_wc_id;

    insert into lab_results (scope, wash_cycle_id, sample_date, moisture_pct, verdict, status, tested_by, note)
    values ('chiqim', v_wc_id, '2025-01-01', 8, 'o_tdi', 'complete', v_laborator, 'Eski zaxira — dastlabki tekshiruv qayta tiklanmagan');
  end loop;

  -- === Old washed pallets: 720 kg/pallet + remainder, per (type, calibre) ===
  for rec in
    select * from (values
      ('subxon', v_cal1, 30::numeric), ('subxon', v_cal4, 1040::numeric),
      ('subxon', v_cal6, 11540::numeric), ('subxon', v_cal8, 6260::numeric),
      ('isfara', v_cal1, 1400::numeric), ('isfara', v_cal8, 24120::numeric),
      ('natural', v_cal1, 6550::numeric),
      ('qand', v_cal8, 50::numeric),
      ('qandqizil', v_cal6, 1040::numeric), ('qandqizil', v_cal8, 180::numeric)
    ) as t(type_key, calibre_id, total_kg)
  loop
    v_serial := v_serial_by_type ->> rec.type_key;
    v_full_pallets := floor(rec.total_kg / 720);
    v_remainder := rec.total_kg - v_full_pallets * 720;
    v_seq := 0;

    for i in 1..v_full_pallets loop
      v_seq := v_seq + 1;
      insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, is_old_stock, weight_is_estimate)
      values (
        'PLT-' || v_serial || '-' || (select code from calibres where id = rec.calibre_id) || '-' || v_seq,
        v_serial, (select type_id from kirim_lines where serial = v_serial), rec.calibre_id,
        720, '2025-01-01', 'in_stock', true, true
      );
    end loop;

    if v_remainder > 0 then
      v_seq := v_seq + 1;
      insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, is_old_stock, weight_is_estimate)
      values (
        'PLT-' || v_serial || '-' || (select code from calibres where id = rec.calibre_id) || '-' || v_seq,
        v_serial, (select type_id from kirim_lines where serial = v_serial), rec.calibre_id,
        v_remainder, '2025-01-01', 'in_stock', true, true
      );
    end if;
  end loop;

  -- === Old raw: Qand, 2,880 kg — a normal serial, seeded ===
  insert into kirim_orders (order_id, order_date, plate, driver, owner_id, declared_total, origin)
  values (gen_random_uuid(), '2025-01-01', 'ESKI-ZAXIRA', 'Ochilish balansi', v_owner, null, 'opening_stock')
  returning order_id into v_order_id;

  insert into kirim_lines (order_id, type_id, declared_qty)
  values (v_order_id, v_type_qand, 2880)
  returning serial into v_serial;

  -- Synthetic completed gate weighing -- resolves effective_qty to final,
  -- not provisional (there is no real gate event to ever complete this).
  insert into gate_weighings (dir, order_id, gruzheny_kg, pustoy_kg, stage1_completed_at, completed_at)
  values ('kirim', v_order_id, 2880, 0, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');

  insert into storage_intake (serial, actual_qty, box_mass_kg, confirmed_at)
  values (v_serial, 2880, 0, '2025-01-01T00:00:00Z');

  -- === Old Konditirskiy: weight pools, no serial ===
  insert into old_kn_pools (owner_id, type_id, opening_kg) values
    (v_owner, v_type_subxon, 38202),
    (v_owner, v_type_isfara, 56359),
    (v_owner, v_type_natural, 7791),
    (v_owner, v_type_qand, 1584);
end $$;
