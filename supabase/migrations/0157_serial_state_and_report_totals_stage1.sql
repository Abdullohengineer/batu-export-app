-- Stage 1 of the report_totals perf migration (2026-10-12). Hisobot and
-- client KIRIM (useReportQuery.ts -> report_totals) feel slow because
-- report_totals runs kirim_line_report_bundle_set's per-serial fan-out
-- (effective_qty ladder, moyka sent/out, dispatched, state) across EVERY
-- distinct serial in the filtered set, not just the visible page -- unlike
-- report_query_page_rows/report_page_enrich, which already fan out only
-- for the current page and are UNCHANGED by this migration. Proizvodstva
-- (client_production_ledger, 0114) is fast because it pre-filters to one
-- owner+type+period before any per-serial math runs at all.
--
-- This PR builds serial_state (one row per serial, set-based: grouped
-- scans and joins, no per-row scalar function calls) and points
-- report_totals at it for ONLY the fields that are genuinely
-- date-independent lifetime facts: Qabul qilingan, Omborda qoldi, Xom
-- jo'natilgan, Olib ketilgan, and the two "(jami)" lifetime moyka twins.
-- Moykada (as-of the report's own p_to), the period-scoped Moyka/
-- Yo'qotish/K1-K8/KN figures stay on the exact same formulas
-- kirim_line_report_bundle_set already uses -- a parameterless view
-- cannot honor an arbitrary historical p_to without becoming wrong for
-- any report whose p_to isn't today, so those are lifted out of
-- report_totals' own body verbatim (same exclusion set, same joins) rather
-- than swapped onto serial_state. kirim_line_report_bundle_set itself is
-- UNCHANGED -- report_page_enrich (the per-page path) still calls it
-- exactly as before.
--
-- Staged: dashboard tiles, serial passport, and Ledger B/C swap onto
-- serial_state one at a time in follow-up PRs, per instruction.
--
-- DELIBERATE, DISCLOSED CORRECTION (confirmed with Abdulloh, 2026-10-12):
-- finished-side terms in serial_state use the 0106 THREE-status exclusion
-- (bekor_qilindi, consumed, storage_loss) + serial_mint_sources, matching
-- rahbar_dashboard_ledger's pallet_base (0106_rahbar_dashboard_corrections.sql)
-- -- NOT kirim_line_report_bundle_set's narrower two-status exclusion
-- (bekor_qilindi, storage_loss only). Verified live: 32 'consumed' pallets /
-- 26,740 kg exist; 12 / 7,590 kg are already excluded today via
-- serial_mint_sources (recalibre sources), leaving 20 pallets / 19,150 kg
-- that report_totals currently counts and will stop counting once this
-- ships. Byte-compared old vs new report_totals for 3 scenarios against
-- production (see PR description for the full diff): the ONLY differences
-- in all three are exactly this correction (state_moykadan_chiqgan_lifetime
-- -19,150 kg where all 10 affected serials fall in the filtered set;
-- state_olib_ketilgan -1,400 kg for the one of those serials, 210826-002,
-- that was also gate-departed) -- every other one of the 31 output fields
-- matched exactly in all three scenarios, and the narrowest scenario
-- (one client, this month) matched byte-for-byte with no diff at all.
--
-- netto_kg/received_kg verified byte-identical to kirim_line_effective_qty()
-- across every real (non-TEST) serial in production before writing this.
-- moykada_kg verified byte-identical to kirim_line_moyka_asof(serial,
-- current_date) the same way. serial_state's own finished-on-hand sum
-- (moykadan_kg - olib_ketilgan_kg, origin in delivery/internal_reprocess)
-- reproduces exactly 63,040 kg in production -- the TRUE current on-hand
-- fixed in the earlier "omborda qolgan" caption PR, not the old buggy
-- 80,790 kg period-closing figure -- confirming this view doesn't carry
-- forward that bug class.

create or replace view public.serial_state as
with
line_counts as (
  select order_id, count(*) as n from kirim_lines group by order_id
),
box_mass as (
  select kl.order_id,
    case when bool_and(si.serial is not null) then sum(si.box_mass_kg) else null end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si on si.serial = kl.serial
  group by kl.order_id
),
gw_kirim_latest as (
  select distinct on (order_id) order_id, net_kg
  from gate_weighings
  where dir = 'kirim'
  order by order_id, stage1_completed_at desc nulls last
),
base as (
  select
    kl.serial, kl.order_id, kl.type_id, kl.declared_qty,
    ko.owner_id, ko.origin, ko.order_date as arrival_date, ko.truck_type,
    si.actual_qty,
    lc.n as line_count,
    bm.total_box_mass_kg,
    gw.net_kg as gw_net_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  left join storage_intake si on si.serial = kl.serial
  left join line_counts lc on lc.order_id = kl.order_id
  left join box_mass bm on bm.order_id = kl.order_id
  left join gw_kirim_latest gw on gw.order_id = kl.order_id
  where ko.plate not like 'TEST-%'
),
-- kirim_line_effective_qty's branching, reproduced set-based (verified
-- byte-identical to the scalar function for every real serial).
netto as (
  select
    serial, order_id, type_id, owner_id, origin, arrival_date,
    sum(declared_qty) as declared_kg,
    case
      when truck_type = 'fura' then coalesce(actual_qty, declared_qty)
      when actual_qty is null then declared_qty
      when gw_net_kg is null or total_box_mass_kg is null then actual_qty
      when line_count > 1 then actual_qty
      else coalesce(gw_net_kg - total_box_mass_kg, actual_qty)
    end as netto_kg
  from base
  group by serial, order_id, type_id, owner_id, origin, arrival_date, truck_type,
    actual_qty, gw_net_kg, total_box_mass_kg, line_count, declared_qty
),
moyka_sent as (
  select serial, coalesce(sum(qty_kg), 0) as kg from moyka_sends group by serial
),
rezka_sent as (
  select serial, coalesce(sum(qty_kg), 0) as kg from rezka_sends group by serial
),
raw_disp as (
  select serial, coalesce(sum(net_kg), 0) as kg from raw_dispatch_lines group by serial
),
-- 0106 exclusion set -- see header comment.
fp_live as (
  select fp.serial, fp.barcode2, fp.weight_kg, fp.received_date
  from finished_pallets fp
  where fp.status not in ('bekor_qilindi', 'consumed', 'storage_loss')
    and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
),
moyka_out as (
  select serial, coalesce(sum(weight_kg), 0) as kg from fp_live group by serial
),
-- Moykada (current in-moyka balance) -- at most one open cycle per serial by
-- construction; reproduces kirim_line_moyka_asof(serial, current_date)'s
-- formula, set-based (verified byte-identical where exercised in production).
open_cycle as (
  select distinct on (serial) serial, opened_at
  from wash_cycles
  where closed_at is null
  order by serial, opened_at desc
),
sent_since_open as (
  select oc.serial, coalesce(sum(ms.qty_kg) filter (where ms.sent_date >= (oc.opened_at at time zone 'utc')::date), 0) as kg
  from open_cycle oc
  left join moyka_sends ms on ms.serial = oc.serial
  group by oc.serial
),
out_since_open as (
  select oc.serial, coalesce(sum(fl.weight_kg) filter (where fl.received_date >= (oc.opened_at at time zone 'utc')::date), 0) as kg
  from open_cycle oc
  left join fp_live fl on fl.serial = oc.serial
  group by oc.serial
),
moykada as (
  select oc.serial, greatest(0, coalesce(sso.kg, 0) - coalesce(oso.kg, 0)) as kg
  from open_cycle oc
  left join sent_since_open sso on sso.serial = oc.serial
  left join out_since_open oso on oso.serial = oc.serial
),
-- Olib ketilgan -- gate-completed CHIQIM dispatch only (chiqim_departed_at),
-- same gate every "departed" reading in this codebase uses (pallet
-- passport, stock-on-hand, this). One call per distinct request with any
-- pallet consumption, not per pallet/serial.
departed_requests as (
  select distinct cr.id as request_id, chiqim_departed_at(cr.id) as completed_at
  from chiqim_requests cr
  join chiqim_lines cl2 on cl2.request_id = cr.id
  join chiqim_pallet_consumption c2 on c2.chiqim_line_id = cl2.id
),
departed as (
  select fl.serial, coalesce(sum(c.qty_kg), 0) as kg
  from fp_live fl
  join chiqim_pallet_consumption c on c.barcode2 = fl.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join departed_requests dr on dr.request_id = cl.request_id
  where dr.completed_at is not null
  group by fl.serial
)
select
  n.serial,
  n.owner_id,
  n.type_id as product_type_id,
  n.origin,
  n.arrival_date,
  n.declared_kg,
  n.netto_kg,
  least(n.netto_kg, n.declared_kg) as hisobiy_kg,
  n.netto_kg as received_kg,
  greatest(0, n.netto_kg - coalesce(ms.kg, 0) - coalesce(rs.kg, 0) - coalesce(rd.kg, 0)) as skladda_kg,
  coalesce(ms.kg, 0) as moykaga_kg,
  coalesce(mk.kg, 0) as moykada_kg,
  coalesce(mo.kg, 0) as moykadan_kg,
  coalesce(rd.kg, 0) as vozvrat_kg,
  coalesce(dep.kg, 0) as olib_ketilgan_kg
