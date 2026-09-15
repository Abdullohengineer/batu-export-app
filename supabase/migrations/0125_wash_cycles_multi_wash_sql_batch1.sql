-- Multi-wash support, SQL batch 1 of 3. Depends on 0124 (schema).
-- docs/decisions/0191. get_client_report and rahbar_dashboard_ledger are
-- deliberately NOT in this file -- both compute a period-scoped realized
-- loss, not just a live in-process balance, and need the same
-- client_lines/client_washes-style split (own commits, same reasoning).
-- The three-serial data migration (0126) stays unapplied until this file
-- is reviewed and merged.

-- ============================================================
-- 1. RLS hard gate (SPEC.md §5.5.3) -- finished_pallets.ombor_writes.
--    The inserted row now declares its own wash_no; the gate checks THAT
--    wash's own latest chiqim verdict, not an arbitrary one. A NULL
--    wash_no (Rezka pallet) never matches the first branch, falls through
--    to the existing Rezka OR-branch unchanged.
-- ============================================================
drop policy if exists ombor_writes on finished_pallets;
create policy ombor_writes on finished_pallets for insert
with check (
  my_role() = 'ombor' and (
    (
      select lr.verdict from lab_results lr
      join wash_cycles wc on wc.id = lr.wash_cycle_id
      where wc.serial = finished_pallets.serial
        and wc.wash_no = finished_pallets.wash_no
        and lr.scope = 'chiqim'
      order by lr.created_at desc limit 1
    ) = 'o_tdi'
    or exists (select 1 from rezka_cycles rc where rc.serial = finished_pallets.serial)
  )
);

