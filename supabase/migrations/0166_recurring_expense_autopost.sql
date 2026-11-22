-- Buxgalteriya Phase 2 (2026-11-22, docs/decisions/0250): recurring expense
-- auto-post. A daily pg_cron job creates, for each active schedule whose day
-- has arrived this month, ONE expenses row with status = 'pending' (decided:
-- the accountant confirms -- and corrects the amount of -- every auto-post;
-- only confirmed rows count in balances/reports).
--
-- Rules:
--   - due date = day_of_month clamped to the month's length (31 → 30 in Nov);
--   - posted once the due date (Tashkent) has arrived;
--   - never for a due date before the schedule existed (a schedule created
--     on 22 Nov with day 1 starts on 1 Dec -- the mockup's "Keyingi to'lov");
--   - never twice for the same (schedule, month), and NOT re-created if the
--     accountant voided that month's auto-post (voiding = "skip this month");
--   - never into a closed period.
-- Idempotent: running it any number of times a day posts each entry once.

create or replace function public.post_due_recurring_expenses(
  p_today date default (now() at time zone 'Asia/Tashkent')::date
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_today)::date;
  v_last  int  := extract(day from (v_month + interval '1 month - 1 day'))::int;
  v_count int;
begin
  if public.period_is_closed(v_month) then
    return 0;
  end if;

  insert into public.expenses (
    amount, payment_date, period_month, category_id, counterparty_id, source_account_id,
    expense_type, note, recurring_expense_id, status, created_by
  )
  select
    r.monthly_amount,
    v_month + (least(r.day_of_month, v_last) - 1),
    v_month,
    r.category_id,
    r.counterparty_id,
    r.source_account_id,
    r.expense_type,
    'Avtomatik: doimiy xarajat',
    r.id,
    'pending',
    null
  from public.recurring_expenses r
  where r.is_active
    and v_month + (least(r.day_of_month, v_last) - 1) <= p_today
    and v_month + (least(r.day_of_month, v_last) - 1) >= (r.created_at at time zone 'Asia/Tashkent')::date
    and not exists (
      select 1 from public.expenses e
      where e.recurring_expense_id = r.id and e.period_month = v_month   -- voided ones count: no re-post
    )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Only the scheduler runs it.
revoke all on function public.post_due_recurring_expenses(date) from public, anon, authenticated;

create extension if not exists pg_cron;

-- 00:05 UTC = 05:05 Tashkent, daily. cron.schedule upserts by job name.
select cron.schedule(
  'buxgalteriya-recurring-autopost',
  '5 0 * * *',
  $cron$select public.post_due_recurring_expenses()$cron$
);
