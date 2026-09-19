-- Follow-up fix to 0124, same session, found during live verification
-- (see docs/decisions/0196) -- caught before any production serial ever
-- legitimately had a second cycle, so zero regression risk to real data.
--
-- Bug: client_serial_loss_kg bounded a closed cycle's own sent/output
-- window by [opened_at, closed_at] -- but closed_at is "when Yakunlash was
-- clicked," not "when the next cycle's material started arriving." A
-- same-day close-then-reopen (or any later cycle's first activity landing
-- on or before the prior cycle's own closed_at date) would double-count
-- the later cycle's sends into the earlier, already-closed cycle's booked
-- loss. Verified live with a TEST- fixture: cycle 1 (sent 500/received
-- 480, true loss 20) read as 30 once cycle 2's 200 kg send landed on a
-- date within cycle 1's [opened_at, closed_at] window.
--
-- Fix: bound each cycle by the NEXT cycle's opened_at instead (exclusive),
-- not by its own closed_at. Cycles are contiguous and non-overlapping by
-- construction (wash_cycles_one_open_per_serial enforces at most one open
-- cycle at a time), so "everything from this cycle's opened_at up to the
-- next cycle's opened_at" is the correct, unambiguous partition -- and for
-- the terminal cycle (no successor), unbounded above, identical to every
-- single-cycle serial's existing behavior (opened_at is always <= the
-- earliest real send, so the lower bound is a no-op there too).

begin;

create or replace function public.client_serial_loss_kg(p_serial text)
returns numeric
language sql
stable
as $function$
  with cycles as (
    select id, opened_at, closed_at,
      lead(opened_at) over (order by cycle_no) as next_opened_at
    from wash_cycles where serial = p_serial
  ),
  closed_cycles as (
    select * from cycles where closed_at is not null
  ),
  per_cycle as (
    select
      cc.id,
      coalesce((select sum(ms.qty_kg) from moyka_sends ms
                where ms.serial = p_serial
                  and ms.sent_date >= cc.opened_at::date
                  and (cc.next_opened_at is null or ms.sent_date < cc.next_opened_at::date)), 0) as sent_kg,
      (select calibre_kg + kn_kg from client_calibre_split(
        p_serial, cc.opened_at,
        case when cc.next_opened_at is null then null else cc.next_opened_at - interval '1 day' end
      )) as output_kg
    from closed_cycles cc
  )
  select case when not exists (select 1 from closed_cycles) then null
    else (select coalesce(sum(sent_kg - output_kg), 0) from per_cycle)
  end;
$function$;

commit;
