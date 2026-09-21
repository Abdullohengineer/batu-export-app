-- Phase 2 step 4 (data-layer perf pass) — ships docs/decisions/
-- 0210-2026-09-19-phase3-design-proposal-set-based-vs-summary-table.md
-- Option 1, PARTIALLY: report_totals only. report_query_page's own swap
-- was applied, measured, and reverted after live re-verification surfaced
-- a severe query-planner regression specific to it — see the note ahead of
-- section 2 below and the DECISIONS.md entry for this step.
--
-- Problem (0208, 0210): report_query_page/report_totals dedup their LATERAL
-- to one kirim_line_report_bundle(serial, from, to) CALL per DISTINCT serial
-- (migration 0135 already cut this from one-per-row to one-per-serial), but
-- each call still independently re-runs its own set of correlated
-- subqueries against moyka_sends/finished_pallets/etc. filtered to that one
-- serial. report_totals' own page of 33 distinct serials costs ~1.7s this
-- way — "inherent: ~33 distinct serials x ~50ms per bundle call" (0208).
--
-- Fix (0210 Option 1, measured ~449ms for the same 33-serial set): a new
-- kirim_line_report_bundle_set(p_serials text[], p_from date, p_to date)
-- computes every serial's bundle in ONE query via GROUP BY serial /
-- per-serial CTEs over the whole serial set at once, instead of N separate
-- function invocations each re-planning and re-scanning per serial.
-- report_totals(text[], ...) swaps its per-serial LATERAL for one call to
-- it. kirim_line_report_bundle(p_serial, from, to) itself, and
-- report_query_page(text[], ...) (the other caller, confirmed via prosrc
-- search -- the single-direction, non-array overloads of both functions
-- call report_filtered_rows/report_totals' pre-0135 path and never
-- reference kirim_line_report_bundle at all), are UNCHANGED — see the note
-- ahead of section 2 below for why.
--
-- 7 of the 20 returned fields are lifetime/current-state (state_qabul_
-- qilingan, state_omborda_qoldi, state_moykaga_yuborilgan, state_moykada,
-- state_moykadan_chiqgan, state_xom_jonatilgan, state_olib_ketilgan) --
-- independent of p_from/p_to. The other 13 (moyka_asof, moyka_range_*,
-- calibre_output_k1..k8/kn, loss_range) are period-scoped. state_moykada,
-- moyka_asof and loss_range are the three cycle-aware fields -- kept as a
-- LATERAL/join over CYCLES (not serials), same as the original, since a
-- serial can have more than one wash cycle (Path E cheat).
--
-- 🔒 Byte-identity requirement (0210's own verification plan, same "prove
-- it" standard as migration 0135's own dedup applies): verified
-- serial-by-serial, field-by-field (IS DISTINCT FROM) and whole-RPC md5,
-- across 6 date-window shapes (full history, current month, empty window,
-- mid-cycle-end, a fixed historical range, last 7 days), 198 rows compared
-- (33 serials × 6 windows), 0 mismatches. See the DECISIONS.md entry for
-- this step for the full verification write-up, including the RLS-role
-- equivalence argument (both functions are plain security-invoker SQL with
-- no role-specific logic, reading the same tables the same way, so RLS
-- enforcement is orthogonal to this rewrite by construction).

-- ============================================================
-- 1. New set-based function
-- ============================================================
create or replace function kirim_line_report_bundle_set(p_serials text[], p_from date, p_to date)
returns table(
  serial text,
  state_qabul_qilingan numeric,
  state_omborda_qoldi numeric,
  state_moykaga_yuborilgan numeric,
  state_moykada numeric,
  state_moykadan_chiqgan numeric,
  state_xom_jonatilgan numeric,
  state_olib_ketilgan numeric,
  moyka_asof numeric,
  moyka_range_to_moyka_kg numeric,
  moyka_range_from_moyka_kg numeric,
  calibre_output_k1 numeric,
  calibre_output_k2 numeric,
  calibre_output_k3 numeric,
  calibre_output_k4 numeric,
  calibre_output_k5 numeric,
  calibre_output_k6 numeric,
  calibre_output_k7 numeric,
  calibre_output_k8 numeric,
  calibre_output_kn numeric,
  loss_range numeric
)
language sql
stable
as $function$
  with
  target_serials as (
    select distinct s as serial from unnest(p_serials) as s
  ),
  eq as (
    select ts.serial, kirim_line_effective_qty(ts.serial) as v
    from target_serials ts
  ),
  ms_all as materialized (
    select serial, qty_kg, sent_date from moyka_sends where serial = any(p_serials)
  ),
  sent as (
    select ts.serial, coalesce(sum(ms.qty_kg), 0) as v
    from target_serials ts
    left join ms_all ms on ms.serial = ts.serial
    group by ts.serial
  ),
  rezka_sent as (
    select ts.serial, coalesce(sum(r.qty_kg), 0) as v
    from target_serials ts
    left join rezka_sends r on r.serial = ts.serial
    group by ts.serial
  ),
  raw_disp as (
    select ts.serial, coalesce(sum(rd.net_kg), 0) as v
    from target_serials ts
    left join raw_dispatch_lines rd on rd.serial = ts.serial
    group by ts.serial
  ),
  fp_all as materialized (
    select fp.serial, fp.weight_kg, fp.barcode2, fp.received_date, c.code
    from finished_pallets fp
    left join calibres c on c.id = fp.calibre_id
    where fp.serial = any(p_serials)
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  ),
  moyka_out_all as materialized (
    select r.serial, r.qty_kg, r.date_basis
    from report_moyka_output_rows r
    where r.serial = any(p_serials)
      and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
  ),
  cycles_all as materialized (
    select serial, id, cycle_no, opened_at, closed_at,
           lead(opened_at) over (partition by serial order by cycle_no) as next_opened_at
    from wash_cycles where serial = any(p_serials)
  ),
  moyka_out as (
    select ts.serial, coalesce(sum(fp.weight_kg), 0) as v
    from target_serials ts
    left join fp_all fp on fp.serial = ts.serial
    group by ts.serial
  ),
  moykada_per_cycle as (
    select c.serial, coalesce(sum(
      case when c.closed_at is not null then 0
        else greatest(0,
          coalesce((select sum(qty_kg) from ms_all where ms_all.serial = c.serial and sent_date >= c.opened_at::date), 0)
          - coalesce((select sum(weight_kg) from fp_all where fp_all.serial = c.serial and received_date >= c.opened_at::date), 0)
        )
      end
    ), 0) as v
    from cycles_all c
    group by c.serial
  ),
  departed as (
    select ts.serial, coalesce(sum(d.qty_kg), 0) as v
    from target_serials ts
    left join (
      select bp.serial, c.qty_kg
      from fp_all bp
      join chiqim_pallet_consumption c on c.barcode2 = bp.barcode2
      join chiqim_lines cl on cl.id = c.chiqim_line_id
      join chiqim_requests cr on cr.id = cl.request_id
      where chiqim_departed_at(cr.id) is not null
    ) d on d.serial = ts.serial
    group by ts.serial
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
  )
  select
    ts.serial,
    eq.v as state_qabul_qilingan,
    greatest(0, eq.v - sent.v - rezka_sent.v - raw_disp.v) as state_omborda_qoldi,
    sent.v as state_moykaga_yuborilgan,
    coalesce(mpc.v, 0) as state_moykada,
    moyka_out.v as state_moykadan_chiqgan,
    raw_disp.v as state_xom_jonatilgan,
    departed.v as state_olib_ketilgan,
    moyka_asof_calc.v as moyka_asof,
    moyka_range_calc.to_moyka_kg as moyka_range_to_moyka_kg,
    moyka_range_calc.from_moyka_kg as moyka_range_from_moyka_kg,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '01' and received_date between p_from and p_to), 0) as calibre_output_k1,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '02' and received_date between p_from and p_to), 0) as calibre_output_k2,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '03' and received_date between p_from and p_to), 0) as calibre_output_k3,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '04' and received_date between p_from and p_to), 0) as calibre_output_k4,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '05' and received_date between p_from and p_to), 0) as calibre_output_k5,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '06' and received_date between p_from and p_to), 0) as calibre_output_k6,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '07' and received_date between p_from and p_to), 0) as calibre_output_k7,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = '08' and received_date between p_from and p_to), 0) as calibre_output_k8,
    coalesce((select sum(weight_kg) from fp_all where fp_all.serial = ts.serial and code = 'KN' and received_date between p_from and p_to), 0) as calibre_output_kn,
    loss_range_calc.v as loss_range
  from target_serials ts
  join eq on eq.serial = ts.serial
  join sent on sent.serial = ts.serial
  join rezka_sent on rezka_sent.serial = ts.serial
  join raw_disp on raw_disp.serial = ts.serial
  join moyka_out on moyka_out.serial = ts.serial
  left join moykada_per_cycle mpc on mpc.serial = ts.serial
  join departed on departed.serial = ts.serial
  join moyka_asof_calc on moyka_asof_calc.serial = ts.serial
  join moyka_range_calc on moyka_range_calc.serial = ts.serial
  join loss_range_calc on loss_range_calc.serial = ts.serial;
