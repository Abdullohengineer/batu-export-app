-- so2_pending (Laborator WIP alert, §5.5.1): the target_so2_mg_kg-is-null
-- inference is retired, replaced by the explicit is_sulfured flag
-- (2026-08-14). Same NULL-means-sulfured fail-safe as every other consumer:
-- `is distinct from false` treats NULL (not yet classified) the same as
-- true -- only an explicit false exempts a serial from this alert. See
-- DECISIONS.md "Client quality targets removed from Menejer/Laborator;
-- explicit natural/sulphured flag".
--
-- Every other CTE (raw_not_sent, moyka_not_returned, awaiting_lab,
-- chiqim_open, provisional_weight) and the final UNION ALL/select list are
-- byte-identical to the live definition (confirmed via pg_get_viewdef
-- immediately before writing this) -- only so2_pending's predicate changes.
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
  where lr.status = 'moisture_in' and kl.is_sulfured is distinct from false and ko.plate not like 'TEST-%'
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
