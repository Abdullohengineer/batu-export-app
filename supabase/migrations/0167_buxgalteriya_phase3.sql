-- Buxgalteriya Phase 3 (2026-11-22, docs/decisions/0251): upcoming
-- obligations auto-post, month-closing gate, audit read for the finance roles.

-- ------------------------------------------------------------------ 1. obligations → pending expense on the due date
-- Mockup (Kutilayotgan): "Muddat kelganda tizim avtomatik Xarajat bo'limiga
-- yoziladi (sizdan tasdiq so'raydi)". Same shape as recurring auto-posts:
-- one pending expense per obligation, never twice (a voided one is not
-- re-posted), never into a closed period. No source account on the
-- obligation → the bank account.
create or replace function public.post_due_obligations(
  p_today date default (now() at time zone 'Asia/Tashkent')::date
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  insert into public.expenses (
    amount, payment_date, period_month, category_id, counterparty_id, source_account_id,
    expense_type, note, upcoming_obligation_id, status, created_by
  )
  select
    o.estimated_amount,
    o.due_date,
    o.period_month,
    o.category_id,
    null,
    coalesce(o.source_account_id, (select a.id from public.accounts a where a.kind = 'bank' and a.is_active order by a.created_at limit 1)),
    case when o.recurrence = 'one_off' then 'one_off' else 'recurring_required' end,
    o.name,
    o.id,
    'pending',
    null
  from public.upcoming_obligations o
  where o.status = 'pending'
    and o.due_date <= p_today
    and not public.period_is_closed(o.period_month)
    and not exists (select 1 from public.expenses e where e.upcoming_obligation_id = o.id);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.post_due_obligations(date) from public, anon, authenticated;

-- One daily entry point for the scheduler.
create or replace function public.buxgalteriya_daily() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.post_due_recurring_expenses();
  perform public.post_due_obligations();
end $$;
revoke all on function public.buxgalteriya_daily() from public, anon, authenticated;

select cron.schedule(
  'buxgalteriya-recurring-autopost',
  '5 0 * * *',
  $cron$select public.buxgalteriya_daily()$cron$
);

-- ------------------------------------------------------------------ 2. obligation lifecycle
-- Confirming an obligation's auto-posted expense marks it paid; voiding that
-- expense marks it skipped (the job never re-posts it). Either way a
-- monthly/quarterly/yearly obligation rolls forward to its next occurrence,
-- as does one the accountant skips from Kutilayotgan before it posts.
create or replace function public.on_obligation_expense_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.upcoming_obligation_id is null then
    return new;
  end if;
  if new.voided_at is not null and old.voided_at is null then
    update public.upcoming_obligations set status = 'skipped'
      where id = new.upcoming_obligation_id and status = 'pending';
  elsif old.status = 'pending' and new.status = 'confirmed' and new.voided_at is null then
    update public.upcoming_obligations set status = 'paid'
      where id = new.upcoming_obligation_id and status = 'pending';
  end if;
  return new;
end $$;

create trigger expenses_obligation_change after update of status, voided_at on public.expenses
  for each row execute function public.on_obligation_expense_change();

create or replace function public.roll_obligation_forward() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_step interval;
begin
  if old.status <> 'pending' or new.status = 'pending' or new.recurrence = 'one_off' then
    return new;
  end if;
  v_step := case new.recurrence when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end;
  insert into public.upcoming_obligations (
    name, category_id, estimated_amount, due_date, period_month, source_account_id,
    recurrence, reminder_days_before, note, status, created_by
  ) values (
    new.name, new.category_id, new.estimated_amount, (new.due_date + v_step)::date, (new.period_month + v_step)::date,
    new.source_account_id, new.recurrence, new.reminder_days_before, new.note, 'pending', new.created_by
  );
  return new;
end $$;

create trigger upcoming_obligations_roll_forward after update of status on public.upcoming_obligations
  for each row execute function public.roll_obligation_forward();

-- ------------------------------------------------------------------ 3. month-closing checklist (single source of truth)
-- Brief invariant 3, minus Rezka (cut by the owner 2026-11-22). Every code is
-- always returned (n = 0 means the check passes) so the UI can show ✓ rows.
--   recurring_missing  active schedules due in the month with no entry at all
--                      (a voided auto-post counts as a deliberate skip)
--   pending            auto-posts not yet confirmed
--   cash_in_missing    no Global Export cash-in for the month
--   uncategorized      confirmed expenses with no category
--   obligations_open   obligations for the month still pending -- shown, NOT blocking
create or replace function public.period_close_blockers(p_month date)
returns table (code text, blocking boolean, n integer, detail jsonb)
language sql stable set search_path = public as $$
  with m as (
    select date_trunc('month', p_month)::date as month,
           extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::int as last_day
  ),
  due as (
    select r.id, r.monthly_amount, r.counterparty_id,
           (m.month + (least(r.day_of_month, m.last_day) - 1))::date as due_date
    from public.recurring_expenses r, m
    where r.is_active
  ),
  missing as (
    select d.*, c.name as counterparty
    from due d
    join public.counterparties c on c.id = d.counterparty_id
    join public.recurring_expenses r on r.id = d.id, m
    where d.due_date >= (r.created_at at time zone 'Asia/Tashkent')::date
      and not exists (select 1 from public.expenses e where e.recurring_expense_id = d.id and e.period_month = m.month)
  )
  select 'recurring_missing', true, count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('name', counterparty, 'amount', monthly_amount, 'due', due_date) order by due_date), '[]')
  from missing
  union all
  select 'pending', true, count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'note', e.note, 'amount', e.amount, 'date', e.payment_date) order by e.payment_date), '[]')
  from public.expenses e, m
  where e.period_month = m.month and e.status = 'pending' and e.voided_at is null
  union all
  select 'cash_in_missing', true,
         case when exists (select 1 from public.cash_ins ci, m where ci.period_month = m.month and ci.voided_at is null) then 0 else 1 end,
         coalesce((select jsonb_agg(jsonb_build_object('amount', ci.amount, 'date', ci.received_date) order by ci.received_date)
                   from public.cash_ins ci, m where ci.period_month = m.month and ci.voided_at is null), '[]')
  union all
  select 'uncategorized', true, count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'amount', e.amount, 'date', e.payment_date) order by e.payment_date), '[]')
  from public.expenses e, m
  where e.period_month = m.month and e.status = 'confirmed' and e.voided_at is null and e.category_id is null
  union all
  select 'obligations_open', false, count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'amount', o.estimated_amount, 'due', o.due_date) order by o.due_date), '[]')
  from public.upcoming_obligations o, m
  where o.period_month = m.month and o.status = 'pending'
