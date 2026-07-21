-- §3.2.8 Moisture-adjusted yield + §3.2.10 Rahbar dashboard (monthly trends,
-- client ranking, product mix, exceptions). Built on the same foundation as
-- 0026/0028/0029 -- report_kirim_rows/report_chiqim_rows/stock_on_hand_rows/
-- wip_rows reused directly; the same all_*/live_* loss-vs-output split and
-- raw-consumed-once denominator 0029 established, applied here from the
-- start (0029 discovered its lossPct bug live; this migration starts with
-- the fix already in place).
--
-- NOTE: this file reflects the FINAL, corrected state as applied live
-- (originally applied as two migrations this session -- the initial
-- yield_rows had a real loss_kg bug, found and fixed within minutes via a
-- second `create or replace view`; folded into one file here since a fresh
-- `supabase db push` should never reproduce a known-bad intermediate step.
-- See DECISIONS.md "Yield view (§3.2.8) + Rahbar dashboard (§3.2.10)" for
-- the bug's full story).

-- ============================================================
-- 0. New settings_limits keys (§2.14). value must become nullable to
--    represent "capacity not yet configured" without a placeholder number
--    -- confirmed with the user: no real production capacity figure exists
--    yet, so the dashboard hides the utilisation line entirely rather than
--    showing a guessed percentage.
-- ============================================================
alter table settings_limits alter column value drop not null;

insert into settings_limits (key, value) values
  ('high_rewash_rate_pct', 20),
  ('practical_capacity_kg_per_month', null)
on conflict (key) do nothing;

-- ============================================================
-- 1. yield_rows -- §3.2.8. One row per fully-processed serial (current/
--    highest wash cycle is 'final' -- still-active serials are WIP, §3.2.9,
--    not here yet). Reuses 0029's exact all_*/live_* split: all_* (every
--    pallet a cycle ever produced, voided or not) feeds loss only; live_*
--    (in_stock only) feeds output/calibre-mix, so superseded voided output
--    is never double-counted. raw_consumed_kg (cycle-1 actual moyka_sends,
--    uncapped) is the loss/yield denominator throughout -- 0029's lossPct
--    bug fix, applied here from the start.
--
-- 🔒 Confirmed with the user: a serial whose current cycle is 'final' but
-- carries an un-actioned `qayta_yuvish` verdict (voided, re-send pending,
-- no successor cycle yet -- fixture story 9) is EXCLUDED here, not just
-- "shown with odd numbers". Its live output is 0 (voided) while its loss
-- line still counts the (now-superseded) original output, so gross yield
-- and loss don't reconcile and true_loss_pct reads a false 100% -- the
-- serial isn't "finished", it's mid-re-wash-limbo, already covered by
-- wip_rows' qayta_yuvish_pending kind (0028). Reuses that EXACT condition
-- (lab verdict qayta_yuvish + no wash_cycles row at cycle_no+1) rather than
-- re-deriving it a second, possibly-drifting way.
--
-- 🔒 loss_kg's minuend is total_sent_kg (moyka_sends summed ACROSS EVERY
-- cycle), never raw_consumed_kg (cycle-1-only) -- a re-wash cycle's own
-- sent_kg is the previous cycle's voided output flowing back into Moyka
-- (§2.13), and must be subtracted against alongside every cycle's own
-- all_calibre_kg/all_konditirskiy_kg, which are ALSO summed across every
-- cycle. Mixing a cycle-1-only numerator with an all-cycles-summed
-- subtrahend (the original bug here) gives nonsense on any re-washed
-- serial -- confirmed against story 4 (Toshkent): the buggy formula gave
-- -2,250 kg/-54.9% where the locked reference is 750 kg/18.3%.
-- loss_PCT's own denominator stays raw_consumed_kg (cycle-1-only, uncapped)
-- -- that part of 0029's fix was correct from the start.
-- ============================================================
create or replace view yield_rows
with (security_invoker = true) as
with serial_base as (
  select
    kl.serial, kl.type_id, ko.owner_id, ko.plate, ko.driver,
    rkr.qty_kg as effective_qty,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.wash_cycle = 1) as raw_consumed_kg,
    (select max(wc.cycle_no) from wash_cycles wc where wc.serial = kl.serial) as current_cycle_no,
    (select max(wc.cycle_no) from wash_cycles wc where wc.serial = kl.serial and wc.status = 'final') as last_final_cycle_no
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows rkr on rkr.serial = kl.serial
  where ko.plate not like 'TEST-%'
),
-- only serials whose CURRENT cycle is itself final -- nothing still active,
-- and nothing sitting flagged-for-rewash-but-not-yet-resent (see header note).
finished_serials as (
  select * from serial_base sb
  where sb.last_final_cycle_no is not null
    and sb.last_final_cycle_no = sb.current_cycle_no
    and not exists (
      select 1 from wash_cycles wc
      join lab_results lr on lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id and lr.verdict = 'qayta_yuvish'
      where wc.serial = sb.serial
        and not exists (select 1 from wash_cycles wc2 where wc2.serial = wc.serial and wc2.cycle_no = wc.cycle_no + 1)
    )
),
cycles as (
  select
    fs.serial, wc.cycle_no,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = fs.serial and fp.wash_cycle = wc.cycle_no) as completed_date,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = fs.serial and ms.wash_cycle = wc.cycle_no) as sent_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = fs.serial and fp.wash_cycle = wc.cycle_no and not c.is_numberless) as all_calibre_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = fs.serial and fp.wash_cycle = wc.cycle_no and c.is_numberless) as all_konditirskiy_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = fs.serial and fp.wash_cycle = wc.cycle_no and fp.status = 'in_stock' and not c.is_numberless) as live_calibre_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp join calibres c on c.id = fp.calibre_id
       where fp.serial = fs.serial and fp.wash_cycle = wc.cycle_no and fp.status = 'in_stock' and c.is_numberless) as live_konditirskiy_kg
  from finished_serials fs
  join wash_cycles wc on wc.serial = fs.serial
  where wc.status = 'final'
),
rollup as (
  select serial, max(completed_date) as completed_date, max(cycle_no) as max_cycle_no,
    sum(sent_kg) as total_sent_kg,
    sum(all_calibre_kg) as total_all_calibre_kg, sum(all_konditirskiy_kg) as total_all_konditirskiy_kg,
    sum(live_calibre_kg) as live_calibre_kg, sum(live_konditirskiy_kg) as live_konditirskiy_kg
  from cycles group by serial
),
calibre_breakdown as (
  select fs.serial, fp.calibre_id, sum(fp.weight_kg) as kg
  from finished_serials fs
  join finished_pallets fp on fp.serial = fs.serial
  join wash_cycles wc on wc.serial = fp.serial and wc.cycle_no = fp.wash_cycle
  where wc.status = 'final' and fp.status = 'in_stock'
  group by fs.serial, fp.calibre_id
),
-- intake moisture (once per serial) + CURRENT cycle's own delivered moisture
-- -- same "judge by current cycle" rule stock_on_hand_rows already applies.
lab_readings as (
  select fs.serial,
    (select lr.moisture_pct from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = fs.serial order by lr.created_at desc limit 1) as intake_moisture_pct,
    (select lr.moisture_pct from lab_results lr join wash_cycles wc on wc.id = lr.wash_cycle_id
       where lr.scope = 'chiqim' and wc.serial = fs.serial order by wc.cycle_no desc, lr.created_at desc limit 1) as delivered_moisture_pct
  from finished_serials fs
)
select
  fs.serial, fs.type_id, fs.owner_id, fs.plate, fs.driver,
  fs.effective_qty as raw_received_kg,
  fs.raw_consumed_kg,
  (fs.raw_consumed_kg - fs.effective_qty) as raw_overage_kg,
  r.completed_date,
  r.max_cycle_no,
  (r.max_cycle_no > 1) as rewashed,
  r.live_calibre_kg, r.live_konditirskiy_kg,
  (r.live_calibre_kg + r.live_konditirskiy_kg) as output_kg,
  (r.total_sent_kg - r.total_all_calibre_kg - r.total_all_konditirskiy_kg) as loss_kg,
  case when fs.raw_consumed_kg > 0 then round((r.total_sent_kg - r.total_all_calibre_kg - r.total_all_konditirskiy_kg) / fs.raw_consumed_kg * 100, 1) else 0 end as loss_pct,
  case when fs.raw_consumed_kg > 0 then round((r.live_calibre_kg + r.live_konditirskiy_kg) / fs.raw_consumed_kg * 100, 1) else 0 end as gross_yield_pct,
  lab.intake_moisture_pct, lab.delivered_moisture_pct,
  (lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null) as dry_matter_available,
  case when lab.intake_moisture_pct is not null then round(fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100), 1) end as dry_matter_in_kg,
  case when lab.delivered_moisture_pct is not null then round((r.live_calibre_kg + r.live_konditirskiy_kg) * (1 - lab.delivered_moisture_pct / 100), 1) end as dry_matter_out_kg,
  case when lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null
         and fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100) > 0
       then round((fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100) - (r.live_calibre_kg + r.live_konditirskiy_kg) * (1 - lab.delivered_moisture_pct / 100))
                  / (fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100)) * 100, 1)
  end as true_loss_pct,
  (
    select coalesce(jsonb_agg(jsonb_build_object('calibreId', cb.calibre_id, 'kg', cb.kg,
      'pct', case when (r.live_calibre_kg + r.live_konditirskiy_kg) > 0 then round(cb.kg / (r.live_calibre_kg + r.live_konditirskiy_kg) * 100, 1) else 0 end)
      order by cb.kg desc), '[]'::jsonb)
    from calibre_breakdown cb where cb.serial = fs.serial
  ) as calibre_mix
