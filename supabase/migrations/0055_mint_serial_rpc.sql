-- Opening stock, Stage 3 (2026-08-02). Two functions, deliberately split:
--   mint_serial_from_sources  -- GENERIC. Rezka reuses this unchanged.
--   send_old_stock_to_moyka   -- old-stock-specific wrapper, one transaction.
-- Keeping the generic mint free of any Moyka knowledge is the whole point:
-- Rezka sends its minted serial to cutting, not washing.

create or replace function mint_serial_from_sources(
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
     where fp.barcode2 = any(p_pallet_barcodes)
       and fp.status   = 'in_stock'
       and ko.owner_id = p_owner_id
       and fp.type_id  = p_type_id
       and not exists (select 1 from dispatch_manifest dm where dm.barcode2 = fp.barcode2)
       and not exists (select 1 from chiqim_line_pallets clp
                        where clp.barcode2 = fp.barcode2 and clp.released_at is null)
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

revoke all on function mint_serial_from_sources(uuid,uuid,numeric,text[],uuid,numeric) from public;
grant execute on function mint_serial_from_sources(uuid,uuid,numeric,text[],uuid,numeric) to authenticated;


-- Old-stock-to-Moyka: the entire combined submit in ONE transaction, so a
-- failure can never leave consumed pallets behind with no send to account
-- for them.
create or replace function send_old_stock_to_moyka(
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
  -- The weighed figure is mandatory and never defaulted. Book weights are
  -- year-old approximations; trusting one here would fold storage
  -- shrinkage into wash loss and corrupt yield.
  if p_weighed_kg is null or p_weighed_kg <= 0 then
    raise exception 'Tarozidagi og''irlikni kiriting' using errcode = '22023';
  end if;

  -- Book total read BEFORE the pallets are consumed.
  select coalesce(sum(weight_kg), 0) into v_book
    from finished_pallets where barcode2 = any(p_pallet_barcodes);

  -- declared_qty = the WEIGHED figure, not the book figure. This keeps
  -- yield_rows' raw_received == raw_consumed, so wash loss is pure
  -- processing loss and no false capped_serials alarm fires when the scale
  -- reads over book. Storage loss stays derivable, never stored:
  --   (sum of book weights via serial_mint_sources) - moyka_sends.qty_kg
  v_serial := mint_serial_from_sources(p_owner_id, p_type_id, p_weighed_kg,
                                       p_pallet_barcodes, null, null);

  -- Same upsert the normal send path uses (OmborMoykaTab.handleSend): the
  -- wash_cycles row must exist before Laborator can enter a CHIQIM test.
  insert into wash_cycles (serial, status) values (v_serial, 'active')
    on conflict (serial) do nothing;

  insert into moyka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_weighed_kg, v_actor);

  -- Auto-note on the new serial, via the existing generic notes mechanism
  -- (entity_type='moyka' keyed by serial -- the same key OmborMoykaTab's
  -- Qaydlar panel already reads, and what LaboratorChiqimTab and the
  -- passport now read too).
  insert into notes (entity_type, entity_id, author, body)
  values ('moyka', v_serial, v_actor,
    format('Eski zaxiradan qayta yuvish: %s ta eski pallet ishlatildi, kitob bo''yicha ~%s kg, tarozida %s kg yuborildi.',
           v_count, round(v_book), round(p_weighed_kg)));

  return v_serial;
end
$function$;

revoke all on function send_old_stock_to_moyka(uuid,uuid,text[],numeric) from public;
grant execute on function send_old_stock_to_moyka(uuid,uuid,text[],numeric) to authenticated;
