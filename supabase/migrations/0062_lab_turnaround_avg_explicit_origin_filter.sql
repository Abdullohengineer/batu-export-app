-- lab_turnaround_avg excluded opening stock only because opening stock's
-- fabricated wash rows have no moyka_sends counterpart, so the turnaround
-- subtraction silently evaluated to NULL and avg() dropped it -- an
-- accident of the current data, not a filter. Made explicit per the new
-- CLAUDE.md origin-filtering rule ("Processing aggregates -> origin !=
-- 'opening_stock'"), and ahead of Rezka, which will mint serials with real
-- moyka_sends rows and could make the emergent exclusion stop working.
-- No-op on current data: 0 opening_stock wash cycles have any moyka_sends
-- row today.

create or replace function public.lab_turnaround_avg()
 returns numeric
 language sql
 stable
as $function$
  select avg(lr.sample_date - ms_first.sent_date)
  from lab_results lr
  join wash_cycles wc on wc.id = lr.wash_cycle_id
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select min(ms2.sent_date) as sent_date from moyka_sends ms2 where ms2.serial = wc.serial
  ) ms_first on true
  where lr.scope = 'chiqim'
    and ko.plate not like 'TEST-%'
    and ko.origin != 'opening_stock';
$function$;
