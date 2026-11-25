-- 2026-11-25, docs/decisions/0254: importing Aug–Oct 2026 history so the app's
-- balances equal the real ones.
--
-- 1. account kind 'external': money that is neither income nor expense
--    (opening balances, loan repayments, a secondary bank account). Moving it
--    in or out is a TRANSFER, so it never touches sof foyda. External accounts
--    are inactive: hidden from every account list and picker, while their
--    transfers still move the real accounts' balances.
-- 2. import_batch on the entry tables, so a whole import can be found -- and
--    voided -- in one step.
alter table public.accounts drop constraint accounts_kind_check;
alter table public.accounts add constraint accounts_kind_check check (kind in ('bank', 'kassa', 'utility', 'external'));

alter table public.expenses  add column if not exists import_batch text;
alter table public.cash_ins  add column if not exists import_batch text;
alter table public.transfers add column if not exists import_batch text;

insert into public.accounts (name_uz, kind, supplier_name, is_active)
values ('Boshlang''ich qoldiq', 'external', null, false),
       ('Tashqi harakatlar (foydaga kirmaydi)', 'external', null, false)
on conflict (name_uz) do nothing;