-- ============================================================
-- 2. send_old_stock_to_moyka -- retarget the on-conflict now that the
--    single-column unique is gone. Always mints a brand-new serial, so
--    wash_no is always 1 here; no gate needed (there is no "prior wash").
-- ============================================================
create or replace function public.send_old_stock_to_moyka(
  p_owner_id        uuid,
  p_type_id         uuid,
  p_pallet_barcodes text[],
  p_weighed_kg      numeric
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_serial text;
  v_actor  uuid := auth.uid();
  v_book   numeric;
  v_count  int := coalesce(array_length(p_pallet_barcodes, 1), 0);
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor Moykaga yubora oladi' using errcode = '42501';
  end if;
  if p_weighed_kg is null or p_weighed_kg <= 0 then
    raise exception 'Tarozidagi og''irlikni kiriting' using errcode = '22023';
  end if;

  select coalesce(sum(weight_kg), 0) into v_book
    from finished_pallets where barcode2 = any(p_pallet_barcodes);

  v_serial := mint_serial_from_sources(p_owner_id, p_type_id, p_weighed_kg,
                                       p_pallet_barcodes, null, null);

  insert into wash_cycles (serial, wash_no, status) values (v_serial, 1, 'active')
    on conflict (serial, wash_no) do nothing;

  insert into moyka_sends (serial, wash_no, sent_date, qty_kg, created_by)
  values (v_serial, 1, (now() at time zone 'Asia/Tashkent')::date, p_weighed_kg, v_actor);

  insert into notes (entity_type, entity_id, author, body)
  values ('moyka', v_serial, v_actor,
    format('Eski zaxiradan qayta yuvish: %s ta eski pallet ishlatildi, kitob bo''yicha ~%s kg, tarozida %s kg yuborildi.',
           v_count, round(v_book), round(p_weighed_kg)));

  return v_serial;
end
$function$;

-- ============================================================
-- 3. open_or_continue_wash -- NEW RPC, the new-wash gate. Replaces
--    OmborMoykaTab.tsx's raw client-side wash_cycles upsert (frontend
--    batch), which breaks outright once wash_cycles_serial_key is gone
--    and can't enforce "only open wash N+1 when wash N is closed AND raw
--    remainder still exists" anyway -- that needs a row lock and a real
--    balance read, both server-side.
-- ============================================================
create or replace function public.open_or_continue_wash(p_serial text)
returns table (wash_no int, is_new boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_open_wash_no  int;
  v_max_wash_no   int;
  v_raw_remaining numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor Moykaga yubora oladi' using errcode = '42501';
  end if;

  perform 1 from wash_cycles where serial = p_serial order by wash_no for update;

  select wc.wash_no into v_open_wash_no from wash_cycles wc
   where wc.serial = p_serial and wc.closed_at is null;

  if v_open_wash_no is not null then
    return query select v_open_wash_no, false;
    return;
  end if;

  select max(wc.wash_no) into v_max_wash_no from wash_cycles wc where wc.serial = p_serial;

  if v_max_wash_no is not null then
    -- New-wash gate: a prior wash exists and is closed (else it would have
    -- matched above) -- only allow N+1 when real raw remainder still
    -- exists. Reuses stock_on_hand_rows' own figure, no new balance calc
    -- (CLAUDE.md).
    select coalesce(sum(s.qty_kg), 0) into v_raw_remaining
      from stock_on_hand_rows s where s.serial = p_serial and s.bucket = 'raw_not_washed';
    if v_raw_remaining <= 0 then
      raise exception 'Bu seriya uchun yopilgan yuvishdan keyin xom qoldiq yo''q -- yangi yuvish ochib bo''lmaydi' using errcode = '22023';
    end if;
  end if;

  insert into wash_cycles (serial, wash_no, status)
  values (p_serial, coalesce(v_max_wash_no, 0) + 1, 'active')
  returning wash_cycles.wash_no into v_open_wash_no;

  return query select v_open_wash_no, v_max_wash_no is not null;
end;
$function$;

revoke all on function public.open_or_continue_wash(text) from public;
grant execute on function public.open_or_continue_wash(text) to authenticated;

-- ============================================================
-- 4. close_wash_cycle_if_settled / close_wash_cycle_serial -- resolve the
--    open wash first, scope sums to that wash's own wash_no.
-- ============================================================
create or replace function public.close_wash_cycle_if_settled(p_serial text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wash_no  int;
  v_sent     numeric;
  v_received numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Ruxsat yo''q' using errcode = '42501';
  end if;

  select wc.wash_no into v_wash_no from wash_cycles wc
   where wc.serial = p_serial and wc.closed_at is null;
  if v_wash_no is null then
    return; -- no open wash for this serial -- nothing to settle
  end if;

  select coalesce(sum(qty_kg), 0) into v_sent
    from moyka_sends where serial = p_serial and wash_no = v_wash_no;
  select coalesce(sum(weight_kg), 0) into v_received
    from finished_pallets where serial = p_serial and wash_no = v_wash_no and status <> 'bekor_qilindi';

  update wash_cycles set closed_at = now()
  where serial = p_serial and wash_no = v_wash_no and closed_at is null and v_sent - v_received <= 0;
end
$function$;

create or replace function public.close_wash_cycle_serial(p_serial text)
returns table(moykada_kg numeric, yoqotish_kg numeric, closed_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wc_id       uuid;
  v_wash_no     int;
  v_closed_at   timestamptz;
  v_lab_verdict text;
  v_sent        numeric;
  v_received    numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor seriyani yakunlashi mumkin' using errcode = '42501';
  end if;

  select wc.id, wc.wash_no into v_wc_id, v_wash_no
  from wash_cycles wc where wc.serial = p_serial and wc.closed_at is null
  for update;

  if not found then
    -- CHANGED message text from the original "Seriya topilmadi": a serial
    -- can now exist with every wash already closed, a different situation
    -- from never having existed at all.
    raise exception 'Ochiq yuvish topilmadi: %', p_serial using errcode = 'P0002';
  end if;

  select lr.verdict into v_lab_verdict
  from lab_results lr where lr.wash_cycle_id = v_wc_id and lr.scope = 'chiqim'
  order by lr.created_at desc limit 1;

  if v_lab_verdict is distinct from 'o_tdi' then
    raise exception 'Seriya laborant tomonidan tasdiqlanmagan -- avval tahlildan o''tishi kerak' using errcode = '22023';
  end if;

  select coalesce(sum(qty_kg), 0) into v_sent from moyka_sends where serial = p_serial and wash_no = v_wash_no;
  select coalesce(sum(weight_kg), 0) into v_received
  from finished_pallets where serial = p_serial and wash_no = v_wash_no and status <> 'bekor_qilindi';

  if v_sent - v_received <= 0 then
    raise exception 'Seriyada yopiladigan qoldiq yo''q' using errcode = '22023';
  end if;

  update wash_cycles set closed_at = now() where id = v_wc_id
  returning wash_cycles.closed_at into v_closed_at;

  return query select 0::numeric, v_sent - v_received, v_closed_at;
end
$function$;

-- ============================================================
-- 5. client_calibre_split -- new wash-scoped overload, additive. The
--    original (p_serial text) is untouched -- nothing else calls it.
-- ============================================================
create or replace function public.client_calibre_split(p_serial text, p_wash_no int)
returns table(calibre_kg numeric, kn_kg numeric)
language sql
stable
as $function$
  with base_pallets as (
    select fp.weight_kg, c.is_numberless
    from finished_pallets fp
    join calibres c on c.id = fp.calibre_id
    where fp.serial = p_serial and fp.wash_no = p_wash_no
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  )
  select
    coalesce(sum(weight_kg) filter (where not is_numberless), 0) as calibre_kg,
    coalesce(sum(weight_kg) filter (where is_numberless), 0) as kn_kg
  from base_pallets;
$function$;

-- ============================================================
-- 6. client_serial_loss_kg / client_serial_moyka_kg -- loss sums across
--    every CLOSED wash; moyka reads the OPEN wash only. Nullability
--    audited and preserved against the originals: loss stays NULL when no
--    wash has ever closed (was NULL whenever wc.closed_at was null, i.e.
--    "nothing realized yet"); moyka stays always-numeric (was NEVER null
--    in the original -- the outer coalesce(...,0) below is required, not
--    decorative, since `select ... from wash_cycles wc where ... closed_at
--    is null` returns zero rows -- not a null row -- when no wash is open,
--    which a bare scalar-subquery function would otherwise turn into NULL).
-- ============================================================
create or replace function public.client_serial_loss_kg(p_serial text)
returns numeric
language sql
stable
as $function$
  select case
    when not exists (select 1 from wash_cycles wc where wc.serial = p_serial and wc.closed_at is not null)
    then null
    else coalesce((
      select sum(
        (select coalesce(sum(ms.qty_kg),0) from moyka_sends ms where ms.serial=wc.serial and ms.wash_no=wc.wash_no)
        - (select cs.calibre_kg + cs.kn_kg from client_calibre_split(wc.serial, wc.wash_no) cs)
      )
      from wash_cycles wc
      where wc.serial = p_serial and wc.closed_at is not null
    ), 0)
  end;
$function$;

create or replace function public.client_serial_moyka_kg(p_serial text)
returns numeric
language sql
stable
as $function$
  select coalesce((
    select greatest(0,
      (select coalesce(sum(ms.qty_kg),0) from moyka_sends ms where ms.serial=wc.serial and ms.wash_no=wc.wash_no)
      - (select cs.calibre_kg + cs.kn_kg from client_calibre_split(wc.serial, wc.wash_no) cs)
    )
    from wash_cycles wc
    where wc.serial = p_serial and wc.closed_at is null
  ), 0);
$function$;

-- ============================================================
-- 7. kirim_line_loss_range / kirim_line_moyka_asof -- same scalar
--    signature the generic report grid (reportColumns.ts) reads; math
--    fixed to genuinely aggregate across washes instead of assuming one.
--    Turning these into per-wash sets instead is a UI decision (the grid
--    would need a row-per-wash redesign) -- flagged as a named follow-up,
--    not decided here. Nullability preserved: loss_range was already
--    NULL-when-nothing-in-range (unchanged shape); moyka_asof was NEVER
--    null in the original, matched via the same outer-coalesce reasoning
--    as item 6.
-- ============================================================
create or replace function public.kirim_line_loss_range(p_serial text, p_from date, p_to date)
returns numeric
language sql
stable
as $function$
  select case when exists (
    select 1 from wash_cycles wc
    where wc.serial = p_serial and wc.closed_at is not null
      and (wc.closed_at at time zone 'utc')::date between p_from and p_to
  ) then (
    select coalesce(sum(
      (select coalesce(sum(ms.qty_kg),0) from moyka_sends ms where ms.serial=wc.serial and ms.wash_no=wc.wash_no)
      - (select cs.calibre_kg + cs.kn_kg from client_calibre_split(wc.serial, wc.wash_no) cs)
    ), 0)
    from wash_cycles wc
    where wc.serial = p_serial and wc.closed_at is not null
      and (wc.closed_at at time zone 'utc')::date between p_from and p_to
  ) else null end;
$function$;

create or replace function public.kirim_line_moyka_asof(p_serial text, p_to date)
returns numeric
language sql
stable
as $function$
  -- The wash still open as of p_to (closed_at is null, or closed after
  -- p_to) -- at most one such wash, by the partial-unique-index invariant
  -- (0124), so order by/limit 1 is a formality, not a tiebreak.
  select coalesce(
    (
      select greatest(0,
        coalesce((select sum(ms.qty_kg) from moyka_sends ms
                    where ms.serial = wc.serial and ms.wash_no = wc.wash_no and ms.sent_date <= p_to), 0)
        - coalesce((select sum(r.qty_kg) from report_moyka_output_rows r
                    where r.serial = wc.serial and r.wash_no = wc.wash_no
                      and r.date_basis <= p_to
                      and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
                      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
                   ), 0)
      )
      from wash_cycles wc
      where wc.serial = p_serial and (wc.closed_at is null or (wc.closed_at at time zone 'utc')::date > p_to)
      order by wc.wash_no desc limit 1
    ), 0
  );
$function$;

-- ============================================================
-- 8. kirim_line_state -- fixes the scalar-subquery crash (`more than one
--    row returned`) once a serial has 2+ wash_cycles rows. moykada now
--    reuses the already-fixed asof function instead of re-deriving.
-- ============================================================
create or replace function public.kirim_line_state(p_serial text)
returns TABLE(qabul_qilingan numeric, omborda_qoldi numeric, moykaga_yuborilgan numeric, moykada numeric, moykadan_chiqgan numeric, xom_jonatilgan numeric, olib_ketilgan numeric)
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
    select fp.weight_kg, fp.barcode2
    from finished_pallets fp
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  ),
  moyka_out as (
    select coalesce(sum(weight_kg), 0) as v from base_pallets
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
    kirim_line_moyka_asof(p_serial, (now() at time zone 'Asia/Tashkent')::date) as moykada,
    moyka_out.v as moykadan_chiqgan,
    raw_disp.v as xom_jonatilgan,
    departed.v as olib_ketilgan
  from eq, sent, rezka_sent, raw_disp, moyka_out, departed;
$function$;

-- ============================================================
-- 9. lab_turnaround_avg -- turnaround measured from the RELEVANT wash's
--    own first send (wc.wash_no threaded into the sent_date lateral),
--    not the serial's lifetime-first send. lr.wash_cycle_id was already
--    correctly specific -- only the sent_date lookup needed the fix.
-- ============================================================
create or replace function public.lab_turnaround_avg()
returns numeric
language sql
stable
as $function$
  select avg(lr.sample_date - ms_first.sent_date)
  from lab_results lr
  join wash_cycles wc on wc.id = lr.wash_cycle_id
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select min(ms2.sent_date) as sent_date from moyka_sends ms2
    where ms2.serial = wc.serial and ms2.wash_no = wc.wash_no
  ) ms_first on true
  where lr.scope = 'chiqim'
    and ko.plate not like 'TEST-%'
    and ko.origin != 'opening_stock';
$function$;

-- ============================================================
-- 10. attribute_chiqim_line_fifo -- the wash-lookup lateral now joins on
--     (serial, wash_no) instead of an undefined "limit 1" pick.
-- ============================================================
create or replace function public.attribute_chiqim_line_fifo(p_line_id uuid, p_loaded_kg numeric, p_actor uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_type_id uuid;
  v_calibre_id uuid;
  v_is_old boolean;
  v_remaining numeric := p_loaded_kg;
  v_take numeric;
  r record;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor yuklashni yakunlay oladi' using errcode = '42501';
  end if;

  if p_loaded_kg <= 0 then
    raise exception 'attribute_chiqim_line_fifo: loaded kg must be positive (got %)', p_loaded_kg;
  end if;

  select cl.type_id, cl.calibre_id, cl.line_kind = 'old_washed'
    into v_type_id, v_calibre_id, v_is_old
  from public.chiqim_lines cl
  where cl.id = p_line_id;

  if v_calibre_id is null then
    raise exception 'chiqim_line % has no calibre_id -- FIFO attribution only applies to finished/old_washed lines', p_line_id;
  end if;

  for r in
    select fp.barcode2, fp.weight_kg
    from public.finished_pallets fp
    left join lateral (
      select wc2.id from public.wash_cycles wc2
      where wc2.serial = fp.serial and wc2.wash_no = fp.wash_no
      limit 1
    ) wc on true
    left join lateral (
      select lr.verdict
      from public.lab_results lr
      where lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id
      order by lr.created_at desc limit 1
    ) lr on true
    where fp.type_id = v_type_id
      and fp.calibre_id = v_calibre_id
      and fp.is_old_stock = v_is_old
      and fp.status = 'in_stock'
      and lr.verdict = 'o_tdi'
    order by fp.created_at
    for update of fp
  loop
    exit when v_remaining <= 0;
    v_take := least(
      v_remaining,
      r.weight_kg - coalesce((select sum(qty_kg) from public.chiqim_pallet_consumption where barcode2 = r.barcode2), 0)
    );
    if v_take <= 0 then continue; end if;
    insert into public.chiqim_pallet_consumption (chiqim_line_id, barcode2, qty_kg, created_by)
    values (p_line_id, r.barcode2, v_take, p_actor);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Yetarli mahsulot yo''q: % kg yetishmayapti.', round(v_remaining, 1);
  end if;
end;
$function$;

-- ============================================================
-- 11. finished_pallet_availability -- same wash-lookup fix.
-- ============================================================
create or replace view public.finished_pallet_availability as
select fp.barcode2,
    fp.serial,
    fp.type_id,
    fp.calibre_id,
    fp.is_old_stock,
    fp.created_at,
    greatest(0::numeric, fp.weight_kg - coalesce(c.consumed_kg, 0::numeric)) as available_kg
   from finished_pallets fp
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial and wc2.wash_no = fp.wash_no
         limit 1) wc on true
     left join lateral ( select lr_1.verdict
           from lab_results lr_1
          where lr_1.scope = 'chiqim'::direction and lr_1.wash_cycle_id = wc.id
          order by lr_1.created_at desc
         limit 1) lr on true
     left join ( select chiqim_pallet_consumption.barcode2,
            sum(chiqim_pallet_consumption.qty_kg) as consumed_kg
           from chiqim_pallet_consumption
          group by chiqim_pallet_consumption.barcode2) c on c.barcode2 = fp.barcode2
  where fp.status = 'in_stock'::pallet_status and lr.verdict = 'o_tdi'::text;

-- ============================================================
-- 12. report_chiqim_rows -- same wash-lookup fix, plus fp.wash_no
--     surfaced (needed by kirim_line_moyka_asof, item 7, and by
--     report_moyka_output_rows' own downstream consumers).
-- ============================================================
create or replace view public.report_chiqim_rows as
select 'chiqim'::text as kind,
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    fp.wash_no,
    kl.order_id,
    latest.request_id,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    coalesce(cr.plate, ''::text) as plate,
    coalesce(cr.driver, ''::text) as driver,
    cr.request_date as date_basis,
    null::text as date_basis_source,
    fp.weight_kg as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
    case
        when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
        when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
        when fp.status = 'storage_loss'::pallet_status then 'saqlashda_yoqolgan'::text
        when coalesce(consumed.departed_kg, 0) >= fp.weight_kg then 'jonatilgan'::text
        when coalesce(consumed.departed_kg, 0) > 0 or coalesce(consumed.pending_kg, 0) > 0 then 'band_qilingan'::text
        else 'omborda'::text
    end as pallet_status,
    lr.verdict as lab_verdict,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    lr.moisture_pct,
    lr.so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg
   from finished_pallets fp
     join kirim_lines kl on kl.serial = fp.serial
     join kirim_orders ko on ko.order_id = kl.order_id
     left join lateral (
       select
         sum(c.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
         sum(c.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
       from chiqim_pallet_consumption c
       join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
       join chiqim_requests cr2 on cr2.id = cl2.request_id
       left join lateral (
         select cgw3.completed_at from gate_weighings cgw3
         where cgw3.dir = 'chiqim'::direction and cgw3.request_id = cr2.id
         order by cgw3.completed_at desc nulls last limit 1
       ) cgwx on true
       where c.barcode2 = fp.barcode2
     ) consumed on true
     left join lateral (
       select cl3.request_id
       from chiqim_pallet_consumption c3
       join chiqim_lines cl3 on cl3.id = c3.chiqim_line_id
       where c3.barcode2 = fp.barcode2
       order by c3.created_at desc limit 1
     ) latest on true
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial and wc2.wash_no = fp.wash_no
         limit 1) wc on true
     left join lateral ( select lr3.verdict,
            lr3.moisture_pct,
            lr3.so2_mg_kg
           from lab_results lr3
          where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
          order by lr3.created_at desc
         limit 1) lr on true
  where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 13. report_chiqim_rows_v2 -- same fix.
-- ============================================================
create or replace view public.report_chiqim_rows_v2 as
select 'chiqim'::text as kind,
    c.id::text as row_key,
    fp.serial,
    fp.barcode2,
    fp.wash_no,
    kl.order_id,
    cl.request_id,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    coalesce(cr.plate, ''::text) as plate,
    coalesce(cr.driver, ''::text) as driver,
    (chiqim_departed_at(cr.id) at time zone 'utc'::text)::date as date_basis,
    null::text as date_basis_source,
    c.qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
        case
            when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
            when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
            when fp.status = 'storage_loss'::pallet_status then 'saqlashda_yoqolgan'::text
            when coalesce(consumed.departed_kg, 0::numeric) >= fp.weight_kg then 'jonatilgan'::text
            when coalesce(consumed.departed_kg, 0::numeric) > 0::numeric or coalesce(consumed.pending_kg, 0::numeric) > 0::numeric then 'band_qilingan'::text
            else 'omborda'::text
        end as pallet_status,
    lr.verdict as lab_verdict,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    lr.moisture_pct,
    lr.so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    kl.partiya_no
   from chiqim_pallet_consumption c
     join chiqim_lines cl on cl.id = c.chiqim_line_id
     join chiqim_requests cr on cr.id = cl.request_id
     join finished_pallets fp on fp.barcode2 = c.barcode2
     join kirim_lines kl on kl.serial = fp.serial
     join kirim_orders ko on ko.order_id = kl.order_id
     left join lateral ( select sum(c2.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
            sum(c2.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
           from chiqim_pallet_consumption c2
             join chiqim_lines cl2 on cl2.id = c2.chiqim_line_id
             join chiqim_requests cr2 on cr2.id = cl2.request_id
             left join lateral ( select chiqim_departed_at(cr2.id) as completed_at) cgwx on true
          where c2.barcode2 = fp.barcode2) consumed on true
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial and wc2.wash_no = fp.wash_no
         limit 1) wc on true
     left join lateral ( select lr3.verdict,
            lr3.moisture_pct,
            lr3.so2_mg_kg
           from lab_results lr3
          where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
          order by lr3.created_at desc
         limit 1) lr on true
  where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 14. report_moyka_output_rows -- same fix, wash_no surfaced.
-- ============================================================
create or replace view public.report_moyka_output_rows as
 select 'moyka_output'::text as kind,
    'moyka-output-'::text || fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    fp.wash_no,
    kl.order_id,
    latest.request_id,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    null::text as plate,
    null::text as driver,
    fp.received_date as date_basis,
    'received_date'::text as date_basis_source,
    fp.weight_kg as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
        case
            when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
            when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
            when fp.status = 'storage_loss'::pallet_status then 'saqlashda_yoqolgan'::text
            when coalesce(consumed.departed_kg, 0) >= fp.weight_kg then 'jonatilgan'::text
            when coalesce(consumed.departed_kg, 0) > 0 or coalesce(consumed.pending_kg, 0) > 0 then 'band_qilingan'::text
            else 'omborda'::text
        end as pallet_status,
    lr.verdict as lab_verdict,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    lr.moisture_pct,
    lr.so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg
   from finished_pallets fp
     join kirim_lines kl on kl.serial = fp.serial
     join kirim_orders ko on ko.order_id = kl.order_id
     left join lateral (
       select
         sum(c.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
         sum(c.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
       from chiqim_pallet_consumption c
       join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
       join chiqim_requests cr2 on cr2.id = cl2.request_id
       left join lateral (
         select cgw3.completed_at from gate_weighings cgw3
         where cgw3.dir = 'chiqim'::direction and cgw3.request_id = cr2.id
         order by cgw3.completed_at desc nulls last limit 1
       ) cgwx on true
       where c.barcode2 = fp.barcode2
     ) consumed on true
     left join lateral (
       select cl3.request_id
       from chiqim_pallet_consumption c3
       join chiqim_lines cl3 on cl3.id = c3.chiqim_line_id
       where c3.barcode2 = fp.barcode2
       order by c3.created_at desc limit 1
     ) latest on true
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial and wc2.wash_no = fp.wash_no
         limit 1) wc on true
     left join lateral ( select lr2.verdict,
            lr2.moisture_pct,
            lr2.so2_mg_kg
           from lab_results lr2
          where lr2.scope = 'chiqim'::direction and lr2.wash_cycle_id = wc.id
          order by lr2.created_at desc
         limit 1) lr on true
  where ko.plate !~~ 'TEST-%'::text;

-- ============================================================
-- 15. stock_on_hand_rows -- same wash-lookup fix in pallet_base, wash_no
--     passthrough for the send-picker forms.
-- ============================================================
create or replace view public.stock_on_hand_rows as
 with pallet_base as (
         select fp.barcode2,
            fp.serial,
            ko.owner_id,
            fp.type_id,
            kl.partiya_no,
            fp.calibre_id,
            fp.received_date,
            fp.is_old_stock,
            fp.weight_is_estimate,
            fp.wash_no,
            lr.verdict,
            lr.moisture_pct as lab_moisture_pct,
            wc.id as wash_cycle_id
           from finished_pallets fp
             join kirim_lines kl on kl.serial = fp.serial
             join kirim_orders ko on ko.order_id = kl.order_id
             left join lateral ( select wc2.id
                   from wash_cycles wc2
                  where wc2.serial = fp.serial and wc2.wash_no = fp.wash_no
                 limit 1) wc on true
             left join lateral ( select lr3.verdict,
                    lr3.moisture_pct
                   from lab_results lr3
                  where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
                  order by lr3.created_at desc
                 limit 1) lr on true
          where fp.status = 'in_stock'::pallet_status and ko.plate !~~ 'TEST-%'::text
        ), lab_bucketed as (
         select
                case
                    when pallet_base.verdict = 'qayta_yuvish'::text then 'qayta_yuvish'::text
                    when pallet_base.verdict is null then 'awaiting_lab'::text
                    else null::text
                end as forced_bucket,
            pallet_base.barcode2,
            pallet_base.serial,
            pallet_base.owner_id,
            pallet_base.type_id,
            pallet_base.partiya_no,
            pallet_base.calibre_id,
            pallet_base.received_date,
            pallet_base.is_old_stock,
            pallet_base.weight_is_estimate,
            pallet_base.wash_no,
            pallet_base.lab_moisture_pct
           from pallet_base
        ), consumed_by_pallet as (
         select c.barcode2,
            sum(c.qty_kg) filter (where cgw.completed_at is not null) as departed_kg,
            sum(c.qty_kg) filter (where cgw.completed_at is null) as pending_kg
           from chiqim_pallet_consumption c
             join chiqim_lines cl on cl.id = c.chiqim_line_id
             join chiqim_requests cr on cr.id = cl.request_id
             left join lateral ( select chiqim_departed_at(cr.id) as completed_at) cgw on true
          where cr.plate !~~ 'TEST-%'::text
          group by c.barcode2
        ), pallet_qty as (
         select fp.barcode2,
            fp.weight_kg,
            coalesce(cbp.departed_kg, 0::numeric) as departed_kg,
            coalesce(cbp.pending_kg, 0::numeric) as pending_kg
           from finished_pallets fp
             left join consumed_by_pallet cbp on cbp.barcode2 = fp.barcode2
        ), pallet_rows as (
         select coalesce(lb.forced_bucket, 'available'::text) as bucket,
            lb.barcode2 as row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            greatest(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg) as qty_kg,
            lb.received_date as anchor_date,
            lb.lab_moisture_pct as moisture_pct,
            null::numeric as box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no,
            lb.wash_no
           from lab_bucketed lb
             join pallet_qty pq on pq.barcode2 = lb.barcode2
          where greatest(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg) > 0::numeric or lb.forced_bucket is not null
        union all
         select 'band_qilingan'::text as bucket,
            lb.barcode2 || ':band'::text as row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            pq.pending_kg as qty_kg,
            lb.received_date as anchor_date,
            lb.lab_moisture_pct as moisture_pct,
            null::numeric as box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no,
            lb.wash_no
           from lab_bucketed lb
             join pallet_qty pq on pq.barcode2 = lb.barcode2
          where lb.forced_bucket is null and pq.pending_kg > 0::numeric
        ), raw_rows as (
         select 'raw_not_washed'::text as bucket,
            r.row_key,
            r.serial,
            null::text as barcode2,
            r.owner_id,
            r.type_id,
            null::uuid as calibre_id,
            r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(rezka.total_rezka_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric) as qty_kg,
            r.date_basis as anchor_date,
            kirim_lr.moisture_pct,
            r.box_mass_kg,
            r.origin = 'opening_stock'::text as is_old_stock,
            false as weight_is_estimate,
            r.partiya_no,
            null::int as wash_no
           from report_kirim_rows r
             join storage_intake si on si.serial = r.serial
             left join lateral ( select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent
                   from moyka_sends ms
                  where ms.serial = r.serial) sent on true
             left join lateral ( select coalesce(sum(rs.qty_kg), 0::numeric) as total_rezka_sent
                   from rezka_sends rs
                  where rs.serial = r.serial) rezka on true
             left join lateral ( select coalesce(sum(rdl.net_kg), 0::numeric) as total_raw
                   from raw_dispatch_lines rdl
                  where rdl.serial = r.serial) raw on true
             left join lateral ( select lr4.moisture_pct
                   from lab_results lr4
                  where lr4.scope = 'kirim'::direction and lr4.parent_serial = r.serial
                  order by lr4.created_at desc
                 limit 1) kirim_lr on true
          where (r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(rezka.total_rezka_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric)) > 0::numeric and not (exists ( select 1
                   from old_stock_closeouts osc
                  where osc.kind = 'old_raw'::text and osc.owner_id = r.owner_id and osc.type_id = r.type_id))
        ), old_kn_rows as (
         select 'old_kn'::text as bucket,
            p.id::text as row_key,
            null::text as serial,
            null::text as barcode2,
            p.owner_id,
            p.type_id,
            null::uuid as calibre_id,
            p.opening_kg - coalesce(c.collected, 0::numeric) - coalesce(m.minted, 0::numeric) as qty_kg,
            null::date as anchor_date,
            null::numeric as moisture_pct,
            null::numeric as box_mass_kg,
            true as is_old_stock,
            null::boolean as weight_is_estimate,
            null::integer as partiya_no,
            null::int as wash_no
           from old_kn_pools p
             left join lateral ( select coalesce(sum(oc.collected_kg), 0::numeric) as collected
                   from old_kn_collections oc
                  where oc.pool_id = p.id) c on true
             left join lateral ( select coalesce(sum(sms.weight_kg), 0::numeric) as minted
                   from serial_mint_sources sms
                  where sms.source_kind = 'weight_pool'::text and sms.source_pool_id = p.id) m on true
          where (p.opening_kg - coalesce(c.collected, 0::numeric) - coalesce(m.minted, 0::numeric)) > 0::numeric and p.closed_at is null
        )
 select pallet_rows.bucket,
    pallet_rows.row_key,
    pallet_rows.serial,
    pallet_rows.barcode2,
    pallet_rows.owner_id,
    pallet_rows.type_id,
    pallet_rows.calibre_id,
    pallet_rows.qty_kg,
    pallet_rows.anchor_date,
    current_date - pallet_rows.anchor_date as days_held,
    (current_date - pallet_rows.anchor_date) > 90 as aged_90,
    pallet_rows.moisture_pct,
    pallet_rows.box_mass_kg,
    pallet_rows.is_old_stock,
    pallet_rows.weight_is_estimate,
    pallet_rows.partiya_no,
    pallet_rows.wash_no
   from pallet_rows
union all
 select raw_rows.bucket,
    raw_rows.row_key,
    raw_rows.serial,
    raw_rows.barcode2,
    raw_rows.owner_id,
    raw_rows.type_id,
    raw_rows.calibre_id,
    raw_rows.qty_kg,
    raw_rows.anchor_date,
    current_date - raw_rows.anchor_date as days_held,
    (current_date - raw_rows.anchor_date) > 90 as aged_90,
    raw_rows.moisture_pct,
    raw_rows.box_mass_kg,
    raw_rows.is_old_stock,
    raw_rows.weight_is_estimate,
    raw_rows.partiya_no,
    raw_rows.wash_no
   from raw_rows
union all
 select old_kn_rows.bucket,
    old_kn_rows.row_key,
    old_kn_rows.serial,
    old_kn_rows.barcode2,
    old_kn_rows.owner_id,
    old_kn_rows.type_id,
    old_kn_rows.calibre_id,
    old_kn_rows.qty_kg,
    old_kn_rows.anchor_date,
    null::integer as days_held,
    false as aged_90,
    old_kn_rows.moisture_pct,
    old_kn_rows.box_mass_kg,
    old_kn_rows.is_old_stock,
    old_kn_rows.weight_is_estimate,
    old_kn_rows.partiya_no,
    old_kn_rows.wash_no
   from old_kn_rows;

-- ============================================================
-- 16. client_panel_summary / rahbar_stock_snapshot -- moyka_lines becomes
--     an inner join to the OPEN wash (never fans out -- at most one open
--     wash per serial), sums scoped to that wash's own wash_no. A serial
--     with no open wash (fully settled, nothing new sent) now correctly
--     drops out via the inner join, same end result the original's outer
--     `where closed_at is null` filter produced -- not a behavior change,
--     just no longer fan-out-prone.
-- ============================================================
create or replace function public.client_panel_summary()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid := my_owner_id();
  v_raw_kg numeric := 0;
  v_finished_kg numeric := 0;
  v_moyka_kg numeric := 0;
  v_old jsonb;
  v_dispatched_kg numeric := 0;
begin
  if v_owner is null then
    return jsonb_build_object(
      'stock', jsonb_build_object('rawKg', 0, 'moykaKg', 0, 'finishedKg', 0, 'oldStockKg', 0),
      'dispatchedKg', 0
    );
  end if;

  select coalesce(sum(qty_kg), 0) into v_raw_kg
  from stock_on_hand_rows
  where owner_id = v_owner and bucket = 'raw_not_washed';

  select coalesce(sum(qty_kg), 0) into v_finished_kg
  from stock_on_hand_rows
  where owner_id = v_owner and barcode2 is not null and not is_old_stock;

  select coalesce(sum(greatest(sent_kg - output_kg, 0)), 0) into v_moyka_kg
  from (
    select
      kl.serial, wc.wash_no,
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
        where ms.serial = kl.serial and ms.wash_no = wc.wash_no) as sent_kg,
      (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp
        where fp.serial = kl.serial and fp.wash_no = wc.wash_no and fp.status <> 'bekor_qilindi') as output_kg
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    join wash_cycles wc on wc.serial = kl.serial and wc.closed_at is null
    where ko.owner_id = v_owner
      and ko.plate not like 'TEST-%'
      and exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
  ) moyka_lines;

  v_old := client_old_stock_breakdown();

  select coalesce(sum(cl.qty_kg), 0) into v_dispatched_kg
  from chiqim_lines cl
  join chiqim_requests cr on cr.id = cl.request_id
  where cr.owner_id = v_owner
    and cr.plate not like 'TEST-%'
    and chiqim_departed_at(cr.id) is not null;

  return jsonb_build_object(
    'stock', jsonb_build_object(
      'rawKg', v_raw_kg,
      'moykaKg', v_moyka_kg,
      'finishedKg', v_finished_kg,
      'oldStockKg', coalesce((v_old -> 'oldWashed' ->> 'totalKg')::numeric, 0) + coalesce((v_old -> 'oldKn' ->> 'totalKg')::numeric, 0)
    ),
    'dispatchedKg', v_dispatched_kg
  );
end;
$function$;

create or replace function public.rahbar_stock_snapshot(p_scope text)
returns jsonb
language sql
stable
as $function$
with scoped as (
  select *
  from stock_on_hand_rows
  where (p_scope = 'hammasi'
      or (p_scope = 'yangi' and not is_old_stock)
      or (p_scope = 'eski' and is_old_stock))
),
raw_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'raw_not_washed'
),
finished_calibred_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and not c.is_numberless
),
finished_konditirskiy_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and c.is_numberless
),
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where bucket = 'old_kn'
),
old_kn_by_type as (
  select s.type_id, pt.name as type_name, coalesce(sum(s.qty_kg), 0) as kg
  from stock_on_hand_rows s
  join product_types pt on pt.id = s.type_id
  where s.bucket = 'old_kn'
  group by s.type_id, pt.name
),
moyka_lines as (
  select
    kl.serial, wc.wash_no,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
      where ms.serial = kl.serial and ms.wash_no = wc.wash_no) as sent_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp
      where fp.serial = kl.serial and fp.wash_no = wc.wash_no and fp.status <> 'bekor_qilindi') as output_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join wash_cycles wc on wc.serial = kl.serial and wc.closed_at is null
  where exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
