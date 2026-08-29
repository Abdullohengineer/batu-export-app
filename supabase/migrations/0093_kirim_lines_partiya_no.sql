-- Partiya raqami (per-type arrival batch number) — SPEC.md new subsection
-- (see DECISIONS.md "Partiya raqami" for the full writeup). Assigned eagerly
-- at kirim_lines INSERT time (confirmed with the user before writing this:
-- matches order_date already being decided at that point, and avoids a
-- visible gap on Menejer's own screens between line creation and Ombor's
-- later intake confirmation).
--
-- Ordering key (confirmed with the user; two premises in the task's own
-- brief corrected first): kirim_lines has NO id column at all (its PK is
-- the generated text `serial`) -- the task's own suggested tie-break
-- "kirim_lines.id" does not exist. kirim_orders has no `arrival_date`
-- column either -- the real column is `order_date`, which is already what
-- every other read path in this codebase treats as "arrival" (aliased
-- date_basis/arrival_date in report_kirim_rows etc.). Final key:
-- (kirim_orders.order_date, kirim_orders.created_at, kirim_lines.serial) --
-- order_date for the date itself, the parent order's own created_at to
-- break ties between different orders sharing a date, and serial (globally
-- unique, itself a monotonic per-day counter via next_serial()) as the
-- final tie-break between two lines of the same type on one multi-type
-- order (a mixed Subxon+Isfara truck creates one order, two lines, same
-- order_date and created_at -- serial is what actually distinguishes them,
-- though they're different types here anyway and would never collide on
-- the SAME counter).
--
-- Origin filtering (CLAUDE.md): opening_stock and internal_reprocess rows
-- never get a number -- they didn't arrive on a truck. Left NULL, not 0 or
-- 1. This also means the column cannot be NOT NULL despite the task's own
-- rough sketch saying so -- the "opening stock leaves it null" requirement
-- is unambiguous and stated twice; corrected here rather than silently
-- picking one side of the contradiction.
--
-- Race safety: assigned via an atomic per-type counter table
-- (partiya_counter), the exact same pattern next_serial()/serial_counter
-- already established for the analogous problem (two concurrent inserts
-- must never receive the same number) -- not a live `count(*) + 1` scan,
-- which would race under concurrent Menejer submissions for the same type.
-- This is equivalent to "1 + count of earlier arrivals" for live inserts
-- specifically because eager assignment means every new row's own
-- order_date is always today, i.e. never earlier than an already-numbered
-- row's -- a backdated order_date arriving after later ones already got
-- numbered simply appends at the end of the sequence rather than being
-- retroactively inserted mid-sequence, which "never reassigned once
-- written" makes impossible anyway. Immutability is enforced by a second
-- trigger, independent of the RLS layer (kirim_lines has no UPDATE policy
-- for any role at all today -- this is defense in depth for the
-- classify_kirim_line_sulfur()-style security-definer RPC path, not the
-- primary guard).

-- ============================================================
-- 1. Column + counter table.
-- ============================================================
alter table public.kirim_lines add column partiya_no int;

create table public.partiya_counter (
  type_id uuid primary key references public.product_types(id),
  last_no int not null default 0
);

-- Locked down exactly like serial_counter (RLS enabled, zero policies) --
-- internal bookkeeping, touched only from inside the security-definer
-- trigger function below, never read or written directly by any role.
alter table public.partiya_counter enable row level security;

-- ============================================================
-- 2. Assignment trigger (BEFORE INSERT) — origin-gated, race-safe.
-- ============================================================
create or replace function public.assign_partiya_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text;
  v_no int;
begin
  select origin into v_origin from kirim_orders where order_id = new.order_id;

  if v_origin = 'delivery' then
    insert into partiya_counter (type_id, last_no) values (new.type_id, 1)
    on conflict (type_id) do update set last_no = partiya_counter.last_no + 1
    returning last_no into v_no;
    new.partiya_no := v_no;
  end if;

  return new;
end;
$$;

create trigger kirim_lines_assign_partiya_no
  before insert on public.kirim_lines
  for each row execute function public.assign_partiya_no();

-- ============================================================
-- 3. Immutability guard (BEFORE UPDATE) — "never reassigned once written."
-- ============================================================
create or replace function public.prevent_partiya_no_change()
returns trigger
language plpgsql
as $$
begin
  if old.partiya_no is not null and new.partiya_no is distinct from old.partiya_no then
    raise exception 'partiya_no is immutable once assigned' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger kirim_lines_partiya_no_immutable
  before update on public.kirim_lines
  for each row execute function public.prevent_partiya_no_change();

-- ============================================================
-- 4. Backfill — existing origin='delivery' rows only, ordered by the same
--    key above. Guarded by `where partiya_no is null` so this is trivially
--    idempotent: a second run finds zero matching rows and changes nothing
--    (also compatible with the immutability trigger above, which only ever
--    sees this statement touch NULL->value, never value->different-value).
-- ============================================================
with delivery_lines as (
  select kl.serial, kl.type_id,
    row_number() over (
      partition by kl.type_id
      order by ko.order_date, ko.created_at, kl.serial
    ) as rn
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  where ko.origin = 'delivery'
)
update kirim_lines kl
set partiya_no = dl.rn
from delivery_lines dl
where dl.serial = kl.serial
  and kl.partiya_no is null;

-- Seed the counter from the backfilled max per type, so the NEXT live
-- insert continues the sequence rather than colliding back at 1.
insert into partiya_counter (type_id, last_no)
select type_id, max(partiya_no) from kirim_lines where partiya_no is not null group by type_id
on conflict (type_id) do update set last_no = greatest(partiya_counter.last_no, excluded.last_no);
