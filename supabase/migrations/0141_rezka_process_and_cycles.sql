-- Rezka build, Prompt 1 of 4 (2026-09-23) -- part 1: process field, the
-- process-level guard, Rezka cycle close-out, calibre rename.
-- Design: docs/REZKA-AUDIT.md + the approved Prompt-1 plan; decisions logged
-- in docs/decisions/0219-* .. 0223-*. No UI here.
--
-- 1. kirim_lines.process ('moyka' | 'rezka'), default 'moyka'. Rides the
--    serial (a serial is single-process by construction, same as it is
--    single-type). No backfill: every existing line is Moyka, the default
--    already says so.
-- 2. enforce_serial_process(): the process-level twin of 0076's
--    prevent_dual_process_serial (which guards the CYCLE tables against one
--    serial living in both). Moyka exits (moyka_sends, wash_cycles --
--    ensure_open_wash_cycle/open_second_wash_cycle insert there) reject a
--    process='rezka' serial; Rezka exits (rezka_sends, rezka_cycles) reject
--    a process='moyka' serial. Fires on INSERT and on UPDATE OF serial.
-- 3. rezka_cycles gains opened_at/cycle_no/closed_at so it has the same
--    multi-cycle shape wash_cycles has had since 0124 (0076 copied the
--    pre-0124 shape). unique(serial) -> unique(serial, cycle_no) + one open
--    cycle per serial. 0 rows live, nothing to backfill.
-- 4. ensure_open_rezka_cycle / close_rezka_cycle_if_settled /
--    close_rezka_cycle_serial: copies of the live Moyka trio, lab gate
--    REMOVED (Rezka has no lab). Close semantics per product-owner decision
--    (b): auto-close only at EXACTLY received = sent; the manual close
--    closes at any residual, positive or negative, and returns the signed
--    yoqotish (negative = gain). Rezka output arrives in batches and gains
--    are normal -- nothing may lock out pallets still coming.
-- 5. RKN calibre display label 'Rezka KN' -> 'Standard'. Code unchanged
--    (Barcode #2 ids embed the code, PLT-<serial>-RKN-<seq>).

-- ------------------------------------------------------------------
-- 1. process column
-- ------------------------------------------------------------------
alter table kirim_lines
  add column process text not null default 'moyka'
  check (process in ('moyka', 'rezka'));

-- ------------------------------------------------------------------
-- 2. process-level guard
-- ------------------------------------------------------------------
create or replace function enforce_serial_process()
returns trigger
language plpgsql
as $$
declare
  v_process text;
begin
  select process into v_process from kirim_lines where serial = new.serial;
  if TG_TABLE_NAME in ('moyka_sends', 'wash_cycles') and v_process = 'rezka' then
    raise exception 'Bu seriya Rezka uchun -- Moykaga yuborib bo''lmaydi (%)', new.serial
      using errcode = '23514';
  elsif TG_TABLE_NAME in ('rezka_sends', 'rezka_cycles') and v_process = 'moyka' then
    raise exception 'Bu seriya Moyka uchun -- Rezkaga yuborib bo''lmaydi (%)', new.serial
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger moyka_sends_enforce_process
  before insert or update of serial on moyka_sends
  for each row execute function enforce_serial_process();
create trigger wash_cycles_enforce_process
  before insert or update of serial on wash_cycles
  for each row execute function enforce_serial_process();
create trigger rezka_sends_enforce_process
  before insert or update of serial on rezka_sends
  for each row execute function enforce_serial_process();
create trigger rezka_cycles_enforce_process
  before insert or update of serial on rezka_cycles
  for each row execute function enforce_serial_process();

-- ------------------------------------------------------------------
-- 3. rezka_cycles multi-cycle shape (mirrors live wash_cycles)
-- ------------------------------------------------------------------
alter table rezka_cycles
  add column opened_at timestamptz not null default now(),
  add column cycle_no  integer not null default 1,
  add column closed_at timestamptz;
alter table rezka_cycles drop constraint rezka_cycles_serial_key;
alter table rezka_cycles
  add constraint rezka_cycles_serial_cycle_no_key unique (serial, cycle_no);
create unique index rezka_cycles_one_open_per_serial
  on rezka_cycles (serial) where closed_at is null;

-- ------------------------------------------------------------------
-- 4. Rezka cycle RPCs (copies of the live Moyka trio, no lab gate)
-- ------------------------------------------------------------------
create or replace function ensure_open_rezka_cycle(p_serial text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Ruxsat yo''q' using errcode = '42501';
  end if;

  insert into rezka_cycles (serial, cycle_no, status)
  values (p_serial, 1, 'active')
  on conflict (serial, cycle_no) do nothing;
end
$$;

-- Moyka's twin closes when received >= sent. Rezka closes only at EXACT
-- settlement: an over-receive is a normal gain and more pallets may still
-- be coming, so it must stay open until Ombor closes it by hand.
create or replace function close_rezka_cycle_if_settled(p_serial text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rc_id     uuid;
  v_opened_at timestamptz;
  v_sent      numeric;
  v_received  numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Ruxsat yo''q' using errcode = '42501';
  end if;

  select rc.id, rc.opened_at into v_rc_id, v_opened_at
  from rezka_cycles rc where rc.serial = p_serial and rc.closed_at is null;

  if not found then
    return; -- no open cycle: silent no-op, same contract as the Moyka twin
  end if;

  select coalesce(sum(qty_kg), 0) into v_sent
  from rezka_sends where serial = p_serial and sent_date >= v_opened_at::date;
  select coalesce(sum(weight_kg), 0) into v_received
  from finished_pallets where serial = p_serial and status <> 'bekor_qilindi'
    and received_date >= v_opened_at::date;

  update rezka_cycles
  set closed_at = now()
  where id = v_rc_id and v_sent = v_received;
end
$$;

-- Manual Yakunlash for Rezka. No lab gate (Rezka has no lab) and, unlike
-- close_wash_cycle_serial, no "nothing left to close" refusal: it closes at
-- any residual. yoqotish_kg is signed -- negative means a gain.
create or replace function close_rezka_cycle_serial(p_serial text)
returns table(rezkada_kg numeric, yoqotish_kg numeric, closed_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rc_id     uuid;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_sent      numeric;
  v_received  numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor seriyani yakunlashi mumkin' using errcode = '42501';
  end if;

  select rc.id, rc.opened_at into v_rc_id, v_opened_at
  from rezka_cycles rc where rc.serial = p_serial and rc.closed_at is null
  for update;

  if not found then
    raise exception 'Seriya topilmadi yoki ochiq sikl yo''q: %', p_serial using errcode = 'P0002';
  end if;

  select coalesce(sum(qty_kg), 0) into v_sent
  from rezka_sends where serial = p_serial and sent_date >= v_opened_at::date;
  select coalesce(sum(weight_kg), 0) into v_received
  from finished_pallets where serial = p_serial and status <> 'bekor_qilindi'
    and received_date >= v_opened_at::date;

  update rezka_cycles set closed_at = now() where id = v_rc_id
  returning rezka_cycles.closed_at into v_closed_at;

  return query select 0::numeric, v_sent - v_received, v_closed_at;
end
$$;

-- ------------------------------------------------------------------
-- 5. RKN calibre display rename
-- ------------------------------------------------------------------
update calibres set label = 'Standard' where code = 'RKN' and is_rezka_output;
