-- Path E cheat version: schema + RPCs for a second wash_cycles cycle per
-- serial, admin-only (service-role RPC call), no UI. Partial reversal of
-- the 2026-07-28 "Laborator v2" collapse (0036_lab_relocation_reporting.sql),
-- which dropped cycle_no on the premise "a serial washes exactly once."
-- See docs/decisions/0196-2026-09-19-path-e-cheat-multi-cycle-scoping.md.
--
-- Reviewed and approved by Abdulloh 2026-09-19 (schema + all six function
-- rewrites below, plus the opened_at fallback for the 5 legacy zero-send
-- rows) before being applied.

begin;

-- 1. Schema ---------------------------------------------------------

alter table wash_cycles add column cycle_no int;
alter table wash_cycles add column opened_at timestamptz;

update wash_cycles set cycle_no = 1 where cycle_no is null;

-- 5 legacy rows (020826-034/035/036/037/038) have zero moyka_sends at all
-- -- pre-cutover seed/fixture rows, status='final', closed_at=null,
-- finalized_at='2025-01-01 00:00:00+00' (an obvious placeholder sentinel,
-- not a real event; there is no wash_cycles.created_at column to fall
-- back to instead -- confirmed absent from live schema). Approved by
-- Abdulloh 2026-09-19: use that same 2025-01-01 sentinel for opened_at.
-- Safe because opened_at is ONLY ever used as a cycle-window lower bound
-- for summing moyka_sends/finished_pallets on this cycle (never as a
-- period-report bucket key -- every consumer buckets by closed_at,
-- sent_date, or received_date, none of which exist on these 5 rows) --
-- with zero sends and zero pallets on either side of that bound, every
-- window sum is 0 regardless of what date opened_at actually holds. The
-- fake date is inert, not a source of drift. Left here rather than
-- silently picking a different placeholder so a future reader doesn't
-- mistake 2025-01-01 for a real cycle-open date and re-derive it.
update wash_cycles wc
set opened_at = coalesce(
  (select min(ms.sent_date)::timestamptz from moyka_sends ms where ms.serial = wc.serial),
  wc.finalized_at,
  now()
)
where opened_at is null;

alter table wash_cycles alter column cycle_no set not null;
alter table wash_cycles alter column cycle_no set default 1;
alter table wash_cycles alter column opened_at set not null;
alter table wash_cycles alter column opened_at set default now();

alter table wash_cycles drop constraint wash_cycles_serial_key;
alter table wash_cycles add constraint wash_cycles_serial_cycle_no_key unique (serial, cycle_no);

-- At most one OPEN cycle per serial -- every scalar-subquery call site
-- below (and in get_serial_passport/yield_rows/get_client_report/
-- rahbar_dashboard_ledger/client_serial_ledger/client_panel_summary/
-- rahbar_stock_snapshot/lab_turnaround_avg/kirim_line_loss_range/
-- kirim_line_moyka_asof/kirim_line_moyka_range, all untouched by this
-- migration -- see docs/decisions/0196 for the full audit) assumes this.
create unique index wash_cycles_one_open_per_serial on wash_cycles (serial) where closed_at is null;

comment on column wash_cycles.cycle_no is 'Restored -- see docs/decisions/0196. Dropped in 0036 (2026-07-28). 1 for every pre-existing row; 2+ only via open_second_wash_cycle, admin-only.';
comment on column wash_cycles.opened_at is 'Restored -- see docs/decisions/0196. Backfilled to earliest moyka_sends.sent_date, or finalized_at (falling back further to now()) for 5 legacy zero-send rows. Cycle membership for moyka_sends/finished_pallets is derived by date window (opened_at..coalesce(closed_at,current_date)), never an FK.';

-- 2. open_second_wash_cycle -------------------------------------------

