-- Post-Rezka cleanup, item 6 (2026-09-28): a void path for TEST- raw.
-- Decision: docs/decisions/0232-*.
--
-- Accepted raw had no void path, so a failed e2e run stranded TEST- raw in
-- live operational queues (Ombor Moyka/Tashqi pickers, intake Window 2, the
-- Moykaga badge, Laborator KIRIM, the Menejer Xom pool). The brief asked to
-- reuse "the existing voided filters" -- there are none for KIRIM lines:
-- kirim_lines has no void column, kirim_orders.status is a workflow enum
-- (kutilmoqda/qabul_qilindi/olib_ketildi/yakunlandi) and storage_intake.status
-- is always 'skladda_turibdi'. So this adds the smallest honest one:
--   * kirim_lines.voided_at / voided_by -- the void is recorded, never a
--     DELETE (SPEC §2.15), and never an edit of declared/actual quantities.
--   * void_test_kirim_line(serial) -- SECURITY DEFINER; refuses unless the
--     line's order plate starts with TEST-; idempotent (a second call is a
--     no-op); callable by staff (non-client, authenticated) and by
--     service_role (the e2e specs' Node-side cleanup client).
-- The raw-stage frontend readers (useMoykaSerials, useIntakeLines,
-- useLaboratorKirim, useKirimTrips, and the history twins useIntakeHistory /
-- useLaboratorHistory) filter voided_at is null. Server-side reports, the
-- ledger, the snapshot and stock_on_hand_rows need nothing: a voidable line
-- is TEST- by construction and every one of them already drops TEST- plates.

alter table public.kirim_lines
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id);

comment on column public.kirim_lines.voided_at is
  'TEST- lines only (void_test_kirim_line): the line is hidden from every raw-stage queue. Never set on real data.';

create function public.void_test_kirim_line(p_serial text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plate text;
  v_voided timestamptz;
begin
  if not ((select auth.role()) = 'service_role'
          or ((select auth.uid()) is not null and (select my_role()) is distinct from 'client'::user_role)) then
    raise exception 'void_test_kirim_line: staff only' using errcode = '42501';
  end if;

  select ko.plate, kl.voided_at into v_plate, v_voided
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  where kl.serial = p_serial
  for update of kl;

  if not found then
    raise exception 'void_test_kirim_line: serial % not found', p_serial;
  end if;
  if v_plate is null or v_plate not like 'TEST-%' then
    raise exception 'void_test_kirim_line: % is not TEST- data (plate %) -- real lines are never voided', p_serial, v_plate
      using errcode = '42501';
  end if;
  if v_voided is not null then
    return; -- already voided: idempotent
  end if;

  update kirim_lines set voided_at = now(), voided_by = (select auth.uid()) where serial = p_serial;
end;
$$;

revoke execute on function public.void_test_kirim_line(text) from public, anon;
grant execute on function public.void_test_kirim_line(text) to authenticated, service_role;
