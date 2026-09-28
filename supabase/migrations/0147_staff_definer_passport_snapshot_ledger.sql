-- Post-Rezka cleanup, item 1 (2026-09-28): get_serial_passport /
-- rahbar_stock_snapshot / rahbar_dashboard_ledger under RLS.
-- Decision: docs/decisions/0227-*.
--
-- Measured as authenticated Rahbar (EXPLAIN ANALYZE of each body inline,
-- warm second run, planning + execution):
--   get_serial_passport_core   5,140 + 5,687 ms  (postgres, no RLS: 44 + 18)
--   rahbar_stock_snapshot_core   181 +   232 ms  (postgres: 11 + 28)
--   rahbar_dashboard_ledger      243 +   186 ms  (postgres: 24 + 20)
-- The cost is RLS itself: every table reference expands both the read_all
-- and the client_read_own_* policy, and the client branches nest EXISTS
-- joins through kirim_lines/kirim_orders/finished_pallets (hundreds of
-- InitPlans per statement). The v1.58 (select my_role()) rewrite is already
-- schema-wide complete (0130-0133, advisor 0 findings), so it has nothing
-- left to give; this is the other option: SECURITY DEFINER behind an
-- explicit role check.
--
-- Pattern, identical for all three functions:
--   <fn>_rls    the current function, renamed, unchanged (invoker, RLS).
--   <fn>_staff  SECURITY DEFINER, runs <fn>_rls as its owner (RLS bypassed),
--               refuses unless the caller is authenticated and not a client.
--   <fn>        the public name, a router: authenticated non-client callers
--               go to <fn>_staff; everyone else (client, anon, service_role,
--               postgres) goes to <fn>_rls exactly as today.
--
-- Why this is result-identical for staff: every table these bodies, their
-- helper functions (chiqim_departed_at, chiqim_fura_photo_paths,
-- chiqim_request_loaded_kg, report_kirim_rows_as_of, rezka_serial_is_test,
-- rezka_serial_state_set) and every view read has a permissive SELECT
-- policy of either "auth.uid() is not null and my_role() <> 'client'" or
-- "auth.uid() is not null" -- a non-client authenticated user already sees
-- every row. The only tables outside that pattern (audit_log Rahbar-only,
-- serial_counter / partiya_counter no read policy) are not reached by any
-- of the three call graphs (checked by walking pg_proc text to depth 4 and
-- every view definition). The guard is the read_all predicate itself.
-- Client behaviour is untouched: the client portal's Панель is scoped
-- purely by RLS and keeps that path.

-- ------------------------------------------------------------------
-- 1. get_serial_passport
-- ------------------------------------------------------------------
alter function public.get_serial_passport(text) rename to get_serial_passport_rls;

create function public.get_serial_passport_staff(p_serial text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null or (select my_role()) is not distinct from 'client'::user_role then
    raise exception 'get_serial_passport_staff: staff only' using errcode = '42501';
  end if;
  return get_serial_passport_rls(p_serial);
end;
$$;

create function public.get_serial_passport(p_serial text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is not null and (select my_role()) is distinct from 'client'::user_role then
    return get_serial_passport_staff(p_serial);
  end if;
  return get_serial_passport_rls(p_serial);
end;
$$;

-- ------------------------------------------------------------------
-- 2. rahbar_stock_snapshot
-- ------------------------------------------------------------------
alter function public.rahbar_stock_snapshot(text) rename to rahbar_stock_snapshot_rls;

create function public.rahbar_stock_snapshot_staff(p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null or (select my_role()) is not distinct from 'client'::user_role then
    raise exception 'rahbar_stock_snapshot_staff: staff only' using errcode = '42501';
  end if;
  return rahbar_stock_snapshot_rls(p_scope);
end;
$$;

create function public.rahbar_stock_snapshot(p_scope text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is not null and (select my_role()) is distinct from 'client'::user_role then
    return rahbar_stock_snapshot_staff(p_scope);
  end if;
  return rahbar_stock_snapshot_rls(p_scope);
end;
$$;

-- ------------------------------------------------------------------
-- 3. rahbar_dashboard_ledger
-- ------------------------------------------------------------------
alter function public.rahbar_dashboard_ledger(date, date, text) rename to rahbar_dashboard_ledger_rls;

-- byCalibreType.dispatched was a jsonb_agg without ORDER BY, so its element
-- order followed the plan -- and bypassing RLS changes the plan (the 0147
-- dry run's one hash mismatch: same 11 elements, different order). Give it
-- an explicit order so the output is plan-independent. Done as a checked
-- text edit of the live body (the 0143 body, 19,098 chars), not a retype:
-- the body must be exactly the one measured (md5 below) and the target line
-- must occur exactly once, or the migration aborts. Nothing else changes.
do $ord$
declare
  v_src text;
  v_old constant text := $x$select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', kg)), '[]'::jsonb)$x$;
  v_new constant text := $x$select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', kg) order by type_id, calibre_id), '[]'::jsonb)$x$;
begin
  select prosrc into v_src from pg_proc
  where proname = 'rahbar_dashboard_ledger_rls' and pronamespace = 'public'::regnamespace;
  if md5(v_src) <> '178696381ebb22ab4801942952fc7bb0' then
    raise exception '0147: rahbar_dashboard_ledger body is not the expected 0143 body (md5 %)', md5(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception '0147: dispatched jsonb_agg line not found exactly once';
  end if;
  execute format(
    'create or replace function public.rahbar_dashboard_ledger_rls(p_from date, p_to date, p_scope text) returns jsonb language sql stable as %L',
    replace(v_src, v_old, v_new));
end;
$ord$;

create function public.rahbar_dashboard_ledger_staff(p_from date, p_to date, p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null or (select my_role()) is not distinct from 'client'::user_role then
    raise exception 'rahbar_dashboard_ledger_staff: staff only' using errcode = '42501';
  end if;
  return rahbar_dashboard_ledger_rls(p_from, p_to, p_scope);
end;
$$;

create function public.rahbar_dashboard_ledger(p_from date, p_to date, p_scope text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is not null and (select my_role()) is distinct from 'client'::user_role then
    return rahbar_dashboard_ledger_staff(p_from, p_to, p_scope);
  end if;
  return rahbar_dashboard_ledger_rls(p_from, p_to, p_scope);
end;
$$;

-- Same grants as before on every public name; the _staff twins are callable
-- (the router runs as the caller) but refuse non-staff themselves.
grant execute on function public.get_serial_passport(text) to anon, authenticated, service_role;
grant execute on function public.get_serial_passport_staff(text) to authenticated, service_role;
grant execute on function public.rahbar_stock_snapshot(text) to anon, authenticated, service_role;
grant execute on function public.rahbar_stock_snapshot_staff(text) to authenticated, service_role;
grant execute on function public.rahbar_dashboard_ledger(date, date, text) to anon, authenticated, service_role;
grant execute on function public.rahbar_dashboard_ledger_staff(date, date, text) to authenticated, service_role;
revoke execute on function public.get_serial_passport_staff(text) from public, anon;
revoke execute on function public.rahbar_stock_snapshot_staff(text) from public, anon;
revoke execute on function public.rahbar_dashboard_ledger_staff(date, date, text) from public, anon;
