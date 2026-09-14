-- Applied 2026-09-15 against project qohoqbapevrcjqxbstxi.
-- Schema-level change (2 new functions, 1 body-only CREATE OR REPLACE, 1
-- DROP+CREATE for a return-shape change) -- archived per this session's
-- established convention of archiving every applied SQL change.
--
-- See docs/decisions/0189-2026-09-15-chiqim-dispatch-full-detail-and-
-- kalibr-breakdown.md for the full investigation, the regression this
-- fixes, and the before/after verification.
--
-- Fixes Regression 1 from that investigation (full request detail --
-- photos, actor timestamps -- unreachable for any CHIQIM dispatch that
-- isn't carrying old-KN cargo, the common case): the fix itself is app-
-- layer only (ChiqimDispatchRowDetail.tsx's button un-gated), no SQL
-- change needed for that half.
--
-- Adds Requirement 3 (per-kalibr breakdown on rolled-up dispatch lines):
-- new dispatch_k1..dispatch_kn columns on report_query_page, sourced from
-- a new chiqim_dispatch_calibre_breakdown() lateral, mirroring
-- kirim_line_calibre_output_range's existing pattern but keyed by
-- request_id instead of serial. Blank (null), not zero, when a dispatch
-- carried none of a given kalibr -- computed via nullif at the SQL layer
-- so both the table and the Excel export agree without either
-- reimplementing the distinction.
--
-- Along the way: report_dispatch_rows_v2's is_match predicate (introduced
-- in migration 2026-09-14_chiqim-regrain-departure-date-dispatch-
-- rollup.sql) would otherwise have needed a byte-for-byte duplicate inside
-- chiqim_dispatch_calibre_breakdown -- two copies that must stay in sync
-- is exactly the kind of drift risk a comment doesn't prevent. Factored
-- into a new shared function, chiqim_component_is_match(), called by both.
-- report_dispatch_rows_v2's own body changed (CREATE OR REPLACE, same
-- signature) to call it instead of inlining the predicate; behavior
-- verified unchanged (see decision doc).

-- ============================================================
-- Shared predicate -- one definition, used by report_dispatch_rows_v2 (the
-- rollup's own row-inclusion test) and chiqim_dispatch_calibre_breakdown
-- (the new per-kalibr columns), so the two can never drift apart.
-- ============================================================

create or replace function chiqim_component_is_match(
  comp_kind text, comp_calibre_id uuid, comp_barcode2 text, comp_wash_cycle integer, comp_lab_verdict text,
  comp_pallet_status text, comp_serial text, comp_type_id uuid, comp_partiya_no integer,
  p_kinds text[], p_calibre_id uuid, p_barcode2 text, p_wash_cycle text, p_lab_verdict text,
  p_status text, p_serial text, p_type_id uuid, p_partiya_no integer
) returns boolean
language sql immutable as $$
  select (p_kinds is null or comp_kind = any(p_kinds))
    and (p_calibre_id is null or comp_calibre_id = p_calibre_id)
    and (p_barcode2 is null or p_barcode2 = '' or comp_barcode2 ilike '%' || p_barcode2 || '%')
    and (p_wash_cycle is null or p_wash_cycle = '' or (p_wash_cycle = '1' and comp_wash_cycle = 1) or (p_wash_cycle = '2+' and comp_wash_cycle >= 2))
    and (p_lab_verdict is null or p_lab_verdict = '' or (p_lab_verdict = 'tekshirilmagan' and comp_lab_verdict is null) or comp_lab_verdict = p_lab_verdict)
    and (p_status is null or p_status = '' or comp_pallet_status = p_status)
    and (p_serial is null or p_serial = '' or comp_serial ilike '%' || p_serial || '%')
    and (p_type_id is null or comp_type_id = p_type_id)
    and (p_partiya_no is null or comp_partiya_no = p_partiya_no)
$$;

-- ============================================================
-- report_dispatch_rows_v2: body-only change, same 14-arg signature/return
-- shape -- now calls chiqim_component_is_match instead of inlining the
-- predicate.
-- ============================================================

CREATE OR REPLACE FUNCTION public.report_dispatch_rows_v2(p_kinds text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer)
 RETURNS SETOF report_rows_v2
 LANGUAGE sql
 STABLE
AS $function$
  with components as (
    select 'chiqim'::text as comp_kind, request_id, owner_id, type_id, calibre_id, serial, barcode2, wash_cycle, lab_verdict, pallet_status, partiya_no, qty_kg
    from report_chiqim_rows_v2
    where date_basis between p_from and p_to
    union all
    select 'chiqim_raw', request_id, owner_id, type_id, null::uuid, serial, null::text, null::integer, null::text, 'jonatilgan'::text, partiya_no, qty_kg
    from report_raw_dispatch_rows_v2
    where date_basis between p_from and p_to
    union all
    select 'chiqim_old_kn', request_id, owner_id, type_id, null::uuid, null::text, null::text, null::integer, null::text, 'jonatilgan'::text, partiya_no, qty_kg
    from report_old_kn_rows_v2
    where date_basis between p_from and p_to
  ),
  matched as (
    select *,
      chiqim_component_is_match(
        comp_kind, calibre_id, barcode2, wash_cycle, lab_verdict, pallet_status, serial, type_id, partiya_no,
        p_kinds, p_calibre_id, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_serial, p_type_id, p_partiya_no
      ) as is_match
    from components
  )
  select
    'chiqim_dispatch'::text as kind,
    'dispatch-' || cr.id::text as row_key,
    null::text as serial,
    null::text as barcode2,
    null::uuid as order_id,
    cr.id as request_id,
    cr.owner_id,
    null::uuid as type_id,
    null::uuid as calibre_id,
    coalesce(cr.plate, '') as plate,
    coalesce(cr.driver, '') as driver,
    (chiqim_departed_at(cr.id) at time zone 'utc')::date as date_basis,
    null::text as date_basis_source,
    coalesce(sum(m.qty_kg) filter (where m.is_match), 0) as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
    null::text as pallet_status,
    null::text as lab_verdict,
    null::numeric as target_moisture_pct,
    null::numeric as target_so2_mg_kg,
    null::numeric as moisture_pct,
    null::numeric as so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    null::integer as partiya_no
  from chiqim_requests cr
  join matched m on m.request_id = cr.id
  where chiqim_departed_at(cr.id) is not null
    and (chiqim_departed_at(cr.id) at time zone 'utc')::date between p_from and p_to
    and (p_owner_id is null or cr.owner_id = p_owner_id)
    and (p_plate is null or p_plate = '' or cr.plate ilike '%' || p_plate || '%')
    and (p_driver is null or p_driver = '' or cr.driver ilike '%' || p_driver || '%')
    and coalesce(cr.plate, '') not like 'TEST-%'
  group by cr.id, cr.owner_id, cr.plate, cr.driver
  having bool_or(m.is_match);
$function$;

-- ============================================================
-- New: chiqim_dispatch_calibre_breakdown -- per-request kalibr breakdown,
-- mirrors kirim_line_calibre_output_range's shape/nullif pattern, keyed by
-- request_id instead of serial. Only the pallet ('chiqim') component kind
-- can carry a calibre -- raw/old-KN correctly contribute nothing.
-- ============================================================

create or replace function chiqim_dispatch_calibre_breakdown(
  p_request_id uuid, p_directions text[], p_from date, p_to date, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer
) returns table(k1 numeric, k2 numeric, k3 numeric, k4 numeric, k5 numeric, k6 numeric, k7 numeric, k8 numeric, kn numeric)
language sql stable as $$
  with matched as (
    select r.qty_kg, cal.code as calibre_code,
      chiqim_component_is_match(
        'chiqim'::text, r.calibre_id, r.barcode2, r.wash_cycle, r.lab_verdict, r.pallet_status, r.serial, r.type_id, r.partiya_no,
        p_directions, p_calibre_id, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_serial, p_type_id, p_partiya_no
      ) as is_match
    from report_chiqim_rows_v2 r
    left join calibres cal on cal.id = r.calibre_id
    where r.request_id = p_request_id and r.date_basis between p_from and p_to
  )
  select
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '01'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '02'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '03'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '04'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '05'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '06'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '07'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = '08'), 0), 0),
    nullif(coalesce(sum(qty_kg) filter (where is_match and calibre_code = 'KN'), 0), 0)
  from matched;
