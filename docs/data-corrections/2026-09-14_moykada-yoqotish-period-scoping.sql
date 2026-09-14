-- Applied 2026-09-14 against project qohoqbapevrcjqxbstxi.
-- Schema-level fix, not a data correction — archived here anyway per this
-- session's established convention of archiving every applied SQL change.
--
-- See docs/decisions/0186-2026-09-14-moykada-yoqotish-period-scoping.md for
-- the full investigation, the live-caught counterexample this design
-- avoids, and the before/after for all 5 known cross-month serials.
--
-- Bug: Moykada (as-of-now, kirim_line_state) and Yo'qotish (lifetime,
-- client_serial_loss_kg) disagreed on scope. A closed serial showed 0 in
-- Moykada (correct) but its full realized loss in EVERY period it had any
-- row in (wrong — should show only in the period it actually closed).
-- Reported case: 110826-002 (closes 2026-09-04) showed "+55" loss in BOTH
-- August (still open, 15 kg genuinely in the wash) and September (closed).
--
-- Fix: both columns become genuinely period-relative instead of one
-- staying lifetime.
--   - kirim_line_moyka_asof(p_serial, p_to): in-moyka balance as of p_to
--     (sends<=p_to minus non-void non-mint output<=p_to), but 0 if the
--     cycle closed on or before p_to — mirrors kirim_line_state's own
--     closed-cycle override exactly. This override is NOT optional: an
--     earlier draft of this fix omitted it and produced a real invariant
--     violation, live-caught on serial 190826-001 (closed same day as this
--     fix was written) — September showed Moykada=425 AND Yo'qotish=425
--     simultaneously, because a closed cycle's raw sends-output gap IS its
--     loss/surplus, not a leftover balance.
--   - kirim_line_loss_range(p_serial, p_from, p_to): client_serial_loss_kg
--     value, but only when wash_cycles.closed_at falls within
--     [p_from,p_to] — null ("blank," not zero) otherwise. Reuses
--     get_client_report's own loss_totals attribution shape (gate on
--     closed_at, then read the realized figure) rather than inventing a
--     new one, per instruction.
--
-- report_query_page/report_totals' RETURN TABLE shape is UNCHANGED (no new
-- columns — state_moykada/state_yoqotish already existed) so this is
-- CREATE OR REPLACE, no DROP FUNCTION needed.
--
-- Verified live (not just dry-run) after applying:
--   - report_query_page, 110826-002, MOYKADAN direction: August
--     state_moykada=15, state_yoqotish=null; September state_moykada=0,
--     state_yoqotish=-55 (renders "+55 kg", a surplus, per formatLoss.ts's
--     sign convention) — matches the operator's expected table exactly.
--   - Full-dataset invariant check (all serials with a wash cycle, every
--     month Jan 2025-Sep 2026): 0 rows show both a nonzero Moykada and a
--     non-blank Yo'qotish.
--   - Yo'qotish additivity: August closings (1,452) + September closings
--     (3,766) = 5,218 = the combined Aug-Sep range total, exactly.
--   - The pre-existing Moyka-internal identity gap (Moykaga yuborilgan =
--     Moykadan chiqgan + Moykada + Yo'qotish), reproduced on the EXACT
--     scope report_filtered_rows(null,'2026-01-01','2026-12-31',...) uses:
--     old formula diff = -17,830; new formula, same scope, diff = -17,830.
--     Identical to the kg — this fix leaves that gap untouched, does not
--     close or change it.
--   - Qabul qilingan identity (unaffected by this change, contains no
--     Moykada term and none of its own 3 terms changed): unchanged.

create or replace function public.kirim_line_moyka_asof(p_serial text, p_to date)
returns numeric
language sql
stable
as $function$
  select case
    when exists (
      select 1 from wash_cycles wc
      where wc.serial = p_serial and wc.closed_at is not null
        and (wc.closed_at at time zone 'utc')::date <= p_to
    ) then 0
    else greatest(0,
      coalesce((select sum(ms.qty_kg) from moyka_sends ms
                  where ms.serial = p_serial and ms.sent_date <= p_to), 0)
      - coalesce((select sum(r.qty_kg) from report_moyka_output_rows r
                  where r.serial = p_serial
                    and r.date_basis <= p_to
                    and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
                    and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
               ), 0)
    )
  end;
$function$;

create or replace function public.kirim_line_loss_range(p_serial text, p_from date, p_to date)
returns numeric
language sql
stable
as $function$
  select case
    when exists (
      select 1 from wash_cycles wc
      where wc.serial = p_serial and wc.closed_at is not null
        and (wc.closed_at at time zone 'utc')::date between p_from and p_to
    ) then client_serial_loss_kg(p_serial)
    else null
  end;
$function$;

create or replace function public.report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_partiya_no integer DEFAULT NULL::integer
)
returns table(
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid,
  calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean,
  declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean,
  wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric,
  moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, partiya_no integer,
  state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric,
  state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric,
  state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
)
language sql
stable
as $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, mr.to_moyka_kg, mk.moykada_asof,
         mr.from_moyka_kg, s.xom_jonatilgan, s.olib_ketilgan,
         cor.k1, cor.k2, cor.k3, cor.k4, cor.k5, cor.k6, cor.k7, cor.k8, cor.kn,
         kirim_line_loss_range(f.serial, p_from, p_to),
         s.moykaga_yuborilgan, s.moykadan_chiqgan
  from (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral kirim_line_calibre_output_range(f.serial, p_from, p_to) cor on f.serial is not null
  left join lateral kirim_line_moyka_range(f.serial, p_from, p_to) mr on f.serial is not null
  left join lateral (select kirim_line_moyka_asof(f.serial, p_to) as moykada_asof) mk on f.serial is not null;
$function$;

create or replace function public.report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_partiya_no integer DEFAULT NULL::integer
)
returns table(
  total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric,
  total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric, total_kg_from_moyka numeric,
  state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric,
  state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric,
  state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
)
language sql
stable
as $function$
  with filtered as materialized (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
  ),
  movement as (
    select
      count(*) as total_count,
      coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn') then qty_kg else 0 end), 0) as total_kg_out,
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
  state as (
    select
      count(*) as state_serial_count,
      coalesce(sum(s.qabul_qilingan), 0) as state_qabul_qilingan,
      coalesce(sum(s.omborda_qoldi), 0) as state_omborda_qoldi,
      coalesce(sum(s.xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(s.olib_ketilgan), 0) as state_olib_ketilgan,
      coalesce(sum(s.moykaga_yuborilgan), 0) as state_moykaga_yuborilgan_lifetime,
      coalesce(sum(s.moykadan_chiqgan), 0) as state_moykadan_chiqgan_lifetime
    from distinct_serials ds
    cross join lateral kirim_line_state(ds.serial) s
  ),
  moykada_asof as (
    select coalesce(sum(kirim_line_moyka_asof(ds.serial, p_to)), 0) as state_moykada
    from distinct_serials ds
  ),
  moyka_range as (
    select
      coalesce(sum(mr.to_moyka_kg), 0) as state_moykaga_yuborilgan,
      coalesce(sum(mr.from_moyka_kg), 0) as state_moykadan_chiqgan
    from distinct_serials ds
    cross join lateral kirim_line_moyka_range(ds.serial, p_from, p_to) mr
  ),
  calibre_output as (
    select
      coalesce(sum(co.k1), 0) as state_k1, coalesce(sum(co.k2), 0) as state_k2, coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4, coalesce(sum(co.k5), 0) as state_k5, coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7, coalesce(sum(co.k8), 0) as state_k8, coalesce(sum(co.kn), 0) as state_kn
    from distinct_serials ds
    cross join lateral kirim_line_calibre_output_range(ds.serial, p_from, p_to) co
  ),
  realized_loss as (
    select coalesce(sum(kirim_line_loss_range(ds.serial, p_from, p_to)), 0) as state_yoqotish
    from distinct_serials ds
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    state.state_serial_count, state.state_qabul_qilingan, state.state_omborda_qoldi,
    moyka_range.state_moykaga_yuborilgan, moykada_asof.state_moykada, moyka_range.state_moykadan_chiqgan,
    state.state_xom_jonatilgan, state.state_olib_ketilgan,
    calibre_output.state_k1, calibre_output.state_k2, calibre_output.state_k3, calibre_output.state_k4,
    calibre_output.state_k5, calibre_output.state_k6, calibre_output.state_k7, calibre_output.state_k8,
    calibre_output.state_kn,
    realized_loss.state_yoqotish,
    state.state_moykaga_yuborilgan_lifetime, state.state_moykadan_chiqgan_lifetime
  from movement, state, moykada_asof, moyka_range, calibre_output, realized_loss;
$function$;
