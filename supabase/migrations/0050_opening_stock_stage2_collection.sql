-- Stage 2 (collection): widen chiqim_lines.line_kind to the three old-stock
-- shapes, add old_kn_collections (KN's own append-only draw-down event,
-- mirroring raw_dispatch_lines' shape/RLS exactly), give
-- stock_on_hand_rows.old_kn_rows a real balance instead of Stage 1's
-- opening_kg stub, and fix a bug found while designing this stage:
-- wip_rows.raw_not_sent flags the seeded old-raw serial with a fabricated
-- "578 days waiting to be sent to Moyka" -- confirmed_at was deliberately
-- backdated to the 2025-01-01 seed anchor for effective_qty purposes
-- (correct for balance math), but the same backdating leaks into this WIP
-- read as a nonsense number. Same root cause and same fix shape as
-- yield_rows' Stage 1 bug.
--
-- Old-washed and old-raw dispatch need NO reporting-view changes: they
-- reuse finished_pallets/dispatch_manifest and raw_dispatch_lines, both of
-- which already flow into report_chiqim_rows/report_raw_dispatch_rows
-- unfiltered by line_kind (confirmed via pg_get_viewdef -- neither view
-- reads chiqim_lines.line_kind at all). Old-KN reporting visibility
-- (Hisobot/get_client_report) is explicitly deferred to a later pass, per
-- confirmation -- old_kn_collections exists and drains the pool correctly,
-- it just isn't surfaced as a report_rows kind yet.

-- 1. Widen line_kind's shape constraint (was 'finished'|'raw' only).
alter table chiqim_lines drop constraint chiqim_lines_kind_shape;
alter table chiqim_lines add constraint chiqim_lines_kind_shape check (
  (line_kind = 'finished'  and calibre_id is not null and qty_kg is not null) or
  (line_kind = 'raw'       and calibre_id is null) or
  (line_kind = 'old_washed' and calibre_id is not null and qty_kg is not null) or
  (line_kind = 'old_kn'    and calibre_id is null) or
  (line_kind = 'old_raw'   and calibre_id is null)
);

-- 2. old_kn_collections: KN's own draw-down event. No serial (KN has no
-- serial identity, per Stage 1's design), so it anchors directly to the
-- pool row via pool_id -- resolved client-side the same way Ombor already
-- resolves which raw serial a draw is against (no server-side derivation,
-- matching that precedent). Append-only: no update/delete policy, same as
-- raw_dispatch_lines (committed only at "Yuklashni yakunlash", never
-- amended after).
create table old_kn_collections (
  id uuid primary key default gen_random_uuid(),
  chiqim_line_id uuid not null references chiqim_lines(id),
  pool_id uuid not null references old_kn_pools(id),
  collected_kg numeric not null check (collected_kg > 0),
  collected_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
alter table old_kn_collections enable row level security;
create policy read_all on old_kn_collections for select using (auth.uid() is not null);
create policy ombor_writes on old_kn_collections for insert with check (my_role() = 'ombor');

-- 3. stock_on_hand_rows: old_kn_rows now subtracts real collections instead
-- of reading opening_kg directly (Stage 1's explicit follow-up). Every
-- other CTE (pallet_rows, raw_rows) and the final UNION ALL/select list is
-- byte-identical to the live Stage 1 definition (confirmed via
-- pg_get_viewdef immediately before writing this) -- only old_kn_rows'
-- body changes.
create or replace view stock_on_hand_rows as
with pallet_rows as (
  select
    case
      when lr.verdict = 'qayta_yuvish' then 'qayta_yuvish'
      when lr.verdict is null then 'awaiting_lab'
      when dm.request_id is not null then 'band_qilingan'
      else 'available'
    end as bucket,
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    fp.weight_kg as qty_kg,
    fp.received_date as anchor_date,
    lr.moisture_pct,
    null::numeric as box_mass_kg,
    fp.is_old_stock,
    fp.weight_is_estimate
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (
    select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1
  ) dm on true
  left join chiqim_requests cr on cr.id = dm.request_id
  left join lateral (
    select cgw2.completed_at from gate_weighings cgw2
    where cgw2.dir = 'chiqim' and cgw2.request_id = dm.request_id
    order by cgw2.completed_at desc nulls last limit 1
  ) cgw on true
  left join lateral (
    select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
  ) wc on true
  left join lateral (
    select lr3.verdict, lr3.moisture_pct from lab_results lr3
    where lr3.scope = 'chiqim' and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc limit 1
  ) lr on true
  where fp.status = 'in_stock'
    and not (dm.request_id is not null and cgw.completed_at is not null)
    and ko.plate not like 'TEST-%'
    and coalesce(cr.plate, '') not like 'TEST-%'
), raw_rows as (
  select 'raw_not_washed' as bucket,
    r.row_key, r.serial, null::text as barcode2, r.owner_id, r.type_id, null::uuid as calibre_id,
    r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0) as qty_kg,
    r.date_basis as anchor_date, kirim_lr.moisture_pct, r.box_mass_kg,
    r.origin = 'opening_stock' as is_old_stock, false as weight_is_estimate
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (
    select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial
  ) sent on true
  left join lateral (
    select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial
  ) raw on true
  left join lateral (
    select lr4.moisture_pct from lab_results lr4
    where lr4.scope = 'kirim' and lr4.parent_serial = r.serial
    order by lr4.created_at desc limit 1
  ) kirim_lr on true
  where (r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0)) > 0
), old_kn_rows as (
  select 'old_kn' as bucket,
    p.id::text as row_key, null::text as serial, null::text as barcode2,
    p.owner_id, p.type_id, null::uuid as calibre_id,
    p.opening_kg - coalesce(c.collected, 0) as qty_kg,
    null::date as anchor_date, null::numeric as moisture_pct, null::numeric as box_mass_kg,
    true as is_old_stock, null::boolean as weight_is_estimate
  from old_kn_pools p
  left join lateral (
    select coalesce(sum(oc.collected_kg), 0) as collected from old_kn_collections oc where oc.pool_id = p.id
  ) c on true
  where p.opening_kg - coalesce(c.collected, 0) > 0
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

-- 4. wip_rows: exclude opening_stock from raw_not_sent only (the bug found
-- above). Every other CTE (moyka_not_returned, awaiting_lab, so2_pending,
-- chiqim_open, provisional_weight) and limits/final UNION ALL are
-- byte-identical to the live definition.
create or replace view wip_rows as
with limits as (
  select
    (select value from settings_limits where key = 'raw_idle_days') as raw_idle_days,
    (select value from settings_limits where key = 'moyka_idle_days') as moyka_idle_days,
    (select value from settings_limits where key = 'tahlil_kechikdi_days') as tahlil_kechikdi_days,
    (select value from settings_limits where key = 'sulfur_overdue_days') as sulfur_overdue_days,
    (select value from settings_limits where key = 'chiqim_idle_days') as chiqim_idle_days
), raw_not_sent as (
  select 'raw_not_sent' as wip_kind, r.row_key, r.serial, null::uuid as request_id, r.owner_id, r.type_id,
    current_date - (si.confirmed_at at time zone 'utc')::date as days_waiting,
    l.raw_idle_days::integer as threshold_days
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
  left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
  cross join limits l
  where (r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0)) > 0
    and r.origin != 'opening_stock'
    and (current_date - (si.confirmed_at at time zone 'utc')::date)::numeric > l.raw_idle_days
), moyka_not_returned as (
  select 'moyka_not_returned' as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id, ko.owner_id, kl.type_id,
    current_date - ms_first.sent_date as days_waiting, l.moyka_idle_days::integer as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (select min(ms2.sent_date) as sent_date from moyka_sends ms2 where ms2.serial = wc.serial) ms_first on true
  cross join limits l
  where wc.status = 'active' and ko.plate not like 'TEST-%'
    and (current_date - ms_first.sent_date)::numeric > l.moyka_idle_days
), awaiting_lab as (
  select 'awaiting_lab' as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id, ko.owner_id, kl.type_id,
    current_date - ms_first.sent_date as days_waiting, l.tahlil_kechikdi_days::integer as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (select min(ms2.sent_date) as sent_date from moyka_sends ms2 where ms2.serial = wc.serial) ms_first on true
  cross join limits l
  where not exists (select 1 from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id)
    and ko.plate not like 'TEST-%'
    and (current_date - ms_first.sent_date)::numeric > l.tahlil_kechikdi_days
), so2_pending as (
  select 'so2_pending' as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id, ko.owner_id, kl.type_id,
    current_date - lr.sample_date as days_waiting, l.sulfur_overdue_days::integer as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select lr2.sample_date, lr2.status from lab_results lr2
    where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
    order by lr2.created_at desc limit 1
  ) lr on true
  cross join limits l
  where lr.status = 'moisture_in' and kl.target_so2_mg_kg is not null and ko.plate not like 'TEST-%'
    and (current_date - lr.sample_date)::numeric > l.sulfur_overdue_days
), chiqim_open as (
  select 'chiqim_open' as wip_kind, cr.id::text as row_key, null::text as serial, cr.id as request_id, cr.owner_id, null::uuid as type_id,
    current_date - (cr.created_at at time zone 'utc')::date as days_waiting, l.chiqim_idle_days::integer as threshold_days
  from chiqim_requests cr
  left join lateral (
    select cgw_1.completed_at from gate_weighings cgw_1
    where cgw_1.dir = 'chiqim' and cgw_1.request_id = cr.id
    order by cgw_1.completed_at desc nulls last limit 1
  ) cgw on true
  cross join limits l
  where not (cr.ombor_finished_at is not null and cgw.completed_at is not null)
    and cr.plate not like 'TEST-%'
    and (current_date - (cr.created_at at time zone 'utc')::date)::numeric > l.chiqim_idle_days
), provisional_weight as (
  select 'provisional_weight' as wip_kind, r.row_key, r.serial, null::uuid as request_id, r.owner_id, r.type_id,
    null::integer as days_waiting, null::integer as threshold_days
  from report_kirim_rows r
  where r.provisional
)
select * from raw_not_sent
union all select * from moyka_not_returned
union all select * from awaiting_lab
union all select * from so2_pending
union all select * from chiqim_open
union all select * from provisional_weight;
