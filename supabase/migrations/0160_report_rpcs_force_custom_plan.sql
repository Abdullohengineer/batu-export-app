-- Incident fix (2026-10-17): Hisobot (rahbar) intermittently 500s with
-- "canceling statement due to statement timeout" (57014) on
-- report_query_page_rows / report_totals. See docs/decisions/0242.
--
-- ROOT CAUSE, measured live (same filters: kirim, Global Export, Natural,
-- 2026-09): report_totals took 358-367 ms when called with literal args
-- (as postgres or as a rahbar), but 0.8 s / 3.0 s / 14.6 s on three runs
-- when called the way PostgREST calls it -- as a rahbar, with args coming
-- out of json_to_record($1). Args that are not plan-time constants stop
-- the planner folding the `p_directions is null or ... && array[...]`
-- gates in report_filtered_rows_v2, so every branch (dispatch, moyka
-- output, rezka) is planned and run under RLS: a 1,854-node plan for a
-- 6-row result, 0.4-2.4 s of planning alone. On this burstable compute
-- that intermittently crosses the 12 s role statement_timeout.
--
-- FIX: the three report RPCs the app calls become thin plpgsql wrappers
-- (same names, same signatures, same defaults, same result shape, still
-- SECURITY INVOKER so RLS applies exactly as before) around the existing
-- SQL bodies, renamed to *_impl and otherwise untouched. A plpgsql
-- statement's params ARE known at plan time under force_custom_plan, so
-- the inner SQL function inlines and the gates fold, the same as the
-- literal-args case above. No formula changes.

alter function public.report_query_page_rows(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer)
  rename to report_query_page_rows_impl;

create function public.report_query_page_rows(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text,
  p_status text, p_limit integer, p_offset integer, p_partiya_no integer
)
returns setof report_rows_v2
language plpgsql
stable
set plan_cache_mode = force_custom_plan
as $$
begin
  return query
  select * from public.report_query_page_rows_impl(
    p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict,
    p_status, p_limit, p_offset, p_partiya_no
  );
end;
$$;

alter function public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer)
  rename to report_totals_impl;

create function public.report_totals(
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
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric,
  total_kg_to_rezka numeric, total_kg_from_rezka numeric, state_rezkaga_yuborilgan numeric,
  state_rezkada numeric
)
language plpgsql
stable
set plan_cache_mode = force_custom_plan
as $$
begin
  return query
  select * from public.report_totals_impl(
    p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict,
    p_status, p_partiya_no
  );
end;
$$;

-- Excel export path (useReportQuery.ts fetchAllReportRowsForExport) --
-- same PostgREST call shape, same fix.
alter function public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer)
  rename to report_query_page_impl;

do $do$
declare
  v_args text;
  v_result text;
begin
  -- Result is a 61-column TABLE(...); copy it verbatim from the renamed
  -- function rather than retyping it, so the wrapper cannot drift.
  select pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
    into v_args, v_result
  from pg_proc p
  where p.oid = 'public.report_query_page_impl(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer)'::regprocedure;

  execute format($f$
    create function public.report_query_page(%s)
    returns %s
    language plpgsql
    stable
    set plan_cache_mode = force_custom_plan
    as $body$
    begin
      return query
      select * from public.report_query_page_impl(
        p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
        p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict,
        p_status, p_limit, p_offset, p_partiya_no
      );
    end;
    $body$
  $f$, v_args, v_result);
end;
$do$;

-- Same grants the originals carried (PUBLIC/anon/authenticated/service_role).
grant execute on function public.report_query_page_rows(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
