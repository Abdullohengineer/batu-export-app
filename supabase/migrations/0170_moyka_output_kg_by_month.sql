-- 2026-11-25, docs/decisions/0255: "1 kg tannarxi" showed "—" because the
-- finance screens asked the full report engine (report_totals) for Moyka
-- output kg once per month -- ~7 heavy calls at once, which hit the
-- statement timeout (500s in the API log). This returns the SAME number
-- (sum of qty_kg over report_filtered_rows_v2 'moyka_output' rows, one
-- window per calendar month, exactly as report_totals.total_kg_from_moyka
-- computes it per month) without the per-serial bundles report_totals also
-- builds, for every month of a range in ONE call.
--
-- Per-month windows on purpose: the row source groups output per serial
-- within its window, so one wide window would lump a serial washed across
-- two months into one -- verified it gives different monthly numbers.
-- Origin handling is whatever report_filtered_rows_v2 already applies (the
-- same rows the Hisobot engine counts) -- nothing re-implemented here.
--
-- plpgsql + force_custom_plan: same reason as report_totals (PostgREST's
-- JSON args otherwise defeat constant folding -- 2026-11 timeout fix).
-- Not security definer: the caller's RLS applies, like report_totals.
create or replace function public.moyka_output_kg_by_month(
  p_owner_id uuid,
  p_from_month date,
  p_to_month date
) returns table (month date, kg numeric)
language plpgsql
stable
set plan_cache_mode = force_custom_plan
set search_path = public
as $$
begin
  if p_to_month < p_from_month or p_to_month > p_from_month + interval '36 months' then
    raise exception 'moyka_output_kg_by_month: bad range % .. %', p_from_month, p_to_month using errcode = '22023';
  end if;
  return query
  select m::date,
         coalesce((
           select sum(r.qty_kg)
           from public.report_filtered_rows_v2(
             array['moyka_output'], m::date, (m + interval '1 month - 1 day')::date, p_owner_id,
             null, null, null, null, null, null, null, null, null, null
           ) r
           where r.kind = 'moyka_output'
         ), 0)
  from generate_series(date_trunc('month', p_from_month), date_trunc('month', p_to_month), interval '1 month') m
  order by 1;
end
$$;
grant execute on function public.moyka_output_kg_by_month(uuid, date, date) to authenticated;
