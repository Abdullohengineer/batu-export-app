-- Found during Stage 1 hand-verification: yield_rows treats the seed's
-- fabricated 'final' wash_cycles rows (minted only to satisfy the hard gate
-- -- old-washed pallets never went through a real wash cycle, raw_consumed
-- is always 0 for them) as completed processing, producing a phantom
-- "0 kg in, 52,210 kg out" January 2025 entry in rahbar_monthly_trends'
-- output_kg/calibre_mix/loss%/rewash-rate. Excludes origin='opening_stock'
-- specifically -- NOT 'internal_reprocess': a future Stage 3 re-wash mints
-- an internal_reprocess-origin serial with a REAL wash cycle (real weighed
-- moyka_sends, real output) and must keep counting normally in yield/loss
-- trends, per the already-confirmed "re-washing old stock is real
-- processing" design point. Only serial_base's own WHERE changes; every
-- other CTE in this view is byte-identical to the live definition
-- (confirmed via pg_get_viewdef before editing).
create or replace view yield_rows as
with serial_base as (
  select kl.serial, kl.type_id, ko.owner_id, ko.plate, ko.driver, rkr.qty_kg as effective_qty,
    (select coalesce(sum(ms.qty_kg), 0::numeric) from moyka_sends ms where ms.serial = kl.serial) as raw_consumed_kg,
    wc.id as wash_cycle_id, wc.status as wash_cycle_status
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  where ko.plate !~~ 'TEST-%'::text
    and ko.origin != 'opening_stock'
), finished_serials as (
  select serial_base.serial, serial_base.type_id, serial_base.owner_id, serial_base.plate, serial_base.driver,
    serial_base.effective_qty, serial_base.raw_consumed_kg, serial_base.wash_cycle_id, serial_base.wash_cycle_status
  from serial_base
  where serial_base.wash_cycle_status = 'final'::text
), output as (
  select fs_1.serial,
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0::numeric) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0::numeric) as konditirskiy_kg,
    min(fp.received_date) as completed_date
  from finished_serials fs_1
  join finished_pallets fp on fp.serial = fs_1.serial
  join calibres c on c.id = fp.calibre_id
  group by fs_1.serial
), rewash_flag as (
  select fs_1.serial,
    (exists (select 1 from lab_results lr where lr.wash_cycle_id = fs_1.wash_cycle_id and lr.scope = 'chiqim'::direction and lr.verdict = 'qayta_yuvish'::text)) as rewashed
  from finished_serials fs_1
), calibre_breakdown as (
  select fs_1.serial, fp.calibre_id, sum(fp.weight_kg) as kg
  from finished_serials fs_1
  join finished_pallets fp on fp.serial = fs_1.serial
  group by fs_1.serial, fp.calibre_id
), lab_readings as (
  select fs_1.serial,
    (select lr.moisture_pct from lab_results lr where lr.scope = 'kirim'::direction and lr.parent_serial = fs_1.serial order by lr.created_at desc limit 1) as intake_moisture_pct,
    (select lr.moisture_pct from lab_results lr where lr.scope = 'chiqim'::direction and lr.wash_cycle_id = fs_1.wash_cycle_id order by lr.created_at desc limit 1) as delivered_moisture_pct
  from finished_serials fs_1
)
select fs.serial, fs.type_id, fs.owner_id, fs.plate, fs.driver,
  fs.effective_qty as raw_received_kg, fs.raw_consumed_kg, fs.raw_consumed_kg - fs.effective_qty as raw_overage_kg,
  o.completed_date, 1 as max_cycle_no, rf.rewashed,
  o.calibre_kg as live_calibre_kg, o.konditirskiy_kg as live_konditirskiy_kg,
  o.calibre_kg + o.konditirskiy_kg as output_kg,
  fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg as loss_kg,
  case when fs.raw_consumed_kg > 0::numeric then round((fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1) else 0::numeric end as loss_pct,
  case when fs.raw_consumed_kg > 0::numeric then round((o.calibre_kg + o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1) else 0::numeric end as gross_yield_pct,
  lab.intake_moisture_pct, lab.delivered_moisture_pct,
  lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null as dry_matter_available,
  case when lab.intake_moisture_pct is not null then round(fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric), 1) else null::numeric end as dry_matter_in_kg,
  case when lab.delivered_moisture_pct is not null then round((o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric), 1) else null::numeric end as dry_matter_out_kg,
  case when lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null and (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) > 0::numeric
       then round((fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric) - (o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric)) / (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) * 100::numeric, 1)
       else null::numeric end as true_loss_pct,
  (select coalesce(jsonb_agg(jsonb_build_object('calibreId', cb.calibre_id, 'kg', cb.kg, 'pct',
      case when (o.calibre_kg + o.konditirskiy_kg) > 0::numeric then round(cb.kg / (o.calibre_kg + o.konditirskiy_kg) * 100::numeric, 1) else 0::numeric end) order by cb.kg desc), '[]'::jsonb)
   from calibre_breakdown cb where cb.serial = fs.serial) as calibre_mix
from finished_serials fs
join output o on o.serial = fs.serial
join rewash_flag rf on rf.serial = fs.serial
join lab_readings lab on lab.serial = fs.serial;