create or replace function public.open_second_wash_cycle(p_serial text)
returns table (id uuid, serial text, cycle_no int, opened_at timestamptz, closed_at timestamptz, status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parent_id      uuid;
  v_parent_verdict text;
  v_next_cycle     int;
  v_new_id         uuid;
begin
  -- Not an Ombor-triggered flow (no UI button exists in the cheat
  -- version) -- service-role only, deliberately not my_role() = 'ombor'.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Bu amal faqat administrator tomonidan SQL orqali bajariladi' using errcode = '42501';
  end if;

  perform 1 from wash_cycles where serial = p_serial order by cycle_no for update;

  select id into v_parent_id
    from wash_cycles where serial = p_serial and closed_at is not null
    order by cycle_no desc limit 1;

  if v_parent_id is null then
    raise exception 'Bu seriyada yopilgan sikl topilmadi -- avval Yakunlash orqali yopilishi kerak' using errcode = 'P0002';
  end if;

  if exists (select 1 from wash_cycles where serial = p_serial and closed_at is null) then
    raise exception 'Bu seriyada allaqachon ochiq sikl mavjud' using errcode = '22023';
  end if;

  select lr.verdict into v_parent_verdict
    from lab_results lr
    where lr.scope = 'chiqim' and lr.wash_cycle_id = v_parent_id
    order by lr.created_at desc limit 1;

  if v_parent_verdict is distinct from 'o_tdi' then
    raise exception 'Yopilgan sikl laborant tomonidan tasdiqlanmagan (o''tdi)' using errcode = '22023';
  end if;

  select coalesce(max(cycle_no), 0) + 1 into v_next_cycle from wash_cycles where serial = p_serial;

  insert into wash_cycles (serial, cycle_no, opened_at, closed_at, status)
  values (p_serial, v_next_cycle, now(), null, 'active')
  returning wash_cycles.id into v_new_id;

  insert into audit_log (table_name, row_id, action, before, after, at)
  values ('wash_cycles', v_new_id::text, 'insert', null,
    jsonb_build_object('serial', p_serial, 'cycle_no', v_next_cycle, 'opened_at', now(), 'closed_at', null, 'status', 'active'),
    now());

  return query select wc.id, wc.serial, wc.cycle_no, wc.opened_at, wc.closed_at, wc.status
    from wash_cycles wc where wc.id = v_new_id;
end
$function$;

revoke all on function open_second_wash_cycle(text) from public;
grant execute on function open_second_wash_cycle(text) to service_role;

-- 3. close_wash_cycle_serial / close_wash_cycle_if_settled --------------
-- Beyond just retargeting the row (serial + closed_at is null instead of
-- bare serial): v_sent/v_received inside BOTH functions are now
-- cycle-window-scoped (sent_date/received_date >= this cycle's
-- opened_at), not whole-serial -- otherwise closing cycle 2 would re-sum
-- cycle 1's already-closed, already-booked history into cycle 2's
-- residual, double-booking it. For every existing single-cycle serial
-- this is a no-op (opened_at == earliest send date == nothing earlier to
-- exclude), so single-cycle behavior is unchanged.

create or replace function public.close_wash_cycle_serial(p_serial text)
returns table (moykada_kg numeric, yoqotish_kg numeric, closed_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wc_id       uuid;
  v_opened_at   timestamptz;
  v_closed_at   timestamptz;
  v_lab_verdict text;
  v_sent        numeric;
  v_received    numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor seriyani yakunlashi mumkin' using errcode = '42501';
  end if;

  select wc.id, wc.opened_at into v_wc_id, v_opened_at
  from wash_cycles wc where wc.serial = p_serial and wc.closed_at is null
  for update;

  if not found then
    raise exception 'Seriya topilmadi yoki ochiq sikl yo''q: %', p_serial using errcode = 'P0002';
  end if;

  select lr.verdict into v_lab_verdict
  from lab_results lr
  where lr.wash_cycle_id = v_wc_id and lr.scope = 'chiqim'
  order by lr.created_at desc limit 1;

  if v_lab_verdict is distinct from 'o_tdi' then
    raise exception 'Seriya laborant tomonidan tasdiqlanmagan -- avval tahlildan o''tishi kerak' using errcode = '22023';
  end if;

  select coalesce(sum(qty_kg), 0) into v_sent
  from moyka_sends where serial = p_serial and sent_date >= v_opened_at::date;
  select coalesce(sum(weight_kg), 0) into v_received
  from finished_pallets where serial = p_serial and status <> 'bekor_qilindi'
    and received_date >= v_opened_at::date;

  if v_sent - v_received <= 0 then
    raise exception 'Seriyada yopiladigan qoldiq yo''q' using errcode = '22023';
  end if;

  update wash_cycles set closed_at = now() where id = v_wc_id
  returning wash_cycles.closed_at into v_closed_at;

  return query select 0::numeric, v_sent - v_received, v_closed_at;
end
$function$;

create or replace function public.close_wash_cycle_if_settled(p_serial text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wc_id     uuid;
  v_opened_at timestamptz;
  v_sent      numeric;
  v_received  numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Ruxsat yo''q' using errcode = '42501';
  end if;

  select wc.id, wc.opened_at into v_wc_id, v_opened_at
  from wash_cycles wc where wc.serial = p_serial and wc.closed_at is null;

  if not found then
    return; -- no open cycle -- silent no-op, same contract as today (this
    -- function never raised for "no open cycle," only close_wash_cycle_
    -- serial does -- preserved, not merged)
  end if;

  select coalesce(sum(qty_kg), 0) into v_sent
  from moyka_sends where serial = p_serial and sent_date >= v_opened_at::date;
  select coalesce(sum(weight_kg), 0) into v_received
  from finished_pallets where serial = p_serial and status <> 'bekor_qilindi'
    and received_date >= v_opened_at::date;

  update wash_cycles
  set closed_at = now()
  where id = v_wc_id and v_sent - v_received <= 0;
end
$function$;

-- 4. client_calibre_split -- optional cycle window (backward compatible) --
-- Confirmed only two callers exist (client_serial_loss_kg/
-- client_serial_moyka_kg, both below) -- safe to extend the signature.

create or replace function public.client_calibre_split(p_serial text, p_from timestamptz default null, p_to timestamptz default null)
returns table(calibre_kg numeric, kn_kg numeric)
language sql
stable
as $function$
  with base_pallets as (
    select fp.weight_kg, c.is_numberless
    from finished_pallets fp
    join calibres c on c.id = fp.calibre_id
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
      and (p_from is null or fp.received_date >= p_from::date)
      and (p_to is null or fp.received_date <= p_to::date)
  )
  select
    coalesce(sum(weight_kg) filter (where not is_numberless), 0) as calibre_kg,
    coalesce(sum(weight_kg) filter (where is_numberless), 0) as kn_kg
  from base_pallets;
$function$;

-- 5. client_serial_loss_kg -- sum across every CLOSED cycle -----------

create or replace function public.client_serial_loss_kg(p_serial text)
returns numeric
language sql
stable
as $function$
  with closed_cycles as (
    select id, opened_at, closed_at from wash_cycles where serial = p_serial and closed_at is not null
  ),
  per_cycle as (
    select
      cc.id,
      coalesce((select sum(ms.qty_kg) from moyka_sends ms
                where ms.serial = p_serial and ms.sent_date >= cc.opened_at::date and ms.sent_date <= cc.closed_at::date), 0) as sent_kg,
      (select calibre_kg + kn_kg from client_calibre_split(p_serial, cc.opened_at, cc.closed_at)) as output_kg
    from closed_cycles cc
  )
  select case when not exists (select 1 from closed_cycles) then null
    else (select coalesce(sum(sent_kg - output_kg), 0) from per_cycle)
  end;
$function$;

-- 6. client_serial_moyka_kg -- the currently-open cycle's own residual --

create or replace function public.client_serial_moyka_kg(p_serial text)
returns numeric
language sql
stable
as $function$
  with open_cycle as (
    select opened_at from wash_cycles where serial = p_serial and closed_at is null
  ),
  sent as (
    select coalesce(sum(ms.qty_kg), 0) as kg from moyka_sends ms, open_cycle oc
    where ms.serial = p_serial and ms.sent_date >= oc.opened_at::date
  ),
  split as (
    select * from client_calibre_split(p_serial, (select opened_at from open_cycle), null)
  )
  select case when not exists (select 1 from open_cycle) then 0
    else greatest(0, (select kg from sent) - (select calibre_kg from split) - (select kn_kg from split))
  end;
$function$;

-- 7. kirim_line_state -- moykada cycle-aware, omborda_qoldi/moykaga_
-- yuborilgan deliberately UNCHANGED (whole-serial concepts, correct as-is)

create or replace function public.kirim_line_state(p_serial text)
returns table(qabul_qilingan numeric, omborda_qoldi numeric, moykaga_yuborilgan numeric, moykada numeric, moykadan_chiqgan numeric, xom_jonatilgan numeric, olib_ketilgan numeric)
language sql
stable
as $function$
  with eq as (
    select kirim_line_effective_qty(p_serial) as v
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as v from moyka_sends where serial = p_serial
  ),
  rezka_sent as (
    select coalesce(sum(qty_kg), 0) as v from rezka_sends where serial = p_serial
  ),
  raw_disp as (
    select coalesce(sum(net_kg), 0) as v from raw_dispatch_lines where serial = p_serial
  ),
  base_pallets as (
    select fp.weight_kg, fp.barcode2, fp.received_date
    from finished_pallets fp
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  ),
  moyka_out as (
    select coalesce(sum(weight_kg), 0) as v from base_pallets
  ),
  cycles as (
    select id, opened_at, closed_at from wash_cycles where serial = p_serial
  ),
  moykada_per_cycle as (
    select coalesce(sum(
      case when c.closed_at is not null then 0
        else greatest(0,
          coalesce((select sum(ms.qty_kg) from moyka_sends ms where ms.serial = p_serial and ms.sent_date >= c.opened_at::date), 0)
          - coalesce((select sum(bp.weight_kg) from base_pallets bp where bp.received_date >= c.opened_at::date), 0)
        )
      end
    ), 0) as v
    from cycles c
  ),
  departed as (
    select coalesce(sum(c.qty_kg), 0) as v
    from chiqim_pallet_consumption c
    join base_pallets bp on bp.barcode2 = c.barcode2
    join chiqim_lines cl on cl.id = c.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where chiqim_departed_at(cr.id) is not null
  )
  select
    eq.v as qabul_qilingan,
    greatest(0, eq.v - sent.v - rezka_sent.v - raw_disp.v) as omborda_qoldi,
    sent.v as moykaga_yuborilgan,
    (select v from moykada_per_cycle) as moykada,
    moyka_out.v as moykadan_chiqgan,
    raw_disp.v as xom_jonatilgan,
    departed.v as olib_ketilgan
  from eq, sent, rezka_sent, raw_disp, moyka_out, departed;
$function$;

commit;
