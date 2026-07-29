-- Laborator v2: lab moves inside Moyka, wash-cycle concept removed (2026-07-28).
-- wash_cycles KEPT as a table (too many FK/RLS/query references for little
-- gain to drop it -- confirmed with the user) but now enforces exactly one
-- row per serial, not one per cycle. cycle_no and voided_at both dropped:
-- cycle_no because there is nothing left to number, voided_at because it has
-- zero live writers even in the current system (handleRewash only ever
-- flipped finished_pallets.status, never touched wash_cycles itself).
-- status/final_loss_pct/finalized_at survive untouched -- Tugallash survives
-- as "one loss number per serial", just scoped to the whole serial instead
-- of a cycle. lab_results.wash_cycle_id is UNCHANGED -- still FK's to
-- wash_cycles.id, still required on scope='chiqim'. A reject is simply
-- another lab_results row against the SAME wash_cycle_id (no unique
-- constraint ever forced 1:1 there); "current verdict" is the latest row by
-- created_at, the exact rule labVerdict.ts already used for "current cycle".
--
-- Views that directly reference cycle_no/wash_cycle (report_chiqim_rows,
-- stock_on_hand_rows, wip_rows, yield_rows) must be replaced BEFORE the
-- column drops below, or Postgres refuses the drop with a dependency error.
-- get_client_report/get_serial_passport/lab_turnaround_avg/rahbar_* are
-- FUNCTIONS, not blocked the same way -- deliberately handled in a separate
-- follow-up migration (0036), hand-verified against seeded data rather than
-- rushed here: this is the loss/yield arithmetic this project has already
-- shipped one real bug in (see 0029's own header).

-- ============================================================
-- 1. report_chiqim_rows -- drop cycle/void-successor logic (no pallet is
--    ever voided under the new model; wash_cycles is now unique per serial,
--    so the old "find the current cycle" lateral collapses to a direct join).
-- ============================================================
create or replace view report_chiqim_rows as
select 'chiqim'::text as kind,
    fp.barcode2 as row_key, fp.serial, fp.barcode2, kl.order_id, dm.request_id, ko.owner_id, fp.type_id, fp.calibre_id,
    coalesce(cr.plate, ''::text) as plate, coalesce(cr.driver, ''::text) as driver,
    (cgw.completed_at at time zone 'utc')::date as date_basis, null::text as date_basis_source,
    fp.weight_kg as qty_kg, false as provisional, null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg, null::numeric as truck_variance_diff_pct, false as provisional_variance_flag,
    null::integer as wash_cycle,
    case
        when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
        when dm.request_id is not null then case when cgw.completed_at is not null then 'jonatilgan'::text else 'band_qilingan'::text end
        else 'omborda'::text
    end as pallet_status,
    lr.verdict as lab_verdict, kl.target_moisture_pct, kl.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
    null::text[] as void_successor_barcodes
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
        select lr3.verdict, lr3.moisture_pct, lr3.so2_mg_kg from lab_results lr3
        where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
        order by lr3.created_at desc limit 1
    ) lr on true
