-- Row Level Security — enforced from day one, on EVERY table (SPEC §2.12, §2.15; PHASE0 Part B7)
-- Hiding buttons in the UI is not security — the database must refuse the write.

create or replace function my_role() returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and active
$$;

-- ============================================================
-- Enable RLS on every table.
-- ============================================================
alter table profiles           enable row level security;
alter table owners             enable row level security;
alter table product_categories enable row level security;
alter table product_types      enable row level security;
alter table calibres           enable row level security;
alter table settings_limits    enable row level security;
alter table serial_counter     enable row level security;
alter table kirim_orders       enable row level security;
alter table kirim_lines        enable row level security;
alter table chiqim_requests    enable row level security;
alter table chiqim_lines       enable row level security;
alter table gate_weighings     enable row level security;
alter table storage_intake     enable row level security;
alter table moyka_sends        enable row level security;
alter table finished_pallets   enable row level security;
alter table wash_cycles        enable row level security;
alter table dispatch_manifest  enable row level security;
alter table lab_results        enable row level security;
alter table notes              enable row level security;
alter table audit_log          enable row level security;

-- ============================================================
-- serial_counter — no policies at all. The only path in or out is
-- next_serial(), which is SECURITY DEFINER (see 0002_serial.sql).
-- ============================================================

-- ============================================================
-- Master / admin data — everyone signed in reads; only rahbar writes.
-- ============================================================
create policy read_all on owners for select using (auth.uid() is not null);
create policy rahbar_admin_owners on owners for all
  using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

create policy read_all on product_categories for select using (auth.uid() is not null);
create policy rahbar_admin_product_categories on product_categories for all
  using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

create policy read_all on product_types for select using (auth.uid() is not null);
create policy rahbar_admin_product_types on product_types for all
  using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

create policy read_all on calibres for select using (auth.uid() is not null);
create policy rahbar_admin_calibres on calibres for all
  using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

create policy read_all on settings_limits for select using (auth.uid() is not null);
create policy rahbar_admin_settings_limits on settings_limits for all
  using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

-- profiles: everyone signed in can read (needed for names/roles in the UI);
-- only rahbar manages accounts (§6.4 Foydalanuvchilar va rollar).
create policy read_all on profiles for select using (auth.uid() is not null);
create policy rahbar_admin_profiles on profiles for all
  using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

-- ============================================================
-- Operational tables — everyone signed in reads (traceability, Kuzatuv,
-- Rahbar oversight all need cross-role read); writes are scoped per role.
-- Rahbar has NO write policy on any of these — that absence is the
-- enforcement of §2.12.
-- ============================================================

create policy read_all on kirim_orders for select using (auth.uid() is not null);
create policy menejer_writes on kirim_orders for insert
  with check (my_role() = 'menejer');

create policy read_all on kirim_lines for select using (auth.uid() is not null);
create policy menejer_writes on kirim_lines for insert
  with check (my_role() = 'menejer');

create policy read_all on chiqim_requests for select using (auth.uid() is not null);
create policy menejer_writes on chiqim_requests for insert
  with check (my_role() = 'menejer');

create policy read_all on chiqim_lines for select using (auth.uid() is not null);
create policy menejer_writes on chiqim_lines for insert
  with check (my_role() = 'menejer');

-- gate: qorovul writes stage 1 (insert) and stage 2 (update)
create policy read_all on gate_weighings for select using (auth.uid() is not null);
create policy qorovul_writes on gate_weighings for insert
  with check (my_role() = 'qorovul');
create policy qorovul_updates on gate_weighings for update
  using (my_role() = 'qorovul');

-- storage / pallets / wash cycles / dispatch: ombor writes
create policy read_all on storage_intake for select using (auth.uid() is not null);
create policy ombor_writes on storage_intake for insert
  with check (my_role() = 'ombor');
create policy ombor_updates on storage_intake for update
  using (my_role() = 'ombor');

create policy read_all on moyka_sends for select using (auth.uid() is not null);
create policy ombor_writes on moyka_sends for insert
  with check (my_role() = 'ombor');

create policy read_all on finished_pallets for select using (auth.uid() is not null);
create policy ombor_writes on finished_pallets for insert
  with check (my_role() = 'ombor');
create policy ombor_updates on finished_pallets for update
  using (my_role() = 'ombor');

create policy read_all on wash_cycles for select using (auth.uid() is not null);
create policy ombor_writes on wash_cycles for insert
  with check (my_role() = 'ombor');
create policy ombor_updates on wash_cycles for update
  using (my_role() = 'ombor');

create policy read_all on dispatch_manifest for select using (auth.uid() is not null);
create policy ombor_writes on dispatch_manifest for insert
  with check (my_role() = 'ombor');

-- lab: laborator writes (insert moisture, update later to add SO2 result)
create policy read_all on lab_results for select using (auth.uid() is not null);
create policy laborator_writes on lab_results for insert
  with check (my_role() = 'laborator');
create policy laborator_updates on lab_results for update
  using (my_role() = 'laborator');

-- ============================================================
-- Append-only tables — INSERT only, for everyone signed in.
-- No update/delete policy exists for anyone. This is what makes
-- append-only (§2.5) and the audit trail (§2.7) real, not a convention.
-- ============================================================
create policy notes_insert on notes for insert with check (auth.uid() is not null);
create policy notes_read   on notes for select using (auth.uid() is not null);

create policy audit_log_insert on audit_log for insert with check (auth.uid() is not null);
create policy audit_log_read   on audit_log for select using (my_role() = 'rahbar');
