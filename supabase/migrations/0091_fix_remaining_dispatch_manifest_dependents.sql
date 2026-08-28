-- Corrective fix: a broader sweep (after 0090 caught the release-
-- reservations trigger) for every remaining live object that still reads
-- dispatch_manifest or chiqim_line_pallets as if they were still written to.
-- Both are now permanently empty going forward (0087 stopped writing to
-- dispatch_manifest; chiqim_line_pallets is dropped outright) -- an object
-- that assumed either would keep filling up is not just stale, it now
-- either throws (chiqim_line_pallets: relation does not exist) or silently
-- returns wrong answers (dispatch_manifest: always empty, so any "has this
-- departed" check built on it now always reads false). Found via
-- pg_get_functiondef/pg_get_viewdef ilike sweeps across every live
-- function and view; get_client_report's own hit was a harmless comment
-- (already rewritten in 0088) and is not touched again here.
--
-- Six objects, two failure modes:
--   THROWS (chiqim_line_pallets, relation dropped):
--     - mint_serial_from_sources: Rezka's pallet-source eligibility check.
--   SILENTLY WRONG (dispatch_manifest, permanently empty):
--     - close_out_old_stock (old_washed branch): every in-stock old_washed
--       pallet would be counted as "still remaining" even once FIFO has
--       departed some or all of it, inflating the close-out's book value
--       and mis-voiding pallets that should already read as gone.
--     - client_filtered_report_rows: the client portal's own 'chiqim' rows
--       always got date_basis=NULL (via the dead dispatch_manifest join),
--       which the function's own WHERE clause then filtered out entirely --
--       every client's dispatched-finished-goods rows silently vanished
--       from their own report.
--     - report_chiqim_rows / report_moyka_output_rows: pallet_status always
--       fell through to 'omborda' for a departed pallet (dm.request_id is
--       never non-null any more) -- feeds get_serial_passport's own
--       cycles[].pallets[] list directly, so a dispatched pallet's passport
--       badge would silently read "still in warehouse."
--     - old_stock_closeout_lines (old_washed_lines CTE): same collected_kg/
--       remaining_kg split as close_out_old_stock, same fix.
--
-- Fix shape throughout: replace the dispatch_manifest+gate_weighings
-- existence/status check with the same chiqim_pallet_consumption +
-- gate_weighings pattern already established in 0088/0089 (a pallet's
-- departed_kg = sum of consumption whose OWN request's gate has completed).
-- Where the original was whole-pallet boolean (close_out_old_stock,
-- old_stock_closeout_lines: a pallet was either wholly "collected" or
-- wholly "remaining"), the fix keeps that same granularity -- any
-- departed_kg > 0 flips the whole pallet's weight into "collected," not a
-- partial split -- deliberately not upgraded to a fractional split here,
-- since neither object's own shape has room for one and the brief's "no
-- new balance calculation beyond the one canonical availability read"
-- instruction argues against inventing a third one for a close-out/audit
-- context that never needed pallet-level fractions before either.

-- ============================================================
-- 1. mint_serial_from_sources: candidate-pallet eligibility no longer reads
--    chiqim_line_pallets (dropped) or dispatch_manifest (permanently
--    empty) -- both are replaced by "has this pallet been consumed at all
--    by any CHIQIM dispatch," the canonical chiqim_pallet_consumption
--    check every other read-path already uses.
-- ============================================================
create or replace function public.mint_serial_from_sources(p_owner_id uuid, p_type_id uuid, p_declared_qty numeric, p_pallet_barcodes text[] DEFAULT NULL::text[], p_pool_id uuid DEFAULT NULL::uuid, p_pool_weight_kg numeric DEFAULT NULL::numeric)
 returns text
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
       and not exists (select 1 from chiqim_pallet_consumption cpc where cpc.barcode2 = fp.barcode2)
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

-- ============================================================
-- 2. close_out_old_stock: old_washed branch's "has this departed" check
--    switches from dispatch_manifest+gate_weighings to
--    chiqim_pallet_consumption+gate_weighings (any gate-completed
--    consumption at all -- whole-pallet granularity, matching this
--    function's own pre-existing shape).
-- ============================================================
create or replace function public.close_out_old_stock(p_kind text, p_owner_id uuid, p_type_id uuid)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_remaining numeric;
begin
  if my_role() is distinct from 'menejer' then
    raise exception 'Faqat Menejer eski zaxirani yakunlay oladi' using errcode = '42501';
  end if;
  if p_kind not in ('old_washed', 'old_kn', 'old_raw') then
    raise exception 'Notoʻgʻri tur' using errcode = '22023';
  end if;
  if exists (select 1 from old_stock_closeouts where kind = p_kind and owner_id = p_owner_id and type_id = p_type_id) then
    raise exception 'Bu qator allaqachon yakunlangan' using errcode = '23505';
  end if;
  if p_kind = 'old_washed' then
    perform 1 from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
     order by fp.barcode2 for update of fp;
    select coalesce(sum(fp.weight_kg), 0) into v_remaining
      from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
       and not exists (
         select 1 from chiqim_pallet_consumption cpc3
         join chiqim_lines cl3 on cl3.id = cpc3.chiqim_line_id
         join chiqim_requests cr3 on cr3.id = cl3.request_id
         join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = cr3.id and cgw3.completed_at is not null
         where cpc3.barcode2 = fp.barcode2
       );
    update finished_pallets fp set status = 'storage_loss', voided_at = now()
      from kirim_lines kl, kirim_orders ko
     where fp.serial = kl.serial and kl.order_id = ko.order_id
       and fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id;
  elsif p_kind = 'old_kn' then
    select p.opening_kg
         - coalesce((select sum(oc.collected_kg) from old_kn_collections oc where oc.pool_id = p.id), 0)
         - coalesce((select sum(s.weight_kg) from serial_mint_sources s where s.source_kind = 'weight_pool' and s.source_pool_id = p.id), 0)
      into v_remaining
      from old_kn_pools p
     where p.owner_id = p_owner_id and p.type_id = p_type_id and p.closed_at is null
     for update;
    if v_remaining is null then
      raise exception 'Havza topilmadi yoki allaqachon yakunlangan' using errcode = '23503';
    end if;
    update old_kn_pools set closed_at = now() where owner_id = p_owner_id and type_id = p_type_id;
  else -- old_raw
    select coalesce(sum(greatest(0, r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(rezka.total_rezka_sent, 0) - coalesce(raw.total_raw, 0))), 0)
      into v_remaining
      from report_kirim_rows r
      join storage_intake si on si.serial = r.serial
      join kirim_orders rko on rko.order_id = r.order_id
      left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
      left join lateral (select coalesce(sum(rs.qty_kg), 0) as total_rezka_sent from rezka_sends rs where rs.serial = r.serial) rezka on true
      left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
     where rko.owner_id = p_owner_id and r.type_id = p_type_id and rko.origin = 'opening_stock';
  end if;
  v_remaining := greatest(0, coalesce(v_remaining, 0));
  insert into old_stock_closeouts (kind, owner_id, type_id, book_remaining_kg, closed_by)
  values (p_kind, p_owner_id, p_type_id, v_remaining, v_actor);
  return v_remaining;
end;
$function$;

-- ============================================================
-- 3. client_filtered_report_rows: 'chiqim' branch reads
--    chiqim_pallet_consumption directly instead of the dead
--    dispatch_manifest LEFT JOIN. One row per consumption PORTION now
--    (a pallet can span several requests), not one row per pallet --
--    qty_kg is the portion actually attributed to that request, matching
--    every other consumption-based read in this migration series. Same
--    "any state, no gate-completed gate" timing as the original (a pallet
--    showed up here the moment it was claimed, not once departed).
-- ============================================================
create or replace function public.client_filtered_report_rows(p_directions text[], p_from date, p_to date, p_type_id uuid, p_serial text)
 returns table(kind text, row_key text, serial text, type_id uuid, plate text, driver text, date_basis date, qty_kg numeric, declared_qty numeric)
 language sql
 stable
as $function$
  with rows_unfiltered as (
    select 'kirim'::text as kind, kl.serial as row_key, kl.serial, kl.type_id,
           ko.plate, ko.driver, ko.order_date as date_basis,
           kirim_line_effective_qty(kl.serial) as qty_kg, kl.declared_qty
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.origin = 'delivery'
      and ko.plate !~~ 'TEST-%'

    union all

    select 'chiqim'::text, c.id::text, fp.serial, fp.type_id,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           c.qty_kg, null::numeric
    from chiqim_pallet_consumption c
    join finished_pallets fp on fp.barcode2 = c.barcode2
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    join chiqim_lines cl on cl.id = c.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'chiqim_raw'::text, rdl.id::text, rdl.serial, cl.type_id,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           rdl.net_kg, null::numeric
    from raw_dispatch_lines rdl
    join chiqim_lines cl on cl.id = rdl.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    join kirim_lines kl on kl.serial = rdl.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'chiqim_old_kn'::text, okc.id::text, null::text, okp.type_id,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           okc.collected_kg, null::numeric
    from old_kn_collections okc
    join old_kn_pools okp on okp.id = okc.pool_id
    join chiqim_lines cl on cl.id = okc.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where okp.owner_id = my_owner_id()
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'moyka_output'::text, 'moyka-output-' || fp.barcode2, fp.serial, fp.type_id,
           ko.plate, ko.driver, fp.received_date,
           fp.weight_kg, null::numeric
    from finished_pallets fp
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and ko.origin != 'opening_stock'
  )
  select * from rows_unfiltered r
  where (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
    and r.date_basis is not null and r.date_basis between p_from and p_to
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%');
$function$;

-- ============================================================
-- 4. report_chiqim_rows: pallet_status derives from chiqim_pallet_
--    consumption instead of the dead dispatch_manifest lookup. Since a
--    pallet can now span multiple requests, `request_id`/plate/driver/
--    date_basis pick the MOST RECENT consumption's own request (same
--    "latest wins" convention used throughout this migration series for
--    a many-to-one collapse) -- this view is one row per PALLET, not per
--    portion, so it can't represent every request a split pallet touched;
--    the passport's own dispatchedByCalibre/dispatches blocks are where
--    the full per-portion detail lives.
-- ============================================================
create or replace view public.report_chiqim_rows as
select 'chiqim'::text as kind,
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
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
     left join chiqim_requests cr on cr.id = latest.request_id
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial
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
-- 5. report_moyka_output_rows: identical pallet_status fix as
--    report_chiqim_rows above (same lateral pattern, same "latest request
--    wins" for the unused-downstream request_id column).
-- ============================================================
create or replace view public.report_moyka_output_rows as
 select 'moyka_output'::text as kind,
    'moyka-output-'::text || fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
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
          where wc2.serial = fp.serial
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
-- 6. old_stock_closeout_lines: old_washed_lines CTE gets the exact same
--    collected_kg/remaining_kg fix as close_out_old_stock's own old_washed
--    branch above (same whole-pallet-boolean granularity, same source
--    swap).
-- ============================================================
create or replace view public.old_stock_closeout_lines as
 with old_washed_lines as (
         select 'old_washed'::text as kind,
            ko.owner_id,
            fp.type_id,
            sum(fp.weight_kg) as opening_kg,
            sum(fp.weight_kg) filter (where not (fp.status = 'in_stock'::pallet_status and coalesce(dep.departed_kg, 0) = 0)) as collected_kg,
            sum(fp.weight_kg) filter (where fp.status = 'in_stock'::pallet_status and coalesce(dep.departed_kg, 0) = 0) as remaining_kg
           from finished_pallets fp
             join kirim_lines kl on kl.serial = fp.serial
             join kirim_orders ko on ko.order_id = kl.order_id
             left join lateral (
               select sum(c.qty_kg) as departed_kg
               from chiqim_pallet_consumption c
               join chiqim_lines cl on cl.id = c.chiqim_line_id
               join chiqim_requests cr on cr.id = cl.request_id
               join gate_weighings cgw on cgw.dir = 'chiqim'::direction and cgw.request_id = cr.id and cgw.completed_at is not null
               where c.barcode2 = fp.barcode2
             ) dep on true
          where fp.is_old_stock
          group by ko.owner_id, fp.type_id
        ), old_kn_lines as (
         select 'old_kn'::text as kind,
            p.owner_id,
            p.type_id,
            p.opening_kg,
            coalesce(( select sum(oc.collected_kg) as sum
                   from old_kn_collections oc
                  where oc.pool_id = p.id), 0::numeric) as collected_kg,
            greatest(0::numeric, p.opening_kg - coalesce(( select sum(oc.collected_kg) as sum
                   from old_kn_collections oc
                  where oc.pool_id = p.id), 0::numeric) - coalesce(( select sum(s.weight_kg) as sum
                   from serial_mint_sources s
                  where s.source_kind = 'weight_pool'::text and s.source_pool_id = p.id), 0::numeric)) as remaining_kg
           from old_kn_pools p
        ), old_raw_lines as (
         select 'old_raw'::text as kind,
            r.owner_id,
            r.type_id,
            sum(r.qty_kg) as opening_kg,
            sum(coalesce(sent.total_sent, 0::numeric) + coalesce(rezka.total_rezka_sent, 0::numeric) + coalesce(raw.total_raw, 0::numeric)) as collected_kg,
            sum(greatest(0::numeric, r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(rezka.total_rezka_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric))) as remaining_kg
           from report_kirim_rows r
             join storage_intake si on si.serial = r.serial
             join kirim_orders rko on rko.order_id = r.order_id
             left join lateral ( select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent
                   from moyka_sends ms
                  where ms.serial = r.serial) sent on true
             left join lateral ( select coalesce(sum(rs.qty_kg), 0::numeric) as total_rezka_sent
                   from rezka_sends rs
                  where rs.serial = r.serial) rezka on true
             left join lateral ( select coalesce(sum(rdl.net_kg), 0::numeric) as total_raw
                   from raw_dispatch_lines rdl
                  where rdl.serial = r.serial) raw on true
          where rko.origin = 'opening_stock'::text
          group by r.owner_id, r.type_id
        ), all_lines as (
         select old_washed_lines.kind,
            old_washed_lines.owner_id,
            old_washed_lines.type_id,
            old_washed_lines.opening_kg,
            old_washed_lines.collected_kg,
            old_washed_lines.remaining_kg
           from old_washed_lines
        union all
         select old_kn_lines.kind,
            old_kn_lines.owner_id,
            old_kn_lines.type_id,
            old_kn_lines.opening_kg,
            old_kn_lines.collected_kg,
            old_kn_lines.remaining_kg
           from old_kn_lines
        union all
         select old_raw_lines.kind,
            old_raw_lines.owner_id,
            old_raw_lines.type_id,
            old_raw_lines.opening_kg,
            old_raw_lines.collected_kg,
            old_raw_lines.remaining_kg
           from old_raw_lines
        )
 select al.kind,
    al.owner_id,
    al.type_id,
    al.opening_kg,
    al.collected_kg,
    al.remaining_kg,
    osc.closed_at,
    osc.book_remaining_kg as closed_book_remaining_kg,
    osc.closed_by
   from all_lines al
     left join old_stock_closeouts osc on osc.kind = al.kind and osc.owner_id = al.owner_id and osc.type_id = al.type_id;
