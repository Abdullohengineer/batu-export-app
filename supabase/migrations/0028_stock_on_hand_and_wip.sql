-- §3.2.6 Ombor qoldig'i (stock on hand) + §3.2.9 Kutilayotgan ishlar (WIP) +
-- §3.2.9 lab turnaround. Built on the same server-side query foundation as
-- §3.2.1-3.2.5 (0026/0027) -- report_kirim_rows/report_chiqim_rows reused
-- directly (provisional-weight check), same TEST- exclusion convention
-- everywhere, same settings_limits table (§2.14) for new thresholds.

-- ============================================================
-- 0. New configurable thresholds (§2.14), editable in Administration like
--    the existing four (abnormal_loss_pct/kam_chiqdi_pct/moyka_idle_days/
--    sulfur_overdue_days). tahlil_kechikdi_days resolves SPEC's own
--    long-open "NEW OPEN #9" question (untested-batch exception, never
--    resolved until now).
-- ============================================================
insert into settings_limits (key, value) values
  ('raw_idle_days', 3),
  ('tahlil_kechikdi_days', 2),
  ('chiqim_idle_days', 2)
on conflict (key) do nothing;

-- ============================================================
-- 1. stock_on_hand_rows -- one row per finished pallet OR per raw-balance
--    serial currently on site. §3.2.6's five states:
--      available      = in_stock, unclaimed, current cycle verdict o'tdi
--      band_qilingan   = claimed onto a manifest, that dispatch not yet
--                        gate-stage-2-complete (reserved, still physically here)
--      awaiting_lab    = in_stock, unclaimed, no chiqim verdict yet
--      qayta_yuvish    = in_stock, unclaimed, verdict qayta_yuvish (flagged)
--      raw_not_washed  = cycle-1 raw balance never sent to Moyka
--    Konditirskiy needs no special-case here: it already has its own
--    calibre_id (is_numberless), so grouping by calibre_id naturally keeps
--    it a separate bucket per client -- a display/sort concern, not new SQL.
-- ============================================================
create or replace view stock_on_hand_rows
with (security_invoker = true) as
with pallet_rows as (
  select
    (case
      when lr.verdict = 'qayta_yuvish' then 'qayta_yuvish'
      when lr.verdict is null then 'awaiting_lab'
      when dm.request_id is not null then 'band_qilingan'
      else 'available'
    end) as bucket,
    fp.barcode2 as row_key,
    fp.serial as serial,
    fp.barcode2 as barcode2,
    ko.owner_id as owner_id,
    fp.type_id as type_id,
    fp.calibre_id as calibre_id,
    fp.weight_kg as qty_kg,
    fp.received_date as anchor_date
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
  -- 🔒 Verdict gate is per-SERIAL's CURRENT (highest cycle_no) cycle, NOT
  -- per this pallet's own fp.wash_cycle -- matches labVerdict.ts's
  -- currentCycleLabStatus exactly (shared by useAvailableFinishedStock.ts +
  -- chiqimScan.ts's hard gate, "one derived truth, all consumers"). Matters
  -- for Konditirskiy: it survives a voided cycle in_stock (§2.13) with
  -- fp.wash_cycle still pointing at the OLD failed cycle, but its actual
  -- availability is governed by the serial's current cycle, same as every
  -- other pallet on that serial -- using fp.wash_cycle directly would wrongly
  -- flag a passed serial's surviving Konditirskiy as qayta_yuvish forever.
  left join lateral (
    select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial order by wc2.cycle_no desc limit 1
  ) wc on true
  left join lateral (
    select lr3.verdict from lab_results lr3
    where lr3.scope = 'chiqim' and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc limit 1
  ) lr on true
  where fp.status = 'in_stock'
    -- jo'natilgan (claimed AND that dispatch's gate stage 2 complete) has
    -- physically departed -- not on-hand. Same derivation report_chiqim_rows
    -- already uses for pallet_status.
    and not (dm.request_id is not null and cgw.completed_at is not null)
    and ko.plate not like 'TEST-%'
    and coalesce(cr.plate, '') not like 'TEST-%'
),
raw_rows as (
  -- §2.16 "every downstream calculation reads effective_qty, never
  -- actual_qty/declared" -- useMoykaSerials.ts's own cycle-1 cap already
  -- reads effective_qty (eq?.value ?? intake.actual_qty), so this bucket
  -- must match it exactly, not re-derive a second, disagreeing raw balance
  -- from storage_intake.actual_qty directly. report_kirim_rows.qty_kg IS
  -- effective_qty (0026) -- reused here rather than a second implementation.
  select
    'raw_not_washed' as bucket,
    r.row_key as row_key,
    r.serial as serial,
    null::text as barcode2,
    r.owner_id as owner_id,
    r.type_id as type_id,
    null::uuid as calibre_id,
    (r.qty_kg - coalesce(sent.total_sent, 0)) as qty_kg,
    (si.confirmed_at at time zone 'utc')::date as anchor_date
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (
    select coalesce(sum(ms.qty_kg), 0) as total_sent
    from moyka_sends ms where ms.serial = r.serial and ms.wash_cycle = 1
  ) sent on true
  where (r.qty_kg - coalesce(sent.total_sent, 0)) > 0
)
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
       (current_date - anchor_date) as days_held,
       (current_date - anchor_date) > 90 as aged_90