moykada_total as (
  select coalesce(sum(greatest(0, sent_kg - output_kg)), 0) as kg
  from moyka_lines
),
by_type as (
  select type_id, coalesce(sum(qty_kg), 0) as kg
  from scoped
  group by type_id
),
by_calibre as (
  select s.type_id, s.calibre_id, c.is_numberless, coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null
  group by s.type_id, s.calibre_id, c.is_numberless
)
select jsonb_build_object(
  'rawKg', (select kg from raw_total),
  'finishedCalibredKg', (select kg from finished_calibred_total),
  'konditirskiyKg', (select kg from finished_konditirskiy_total),
  'oldKnKg', (select kg from old_kn_total),
  'moykadaKg', (select kg from moykada_total),
  'oldKnNote', 'pool stock -- not backed by finished_pallets, structurally outside Ledger C''s coverage; shown separately, never reconciled against it',
  'totalKg', (select kg from raw_total) + (select kg from finished_calibred_total)
             + (select kg from finished_konditirskiy_total) + (select kg from old_kn_total)
             + (select kg from moykada_total),
  'byType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_type
  ),
  'byCalibre', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'typeId', type_id, 'calibreId', calibre_id, 'isNumberless', is_numberless, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_calibre
  ),
  'oldKnByType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'typeName', type_name, 'kg', kg) order by kg desc), '[]'::jsonb)
    from old_kn_by_type
  ),
  'distinctTypeCount', (select count(*) from by_type)
);
$function$;

