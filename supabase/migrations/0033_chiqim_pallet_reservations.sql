-- §3.1/§5.4 CHIQIM Option B: pallet-level reservation. Deferred at the
-- inline-picker task (2026-07-24, "CHIQIM inline pallet picker" — Option A
-- was non-reserving by design). This closes that gap: the picker's
-- selections are now persisted per line, and reserved until the request
-- completes or is voided.

-- Voiding a CHIQIM request: mirrors wash_cycles.voided_at (existing
-- precedent) rather than adding a value to the shared order_status enum,
-- which also drives kirim_orders and is out of scope to touch.
alter table chiqim_requests add column voided_at timestamptz;
alter table chiqim_requests add column voided_by uuid references profiles(id);

-- Menejer had zero UPDATE rights on chiqim_requests before this. Scoped to
-- requests Ombor hasn't started/finished yet -- voiding a request already
-- mid-scan or loaded needs a real unwind of dispatch_manifest, a separate,
-- much bigger concern this task doesn't touch.
create policy menejer_voids on chiqim_requests for update
  using (my_role() = 'menejer' and ombor_finished_at is null)
  with check (my_role() = 'menejer' and ombor_finished_at is null);

-- The reservation link itself. barcode2 -> finished_pallets(barcode2) is
-- valid: barcode2 IS finished_pallets' own primary key (confirmed live),
-- same FK shape dispatch_manifest.barcode2 already uses.
create table chiqim_line_pallets (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references chiqim_lines(id) on delete cascade,
  barcode2 text not null references finished_pallets(barcode2),
  created_at timestamptz not null default now(),
  -- Set by the trigger below, never by client code. Append-only: released
  -- rows stay for history (this app's established void-don't-delete
  -- convention) -- "currently reserved" is always released_at is null.
  released_at timestamptz
);
create index on chiqim_line_pallets(barcode2) where released_at is null;
create index on chiqim_line_pallets(line_id);

-- The actual double-claim guard, enforced by Postgres, same strength as
-- dispatch_manifest.barcode2's existing UNIQUE constraint: at most one
-- ACTIVE reservation per pallet at any moment.
create unique index chiqim_line_pallets_active_barcode
  on chiqim_line_pallets(barcode2) where released_at is null;

alter table chiqim_line_pallets enable row level security;
create policy read_all on chiqim_line_pallets for select using (auth.uid() is not null);
create policy menejer_writes on chiqim_line_pallets for insert with check (my_role() = 'menejer');
-- No update/delete policy: released_at is written only by the trigger
-- below (security definer), matching complete_chiqim_stage2()'s pattern.

-- Releases every active reservation for a request the moment it's voided
-- OR completed by Ombor -- completion means dispatch_manifest has already
-- taken over as the real claim; an un-scanned reserved pallet shouldn't
-- stay locked forever just because the request finished with a shortfall.
create or replace function release_chiqim_reservations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.voided_at is not null and old.voided_at is null)
     or (new.ombor_finished_at is not null and old.ombor_finished_at is null) then
    update chiqim_line_pallets set released_at = now()
    where released_at is null and line_id in (select id from chiqim_lines where request_id = new.id);
  end if;
  return new;
end;
$$;
create trigger chiqim_requests_release_reservations
  after update on chiqim_requests for each row execute function release_chiqim_reservations();
