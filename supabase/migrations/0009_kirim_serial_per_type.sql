-- KIRIM_ORDERS / KIRIM_LINES → v1.9 shape (SPEC §2.1, §3.1, §8; DECISIONS.md
-- "2026-07-14 — Serial is per type-line, not per truck").
--
-- Phase 0 built these tables with the OLD shape: serial lived on
-- kirim_orders (one serial per truck). No application was ever built
-- against them and no real data exists, so this migration replaces them
-- outright rather than migrating data.
--
-- New shape:
--   kirim_orders — a delivery envelope (one truck-trip). No serial.
--   kirim_lines  — one row = one type = one serial. serial is the PK,
--                  minted by next_serial() once per line (not once per
--                  order — see call-site change below; next_serial()
--                  itself is untouched, still a standalone atomic
--                  function per Phase 0).
--
-- KNOWN RIPPLE, DELIBERATELY NOT FIXED HERE (out of scope for this step):
-- six tables + one view were built referencing kirim_orders(serial):
-- gate_weighings, storage_intake, moyka_sends, finished_pallets,
-- wash_cycles, lab_results, and the v_serial_balance view. Since serial no
-- longer lives on kirim_orders, those FKs cannot be satisfied as-is. This
-- migration drops only the now-invalid FK *constraints* on those six
-- tables (their `serial` columns stay, just unconstrained for now) and
-- drops v_serial_balance outright, because leaving them pointed at a
-- column that no longer exists would break the migration entirely.
-- It deliberately does NOT re-point them at kirim_lines(serial) or rebuild
-- the view — GATE_WEIGHINGS changes are explicitly out of scope for this
-- step, and storage/lab/dispatch schema belongs to their own future
-- steps. Whoever builds Gate (§4), Storage §5.1, Laborator (§5.5), or
-- Kuzatuv (§3.4) next will need to re-point these at kirim_lines(serial)
-- and rebuild v_serial_balance against kirim_lines as its anchor.

drop view v_serial_balance;

alter table gate_weighings   drop constraint gate_weighings_serial_fkey;
alter table storage_intake   drop constraint storage_intake_serial_fkey;
alter table moyka_sends      drop constraint moyka_sends_serial_fkey;
alter table finished_pallets drop constraint finished_pallets_serial_fkey;
alter table wash_cycles      drop constraint wash_cycles_serial_fkey;
alter table lab_results      drop constraint lab_results_serial_fkey;

drop table kirim_lines;
drop table kirim_orders;

create table kirim_orders (          -- delivery envelope; one truck-trip. No serial.
  order_id uuid primary key default gen_random_uuid(),
  order_date date not null,          -- SPEC §8 "sana"
  plate text not null,
  driver text not null,
  owner_id uuid not null references owners,
  doc_photo text,                    -- storage path
  declared_total numeric,            -- "Jami avto" — sum of line declared_qty, computed client-side, stored on save
  status order_status not null default 'kutilmoqda',
  created_by uuid references profiles,
  created_at timestamptz not null default now()
);

create table kirim_lines (           -- 🔒 one line = one type = one serial (SPEC §2.1)
  serial text primary key default next_serial(),
  order_id uuid not null references kirim_orders(order_id) on delete cascade,
  type_id uuid not null references product_types,
  declared_qty numeric not null check (declared_qty > 0)   -- manager's declared figure; never overwritten (§3.1)
);

-- RLS: dropping the tables dropped their policies too. Re-enable and
-- recreate exactly what 0007_rls.sql had — same roles, same rules, only
-- the columns underneath changed.
alter table kirim_orders enable row level security;
alter table kirim_lines  enable row level security;

create policy read_all on kirim_orders for select using (auth.uid() is not null);
create policy menejer_writes on kirim_orders for insert
  with check (my_role() = 'menejer');

create policy read_all on kirim_lines for select using (auth.uid() is not null);
create policy menejer_writes on kirim_lines for insert
  with check (my_role() = 'menejer');
