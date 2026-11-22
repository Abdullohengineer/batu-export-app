-- Buxgalteriya Phase 1 (2026-11-22, docs/decisions/0249): accounting schema,
-- seed, RLS, receipt bucket.
--
-- House rules applied:
--   - Money is bigint so'm; rates are numeric(12,2) (they carry kopeks:
--     7,468.75).
--   - Never DELETE -- void (voided_at/voided_by/void_reason). No DELETE
--     policy on any table here.
--   - period_month (first of month) drives reports; the date columns drive
--     account balances only. Both are stored, separately, everywhere.
--   - A closed period freezes its expenses and cash_ins at the database
--     level (trigger), not just in the UI. Transfers have no period (they
--     never touch P&L) and are not frozen.
--   - Readers: buxgalter, rahbar, menejer. Writer: buxgalter only.
--     monthly_rates has NO write policy: rates are set by the owner via an
--     admin migration/SQL (decided 2026-11-22), so Rahbar stays read-only
--     (SPEC §2.12).
--   - No receivables table (non-goal): a cash-in simply credits a period.

-- ------------------------------------------------------------------ helpers
create or replace function public.is_finance_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select my_role()::text) in ('buxgalter', 'rahbar', 'menejer'), false)
$$;

create or replace function public.is_buxgalter() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select my_role()::text) = 'buxgalter', false)
$$;

-- ------------------------------------------------------------------ tables
create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  name_uz       text not null unique,
  kind          text not null check (kind in ('bank', 'kassa', 'utility')),
  supplier_name text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name_uz    text not null,
  name_ru    text,
  "group"    text check ("group" in ('variable', 'fixed', 'periodic', 'unexpected')),
  is_active  boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index expense_categories_name_uniq on public.expense_categories (lower(btrim(name_uz)));

