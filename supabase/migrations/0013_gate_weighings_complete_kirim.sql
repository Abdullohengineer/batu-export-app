-- Flips kirim_orders.status → 'qabul_qilindi' at gate stage-2 completion
-- (SPEC §3.1, §4). This is the ONLY place that flip happens (🔒 §3.1).
--
-- Why a trigger, not a client-side update: `qorovul` has no write policy on
-- kirim_orders at all (0007_rls.sql only grants menejer insert there) — by
-- design, per §2.15 "the database is the source of truth, not the app."
-- A security-definer trigger is the same pattern already used by
-- next_serial() and my_role(): it runs with the function owner's
-- privileges, so it can write to kirim_orders regardless of the calling
-- role's own RLS grants on that table.

create or replace function complete_kirim_stage2() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dir = 'kirim'
     and new.order_id is not null
     and new.completed_at is not null
     and old.completed_at is null then
    update kirim_orders set status = 'qabul_qilindi' where order_id = new.order_id;
  end if;
  return new;
end;
$$;

create trigger gate_weighings_complete_kirim
  after update on gate_weighings
  for each row
  execute function complete_kirim_stage2();
