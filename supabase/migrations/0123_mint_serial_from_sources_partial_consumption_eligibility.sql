-- Fix: Eski zaxirani Moykaga yuborish (OldStockToMoykaForm / send_old_stock_to_moyka)
-- was rejecting old-stock pallets that stock_on_hand_rows itself already shows as
-- legitimately available. docs/decisions/0190.
--
-- Repro (live data, before this fix): Subxon / Global Export Company / Kalibr 6,
-- pallet PLT-020826-034-06-5. weight_kg=720, 700kg already departed via a completed
-- fura chiqim request (20260910, gate-completed 2026-09-10), 0kg pending -- 20kg
-- genuinely remains and stock_on_hand_rows correctly shows it in bucket='available'
-- (GREATEST(0, weight_kg - departed_kg - pending_kg) = 20). Ombor picked it alongside
-- 4 full 720kg pallets (~2,900 kg total, matching the book figure on screen) and
-- submitted with a real 2900 kg scale reading -- mint_serial_from_sources rejected
-- the whole batch: 'Pallet mavjud emas, boshqa so''rovga band qilingan yoki
-- allaqachon ishlatilgan (4 / 5 yaroqli)', surfaced to Ombor as the generic
-- "Saqlashda xatolik yuz berdi." fallback.
--
-- Cause: mint_serial_from_sources' pallet-eligibility check excluded any pallet with
-- *any* row at all in chiqim_pallet_consumption ("not exists (select 1 from
-- chiqim_pallet_consumption cpc where cpc.barcode2 = fp.barcode2)"). That boolean
-- shape predates chiqim's move to fractional/partial pallet consumption (0087) --
-- migration 0091 only swapped the dead chiqim_line_pallets/dispatch_manifest names
-- for chiqim_pallet_consumption, it didn't re-derive the check for partial
-- quantities. So a pallet that has been *partially* and fully-departed-dispatched,
-- with real weight still sitting on the floor, was permanently disqualified from
-- ever being re-minted -- even though OldStockToMoykaForm's own comment says this
-- RPC "re-checks all of it server-side" against the same availability
-- stock_on_hand_rows already computed for the picker.
--
-- Fix: mirror stock_on_hand_rows' own consumed_by_pallet math (chiqim_departed_at(),
-- same TEST-% exclusion) instead of a bare existence check --
--   pending_kg (active, not-yet-departed reservation) must be 0 -- the mint below
--     consumes the WHOLE barcode in one shot, so re-minting out from under a live
--     reservation would silently steal material already committed to that chiqim
--     request; this is intentionally stricter than stock_on_hand_rows' 'available'
--     bucket, which can still show a net-positive remainder alongside a separate
--     'band_qilingan' pending amount on the same pallet -- fine for *display*, not
--     safe for a whole-unit consume-and-remint.
--   weight_kg - departed_kg (completed/departed consumption only) must be > 0 --
--     the same "does the book weight still have anything left" test stock_on_hand_
--     rows uses for a fully-departed pallet.
-- serial_mint_sources exclusion (already-minted) is unchanged.

