-- §2.16 KIRIM box mass: net product = gate loaded − gate empty − Σ(box
-- mass across the truck's lines). storage_intake is already "the
-- intake/line record" (PK = serial) -- box_mass_kg lives there, entered
-- mandatorily by Ombor at accept time, same moment as actual_qty. Table is
-- empty at migration time (post clean-slate wipe), so NOT NULL needs no
-- backfill.
alter table storage_intake
  add column box_mass_kg numeric not null check (box_mass_kg >= 0);

-- report_kirim_rows is the SQL-side twin of weightAuthority.ts's
-- deriveEffectiveQty (see report-effective-qty-parity.spec.ts, which
-- exists specifically to catch the two drifting). box_mass CTE sums each
-- order's lines' box_mass_kg, but only once EVERY line has been accepted
-- (bool_and) -- otherwise the truck-level total is incomplete and must
-- stay null, matching the two-independent-pending-inputs rule. Every place
-- that previously read raw gw.net_kg as the truck's product total now
-- reads (gw.net_kg - bm.total_box_mass_kg) instead: qty_kg's single-line
-- final branch, provisional (now also waits on box mass), both
-- truck_variance_diff_* columns, and provisional_variance_flag.
-- Multi-line per-line qty_kg is untouched (still si.actual_qty, §2.16.1's
-- unchanged headline rule) -- box mass only corrects the truck-level total
-- it's reconciled against.
create or replace view report_kirim_rows as
with lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.declared_qty,
         kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
),
box_mass as (
  select kl.order_id,
         case when bool_and(si.serial is not null) then sum(si.box_mass_kg) else null end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si on si.serial = kl.serial
  group by kl.order_id
)
select 'kirim'::text as kind,
    l.serial as row_key, l.serial, null::text as barcode2, l.order_id, null::uuid as request_id,
    ko.owner_id, l.type_id, null::uuid as calibre_id, ko.plate, ko.driver,
    coalesce((gw.stage1_completed_at at time zone 'utc')::date, ko.order_date) as date_basis,
    case when gw.stage1_completed_at is not null then 'gate_stage1'::text else 'order_date'::text end as date_basis_source,
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
    case
        when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null
        then (gw.net_kg - bm.total_box_mass_kg) - ko.declared_total
        else null::numeric
    end as truck_variance_diff_kg,
    case
        when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null and ko.declared_total > 0::numeric
        then ((gw.net_kg - bm.total_box_mass_kg) - ko.declared_total) / ko.declared_total * 100::numeric
        else null::numeric
    end as truck_variance_diff_pct,
    case
        when l.line_count = 1 and gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null
             and si.actual_qty is not null and si.actual_qty <> 0::numeric and es.sent_date is not null
             and es.sent_date <= (gw.completed_at at time zone 'utc')::date
             and abs(((gw.net_kg - bm.total_box_mass_kg) - si.actual_qty) / si.actual_qty * 100::numeric)
                 > coalesce((select settings_limits.value from settings_limits where settings_limits.key = 'kam_chiqdi_pct'::text), 5::numeric)
        then true else false
    end as provisional_variance_flag,
    null::integer as wash_cycle, null::text as pallet_status, null::text as lab_verdict,
    l.target_moisture_pct, l.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
    null::text[] as void_successor_barcodes
from lines l
    join kirim_orders ko on ko.order_id = l.order_id
    left join storage_intake si on si.serial = l.serial
    left join box_mass bm on bm.order_id = l.order_id
    left join lateral (
        select gw2.net_kg, gw2.completed_at, gw2.stage1_completed_at
        from gate_weighings gw2
        where gw2.dir = 'kirim'::direction and gw2.order_id = l.order_id
        order by gw2.stage1_completed_at desc nulls last limit 1
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