$$;
grant execute on function public.period_close_blockers(date) to authenticated;

-- The database refuses a close the checklist doesn't allow, a close of the
-- current/future month, and close/reopen out of sequence.
create or replace function public.enforce_period_close_rules() returns trigger
language plpgsql set search_path = public as $$
declare
  v_current date := date_trunc('month', (now() at time zone 'Asia/Tashkent'))::date;
  v_blockers text;
begin
  if new.action = 'close' then
    if new.period_month >= v_current then
      raise exception 'Joriy yoki kelgusi oyni yopib bo''lmaydi' using errcode = '23514';
    end if;
    if public.period_is_closed(new.period_month) then
      raise exception 'Bu oy allaqachon yopilgan' using errcode = '23514';
    end if;
    select string_agg(b.code || '=' || b.n, ', ') into v_blockers
    from public.period_close_blockers(new.period_month) b where b.blocking and b.n > 0;
    if v_blockers is not null then
      raise exception 'Oyni yopib bo''lmaydi — hal qilinmagan masalalar: %', v_blockers using errcode = '23514';
    end if;
  else
    if not public.period_is_closed(new.period_month) then
      raise exception 'Faqat yopilgan oyni qayta ochish mumkin' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger period_close_rules before insert on public.period_close_events
  for each row execute function public.enforce_period_close_rules();

-- ------------------------------------------------------------------ 4. audit trail readable by the finance roles
-- audit_log_read is Rahbar-only; the accountant and Menejer need the
-- finance tables' trail for the "Davr tarixi" view. Other tables stay Rahbar-only.
create policy finance_audit_read on public.audit_log for select
  using (
    (select public.is_finance_reader())
    and table_name in ('expenses', 'cash_ins', 'transfers', 'recurring_expenses', 'upcoming_obligations',
                       'accounts', 'expense_categories', 'counterparties')
  );