create or replace function public.mint_serial_from_sources(
  p_owner_id        uuid,
  p_type_id         uuid,
  p_declared_qty    numeric,
  p_pallet_barcodes text[]  default null,
  p_pool_id         uuid    default null,
  p_pool_weight_kg  numeric default null
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_kind      text;
  v_serial    text;
  v_order_id  uuid;
  v_actor     uuid := auth.uid();
  v_ok        int;
  v_expected  int;
  v_raw       int;
  v_available numeric;
begin
  -- SECURITY DEFINER bypasses RLS, so the role gate is explicit and
  -- mandatory. kirim_orders/kirim_lines are menejer-insert-only under RLS;
  -- this function is the ONLY way Ombor may mint, and it is the reason the
  -- function has to be definer in the first place.
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor qayta ishlash uchun seriya ocha oladi' using errcode = '42501';
  end if;
  if p_declared_qty is null or p_declared_qty <= 0 then
    raise exception 'Og''irlik kiritilmagan' using errcode = '22023';
  end if;

  -- exactly one source shape
  if coalesce(array_length(p_pallet_barcodes, 1), 0) > 0
     and (p_pool_id is not null or p_pool_weight_kg is not null) then
    raise exception 'Bir vaqtda ikkala manba turini berib bo''lmaydi' using errcode = '22023';
  elsif coalesce(array_length(p_pallet_barcodes, 1), 0) > 0 then
    v_kind := 'pallet';
  elsif p_pool_id is not null and coalesce(p_pool_weight_kg, 0) > 0 then
    v_kind := 'weight_pool';
  else
    raise exception 'Manba ko''rsatilmagan' using errcode = '22023';
  end if;

  if v_kind = 'pallet' then
    select count(*), count(distinct b) into v_raw, v_expected from unnest(p_pallet_barcodes) b;
    if v_raw <> v_expected then
      raise exception 'Bir pallet ro''yxatda takrorlangan' using errcode = '22023';
    end if;

    -- Lock the candidates in a deterministic order first: two concurrent
    -- mints must never consume the same pallet, and ordering the lock
    -- acquisition avoids a deadlock between overlapping sets. The unique
    -- partial index on serial_mint_sources is the real backstop; this is
    -- what turns a race into a clean error message instead of a 23505.
    perform 1 from finished_pallets
      where barcode2 = any(p_pallet_barcodes) order by barcode2 for update;

    select count(*) into v_ok
      from finished_pallets fp
      join kirim_lines kl  on kl.serial   = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
      left join lateral (
        select
          coalesce(sum(c.qty_kg) filter (where chiqim_departed_at(cr.id) is not null), 0) as departed_kg,
          coalesce(sum(c.qty_kg) filter (where chiqim_departed_at(cr.id) is null), 0)     as pending_kg
        from chiqim_pallet_consumption c
        join chiqim_lines cl2   on cl2.id = c.chiqim_line_id
        join chiqim_requests cr on cr.id = cl2.request_id
        where c.barcode2 = fp.barcode2
          and cr.plate !~~ 'TEST-%'
      ) cons on true
     where fp.barcode2 = any(p_pallet_barcodes)
       and fp.status   = 'in_stock'
       and ko.owner_id = p_owner_id
       and fp.type_id  = p_type_id
       and coalesce(cons.pending_kg, 0) = 0
       and fp.weight_kg - coalesce(cons.departed_kg, 0) > 0
       and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2);

    if v_ok <> v_expected then
      raise exception
        'Pallet mavjud emas, boshqa so''rovga band qilingan yoki allaqachon ishlatilgan (% / % yaroqli)',
        v_ok, v_expected using errcode = '23514';
    end if;
  else
    -- The generalized pool balance, identical to stock_on_hand_rows'
    -- old_kn_rows formula. No caller in Stage 3; Rezka is the first.
    select p.opening_kg
         - coalesce((select sum(oc.collected_kg) from old_kn_collections oc
                      where oc.pool_id = p.id), 0)
         - coalesce((select sum(s.weight_kg) from serial_mint_sources s
                      where s.source_kind = 'weight_pool' and s.source_pool_id = p.id), 0)
      into v_available
      from old_kn_pools p
     where p.id = p_pool_id and p.owner_id = p_owner_id and p.type_id = p_type_id
     for update;
    if v_available is null then
      raise exception 'Havza topilmadi' using errcode = '23503';
    end if;
    if p_pool_weight_kg > v_available then
      raise exception 'Havzada yetarli emas: % kg mavjud, % kg so''raldi',
        v_available, p_pool_weight_kg using errcode = '23514';
    end if;
  end if;

  -- The minted anchor. order_date is TODAY and honest -- unlike Stage 1's
  -- deliberately backdated seed, this event really is happening now, which
  -- is exactly why internal_reprocess must keep counting in yield/loss/
  -- re-wash trends while opening_stock must not.
  --
  -- Sentinel plate/driver chosen to NOT start with 'TEST-' (every report
  -- filters that prefix). status='qabul_qilindi', never the 'kutilmoqda'
  -- default: this order was never pending at a gate. No storage_intake and
  -- no gate_weighings row by design -- giving it either would materialise
  -- phantom raw stock in qoldig'i and the client report, the exact Stage 1
  -- trap. Its raw balance is meant to be zero: it is minted and sent in the
  -- same breath.
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, origin, status, created_by)
  values ((now() at time zone 'Asia/Tashkent')::date, 'QAYTA-ISHLASH', 'Ichki qayta ishlash',
          p_owner_id, null, 'internal_reprocess', 'qabul_qilindi', v_actor)
  returning order_id into v_order_id;

  insert into kirim_lines (order_id, type_id, declared_qty)
  values (v_order_id, p_type_id, p_declared_qty)
  returning serial into v_serial;

  if v_kind = 'pallet' then
    update finished_pallets set status = 'consumed' where barcode2 = any(p_pallet_barcodes);
    insert into serial_mint_sources (minted_serial, source_kind, source_barcode2, created_by)
    select v_serial, 'pallet', b, v_actor from unnest(p_pallet_barcodes) b;
  else
    insert into serial_mint_sources (minted_serial, source_kind, source_pool_id, weight_kg, created_by)
    values (v_serial, 'weight_pool', p_pool_id, p_pool_weight_kg, v_actor);
  end if;

  return v_serial;
end
$function$;