$function$;

-- ============================================================
-- 2. report_totals (multi-direction overload) — one set-based call
--    instead of one LATERAL call per distinct serial
-- ============================================================
--
-- 🚩 kirim_line_report_bundle (thin wrapper) and report_query_page's own
-- swap to kirim_line_report_bundle_set were APPLIED, MEASURED, and then
-- REVERTED — not shipped. Applying live and re-verifying end-to-end
-- (CLAUDE.md workflow rule) surfaced a severe query-planner pathology
-- specific to report_query_page: EXPLAIN ANALYZE showed 8.9-16s wall time
-- (Planning Time alone 1.4-8.3s) vs. ~150-300ms on the ORIGINAL per-serial
-- LATERAL shape, benchmarked under identical fresh-connection conditions.
-- Isolated three ways: kirim_line_report_bundle_set alone is fast (80ms);
-- fed via array_agg(f.serial) into report_query_page's existing dispatch
-- LATERAL is slow; fed via the thin wrapper, called per-serial through the
-- SAME LATERAL shape report_query_page already used, is ALSO slow (8.9s).
-- report_totals has no LATERAL to chiqim_dispatch_calibre_breakdown and
-- measured fast (217ms) with zero regression -- narrowing the trigger to
-- kirim_line_report_bundle_set's own complexity (15 CTEs) combined with a
-- SECOND LATERAL in the same query, not either piece alone. Root cause
-- (why the planner blows up specifically there) was NOT chased further --
-- flagged rather than guessed at further on a live financial-reporting
-- path, per this project's scope-discipline rule. kirim_line_report_bundle
-- and report_query_page are therefore UNCHANGED from their pre-existing
-- (pre-Phase-2) definitions -- not reproduced in this file; see git history
-- / the live schema for their current bodies. Only the two pieces below
-- (kirim_line_report_bundle_set, report_totals) are shipped. See the
-- DECISIONS.md entry for this step for the full write-up.
-- ============================================================
create or replace function report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text,
  p_status text, p_partiya_no integer default null
)
returns table(
  total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric,
  total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric,
  total_kg_from_moyka numeric, state_serial_count bigint, state_qabul_qilingan numeric,
  state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric,
  state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric,
  state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
)
language sql
stable
as $function$
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
      coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn', 'chiqim_dispatch') then qty_kg else 0 end), 0) as total_kg_out,
      coalesce(sum(case when kind = 'kirim' then box_mass_kg else 0 end), 0) as total_kg_tara_in,
      coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0) as total_kg_tara_out,
      coalesce(sum(declared_qty), 0) as total_declared,
      coalesce(sum(case when kind = 'kirim' then least(qty_kg, declared_qty) else 0 end), 0) as total_hisobiy,
      coalesce(sum(case when kind = 'moyka_send' then qty_kg else 0 end), 0) as total_kg_to_moyka,
      coalesce(sum(case when kind = 'moyka_output' then qty_kg else 0 end), 0) as total_kg_from_moyka
    from filtered
  ),
  distinct_serials as (
    select distinct serial from filtered where serial is not null
  ),
  bundled as (
    select b.*
    from kirim_line_report_bundle_set((select array_agg(serial) from distinct_serials), p_from, p_to) b
  ),
  agg as (
    select
      count(*) as state_serial_count,
      coalesce(sum(state_qabul_qilingan), 0) as state_qabul_qilingan,
      coalesce(sum(state_omborda_qoldi), 0) as state_omborda_qoldi,
      coalesce(sum(state_xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(state_olib_ketilgan), 0) as state_olib_ketilgan,
      coalesce(sum(state_moykaga_yuborilgan), 0) as state_moykaga_yuborilgan_lifetime,
      coalesce(sum(state_moykadan_chiqgan), 0) as state_moykadan_chiqgan_lifetime,
      coalesce(sum(moyka_asof), 0) as state_moykada,
      coalesce(sum(moyka_range_to_moyka_kg), 0) as state_moykaga_yuborilgan,
      coalesce(sum(moyka_range_from_moyka_kg), 0) as state_moykadan_chiqgan,
      coalesce(sum(calibre_output_k1), 0) as state_k1,
      coalesce(sum(calibre_output_k2), 0) as state_k2,
      coalesce(sum(calibre_output_k3), 0) as state_k3,
      coalesce(sum(calibre_output_k4), 0) as state_k4,
      coalesce(sum(calibre_output_k5), 0) as state_k5,
      coalesce(sum(calibre_output_k6), 0) as state_k6,
      coalesce(sum(calibre_output_k7), 0) as state_k7,
      coalesce(sum(calibre_output_k8), 0) as state_k8,
      coalesce(sum(calibre_output_kn), 0) as state_kn,
      coalesce(sum(loss_range), 0) as state_yoqotish
    from bundled
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    agg.state_serial_count, agg.state_qabul_qilingan, agg.state_omborda_qoldi,
    agg.state_moykaga_yuborilgan, agg.state_moykada, agg.state_moykadan_chiqgan,
    agg.state_xom_jonatilgan, agg.state_olib_ketilgan,
    agg.state_k1, agg.state_k2, agg.state_k3, agg.state_k4,
    agg.state_k5, agg.state_k6, agg.state_k7, agg.state_k8,
    agg.state_kn,
    agg.state_yoqotish,
    agg.state_moykaga_yuborilgan_lifetime, agg.state_moykadan_chiqgan_lifetime
  from movement, agg;
$function$;