-- ============================================================
-- 17. yield_rows -- the critical fix. finished_serials becomes one row
--     per CLOSED WASH, not per serial; every downstream CTE (output,
--     rewash_flag, calibre_breakdown, lab_readings) keys on
--     (serial, wash_no) instead of serial alone. max_cycle_no stops being
--     hardcoded to 1 -- it was always the wash's own wash_no, just never
--     had a second value to distinguish before now. Hisobot and the
--     Rahbar Yield tab will start seeing 2 rows for a 2-wash serial where
--     they saw 1 before -- flagged for the frontend batch (wash-badge
--     decision), not addressed here.
-- ============================================================
create or replace view public.yield_rows as
 with wash_base as (
         select wc.serial,
            wc.wash_no,
            wc.closed_at,
            wc.id as wash_cycle_id,
            wc.status as wash_cycle_status,
            kl.type_id,
            kl.partiya_no,
            ko.owner_id,
            ko.plate,
            ko.driver,
            rkr.qty_kg as effective_qty,
            ( select coalesce(sum(ms.qty_kg), 0::numeric) as "coalesce"
                   from moyka_sends ms
                  where ms.serial = wc.serial and ms.wash_no = wc.wash_no) as raw_consumed_kg
           from wash_cycles wc
             join kirim_lines kl on kl.serial = wc.serial
             join kirim_orders ko on ko.order_id = kl.order_id
             join report_kirim_rows rkr on rkr.serial = wc.serial
          where ko.plate !~~ 'TEST-%'::text and ko.origin <> 'opening_stock'::text
        ), finished_serials as (
         select wash_base.serial,
            wash_base.wash_no,
            wash_base.type_id,
            wash_base.partiya_no,
            wash_base.owner_id,
            wash_base.plate,
            wash_base.driver,
            wash_base.effective_qty,
            wash_base.raw_consumed_kg,
            wash_base.wash_cycle_id,
            wash_base.wash_cycle_status
           from wash_base
          where wash_base.raw_consumed_kg > 0::numeric and wash_base.closed_at is not null
        ), output as (
         select fs_1.serial,
            fs_1.wash_no,
            coalesce(sum(fp.weight_kg) filter (where not c.is_numberless and fp.status <> 'bekor_qilindi'::pallet_status), 0::numeric) as calibre_kg,
            coalesce(sum(fp.weight_kg) filter (where c.is_numberless and fp.status <> 'bekor_qilindi'::pallet_status), 0::numeric) as konditirskiy_kg,
            min(fp.received_date) as completed_date
           from finished_serials fs_1
             left join finished_pallets fp on fp.serial = fs_1.serial and fp.wash_no = fs_1.wash_no
             left join calibres c on c.id = fp.calibre_id
          group by fs_1.serial, fs_1.wash_no
        ), rewash_flag as (
         select fs_1.serial,
            fs_1.wash_no,
            (exists ( select 1
                   from lab_results lr
                  where lr.wash_cycle_id = fs_1.wash_cycle_id and lr.scope = 'chiqim'::direction and lr.verdict = 'qayta_yuvish'::text)) as rewashed
           from finished_serials fs_1
        ), calibre_breakdown as (
         select fs_1.serial,
            fs_1.wash_no,
            fp.calibre_id,
            sum(fp.weight_kg) as kg
           from finished_serials fs_1
             join finished_pallets fp on fp.serial = fs_1.serial and fp.wash_no = fs_1.wash_no
          where fp.status <> 'bekor_qilindi'::pallet_status
          group by fs_1.serial, fs_1.wash_no, fp.calibre_id
        ), lab_readings as (
         select fs_1.serial,
            fs_1.wash_no,
            ( select lr.moisture_pct
                   from lab_results lr
                  where lr.scope = 'kirim'::direction and lr.parent_serial = fs_1.serial
                  order by lr.created_at desc
                 limit 1) as intake_moisture_pct,
            ( select lr.moisture_pct
                   from lab_results lr
                  where lr.scope = 'chiqim'::direction and lr.wash_cycle_id = fs_1.wash_cycle_id
                  order by lr.created_at desc
                 limit 1) as delivered_moisture_pct
           from finished_serials fs_1
        )
 select fs.serial,
    fs.type_id,
    fs.owner_id,
    fs.plate,
    fs.driver,
    fs.effective_qty as raw_received_kg,
    fs.raw_consumed_kg,
    fs.raw_consumed_kg - fs.effective_qty as raw_overage_kg,
    o.completed_date,
    fs.wash_no as max_cycle_no,
    rf.rewashed,
    o.calibre_kg as live_calibre_kg,
    o.konditirskiy_kg as live_konditirskiy_kg,
    o.calibre_kg + o.konditirskiy_kg as output_kg,
    fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg as loss_kg,
        case
            when fs.raw_consumed_kg > 0::numeric then round((fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1)
            else 0::numeric
        end as loss_pct,
        case
            when fs.raw_consumed_kg > 0::numeric then round((o.calibre_kg + o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1)
            else 0::numeric
        end as gross_yield_pct,
    lab.intake_moisture_pct,
    lab.delivered_moisture_pct,
    lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null as dry_matter_available,
        case
            when lab.intake_moisture_pct is not null then round(fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric), 1)
            else null::numeric
        end as dry_matter_in_kg,
        case
            when lab.delivered_moisture_pct is not null then round((o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric), 1)
            else null::numeric
        end as dry_matter_out_kg,
        case
            when lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null and (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) > 0::numeric then round((fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric) - (o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric)) / (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) * 100::numeric, 1)
            else null::numeric
        end as true_loss_pct,
    ( select coalesce(jsonb_agg(jsonb_build_object('calibreId', cb.calibre_id, 'kg', cb.kg, 'pct',
                case
                    when (o.calibre_kg + o.konditirskiy_kg) > 0::numeric then round(cb.kg / (o.calibre_kg + o.konditirskiy_kg) * 100::numeric, 1)
                    else 0::numeric
                end) order by cb.kg desc), '[]'::jsonb) as "coalesce"
           from calibre_breakdown cb
          where cb.serial = fs.serial and cb.wash_no = fs.wash_no) as calibre_mix,
    fs.partiya_no
   from finished_serials fs
     join output o on o.serial = fs.serial and o.wash_no = fs.wash_no
     join rewash_flag rf on rf.serial = fs.serial and rf.wash_no = fs.wash_no
     join lab_readings lab on lab.serial = fs.serial and lab.wash_no = fs.wash_no;

