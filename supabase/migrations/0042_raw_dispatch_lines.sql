-- Raw dispatch: a client can collect raw (unwashed) material directly on a
-- CHIQIM request, alongside or instead of finished-calibre lines (e.g. half
-- a load washed, half taken raw). Washing-path raw only -- raw KN destined
-- for cutting (Rezka) is explicitly out of scope, see the Rezka inspection
-- report.
--
-- Decision, confirmed with the user before applying: raw_dispatch_lines is
-- written at Ombor's "Yuklashni yakunlash" (finish) click, not at the
-- moment weight is typed -- entries are held client-side (same shape as
-- the existing scanned-pallet list, removable via X before commit) and
-- batch-inserted alongside the dispatch_manifest insert. This table is
-- append-only (no update/delete policy, matching moyka_sends) specifically
-- BECAUSE the commit point is deferred to finish, where a typo can still be
-- corrected by removing the entry client-side -- an immediate-write design
-- would have made a typo permanently corrupt that serial's raw balance.
--
-- 🚩 Flagged for the future: raw_dispatch_lines.serial FKs to
-- kirim_lines(serial), the same constraint the Rezka inspection report
-- identified as needing to move to a serial-identity anchor table once
-- Rezka source-2 (cutting-batch-minted serials with no kirim_lines row)
-- lands. Fine for now -- every serial that can raw-dispatch today arrived
-- by a real truck -- but this FK will need re-pointing at that point, not
-- a surprise when it happens.

-- ============================================================
-- 1. chiqim_lines: a line is either a finished-calibre line (calibre_id set)
--    or a raw line pinned to one specific raw serial (raw_serial set) --
--    mutually exclusive, enforced by the DB, not just the UI. qty_kg stays
--    NOT NULL for both: for a raw line it is the Menejer's planned figure,
--    exactly like a finished line's picker-derived total -- never
--    overwritten once Ombor loads; the actual collected amount lives in
--    raw_dispatch_lines, read separately.
-- ============================================================
alter table chiqim_lines alter column calibre_id drop not null;
alter table chiqim_lines add column raw_serial text references kirim_lines(serial);
alter table chiqim_lines add constraint chiqim_lines_calibre_xor_raw
  check ((calibre_id is not null and raw_serial is null) or (calibre_id is null and raw_serial is not null));

-- ============================================================
-- 2. raw_dispatch_lines -- the second exit from a raw serial's balance
--    (moyka_sends is the first). weight_kg is Ombor's own entry, authoritative
--    immediately -- box_mass_kg subtracted right there via a generated
--    column, the same "gross minus something" idiom gate_weighings.net_kg
--    already uses. CHIQIM's real gate weighing (Qorovul, dir='chiqim')
--    stays what it already is for this request: an informational
--    reconciliation check against the total load, never a value source --
--    unchanged, no dependency added here (see DECISIONS.md).
-- ============================================================
create table raw_dispatch_lines (
  id uuid primary key default gen_random_uuid(),
  chiqim_line_id uuid not null references chiqim_lines(id) on delete cascade,
  serial text not null references kirim_lines(serial),
  weight_kg numeric not null check (weight_kg > 0),
  box_mass_kg numeric not null check (box_mass_kg >= 0),
  net_kg numeric generated always as (weight_kg - box_mass_kg) stored,
  loaded_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
create index on raw_dispatch_lines(serial);
create index on raw_dispatch_lines(chiqim_line_id);

alter table raw_dispatch_lines enable row level security;
create policy read_all on raw_dispatch_lines for select using (auth.uid() is not null);
create policy ombor_writes on raw_dispatch_lines for insert with check (my_role() = 'ombor');

-- ============================================================
-- 3. stock_on_hand_rows -- raw_rows' remaining-balance figure must also
--    subtract raw already dispatched, or "Xom, yuvilmagan" overstates raw
--    stock the moment any of it has gone to a client instead of Moyka.
--    Only the raw_rows CTE changes; every other CTE/column is unchanged
--    from 0041.
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
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    fp.weight_kg as qty_kg,
    fp.received_date as anchor_date,
    lr.moisture_pct,
    null::numeric as box_mass_kg
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (
    select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1
  ) dm on true
  left join chiqim_requests cr on cr.id = dm.request_id
  left join lateral (
    select cgw2.completed_at
    from gate_weighings cgw2
    where cgw2.dir = 'chiqim'::direction and cgw2.request_id = dm.request_id
    order by cgw2.completed_at desc nulls last
    limit 1
  ) cgw on true
  left join lateral (
    select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
  ) wc on true
  left join lateral (
    select lr3.verdict, lr3.moisture_pct
    from lab_results lr3
    where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc
    limit 1
  ) lr on true
  where fp.status = 'in_stock'::pallet_status
    and not (dm.request_id is not null and cgw.completed_at is not null)
    and ko.plate !~~ 'TEST-%'::text
    and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text
), raw_rows as (
  select
    'raw_not_washed'::text as bucket,
    r.row_key,
    r.serial,
    null::text as barcode2,
    r.owner_id,
    r.type_id,
    null::uuid as calibre_id,
    r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric) as qty_kg,
    r.date_basis as anchor_date,
    kirim_lr.moisture_pct,
    r.box_mass_kg
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (
    select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent from moyka_sends ms where ms.serial = r.serial
  ) sent on true
  left join lateral (
    select coalesce(sum(rdl.net_kg), 0::numeric) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial
  ) raw on true
  left join lateral (
    select lr4.moisture_pct
    from lab_results lr4
    where lr4.scope = 'kirim'::direction and lr4.parent_serial = r.serial
    order by lr4.created_at desc
    limit 1
  ) kirim_lr on true
  where (r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric)) > 0::numeric
)
select
  pallet_rows.bucket, pallet_rows.row_key, pallet_rows.serial, pallet_rows.barcode2, pallet_rows.owner_id,
  pallet_rows.type_id, pallet_rows.calibre_id, pallet_rows.qty_kg, pallet_rows.anchor_date,
  current_date - pallet_rows.anchor_date as days_held,
  (current_date - pallet_rows.anchor_date) > 90 as aged_90,
  pallet_rows.moisture_pct,
  pallet_rows.box_mass_kg