from pallet_rows
union all
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
       (current_date - anchor_date) as days_held,
       (current_date - anchor_date) > 90 as aged_90
from raw_rows;

grant select on stock_on_hand_rows to authenticated;

-- ============================================================
-- 2. stock_on_hand_summary -- grouped client -> product -> calibre -> bucket,
--    the aggregate the grouped UI actually renders (row-level view above
--    stays for passport drill-down, same detail/aggregate split as
--    report_query_page/report_totals).
-- ============================================================
create or replace function stock_on_hand_summary(p_owner_id uuid default null)
returns table (
  owner_id uuid, type_id uuid, calibre_id uuid, bucket text,
  total_kg numeric, batch_count bigint, oldest_days_held int, aged_90_count bigint
)
language sql stable security invoker as $$
  select owner_id, type_id, calibre_id, bucket,
         sum(qty_kg), count(*), max(days_held), count(*) filter (where aged_90)
  from stock_on_hand_rows
  where p_owner_id is null or owner_id = p_owner_id
  group by owner_id, type_id, calibre_id, bucket;
$$;

grant execute on function stock_on_hand_summary(uuid) to authenticated;

-- ============================================================
-- 3. lab_turnaround_avg -- §3.2.9 part C: avg days between a wash cycle
--    producing pallets (earliest finished_pallets.received_date for that
--    cycle) and its CHIQIM lab verdict landing (sample_date) -- completed
--    checks only. Shown once, on the stock-on-hand header, as the benchmark
--    an in-progress "awaiting_lab" WIP row's own days_waiting is read against.
--    Day-granularity only (received_date/sample_date are both `date`, no
--    finer timestamp exists on either side -- same limitation already
--    accepted elsewhere in this codebase for sent_date/completed_at).
-- ============================================================
create or replace function lab_turnaround_avg()
returns numeric
language sql stable security invoker as $$
  -- 🔒 TEST- fixture exclusion (matches every other view in this engine,
  -- reportQuery.ts's isTestPlate() precedent) -- found live during visual
  -- verification: 193 TEST- rows vs. 10 real ones diluted the displayed
  -- average from a real 0.9 days down to 0.0, silently.
  select avg(lr.sample_date - fp_first.received_date)
  from lab_results lr
  join wash_cycles wc on wc.id = lr.wash_cycle_id
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select min(fp2.received_date) as received_date
    from finished_pallets fp2
    where fp2.serial = wc.serial and fp2.wash_cycle = wc.cycle_no
  ) fp_first on true
  where lr.scope = 'chiqim'
    and ko.plate not like 'TEST-%';
$$;

grant execute on function lab_turnaround_avg() to authenticated;