$$;

-- ============================================================
-- report_query_page: DROP + CREATE (return shape changes, 9 new trailing
-- columns) -- new lateral join to chiqim_dispatch_calibre_breakdown,
-- gated to chiqim_dispatch rows only.
-- ============================================================

drop function if exists report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.report_query_page(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_partiya_no integer DEFAULT NULL::integer)
 RETURNS TABLE(kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric, dispatch_k1 numeric, dispatch_k2 numeric, dispatch_k3 numeric, dispatch_k4 numeric, dispatch_k5 numeric, dispatch_k6 numeric, dispatch_k7 numeric, dispatch_k8 numeric, dispatch_kn numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, mr.to_moyka_kg, mk.moykada_asof,
         mr.from_moyka_kg, s.xom_jonatilgan, s.olib_ketilgan,
         cor.k1, cor.k2, cor.k3, cor.k4, cor.k5, cor.k6, cor.k7, cor.k8, cor.kn,
         kirim_line_loss_range(f.serial, p_from, p_to),
         s.moykaga_yuborilgan, s.moykadan_chiqgan,
         cdc.k1, cdc.k2, cdc.k3, cdc.k4, cdc.k5, cdc.k6, cdc.k7, cdc.k8, cdc.kn
  from (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral kirim_line_calibre_output_range(f.serial, p_from, p_to) cor on f.serial is not null
  left join lateral kirim_line_moyka_range(f.serial, p_from, p_to) mr on f.serial is not null
  left join lateral (select kirim_line_moyka_asof(f.serial, p_to) as moykada_asof) mk on f.serial is not null
  left join lateral chiqim_dispatch_calibre_breakdown(
    f.request_id, p_directions, p_from, p_to, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
  ) cdc on f.kind = 'chiqim_dispatch';
$function$;

-- ============================================================
-- Verified live after applying (see decision doc for full detail):
--   - Reconciliation unchanged after the predicate refactor: August
--     69,151 kg / Sep 1-12 exactly 28,970 kg across 2 lines / full year
--     98,121 kg -- identical to before this change.
--   - Empty-array p_kinds hardening (2026-09-14) still holds: 0 rows,
--     null-kinds still returns all 10.
--   - Kalibr breakdown sums to the pallet-only portion of each of the 10
--     live Aug-Sep dispatch lines, exactly, including the 5 lines with
--     zero pallet cargo (all 9 columns null, not 0).
--   - Blank-not-zero confirmed directly: a zero-pallet request (13,627 kg,
--     all raw) returns null for every dispatch_k* column; a mixed request
--     (545883f6) returns real values for K1/K2/K4 and null for K3/K5-K8/KN.
--   - Cross-consistency under an active filter: applying a K1-only
--     calibre_id filter to request 545883f6 narrows its row total from
--     20,330 to 2,550 AND dispatch_k1 to 2,550 (K2/K3/K4 correctly go
--     null) -- row total and kalibr breakdown narrow together, same
--     shared predicate, same match set.
--   - report_totals untouched, confirmed unaffected (no strip chip).
-- ============================================================