where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 2. stock_on_hand_rows -- same lateral simplification; raw_rows' send total
--    drops the wash_cycle=1 filter (sums every send for the serial, there's
--    only ever one "cycle" of sends now).
-- ============================================================
create or replace view stock_on_hand_rows
with (security_invoker = true) as
with pallet_rows as (
  select
    case
      when lr.verdict = 'qayta_yuvish'::text then 'qayta_yuvish'::text
      when lr.verdict is null then 'awaiting_lab'::text
      when dm.request_id is not null then 'band_qilingan'::text
      else 'available'::text
    end as bucket,
    fp.barcode2 as row_key, fp.serial, fp.barcode2, ko.owner_id, fp.type_id, fp.calibre_id,
    fp.weight_kg as qty_kg, fp.received_date as anchor_date, lr.moisture_pct
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
    null::uuid as calibre_id, r.qty_kg - coalesce(sent.total_sent, 0::numeric) as qty_kg,
    (si.confirmed_at at time zone 'utc'::text)::date as anchor_date, kirim_lr.moisture_pct
  from report_kirim_rows r
    join storage_intake si on si.serial = r.serial
    left join lateral (select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
    left join lateral (
      select lr4.moisture_pct from lab_results lr4
      where lr4.scope = 'kirim'::direction and lr4.parent_serial = r.serial
      order by lr4.created_at desc limit 1
    ) kirim_lr on true
  where r.qty_kg - coalesce(sent.total_sent, 0::numeric) > 0::numeric
)
select pallet_rows.bucket, pallet_rows.row_key, pallet_rows.serial, pallet_rows.barcode2, pallet_rows.owner_id, pallet_rows.type_id, pallet_rows.calibre_id, pallet_rows.qty_kg, pallet_rows.anchor_date,
  current_date - pallet_rows.anchor_date as days_held, current_date - pallet_rows.anchor_date > 90 as aged_90, pallet_rows.moisture_pct
from pallet_rows
union all
select raw_rows.bucket, raw_rows.row_key, raw_rows.serial, raw_rows.barcode2, raw_rows.owner_id, raw_rows.type_id, raw_rows.calibre_id, raw_rows.qty_kg, raw_rows.anchor_date,
  current_date - raw_rows.anchor_date as days_held, current_date - raw_rows.anchor_date > 90 as aged_90, raw_rows.moisture_pct
from raw_rows;

-- ============================================================
-- 3. wip_rows -- 3 of 4 cycle-keyed checks redesigned around the new trigger
--    timing (anchored to first-send date, since no pallet exists yet at that
--    stage); qayta_yuvish_pending REMOVED outright -- there is no "flagged,
--    not yet re-sent" state left to detect, a reject is immediately
--    re-testable with no Ombor action in between.
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
    cross join limits l
  where (r.qty_kg - coalesce(sent.total_sent, 0)) > 0
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

-- ============================================================
-- 4. yield_rows -- no more all_*/live_* split (nothing is ever voided now, so
--    every finished_pallets row for a finished serial IS its output).
--    rewashed is redefined: a reject occurred in this serial's own lab
--    history before its eventual pass -- the only trace re-washing still
--    leaves once it happens invisibly inside Moyka.
-- ============================================================
create or replace view yield_rows
with (security_invoker = true) as
with serial_base as (
  select
    kl.serial, kl.type_id, ko.owner_id, ko.plate, ko.driver,
    rkr.qty_kg as effective_qty,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as raw_consumed_kg,
    wc.id as wash_cycle_id, wc.status as wash_cycle_status
  from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    join report_kirim_rows rkr on rkr.serial = kl.serial
    left join wash_cycles wc on wc.serial = kl.serial
  where ko.plate not like 'TEST-%'
),
finished_serials as (
  select * from serial_base where wash_cycle_status = 'final'
),
output as (
  select fs.serial,
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg,
    min(fp.received_date) as completed_date
  from finished_serials fs
  join finished_pallets fp on fp.serial = fs.serial
  join calibres c on c.id = fp.calibre_id
  group by fs.serial
),
rewash_flag as (
  select fs.serial, exists (
    select 1 from lab_results lr
    where lr.wash_cycle_id = fs.wash_cycle_id and lr.scope = 'chiqim' and lr.verdict = 'qayta_yuvish'
  ) as rewashed
  from finished_serials fs
),
calibre_breakdown as (
  select fs.serial, fp.calibre_id, sum(fp.weight_kg) as kg
  from finished_serials fs
  join finished_pallets fp on fp.serial = fs.serial
  group by fs.serial, fp.calibre_id
),
lab_readings as (
  select fs.serial,
    (select lr.moisture_pct from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = fs.serial order by lr.created_at desc limit 1) as intake_moisture_pct,
    (select lr.moisture_pct from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = fs.wash_cycle_id order by lr.created_at desc limit 1) as delivered_moisture_pct
  from finished_serials fs
)
select
  fs.serial, fs.type_id, fs.owner_id, fs.plate, fs.driver,
  fs.effective_qty as raw_received_kg, fs.raw_consumed_kg, (fs.raw_consumed_kg - fs.effective_qty) as raw_overage_kg,
  o.completed_date, 1 as max_cycle_no, rf.rewashed,
  o.calibre_kg as live_calibre_kg, o.konditirskiy_kg as live_konditirskiy_kg,
  (o.calibre_kg + o.konditirskiy_kg) as output_kg,
  (fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg) as loss_kg,
  case when fs.raw_consumed_kg > 0 then round((fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg) / fs.raw_consumed_kg * 100, 1) else 0 end as loss_pct,
  case when fs.raw_consumed_kg > 0 then round((o.calibre_kg + o.konditirskiy_kg) / fs.raw_consumed_kg * 100, 1) else 0 end as gross_yield_pct,
  lab.intake_moisture_pct, lab.delivered_moisture_pct,
  (lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null) as dry_matter_available,
  case when lab.intake_moisture_pct is not null then round(fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100), 1) end as dry_matter_in_kg,
  case when lab.delivered_moisture_pct is not null then round((o.calibre_kg + o.konditirskiy_kg) * (1 - lab.delivered_moisture_pct / 100), 1) end as dry_matter_out_kg,
  case when lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null
         and fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100) > 0
       then round((fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100) - (o.calibre_kg + o.konditirskiy_kg) * (1 - lab.delivered_moisture_pct / 100))
                  / (fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100)) * 100, 1)
  end as true_loss_pct,
  (
    select coalesce(jsonb_agg(jsonb_build_object('calibreId', cb.calibre_id, 'kg', cb.kg,
      'pct', case when (o.calibre_kg + o.konditirskiy_kg) > 0 then round(cb.kg / (o.calibre_kg + o.konditirskiy_kg) * 100, 1) else 0 end)
      order by cb.kg desc), '[]'::jsonb)
    from calibre_breakdown cb where cb.serial = fs.serial
  ) as calibre_mix
from finished_serials fs
join output o on o.serial = fs.serial
join rewash_flag rf on rf.serial = fs.serial
join lab_readings lab on lab.serial = fs.serial;

-- ============================================================
-- 5. Schema: wash_cycles -> one row per serial. Drop the now-redundant
--    serial-only index (the new unique constraint backs it automatically).
-- ============================================================
drop index if exists idx_wash_cycles_serial;
alter table wash_cycles drop constraint wash_cycles_serial_cycle_no_key;
alter table wash_cycles add constraint wash_cycles_serial_key unique (serial);
alter table wash_cycles drop column cycle_no;
alter table wash_cycles drop column voided_at;

alter table finished_pallets drop column wash_cycle;
alter table moyka_sends drop column wash_cycle;

-- ============================================================
-- 6. Hard gate: Barcode #2 cannot be assigned without a passing CURRENT
--    (latest) CHIQIM verdict on the parent serial. Scalar subquery, not
--    EXISTS -- must be the most recent verdict specifically.
-- ============================================================
drop policy ombor_writes on finished_pallets;
create policy ombor_writes on finished_pallets for insert
  with check (
    my_role() = 'ombor'
    and (
      select lr.verdict from lab_results lr
      join wash_cycles wc on wc.id = lr.wash_cycle_id
      where wc.serial = finished_pallets.serial and lr.scope = 'chiqim'
      order by lr.created_at desc limit 1
    ) = 'o_tdi'
  );