-- ============================================================
-- 4. wip_rows -- §3.2.9's seven "stuck beyond threshold" checks, one shared
--    row shape, one wip_kind per check. Thresholds read live from
--    settings_limits (§2.14) so they stay editable without a code change.
--    qayta_yuvish_pending and provisional_weight are unconditional per the
--    task's own instruction -- threshold_days is null for both, they always
--    show once the underlying state exists.
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
-- 1. Raw received, not sent to Moyka (cycle-1 balance only -- re-wash
--    remainders are check 5 below, a different state, not this one).
--    §2.16: reads effective_qty (report_kirim_rows.qty_kg), the same figure
--    useMoykaSerials.ts's own cycle-1 cap uses -- not actual_qty directly,
--    which would silently disagree with Ombor's own Moyka screen whenever
--    gate net differs from declared/intake.
raw_not_sent as (
  select
    'raw_not_sent'::text as wip_kind, r.row_key as row_key, r.serial as serial,
    null::uuid as request_id, r.owner_id as owner_id, r.type_id as type_id,
    (current_date - (si.confirmed_at at time zone 'utc')::date) as days_waiting,
    l.raw_idle_days::int as threshold_days
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (
    select coalesce(sum(ms.qty_kg), 0) as total_sent
    from moyka_sends ms where ms.serial = r.serial and ms.wash_cycle = 1
  ) sent on true
  cross join limits l
  where (r.qty_kg - coalesce(sent.total_sent, 0)) > 0
    and (current_date - (si.confirmed_at at time zone 'utc')::date) > l.raw_idle_days
),
-- 2. Sent to Moyka, not returned (cycle still active, past moyka_idle_days)
moyka_not_returned as (
  select
    'moyka_not_returned'::text as wip_kind, wc.serial as row_key, wc.serial as serial,
    null::uuid as request_id, ko.owner_id as owner_id, kl.type_id as type_id,
    (current_date - ms_first.sent_date) as days_waiting, l.moyka_idle_days::int as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select min(ms2.sent_date) as sent_date
    from moyka_sends ms2 where ms2.serial = wc.serial and ms2.wash_cycle = wc.cycle_no
  ) ms_first on true
  cross join limits l
  where wc.status = 'active'
    and ko.plate not like 'TEST-%'
    and (current_date - ms_first.sent_date) > l.moyka_idle_days
),
-- 3. Awaiting lab test (CHIQIM) -- highest value: untested stock cannot ship
awaiting_lab as (
  select
    'awaiting_lab'::text as wip_kind, fp_first.barcode2 as row_key, wc.serial as serial,
    null::uuid as request_id, ko.owner_id as owner_id, fp_first.type_id as type_id,
    (current_date - fp_first.received_date) as days_waiting, l.tahlil_kechikdi_days::int as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select fp2.barcode2, fp2.type_id, fp2.received_date
    from finished_pallets fp2
    where fp2.serial = wc.serial and fp2.wash_cycle = wc.cycle_no
    order by fp2.received_date, fp2.barcode2 limit 1
  ) fp_first on true
  cross join limits l
  where wc.status = 'final'
    and not exists (select 1 from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id)
    and ko.plate not like 'TEST-%'
    and (current_date - fp_first.received_date) > l.tahlil_kechikdi_days
),
-- 4. Moisture in, SO2 pending -- natural products (no SO2 target) excluded,
--    never overdue (§5.5.1)
so2_pending as (
  select
    'so2_pending'::text as wip_kind, wc.serial as row_key, wc.serial as serial,
    null::uuid as request_id, ko.owner_id as owner_id, kl.type_id as type_id,
    (current_date - lr.sample_date) as days_waiting, l.sulfur_overdue_days::int as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lab_results lr on lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id
  cross join limits l
  where lr.status = 'moisture_in'
    and kl.target_so2_mg_kg is not null
    and ko.plate not like 'TEST-%'
    and (current_date - lr.sample_date) > l.sulfur_overdue_days
),
-- 5. Flagged qayta yuvish, not yet re-sent -- unconditional, no threshold
qayta_yuvish_pending as (
  select
    'qayta_yuvish_pending'::text as wip_kind, wc.serial as row_key, wc.serial as serial,
    null::uuid as request_id, ko.owner_id as owner_id, kl.type_id as type_id,
    (current_date - lr.sample_date) as days_waiting, null::int as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lab_results lr on lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id and lr.verdict = 'qayta_yuvish'
  where not exists (
    select 1 from wash_cycles wc2 where wc2.serial = wc.serial and wc2.cycle_no = wc.cycle_no + 1
  )
  and ko.plate not like 'TEST-%'
),
-- 6. Open CHIQIM requests not loaded / not departed
chiqim_open as (
  select
    'chiqim_open'::text as wip_kind, cr.id::text as row_key, null::text as serial,
    cr.id as request_id, cr.owner_id as owner_id, null::uuid as type_id,
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
-- 7. Serials with provisional weight (gate stage 2 outstanding) --
--    unconditional, no threshold. Reuses report_kirim_rows directly rather
--    than re-deriving `provisional`, same reuse precedent §3.2.5 set.
provisional_weight as (
  select
    'provisional_weight'::text as wip_kind, r.row_key as row_key, r.serial as serial,
    null::uuid as request_id, r.owner_id as owner_id, r.type_id as type_id,
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
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from qayta_yuvish_pending
union all
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from chiqim_open
union all
select wip_kind, row_key, serial, request_id, owner_id, type_id, days_waiting, threshold_days from provisional_weight;

grant select on wip_rows to authenticated;

-- ============================================================
-- 5. Supporting indexes -- columns this query shape filters/joins on that
--    have no index yet (dataset is small today; same forward-looking
--    rationale as 0026's own index block).
-- ============================================================
create index if not exists idx_wash_cycles_serial_cycle on wash_cycles (serial, cycle_no);
create index if not exists idx_wash_cycles_status on wash_cycles (status);
create index if not exists idx_lab_results_status on lab_results (status) where scope = 'chiqim';
create index if not exists idx_chiqim_requests_ombor_finished on chiqim_requests (ombor_finished_at);