create table public.counterparties (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null check (kind in ('receiver', 'customer')),
  owner_id   uuid references public.owners(id),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index counterparties_name_kind_uniq on public.counterparties (lower(btrim(name)), kind);

create table public.recurring_expenses (
  id                uuid primary key default gen_random_uuid(),
  counterparty_id   uuid not null references public.counterparties(id),
  category_id       uuid references public.expense_categories(id),
  source_account_id uuid not null references public.accounts(id),
  monthly_amount    bigint not null check (monthly_amount > 0),
  day_of_month      int not null check (day_of_month between 1 and 31),
  expense_type      text not null check (expense_type in ('recurring_required', 'recurring_optional')),
  note              text,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.upcoming_obligations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  category_id          uuid references public.expense_categories(id),
  estimated_amount     bigint not null check (estimated_amount > 0),
  due_date             date not null,
  period_month         date not null check (period_month = date_trunc('month', period_month)::date),
  source_account_id    uuid references public.accounts(id),
  recurrence           text not null check (recurrence in ('monthly', 'quarterly', 'yearly', 'one_off')),
  reminder_days_before int not null default 7 check (reminder_days_before >= 0),
  note                 text,
  status               text not null default 'pending' check (status in ('pending', 'paid', 'skipped')),
  created_by           uuid references public.profiles(id) default auth.uid(),
  created_at           timestamptz not null default now()
);

create table public.expenses (
  id                     uuid primary key default gen_random_uuid(),
  amount                 bigint not null check (amount > 0),
  payment_date           date not null,
  period_month           date not null check (period_month = date_trunc('month', period_month)::date),
  category_id            uuid references public.expense_categories(id),   -- nullable: "kategoriyasiz" is allowed, flagged at Oyni yopish
  counterparty_id        uuid references public.counterparties(id),
  source_account_id      uuid not null references public.accounts(id),
  expense_type           text not null check (expense_type in ('recurring_required', 'recurring_optional', 'one_off', 'unexpected')),
  note                   text,
  receipt_path           text,        -- object key in bucket buxgalteriya-files (house pattern: key, not URL)
  recurring_expense_id   uuid references public.recurring_expenses(id),
  upcoming_obligation_id uuid references public.upcoming_obligations(id),
  -- 'pending' = auto-posted (recurring / kutilayotgan), waiting for the
  -- accountant to confirm (and correct the amount). Only 'confirmed' rows
  -- count in balances and reports.
  status                 text not null default 'confirmed' check (status in ('pending', 'confirmed')),
  voided_at              timestamptz,
  voided_by              uuid references public.profiles(id),
  void_reason            text,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index expenses_period_idx on public.expenses (period_month) where voided_at is null;
create index expenses_account_idx on public.expenses (source_account_id) where voided_at is null;
-- one auto-post per schedule per period
create unique index expenses_recurring_period_uniq on public.expenses (recurring_expense_id, period_month)
  where recurring_expense_id is not null and voided_at is null;

create table public.cash_ins (
  id                     uuid primary key default gen_random_uuid(),
  amount                 bigint not null check (amount > 0),
  received_date          date not null,
  period_month           date not null check (period_month = date_trunc('month', period_month)::date),
  customer_id            uuid not null references public.counterparties(id),
  service_type           text not null check (service_type in ('moyka', 'rezka', 'other')),
  destination_account_id uuid not null references public.accounts(id),
  note                   text,
  voided_at              timestamptz,
  voided_by              uuid references public.profiles(id),
  void_reason            text,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now()
);
create index cash_ins_period_idx on public.cash_ins (period_month) where voided_at is null;

create table public.transfers (
  id                     uuid primary key default gen_random_uuid(),
  amount                 bigint not null check (amount > 0),
  transfer_date          date not null,
  source_account_id      uuid not null references public.accounts(id),
  destination_account_id uuid not null references public.accounts(id),
  note                   text,
  voided_at              timestamptz,
  voided_by              uuid references public.profiles(id),
  void_reason            text,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  check (source_account_id <> destination_account_id)
);

-- Append-only audit trail of closing/reopening; current status = latest event.
create table public.period_close_events (
  id           uuid primary key default gen_random_uuid(),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  action       text not null check (action in ('close', 'reopen')),
  reason       text,
  actor        uuid references public.profiles(id) default auth.uid(),
  at           timestamptz not null default now(),
  check (action <> 'reopen' or length(btrim(coalesce(reason, ''))) > 0)
);
create index period_close_events_month_idx on public.period_close_events (period_month, at desc);

create table public.monthly_rates (
  id           uuid primary key default gen_random_uuid(),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  service_type text not null check (service_type in ('moyka', 'rezka')),
  rate_per_kg  numeric(12, 2) not null check (rate_per_kg > 0),
  set_by       text,
  created_at   timestamptz not null default now(),
  unique (period_month, service_type)
);

-- Period status: 'open' (no events), 'closed', 'reopened'.
create or replace view public.period_status with (security_invoker = true) as
  select distinct on (period_month)
    period_month,
    case when action = 'close' then 'closed' else 'reopened' end as status,
    at as changed_at,
    actor as changed_by,
    reason
  from public.period_close_events
  order by period_month, at desc;

create or replace function public.period_is_closed(p_period date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.action = 'close' from period_close_events e
    where e.period_month = date_trunc('month', p_period)::date
    order by e.at desc limit 1
  ), false)
$$;

-- Freeze a closed period: no insert/update of its expenses or cash_ins,
-- and no moving a row out of a closed period either.
create or replace function public.enforce_period_open() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.period_is_closed(new.period_month) then
    raise exception 'Davr yopilgan (%) — avval qayta oching', to_char(new.period_month, 'YYYY-MM') using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.period_month <> new.period_month and public.period_is_closed(old.period_month) then
    raise exception 'Davr yopilgan (%) — avval qayta oching', to_char(old.period_month, 'YYYY-MM') using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

create trigger expenses_period_open before insert or update on public.expenses
  for each row execute function public.enforce_period_open();

create or replace function public.enforce_cash_in_period_open() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.period_is_closed(new.period_month)
     or (tg_op = 'UPDATE' and public.period_is_closed(old.period_month)) then
    raise exception 'Davr yopilgan — avval qayta oching' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger cash_ins_period_open before insert or update on public.cash_ins
  for each row execute function public.enforce_cash_in_period_open();

-- ------------------------------------------------------------------ RLS
do $rls$
declare t text;
begin
  foreach t in array array['accounts', 'expense_categories', 'counterparties', 'recurring_expenses',
                           'upcoming_obligations', 'expenses', 'cash_ins', 'transfers',
                           'period_close_events', 'monthly_rates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy finance_read on public.%I for select using ((select public.is_finance_reader()))', t);
  end loop;
  -- buxgalter writes (insert + update; never delete -- void instead)
  foreach t in array array['accounts', 'expense_categories', 'counterparties', 'recurring_expenses',
                           'upcoming_obligations', 'expenses', 'cash_ins', 'transfers'] loop
    execute format('create policy buxgalter_insert on public.%I for insert with check ((select public.is_buxgalter()))', t);
    execute format('create policy buxgalter_update on public.%I for update using ((select public.is_buxgalter())) with check ((select public.is_buxgalter()))', t);
  end loop;
  -- period_close_events: append-only
  create policy buxgalter_insert on public.period_close_events for insert with check ((select public.is_buxgalter()));
  -- monthly_rates: read only for everyone in the app; set via admin SQL.
end
$rls$;

-- ------------------------------------------------------------------ storage
insert into storage.buckets (id, name, public)
values ('buxgalteriya-files', 'buxgalteriya-files', false)
on conflict (id) do nothing;

create policy buxgalteriya_files_read on storage.objects for select
  using (bucket_id = 'buxgalteriya-files' and (select public.is_finance_reader()));

create policy buxgalteriya_files_insert on storage.objects for insert
  with check (bucket_id = 'buxgalteriya-files' and (select public.is_buxgalter()));

-- ------------------------------------------------------------------ seed
insert into public.accounts (name_uz, kind, supplier_name) values
  ('Naqd pul (bank)', 'bank', null),
  ('Naqd (kassa)', 'kassa', null),
  ('Gaz balansi', 'utility', 'Hududgaz'),
  ('Elektr balansi', 'utility', 'Hududelektr');

insert into public.counterparties (name, kind, owner_id)
select 'Global Export', 'customer', o.id from public.owners o where o.name = 'Global Export Company';

-- Rates given by the owner on 2026-11-22 for the current month.
insert into public.monthly_rates (period_month, service_type, rate_per_kg, set_by) values
  ('2026-11-01', 'moyka', 7468.75, 'Abdulloh (via admin, 2026-11-22)'),
  ('2026-11-01', 'rezka', 4133.93, 'Abdulloh (via admin, 2026-11-22)');