from pallet_rows
union all
select
  raw_rows.bucket, raw_rows.row_key, raw_rows.serial, raw_rows.barcode2, raw_rows.owner_id,
  raw_rows.type_id, raw_rows.calibre_id, raw_rows.qty_kg, raw_rows.anchor_date,
  current_date - raw_rows.anchor_date as days_held,
  (current_date - raw_rows.anchor_date) > 90 as aged_90,
  raw_rows.moisture_pct,
  raw_rows.box_mass_kg
from raw_rows;

-- ============================================================
-- 4. wip_rows -- raw_not_sent has the identical gap: without this, fully
--    raw-dispatched material would still flag as "waiting to be sent to
--    Moyka". Only raw_not_sent changes; every other CTE/column unchanged
--    from 0035 (moyka_not_returned/awaiting_lab/so2_pending/chiqim_open/
--    provisional_weight untouched -- none of them read a raw balance).
-- ============================================================
create or replace view wip_rows
with (security_invoker = true) as
with limits as (
  select
    (select value from settings_limits where key = 'raw_idle_days') as raw_idle_days,
    (select value from settings_limits where key = 'moyka_idle_days') as moyka_idle_days,
    (select value from settings_limits where key = 'tahlil_kechikdi_days') as tahlil_kechikdi_days,
    (select value from settings_limits where key = 'sulfur_overdue_days') as sulfur_overdue_days,
    (select value from settings_limits where key = 'chiqim_idle_days') as chiqim_idle_days
),
raw_not_sent as (
  select 'raw_not_sent'::text as wip_kind, r.row_key, r.serial, null::uuid as request_id, r.owner_id, r.type_id,
    (current_date - (si.confirmed_at at time zone 'utc')::date) as days_waiting, l.raw_idle_days::int as threshold_days
  from report_kirim_rows r
    join storage_intake si on si.serial = r.serial
    left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
    left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
    cross join limits l
  where (r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0)) > 0
    and (current_date - (si.confirmed_at at time zone 'utc')::date) > l.raw_idle_days
),
moyka_not_returned as (
  select 'moyka_not_returned'::text as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id,
    ko.owner_id, kl.type_id, (current_date - ms_first.sent_date) as days_waiting, l.moyka_idle_days::int as threshold_days
  from wash_cycles wc
    join kirim_lines kl on kl.serial = wc.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    join lateral (select min(ms2.sent_date) as sent_date from moyka_sends ms2 where ms2.serial = wc.serial) ms_first on true
    cross join limits l
  where wc.status = 'active'
    and ko.plate not like 'TEST-%'
    and (current_date - ms_first.sent_date) > l.moyka_idle_days
),
awaiting_lab as (
  select 'awaiting_lab'::text as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id,
    ko.owner_id, kl.type_id, (current_date - ms_first.sent_date) as days_waiting, l.tahlil_kechikdi_days::int as threshold_days
  from wash_cycles wc
    join kirim_lines kl on kl.serial = wc.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    join lateral (select min(ms2.sent_date) as sent_date from moyka_sends ms2 where ms2.serial = wc.serial) ms_first on true
    cross join limits l
  where not exists (select 1 from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id)
    and ko.plate not like 'TEST-%'
    and (current_date - ms_first.sent_date) > l.tahlil_kechikdi_days
),
so2_pending as (
  select 'so2_pending'::text as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id,
    ko.owner_id, kl.type_id, (current_date - lr.sample_date) as days_waiting, l.sulfur_overdue_days::int as threshold_days
  from wash_cycles wc
    join kirim_lines kl on kl.serial = wc.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    join lateral (
      select lr2.sample_date, lr2.status from lab_results lr2
      where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
      order by lr2.created_at desc limit 1
    ) lr on true
    cross join limits l
  where lr.status = 'moisture_in'
    and kl.target_so2_mg_kg is not null
    and ko.plate not like 'TEST-%'
    and (current_date - lr.sample_date) > l.sulfur_overdue_days
),
chiqim_open as (
  select 'chiqim_open'::text as wip_kind, cr.id::text as row_key, null::text as serial,
    cr.id as request_id, cr.owner_id, null::uuid as type_id,
    (current_date - (cr.created_at at time zone 'utc')::date) as days_waiting, l.chiqim_idle_days::int as threshold_days
  from chiqim_requests cr
    left join lateral (
      select cgw.completed_at from gate_weighings cgw
      where cgw.dir = 'chiqim' and cgw.request_id = cr.id
      order by cgw.completed_at desc nulls last limit 1
    ) cgw on true
    cross join limits l
  where not (cr.ombor_finished_at is not null and cgw.completed_at is not null)
    and cr.plate not like 'TEST-%'
    and (current_date - (cr.created_at at time zone 'utc')::date) > l.chiqim_idle_days
),
provisional_weight as (
  select 'provisional_weight'::text as wip_kind, r.row_key, r.serial, null::uuid as request_id, r.owner_id, r.type_id,
    null::int as days_waiting, null::int as threshold_days
  from report_kirim_rows r
  where r.provisional
)
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from raw_not_sent
union all
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from moyka_not_returned
union all
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from awaiting_lab
union all
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from so2_pending
union all
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from chiqim_open
union all
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from provisional_weight;