-- ============================================================
-- 18. wip_rows -- moyka_not_returned/awaiting_lab/so2_pending scoped to
--     the open wash and its own wash_no (was implicitly relying on
--     kirim_line_state's single-row assumption / an unscoped ms_first).
-- ============================================================
create or replace view public.wip_rows as
 with limits as (
         select ( select settings_limits.value
                   from settings_limits
                  where settings_limits.key = 'raw_idle_days'::text) as raw_idle_days,
            ( select settings_limits.value
                   from settings_limits
                  where settings_limits.key = 'moyka_idle_days'::text) as moyka_idle_days,
            ( select settings_limits.value
                   from settings_limits
                  where settings_limits.key = 'tahlil_kechikdi_days'::text) as tahlil_kechikdi_days,
            ( select settings_limits.value
                   from settings_limits
                  where settings_limits.key = 'sulfur_overdue_days'::text) as sulfur_overdue_days,
            ( select settings_limits.value
                   from settings_limits
                  where settings_limits.key = 'chiqim_idle_days'::text) as chiqim_idle_days
        ), raw_not_sent as (
         select 'raw_not_sent'::text as wip_kind,
            r.row_key,
            r.serial,
            null::uuid as request_id,
            r.owner_id,
            r.type_id,
            current_date - (si.confirmed_at at time zone 'utc'::text)::date as days_waiting,
            l.raw_idle_days::integer as threshold_days,
            r.partiya_no
           from report_kirim_rows r
             join storage_intake si on si.serial = r.serial
             left join lateral ( select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent
                   from moyka_sends ms
                  where ms.serial = r.serial) sent on true
             left join lateral ( select coalesce(sum(rs.qty_kg), 0::numeric) as total_rezka_sent
                   from rezka_sends rs
                  where rs.serial = r.serial) rezka on true
             left join lateral ( select coalesce(sum(rdl.net_kg), 0::numeric) as total_raw
                   from raw_dispatch_lines rdl
                  where rdl.serial = r.serial) raw on true
             cross join limits l
          where (r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(rezka.total_rezka_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric)) > 0::numeric and r.origin <> 'opening_stock'::text and (current_date - (si.confirmed_at at time zone 'utc'::text)::date)::numeric > l.raw_idle_days
        ), moyka_not_returned as (
         select 'moyka_not_returned'::text as wip_kind,
            wc.serial as row_key,
            wc.serial,
            null::uuid as request_id,
            ko.owner_id,
            kl.type_id,
            current_date - ms_first.first_sent_date as days_waiting,
            l.moyka_idle_days::integer as threshold_days,
            kl.partiya_no
           from wash_cycles wc
             join kirim_lines kl on kl.serial = wc.serial
             join kirim_orders ko on ko.order_id = kl.order_id
             join lateral ( select min(ms.sent_date) as first_sent_date
                   from moyka_sends ms
                  where ms.serial = wc.serial and ms.wash_no = wc.wash_no) ms_first on true
             cross join limits l
          where wc.closed_at is null
            and greatest(0, kirim_line_moyka_asof(wc.serial, current_date)) > 0::numeric
            and ko.plate !~~ 'TEST-%'::text
            and (current_date - ms_first.first_sent_date)::numeric > l.moyka_idle_days
        ), awaiting_lab as (
         select 'awaiting_lab'::text as wip_kind,
            wc.serial as row_key,
            wc.serial,
            null::uuid as request_id,
            ko.owner_id,
            kl.type_id,
            current_date - ms_first.sent_date as days_waiting,
            l.tahlil_kechikdi_days::integer as threshold_days,
            kl.partiya_no
           from wash_cycles wc
             join kirim_lines kl on kl.serial = wc.serial
             join kirim_orders ko on ko.order_id = kl.order_id
             join lateral ( select min(ms2.sent_date) as sent_date
                   from moyka_sends ms2
                  where ms2.serial = wc.serial and ms2.wash_no = wc.wash_no) ms_first on true
             cross join limits l
          where wc.closed_at is null
            and not (exists ( select 1
                   from lab_results lr
                  where lr.scope = 'chiqim'::direction and lr.wash_cycle_id = wc.id)) and ko.plate !~~ 'TEST-%'::text and (current_date - ms_first.sent_date)::numeric > l.tahlil_kechikdi_days
        ), so2_pending as (
         select 'so2_pending'::text as wip_kind,
            wc.serial as row_key,
            wc.serial,
            null::uuid as request_id,
            ko.owner_id,
            kl.type_id,
            current_date - lr.sample_date as days_waiting,
            l.sulfur_overdue_days::integer as threshold_days,
            kl.partiya_no
           from wash_cycles wc
             join kirim_lines kl on kl.serial = wc.serial
             join kirim_orders ko on ko.order_id = kl.order_id
             join lateral ( select lr2.sample_date,
                    lr2.status
                   from lab_results lr2
                  where lr2.scope = 'chiqim'::direction and lr2.wash_cycle_id = wc.id
                  order by lr2.created_at desc
                 limit 1) lr on true
             cross join limits l
          where wc.closed_at is null
            and lr.status = 'moisture_in'::text and kl.is_sulfured is distinct from false and ko.plate !~~ 'TEST-%'::text and (current_date - lr.sample_date)::numeric > l.sulfur_overdue_days
        ), chiqim_open as (
         select 'chiqim_open'::text as wip_kind,
            cr.id::text as row_key,
            null::text as serial,
            cr.id as request_id,
            cr.owner_id,
            null::uuid as type_id,
            current_date - (cr.created_at at time zone 'utc'::text)::date as days_waiting,
            l.chiqim_idle_days::integer as threshold_days,
            null::integer as partiya_no
           from chiqim_requests cr
             left join lateral ( select chiqim_departed_at(cr.id) as completed_at) cgw on true
             cross join limits l
          where not (cr.ombor_finished_at is not null and cgw.completed_at is not null) and cr.plate !~~ 'TEST-%'::text and (current_date - (cr.created_at at time zone 'utc'::text)::date)::numeric > l.chiqim_idle_days
        ), provisional_weight as (
         select 'provisional_weight'::text as wip_kind,
            r.row_key,
            r.serial,
            null::uuid as request_id,
            r.owner_id,
            r.type_id,
            null::integer as days_waiting,
            null::integer as threshold_days,
            r.partiya_no
           from report_kirim_rows r
          where r.provisional
        )
 select raw_not_sent.wip_kind, raw_not_sent.row_key, raw_not_sent.serial, raw_not_sent.request_id, raw_not_sent.owner_id, raw_not_sent.type_id, raw_not_sent.days_waiting, raw_not_sent.threshold_days, raw_not_sent.partiya_no
   from raw_not_sent
union all
 select moyka_not_returned.wip_kind, moyka_not_returned.row_key, moyka_not_returned.serial, moyka_not_returned.request_id, moyka_not_returned.owner_id, moyka_not_returned.type_id, moyka_not_returned.days_waiting, moyka_not_returned.threshold_days, moyka_not_returned.partiya_no
   from moyka_not_returned
union all
 select awaiting_lab.wip_kind, awaiting_lab.row_key, awaiting_lab.serial, awaiting_lab.request_id, awaiting_lab.owner_id, awaiting_lab.type_id, awaiting_lab.days_waiting, awaiting_lab.threshold_days, awaiting_lab.partiya_no
   from awaiting_lab
union all
 select so2_pending.wip_kind, so2_pending.row_key, so2_pending.serial, so2_pending.request_id, so2_pending.owner_id, so2_pending.type_id, so2_pending.days_waiting, so2_pending.threshold_days, so2_pending.partiya_no
   from so2_pending
union all
 select chiqim_open.wip_kind, chiqim_open.row_key, chiqim_open.serial, chiqim_open.request_id, chiqim_open.owner_id, chiqim_open.type_id, chiqim_open.days_waiting, chiqim_open.threshold_days, chiqim_open.partiya_no
   from chiqim_open
union all
 select provisional_weight.wip_kind, provisional_weight.row_key, provisional_weight.serial, provisional_weight.request_id, provisional_weight.owner_id, provisional_weight.type_id, provisional_weight.days_waiting, provisional_weight.threshold_days, provisional_weight.partiya_no
   from provisional_weight;

-- ============================================================
-- 19. get_serial_passport -- cycles array stops hardcoding cycleNo=1;
--     one genuine entry per wash, each with its own sent/returned/lab
--     figures instead of all cycles sharing the serial's lifetime totals.
-- ============================================================
create or replace function public.get_serial_passport(p_serial text)
returns jsonb
language sql
stable
as $function$
with target_line as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
  where kl.serial = p_serial
),
gate_kirim as (
  select gw.*
  from gate_weighings gw, target_line tl
  where gw.dir = 'kirim' and gw.order_id = tl.order_id
  order by gw.stage1_completed_at desc nulls last
  limit 1
),
intake_row as (
  select * from storage_intake where serial = p_serial
),
kirim_lab as (
  select * from lab_results where scope = 'kirim' and parent_serial = p_serial
  order by created_at desc limit 1
),
washes as (
  select wc.*, row_number() over (order by wc.wash_no) as cycle_no
  from wash_cycles wc where wc.serial = p_serial
),
wash_sends as (
  select w.wash_no, coalesce(sum(ms.qty_kg),0) as sent_kg
  from washes w left join moyka_sends ms on ms.serial = w.serial and ms.wash_no = w.wash_no
  group by w.wash_no
),
wash_output as (
  select w.wash_no, coalesce(sum(fp.weight_kg),0) as returned_kg
  from washes w left join finished_pallets fp
    on fp.serial = w.serial and fp.wash_no = w.wash_no and fp.status <> 'bekor_qilindi'
  group by w.wash_no
),
wash_lab as (
  select w.wash_no, lr.verdict, lr.moisture_pct, lr.so2_mg_kg, lr.sample_date, lr.sample_photo, lr.note, lr.tested_by
  from washes w
  left join lateral (
    select * from lab_results lr2 where lr2.scope='chiqim' and lr2.wash_cycle_id = w.id
    order by lr2.created_at desc limit 1
  ) lr on true
),
sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from moyka_sends where serial = p_serial
),
rezka_sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from rezka_sends where serial = p_serial
),
pallets as (
  select rcr.* from report_chiqim_rows rcr where rcr.serial = p_serial
),
dispatch_ids as (
  select distinct cl.request_id
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
dispatch_gate as (
  select
    di.request_id,
    gw.gruzheny_kg, gw.pustoy_kg, gw.net_kg,
    gw.stage1_completed_at, gw.stage1_created_by, gw.stage1_plate_photo, gw.stage1_scale_photo,
    gw.completed_at, gw.stage2_created_by, gw.stage2_scale_photo, gw.departure_doc_photo
  from dispatch_ids di
  left join lateral (
    select * from gate_weighings gw2
    where gw2.dir = 'chiqim' and gw2.request_id = di.request_id
    order by gw2.completed_at desc nulls last
    limit 1
  ) gw on true
),
dispatch_pallets as (
  select cl.request_id, c.barcode2, c.created_at as loaded_at, fp.calibre_id, c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
raw_dispatches as (
  select rdl.id, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, rdl.loaded_at,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where rdl.serial = p_serial
),
mint_pallet_sources as (
  select sms.source_barcode2, fp.weight_kg as book_weight_kg, fp.calibre_id, fp.serial as source_serial
  from serial_mint_sources sms
  join finished_pallets fp on fp.barcode2 = sms.source_barcode2
  where sms.minted_serial = p_serial and sms.source_kind = 'pallet'
),
mint_pool_sources as (
  select sms.source_pool_id, sms.weight_kg, p.type_id
  from serial_mint_sources sms
  join old_kn_pools p on p.id = sms.source_pool_id
  where sms.minted_serial = p_serial and sms.source_kind = 'weight_pool'
),
raw_received as (
  select rkr.qty_kg as received_kg
  from report_kirim_rows rkr where rkr.serial = p_serial
),
raw_dispatched_total as (
  select coalesce(sum(rdl.net_kg), 0) as kg from raw_dispatch_lines rdl where rdl.serial = p_serial
),
raw_closeout as (
  select osc.closed_at
  from target_line tl2
  join kirim_orders ko2 on ko2.order_id = tl2.order_id
  join old_stock_closeouts osc on osc.kind = 'old_raw' and osc.owner_id = ko2.owner_id and osc.type_id = tl2.type_id
),
raw_still as (
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where serial = p_serial and bucket = 'raw_not_washed'
),
raw_storage_loss as (
  select
    (select closed_at from raw_closeout) as closed_at,
    case when (select closed_at from raw_closeout) is not null
      then greatest(0, coalesce((select received_kg from raw_received), 0) - (select sent_kg from sends_total) - (select sent_kg from rezka_sends_total) - (select kg from raw_dispatched_total))
      else 0
    end as kg
),
finished_returned_total as (
  select coalesce(sum(weight_kg), 0) as kg from finished_pallets
  where serial = p_serial and status <> 'bekor_qilindi'
),
finished_dispatched_total as (
  select coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and chiqim_departed_at(cr.id) is not null
),
finished_dispatched_by_calibre as (
  select cl.calibre_id, coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and chiqim_departed_at(cr.id) is not null
  group by cl.calibre_id
),
finished_storage_loss_pallets as (
  select fp.barcode2, fp.calibre_id, fp.weight_kg, fp.voided_at
  from finished_pallets fp
  where fp.serial = p_serial and fp.status = 'storage_loss'
),
finished_other_total as (
  select
    coalesce(sum(weight_kg) filter (where status = 'consumed'), 0) as consumed_kg,
    coalesce(sum(weight_kg) filter (where status = 'bekor_qilindi'), 0) as voided_kg
  from finished_pallets where serial = p_serial
),
finished_still as (
  select
    coalesce(sum(qty_kg), 0) as total_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'awaiting_lab'), 0) as awaiting_lab_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'qayta_yuvish'), 0) as needs_rewash_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
),
finished_still_by_calibre as (
  select calibre_id,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket in ('awaiting_lab', 'qayta_yuvish')), 0) as under_review_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
  group by calibre_id
),
storage_loss_events as (
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object('kind', 'old_washed', 'barcode2', slp.barcode2, 'calibreId', slp.calibre_id, 'weightKg', slp.weight_kg, 'voidedAt', slp.voided_at)
        order by slp.barcode2
      ) from finished_storage_loss_pallets slp
    ), '[]'::jsonb)
    ||
    case when (select closed_at from raw_storage_loss) is not null
      then jsonb_build_array(jsonb_build_object(
        'kind', 'old_raw', 'closedAt', (select closed_at from raw_storage_loss), 'weightKg', (select kg from raw_storage_loss),
        'note', 'Bu turdagi eski xom ashyo yakunlandi -- ko''rsatilgan miqdor shu seriyaning taxminiy ulushi'
      ))
      else '[]'::jsonb
    end as events
),
pending_raw as (
  select distinct cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from chiqim_line_raw_serials clrs
  join chiqim_lines cl on cl.id = clrs.line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where clrs.serial = p_serial
    and cr.voided_at is null
    and cr.ombor_finished_at is null
    and not exists (select 1 from raw_dispatch_lines rdl2 where rdl2.chiqim_line_id = clrs.line_id and rdl2.serial = p_serial)
),
pending_dispatches as (
  select
    (select coalesce(jsonb_agg(
      jsonb_build_object('kind', 'raw', 'requestId', pr.request_id, 'requestDate', pr.request_date, 'plate', pr.plate, 'driver', pr.driver)
      order by pr.request_date desc
    ), '[]'::jsonb) from pending_raw pr)
    as events
)
select jsonb_build_object(
  'serial', p_serial,
  'order', (
    select jsonb_build_object(
      'orderId', ko.order_id, 'ownerId', ko.owner_id, 'ownerName', o.name, 'plate', ko.plate, 'driver', ko.driver,
      'orderDate', ko.order_date, 'declaredQty', tl.declared_qty, 'declaredTotal', ko.declared_total,
      'isMultiLine', tl.line_count > 1, 'targetMoisturePct', tl.target_moisture_pct, 'targetSo2MgKg', tl.target_so2_mg_kg, 'typeId', tl.type_id,
      'partiyaNo', tl.partiya_no,
      'docPhoto', ko.doc_photo, 'isOldStock', ko.origin = 'opening_stock',
      'isMinted', ko.origin = 'internal_reprocess'
    )
    from target_line tl
    join kirim_orders ko on ko.order_id = tl.order_id
    left join owners o on o.id = ko.owner_id
  ),
  'effectiveQty', (
    select jsonb_build_object(
      'valueKg', rkr.qty_kg, 'provisional', rkr.provisional,
      'truckVarianceDiffKg', rkr.truck_variance_diff_kg, 'truckVarianceDiffPct', rkr.truck_variance_diff_pct
    )
    from report_kirim_rows rkr where rkr.serial = p_serial
  ),
  'gate', (
    select jsonb_build_object(
      'gruzhenyKg', gk.gruzheny_kg, 'pustoyKg', gk.pustoy_kg, 'netKg', gk.net_kg,
      'stage1CompletedAt', gk.stage1_completed_at, 'stage1CreatedByName', p1.full_name,
      'stage1PlatePhoto', gk.stage1_plate_photo, 'stage1ScalePhoto', gk.stage1_scale_photo,
      'stage2CompletedAt', gk.completed_at, 'stage2CreatedByName', p2.full_name,
      'stage2ScalePhoto', gk.stage2_scale_photo, 'departureDocPhoto', gk.departure_doc_photo
    )
    from gate_kirim gk
    left join profiles p1 on p1.id = gk.stage1_created_by
    left join profiles p2 on p2.id = gk.stage2_created_by
  ),
  'intake', (
    select jsonb_build_object(
      'actualQty', ir.actual_qty, 'confirmedAt', ir.confirmed_at, 'confirmedByName', p3.full_name,
      'barcode1', ir.barcode1, 'pilePhoto', ir.pile_photo, 'komment', ir.komment,
      'boxMassKg', ir.box_mass_kg
    )
    from intake_row ir
    left join profiles p3 on p3.id = ir.confirmed_by
  ),
  'kirimLab', (
    select jsonb_build_object(
      'sampleDate', kl.sample_date, 'moisturePct', kl.moisture_pct, 'so2MgKg', kl.so2_mg_kg,
      'testedByName', p4.full_name, 'samplePhoto', kl.sample_photo, 'note', kl.note
    )
    from kirim_lab kl
    left join profiles p4 on p4.id = kl.tested_by
  ),
  'cycles', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'cycleNo', w.cycle_no,
        'sentKg', ws.sent_kg,
        'inMoykaKg', case when w.closed_at is not null then 0 else greatest(0, ws.sent_kg - wo.returned_kg) end,
        'lossKg', case when w.closed_at is not null then ws.sent_kg - wo.returned_kg else null end,
        'isRealized', w.closed_at is not null,
        'closedAt', w.closed_at,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'barcode2', pl.barcode2, 'calibreId', pl.calibre_id, 'weightKg', pl.qty_kg,
              'palletStatus', pl.pallet_status, 'voidSuccessorBarcodes', pl.void_successor_barcodes
            ) order by pl.barcode2
          ), '[]'::jsonb)
          from pallets pl where pl.wash_no = w.wash_no
        ),
        'lab', (
          select jsonb_build_object(
            'verdict', wl.verdict, 'moisturePct', wl.moisture_pct, 'so2MgKg', wl.so2_mg_kg,
            'sampleDate', wl.sample_date, 'testedByName', p5.full_name, 'samplePhoto', wl.sample_photo, 'note', wl.note
          )
          from wash_lab wl
          left join profiles p5 on p5.id = wl.tested_by
          where wl.wash_no = w.wash_no and wl.verdict is not null
        )
      ) order by w.wash_no
    ), '[]'::jsonb)
    from washes w
    join wash_sends ws on ws.wash_no = w.wash_no
    join wash_output wo on wo.wash_no = w.wash_no
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'status', cr.status, 'omborFinishedAt', cr.ombor_finished_at, 'omborFinishedByName', p6.full_name,
        'truckType', cr.truck_type,
        'loadedKg', chiqim_request_loaded_kg(cr.id),
        'departedAt', chiqim_departed_at(cr.id),
        'photos', case when cr.truck_type = 'fura' then (
          select jsonb_build_object('kirdi', fph.kirdi_photo, 'chiqdi', fph.chiqdi_photo)
          from chiqim_fura_photo_paths(cr.id) fph
        ) else null end,
        'gate', jsonb_build_object(
          'gruzhenyKg', dg.gruzheny_kg, 'pustoyKg', dg.pustoy_kg, 'netKg', dg.net_kg,
          'stage1CompletedAt', dg.stage1_completed_at, 'stage1CreatedByName', p7.full_name,
          'stage1PlatePhoto', dg.stage1_plate_photo, 'stage1ScalePhoto', dg.stage1_scale_photo,
          'stage2CompletedAt', dg.completed_at, 'stage2CreatedByName', p8.full_name,
          'stage2ScalePhoto', dg.stage2_scale_photo, 'departureDocPhoto', dg.departure_doc_photo
        ),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', dp.barcode2, 'calibreId', dp.calibre_id, 'weightKg', dp.weight_kg, 'loadedAt', dp.loaded_at)
            order by dp.loaded_at
          ), '[]'::jsonb)
          from dispatch_pallets dp where dp.request_id = cr.id
        )
      ) order by cr.request_date desc
    ), '[]'::jsonb)
    from dispatch_ids di
    join chiqim_requests cr on cr.id = di.request_id
    left join dispatch_gate dg on dg.request_id = di.request_id
    left join profiles p6 on p6.id = cr.ombor_finished_by
    left join profiles p7 on p7.id = dg.stage1_created_by
    left join profiles p8 on p8.id = dg.stage2_created_by
  ),
  'dispatchedByCalibre', (
    select coalesce(jsonb_agg(
      jsonb_build_object('calibreId', fdbc.calibre_id, 'kg', fdbc.kg)
      order by fdbc.calibre_id
    ), '[]'::jsonb)
    from finished_dispatched_by_calibre fdbc
  ),
  'rawDispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', rd.request_id, 'requestDate', rd.request_date, 'plate', rd.plate, 'driver', rd.driver,
        'weightKg', rd.weight_kg, 'boxMassKg', rd.box_mass_kg, 'netKg', rd.net_kg, 'loadedAt', rd.loaded_at
      ) order by rd.loaded_at desc
    ), '[]'::jsonb)
    from raw_dispatches rd
  ),
  'mintOrigin', (
    select case when (select count(*) from serial_mint_sources where minted_serial = p_serial) = 0
      then null
      else jsonb_build_object(
        'palletCount',  (select count(*) from mint_pallet_sources),
        'bookTotalKg',  (select coalesce(sum(book_weight_kg), 0) from mint_pallet_sources),
        'poolDrawKg',   (select coalesce(sum(weight_kg), 0) from mint_pool_sources),
        'sentWeighedKg',(select sent_kg from sends_total) + (select sent_kg from rezka_sends_total),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', mps.source_barcode2, 'bookWeightKg', mps.book_weight_kg,
                               'calibreId', mps.calibre_id, 'sourceSerial', mps.source_serial)
            order by mps.source_barcode2
          ), '[]'::jsonb) from mint_pallet_sources mps
        )
      )
    end
  ),
  'notes', (
    select coalesce(jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at, 'authorName', pr.full_name)
      order by n.created_at
    ), '[]'::jsonb)
    from notes n
    left join profiles pr on pr.id = n.author
    where n.entity_type = 'moyka' and n.entity_id = p_serial
  ),
  'joriyHolat', jsonb_build_object(
    'raw', jsonb_build_object(
      'receivedKg', coalesce((select received_kg from raw_received), 0),
      'sentToMoykaKg', (select sent_kg from sends_total),
      'collectedRawKg', (select kg from raw_dispatched_total),
      'storageLossKg', (select kg from raw_storage_loss),
      'storageLossClosedAt', (select closed_at from raw_storage_loss),
      'stillInStorageKg', (select kg from raw_still)
    ),
    'finished', jsonb_build_object(
      'returnedKg', (select kg from finished_returned_total),
      'dispatchedKg', (select kg from finished_dispatched_total),
      'storageLossKg', (select coalesce(sum(weight_kg), 0) from finished_storage_loss_pallets),
      'consumedKg', (select consumed_kg from finished_other_total),
      'voidedKg', (select voided_kg from finished_other_total),
      'stillInStorageKg', (select total_kg from finished_still),
      'stillInStorageBreakdown', jsonb_build_object(
        'availableKg', (select available_kg from finished_still),
        'reservedKg', (select reserved_kg from finished_still),
        'awaitingLabKg', (select awaiting_lab_kg from finished_still),
        'needsRewashKg', (select needs_rewash_kg from finished_still)
      ),
      'byCalibre', (
        select coalesce(jsonb_agg(
          jsonb_build_object('calibreId', fsc.calibre_id, 'availableKg', fsc.available_kg, 'reservedKg', fsc.reserved_kg, 'underReviewKg', fsc.under_review_kg)
          order by fsc.calibre_id
        ), '[]'::jsonb)
        from finished_still_by_calibre fsc
      )
    )
  ),
  'storageLossEvents', (select events from storage_loss_events),
  'pendingDispatches', (select events from pending_dispatches)
);
$function$;