from finished_serials fs
join rollup r on r.serial = fs.serial
join lab_readings lab on lab.serial = fs.serial;

grant select on yield_rows to authenticated;

-- ============================================================
-- 2. rahbar_monthly_trends -- §3.2.10. One row per month with any activity
--    (KIRIM arrival, CHIQIM departure, or a serial's yield becoming final).
--    utilization_pct is null whenever practical_capacity_kg_per_month is
--    unset -- the UI hides the whole line rather than showing a guessed %.
-- ============================================================
create or replace function rahbar_monthly_trends()
returns table (
  month date, volume_in_kg numeric, volume_out_kg numeric,
  raw_consumed_kg numeric, output_kg numeric,
  gross_yield_pct numeric, gross_loss_pct numeric,
  dry_matter_true_loss_pct numeric, dry_matter_serial_count bigint, yield_serial_count bigint,
  rewash_rate_pct numeric, rewash_count bigint,
  utilization_pct numeric,
  calibre_mix jsonb
)
language sql stable security invoker as $$
with cap as (
  select value from settings_limits where key = 'practical_capacity_kg_per_month'
),
months as (
  select distinct date_trunc('month', date_basis)::date as month from report_kirim_rows where date_basis is not null
  union
  select distinct date_trunc('month', date_basis)::date as month from report_chiqim_rows where date_basis is not null
  union
  select distinct date_trunc('month', completed_date)::date as month from yield_rows where completed_date is not null
),
vol_in as (
  select date_trunc('month', date_basis)::date as month, sum(qty_kg) as kg
  from report_kirim_rows where date_basis is not null group by 1
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
$$;

grant execute on function rahbar_monthly_trends() to authenticated;

-- ============================================================
-- 3. rahbar_client_ranking -- clients with any activity in the period,
--    ranked by kg received (§6.1's own "throughput... qabul qilingan").
-- ============================================================
create or replace function rahbar_client_ranking(p_from date, p_to date)
returns table (owner_id uuid, owner_name text, received_kg numeric, dispatched_kg numeric)
language sql stable security invoker as $$
  with recv as (
    select owner_id, sum(qty_kg) as kg from report_kirim_rows where date_basis between p_from and p_to group by owner_id
  ), disp as (
    select owner_id, sum(qty_kg) as kg from report_chiqim_rows where date_basis between p_from and p_to group by owner_id
  )
  select o.id, o.name, coalesce(r.kg, 0), coalesce(d.kg, 0)
  from owners o
  left join recv r on r.owner_id = o.id
  left join disp d on d.owner_id = o.id
  where coalesce(r.kg, 0) > 0 or coalesce(d.kg, 0) > 0
  order by coalesce(r.kg, 0) desc;
$$;

grant execute on function rahbar_client_ranking(date, date) to authenticated;

-- ============================================================
-- 4. rahbar_product_mix -- % of raw received by product type, period-scoped.
-- ============================================================
create or replace function rahbar_product_mix(p_from date, p_to date)
returns table (type_id uuid, received_kg numeric, pct_of_total numeric)
language sql stable security invoker as $$
  with recv as (
    select type_id, sum(qty_kg) as kg from report_kirim_rows where date_basis between p_from and p_to group by type_id
  ), total as (select coalesce(sum(kg), 0) as kg from recv)
  select r.type_id, r.kg, case when t.kg > 0 then round(r.kg / t.kg * 100, 1) else 0 end
  from recv r cross join total t
  order by r.kg desc;
$$;

grant execute on function rahbar_product_mix(date, date) to authenticated;

-- ============================================================
-- 5. rahbar_exceptions -- §6.2/§3.2.10. Four kinds, one shared row shape,
--    kind-specific fields in `detail`. Three of four reuse EXISTING
--    views/thresholds outright (ageing from 0028's stock_on_hand_rows,
--    lab-overdue from 0028's wip_rows, high-loss from the EXISTING
--    abnormal_loss_pct, §2.14) -- only high-rewash needed a new threshold.
--    high_loss / high_rewash scoped to the current calendar month (an
--    exceptions list, not a history, §3.2.9's own named principle).
-- ============================================================
create or replace function rahbar_exceptions()
returns table (exception_kind text, row_key text, owner_id uuid, serial text, type_id uuid, detail jsonb)
language sql stable security invoker as $$
  select 'ageing_stock', s.row_key, s.owner_id, s.serial, s.type_id,
    jsonb_build_object('qtyKg', s.qty_kg, 'daysHeld', s.days_held, 'bucket', s.bucket)
  from stock_on_hand_rows s where s.aged_90
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
$$;

grant execute on function rahbar_exceptions() to authenticated;