from netto n
left join moyka_sent ms on ms.serial = n.serial
left join rezka_sent rs on rs.serial = n.serial
left join raw_disp rd on rd.serial = n.serial
left join moyka_out mo on mo.serial = n.serial
left join moykada mk on mk.serial = n.serial
left join departed dep on dep.serial = n.serial;

comment on view public.serial_state is
  'Stage 1 of the report_totals perf migration (2026-10-12): one row per serial, set-based (grouped scans, no per-row subqueries). Lifetime facts only -- Moyka/Yo''qotish/K1-K8/KN range-scoped figures stay on kirim_line_report_bundle_set until a follow-up stage. Finished-side terms use the 0106 three-status exclusion (bekor_qilindi, consumed, storage_loss), a deliberate, disclosed correction vs. report_totals'' previous narrower two-status exclusion -- see migration header.';

grant select on public.serial_state to authenticated, service_role;

-- report_totals (text[] overload used by useReportQuery.ts) -- rewritten to
-- read the 6 lifetime fields from serial_state via a plain join+sum
-- instead of kirim_line_report_bundle_set's per-serial correlated calls.
-- The range-scoped fields (moyka_asof/moyka_range/loss_range/calibre_output)
-- are lifted verbatim out of that function's own body (same formulas, same
-- two-status exclusion it already uses -- NOT the 0106 set, since this part
-- must stay byte-identical to current behaviour) rather than called
-- through it, so the now-redundant lifetime computation inside that
-- function is actually removed from this hot path, not just discarded
-- output the planner might or might not prune.
CREATE OR REPLACE FUNCTION public.report_totals(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer DEFAULT NULL::integer)
 RETURNS TABLE(total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric, total_kg_from_moyka numeric, state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric, total_kg_to_rezka numeric, total_kg_from_rezka numeric, state_rezkaga_yuborilgan numeric, state_rezkada numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with filtered as materialized (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
  ),
  movement as (
    select
      count(*) as total_count,
      coalesce(sum(case when kind = 'kirim' or (kind = 'rezka_kirim' and row_key like 'rezka-kirim-%') then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn', 'chiqim_dispatch', 'rezka_chiqim') then qty_kg else 0 end), 0) as total_kg_out,
      coalesce(sum(case when kind = 'kirim' or (kind = 'rezka_kirim' and row_key like 'rezka-kirim-%') then box_mass_kg else 0 end), 0) as total_kg_tara_in,
      coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0) as total_kg_tara_out,
      coalesce(sum(declared_qty), 0) as total_declared,
      coalesce(sum(case when kind = 'kirim' or (kind = 'rezka_kirim' and row_key like 'rezka-kirim-%') then least(qty_kg, declared_qty) else 0 end), 0) as total_hisobiy,
      coalesce(sum(case when kind = 'moyka_send' then qty_kg else 0 end), 0) as total_kg_to_moyka,
      coalesce(sum(case when kind = 'moyka_output' then qty_kg else 0 end), 0) as total_kg_from_moyka,
      coalesce(sum(case when kind = 'rezka_send' then qty_kg else 0 end), 0) as total_kg_to_rezka,
      coalesce(sum(case when kind = 'rezka_output' then qty_kg else 0 end), 0) as total_kg_from_rezka
    from filtered
  ),
  distinct_serials as (
    select distinct serial from filtered where serial is not null
  ),
  lifetime_agg as (
    select
      count(*) as state_serial_count,
      coalesce(sum(ss.received_kg), 0) as state_qabul_qilingan,
      coalesce(sum(ss.skladda_kg), 0) as state_omborda_qoldi,
      coalesce(sum(ss.vozvrat_kg), 0) as state_xom_jonatilgan,
      coalesce(sum(ss.olib_ketilgan_kg), 0) as state_olib_ketilgan,
      coalesce(sum(ss.moykaga_kg), 0) as state_moykaga_yuborilgan_lifetime,
      coalesce(sum(ss.moykadan_kg), 0) as state_moykadan_chiqgan_lifetime
    from distinct_serials ds
    join serial_state ss on ss.serial = ds.serial
  ),
  rezka_state as (
    select coalesce(sum(rs.rezkaga_yuborilgan), 0) as rezkaga_yuborilgan, coalesce(sum(rs.rezkada), 0) as rezkada
    from rezka_serial_state_set((select array_agg(serial) from distinct_serials)) rs
  ),
  target_serials as (
    select serial from distinct_serials
  ),
  ms_all as materialized (
    select ms.serial, ms.qty_kg, ms.sent_date
    from moyka_sends ms
    join distinct_serials ds on ds.serial = ms.serial
  ),
  fp_all as materialized (
    select fp.serial, fp.weight_kg, fp.barcode2, fp.received_date, c.code
    from finished_pallets fp
    join distinct_serials ds on ds.serial = fp.serial
    left join calibres c on c.id = fp.calibre_id
    where fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  ),
  moyka_out_all as materialized (
    select r.serial, r.qty_kg, r.date_basis
    from report_moyka_output_rows r
    join distinct_serials ds on ds.serial = r.serial
    where r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
  ),
  cycles_all as materialized (
    select wc.serial, wc.id, wc.cycle_no, wc.opened_at, wc.closed_at,
           lead(wc.opened_at) over (partition by wc.serial order by wc.cycle_no) as next_opened_at
    from wash_cycles wc
    join distinct_serials ds on ds.serial = wc.serial
  ),
  active_cycle as (
    select distinct on (c.serial) c.serial, c.opened_at, c.closed_at
    from cycles_all c
    where (c.opened_at at time zone 'utc')::date <= p_to
    order by c.serial, c.opened_at desc
  ),
  moyka_asof_calc as (
    select ts.serial,
      case
        when ac.opened_at is null then 0
        when ac.closed_at is not null and (ac.closed_at at time zone 'utc')::date <= p_to then 0
        else greatest(0,
          coalesce((select sum(qty_kg) from ms_all where ms_all.serial = ts.serial and sent_date >= ac.opened_at::date and sent_date <= p_to), 0)
          - coalesce((select sum(qty_kg) from moyka_out_all where moyka_out_all.serial = ts.serial and date_basis >= ac.opened_at::date and date_basis <= p_to), 0)
        )
      end as v
    from target_serials ts
    left join active_cycle ac on ac.serial = ts.serial
  ),
  moyka_range_calc as (
    select ts.serial,
      coalesce((select sum(qty_kg) from ms_all where ms_all.serial = ts.serial and sent_date between p_from and p_to), 0) as to_moyka_kg,
      coalesce((select sum(qty_kg) from moyka_out_all where moyka_out_all.serial = ts.serial and date_basis between p_from and p_to), 0) as from_moyka_kg
    from target_serials ts
  ),
  closed_in_range as (
    select * from cycles_all
    where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to
  ),
  loss_range_calc as (
    select ts.serial,
      case when not exists (select 1 from closed_in_range cir where cir.serial = ts.serial) then null
      else (
        select coalesce(sum(
          coalesce((select sum(qty_kg) from ms_all where ms_all.serial = ts.serial and sent_date >= (cir.opened_at at time zone 'utc')::date and sent_date <= (cir.closed_at at time zone 'utc')::date), 0)
          - (select calibre_kg + kn_kg from client_calibre_split(ts.serial, cir.opened_at, case when cir.next_opened_at is null then null else cir.next_opened_at - interval '1 day' end))
        ), 0)
        from closed_in_range cir where cir.serial = ts.serial
      )
      end as v
    from target_serials ts
  ),
  calibre_output as (
    select ts.serial,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '01' and received_date between p_from and p_to), 0) as k1,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '02' and received_date between p_from and p_to), 0) as k2,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '03' and received_date between p_from and p_to), 0) as k3,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '04' and received_date between p_from and p_to), 0) as k4,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '05' and received_date between p_from and p_to), 0) as k5,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '06' and received_date between p_from and p_to), 0) as k6,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '07' and received_date between p_from and p_to), 0) as k7,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '08' and received_date between p_from and p_to), 0) as k8,
      coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = 'KN' and received_date between p_from and p_to), 0) as kn
    from target_serials ts
  ),
  range_agg as (
    select
      coalesce(sum(mac.v), 0) as state_moykada,
      coalesce(sum(mrc.to_moyka_kg), 0) as state_moykaga_yuborilgan,
      coalesce(sum(mrc.from_moyka_kg), 0) as state_moykadan_chiqgan,
      coalesce(sum(co.k1), 0) as state_k1,
      coalesce(sum(co.k2), 0) as state_k2,
      coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4,
      coalesce(sum(co.k5), 0) as state_k5,
      coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7,
      coalesce(sum(co.k8), 0) as state_k8,
      coalesce(sum(co.kn), 0) as state_kn,
      coalesce(sum(lrc.v), 0) as state_yoqotish
    from target_serials ts
    left join moyka_asof_calc mac on mac.serial = ts.serial
    left join moyka_range_calc mrc on mrc.serial = ts.serial
    left join calibre_output co on co.serial = ts.serial
    left join loss_range_calc lrc on lrc.serial = ts.serial
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    lifetime_agg.state_serial_count, lifetime_agg.state_qabul_qilingan, lifetime_agg.state_omborda_qoldi,
    range_agg.state_moykaga_yuborilgan, range_agg.state_moykada, range_agg.state_moykadan_chiqgan,
    lifetime_agg.state_xom_jonatilgan, lifetime_agg.state_olib_ketilgan,
    range_agg.state_k1, range_agg.state_k2, range_agg.state_k3, range_agg.state_k4,
    range_agg.state_k5, range_agg.state_k6, range_agg.state_k7, range_agg.state_k8,
    range_agg.state_kn,
    range_agg.state_yoqotish,
    lifetime_agg.state_moykaga_yuborilgan_lifetime, lifetime_agg.state_moykadan_chiqgan_lifetime,
    movement.total_kg_to_rezka, movement.total_kg_from_rezka,
    rezka_state.rezkaga_yuborilgan, rezka_state.rezkada
  from movement, lifetime_agg, range_agg, rezka_state;
$function$;
