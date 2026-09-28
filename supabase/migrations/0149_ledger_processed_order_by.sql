-- Post-Rezka cleanup (2026-09-28), follow-up to 0147: byCalibreType.processed
-- gets the same explicit order as byCalibreType.dispatched, so both lists in
-- rahbar_dashboard_ledger are plan-independent. Decision: docs/decisions/0227.
--
-- Same checked text edit as 0147's dispatched change: the live body must be
-- exactly the post-0147 body (md5 below) and the target line must occur
-- exactly once, or this aborts. Nothing else in the body changes.
do $ord$
declare
  v_src text;
  v_old constant text := $x$select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', output_kg)), '[]'::jsonb)$x$;
  v_new constant text := $x$select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', output_kg) order by type_id, calibre_id), '[]'::jsonb)$x$;
begin
  select prosrc into v_src from pg_proc
  where proname = 'rahbar_dashboard_ledger_rls' and pronamespace = 'public'::regnamespace;
  if md5(v_src) <> '678813ec186f77138f199ae1241e2ae2' then
    raise exception '0149: rahbar_dashboard_ledger_rls body is not the expected post-0147 body (md5 %)', md5(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception '0149: processed jsonb_agg line not found exactly once';
  end if;
  execute format(
    'create or replace function public.rahbar_dashboard_ledger_rls(p_from date, p_to date, p_scope text) returns jsonb language sql stable as %L',
    replace(v_src, v_old, v_new));
end;
$ord$;
