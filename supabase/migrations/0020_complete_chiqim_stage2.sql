-- Mirror of complete_kirim_stage2() (0013_gate_weighings_complete_kirim.sql)
-- for the CHIQIM direction. Flips chiqim_requests.status -> 'olib_ketildi'
-- at gate stage-2 completion (SPEC §3.1: "Status Kutilmoqda → Olib
-- ketildi"; §4: manager CHIQIM -> Olib ketildi on Yakunlash). This is the
-- ONLY place that flip happens (CHIQIM per-role finalization invariant,
-- SPEC.md §5 intro) -- qorovul app code never writes chiqim_requests.status
-- directly, and RLS would refuse it anyway (qorovul has no write policy on
-- chiqim_requests -- only menejer_writes INSERT and ombor_updates UPDATE
-- exist, confirmed live before writing this).
--
-- 'olib_ketildi' confirmed against the live order_status enum
-- (kutilmoqda/qabul_qilindi/olib_ketildi/yakunlandi) before writing this --
-- exact match, not assumed.

create or replace function complete_chiqim_stage2() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dir = 'chiqim'
     and new.request_id is not null
     and new.completed_at is not null
     and old.completed_at is null then
    update chiqim_requests set status = 'olib_ketildi' where id = new.request_id;
  end if;
  return new;
end;
$$;

create trigger gate_weighings_complete_chiqim
  after update on gate_weighings
  for each row
  execute function complete_chiqim_stage2();
