-- Rezka build, Prompt 1 of 4 (2026-09-23) -- part 2: kg-based partial
-- internal KN draw ledger, its RPC, every available-KN read site patched to
-- subtract it, and the three dispatch verdict gates (+ the stock-on-hand
-- awaiting-lab bucket) opened for Rezka serials.
-- Decisions: docs/decisions/0220-* (partial draw via ledger), 0219-* (old
-- KN pool excluded). No UI here.
--
-- WHY A LEDGER. Internal KN goes to Rezka in boxes of >= ~10 kg, so a draw
-- is almost never a whole pallet. mint_serial_from_sources consumes whole
-- pallets only (serial_mint_sources' pallet rows are CHECK-forbidden from
-- carrying a weight) and is left untouched. Instead a draw is recorded the
-- same way CHIQIM's partial dispatch already is: an append-only per-pallet
-- kg ledger (rezka_kn_draws, shaped like chiqim_pallet_consumption).
-- finished_pallets.weight_kg and .status are never edited by a draw; the
-- pallet's remaining kg is DERIVED everywhere as
--     weight_kg - sum(chiqim_pallet_consumption) - sum(rezka_kn_draws)
-- i.e. the existing subtraction at every site gains one sibling term -- no
-- new balance calculation.
--
-- Read sites patched here (the full available-KN list, audited 2026-09-23 --
-- every live object that reads chiqim_pallet_consumption was classified):
--   1. stock_on_hand_rows            -- pallet_qty (qoldig'i, rahbar_stock_
--                                       snapshot, get_serial_passport's
--                                       finished_still all read this view)
--   2. finished_pallet_availability  -- (+ finished_calibre_availability,
--                                       useAvailableFinishedStock)
--   3. attribute_chiqim_line_fifo    -- FIFO v_take
--   4. check_chiqim_pallet_consumption_not_overdrawn (+ a twin trigger on
--                                       rezka_kn_draws)
--   5. mint_serial_from_sources      -- whole-pallet eligibility
--   6. rahbar_dashboard_ledger       -- Ledger C: a draw is its OWN outflow
--                                       (finished.rezkaDrawnKg), never folded
--                                       into dispatchedKg
--   7. get_client_report             -- same shape as Ledger C
-- Classified NOT an available-KN site (reads consumption only as a dispatch
-- event, or cannot hold drawable pallets): kirim_line_state /
-- kirim_line_report_bundle(_set) (olib_ketilgan = departed dispatches;
-- Moykadan chiqgan stays the full produced amount), client_serial_ledger,
-- client_filtered_report_rows, report_chiqim_rows(_v2),
-- report_moyka_output_rows, client_chiqim_ledger, chiqim_request_loaded_kg
-- (dispatch reads); close_out_old_stock / old_stock_closeout_lines (draws
-- exclude is_old_stock pallets).
--
-- DISPATCH GATES: finished_pallet_availability, attribute_chiqim_line_fifo
-- and stock_on_hand_rows' awaiting-lab bucket become "lab passed OR serial
-- in rezka_cycles". The finished_pallets INSERT policy already had this
-- branch (0076). No other gate changes.

-- ------------------------------------------------------------------
-- 1. Ledger
-- ------------------------------------------------------------------
create table rezka_kn_draws (
  draw_id       uuid primary key default gen_random_uuid(),
  minted_serial text not null references kirim_lines(serial),
  barcode2      text not null references finished_pallets(barcode2),
  qty_kg        numeric not null check (qty_kg > 0),
  drawn_at      timestamptz not null default now(),
  drawn_by      uuid references profiles(id)
);
create index rezka_kn_draws_barcode_idx on rezka_kn_draws (barcode2);
create index rezka_kn_draws_minted_serial_idx on rezka_kn_draws (minted_serial);

alter table rezka_kn_draws enable row level security;
create policy read_all on rezka_kn_draws for select
  using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
create policy client_read_own_rezka_kn_draws on rezka_kn_draws for select
  using (((select my_role()) = 'client'::user_role) and exists (
    select 1
    from finished_pallets fp
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where fp.barcode2 = rezka_kn_draws.barcode2
      and ko.owner_id = (select my_owner_id())
  ));
-- No insert/update/delete policy: written only by send_kn_to_rezka
-- (security definer). Append-only.

-- ------------------------------------------------------------------
-- 2. Overdraw guards: CHIQIM consumption + Rezka draws <= pallet weight,
--    checked from both sides.
-- ------------------------------------------------------------------
create or replace function public.check_chiqim_pallet_consumption_not_overdrawn()
returns trigger
language plpgsql
as $function$
declare
  v_weight numeric;
  v_consumed numeric;
begin
  select weight_kg into v_weight from public.finished_pallets where barcode2 = new.barcode2;
  select coalesce(sum(qty_kg), 0)
       + coalesce((select sum(d.qty_kg) from public.rezka_kn_draws d where d.barcode2 = new.barcode2), 0)
    into v_consumed
    from public.chiqim_pallet_consumption where barcode2 = new.barcode2;
  if v_consumed > v_weight then
    raise exception 'chiqim_pallet_consumption overdraws finished_pallets % (consumed % kg, pallet is % kg)', new.barcode2, v_consumed, v_weight;
  end if;
  return new;
end;
$function$;

create trigger rezka_kn_draws_not_overdrawn
  after insert on rezka_kn_draws
  for each row execute function check_chiqim_pallet_consumption_not_overdrawn();

-- ------------------------------------------------------------------
-- 3. The draw RPC
-- ------------------------------------------------------------------
-- New function rather than a rewrite: the signature changes (kg, not a
-- pallet list). send_finished_pallets_to_rezka (0076, whole pallets, would
-- bypass the ledger) stays in place but can no longer be called by app
-- roles. send_old_kn_pool_to_rezka is left as-is: dead code, old KN is not
-- a Rezka source (docs/decisions/0219-*).
--
-- Candidate pallets: Konditerka (is_numberless, not is_rezka_output),
-- in_stock, not voided, not old stock, this owner + type, parent serial
-- process = 'moyka', lab passed (latest chiqim verdict 'o_tdi' on the
-- serial's LATEST wash cycle), remaining kg > 0. FIFO by received_date,
-- created_at, barcode2; the last pallet is drawn partially.
-- No minimum kg here (soft-warning philosophy: the UI warns under 10 kg).
create or replace function send_kn_to_rezka(p_owner_id uuid, p_type_id uuid, p_kg numeric)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor     uuid := auth.uid();
  v_order_id  uuid;
  v_serial    text;
  v_remaining numeric := p_kg;
  v_take      numeric;
  v_pallets   int := 0;
  r           record;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor Rezkaga yubora oladi' using errcode = '42501';
  end if;
  if p_kg is null or p_kg <= 0 then
    raise exception 'Og''irlik kiritilmagan' using errcode = '22023';
  end if;

  -- Mint first so the ledger rows can reference the serial. Same order row
  -- shape mint_serial_from_sources writes; no storage_intake, so no
  -- Barcode #1 and no gate/intake queue.
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, origin, status, created_by)
  values ((now() at time zone 'Asia/Tashkent')::date, 'QAYTA-ISHLASH', 'Ichki qayta ishlash',
          p_owner_id, null, 'internal_reprocess', 'qabul_qilindi', v_actor)
  returning order_id into v_order_id;

  insert into kirim_lines (order_id, type_id, declared_qty, process)
  values (v_order_id, p_type_id, p_kg, 'rezka')
  returning serial into v_serial;

  for r in
    select fp.barcode2,
           fp.weight_kg
             - coalesce((select sum(c.qty_kg) from chiqim_pallet_consumption c where c.barcode2 = fp.barcode2), 0)
             - coalesce((select sum(d.qty_kg) from rezka_kn_draws d where d.barcode2 = fp.barcode2), 0)
             as remaining_kg
    from finished_pallets fp
    join calibres cal    on cal.id = fp.calibre_id
    join kirim_lines kl  on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    left join lateral (
      select wc.id from wash_cycles wc where wc.serial = fp.serial
      order by wc.cycle_no desc limit 1
    ) wc on true
    left join lateral (
      select lr.verdict from lab_results lr
      where lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id
      order by lr.created_at desc limit 1
    ) lr on true
    where ko.owner_id = p_owner_id
      and fp.type_id = p_type_id
      and cal.is_numberless and not cal.is_rezka_output
      and fp.status = 'in_stock'
      and fp.voided_at is null
      and not fp.is_old_stock
      and kl.process = 'moyka'
      and lr.verdict = 'o_tdi'
    order by fp.received_date, fp.created_at, fp.barcode2
    for update of fp
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, r.remaining_kg);
    if v_take <= 0 then continue; end if;
    insert into rezka_kn_draws (minted_serial, barcode2, qty_kg, drawn_by)
    values (v_serial, r.barcode2, v_take, v_actor);
    v_remaining := v_remaining - v_take;
    v_pallets := v_pallets + 1;
  end loop;

  if v_remaining > 0 then
    raise exception 'Konditerka yetarli emas: % kg yetishmayapti', round(v_remaining, 1)
      using errcode = '23514';
  end if;

  insert into rezka_cycles (serial, cycle_no, status) values (v_serial, 1, 'active');
  insert into rezka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_kg, v_actor);
  insert into notes (entity_type, entity_id, author, body)
  values ('rezka', v_serial, v_actor,
    format('Ichki Konditerkadan Rezkaga: %s kg, %s ta palletdan (FIFO).', p_kg, v_pallets));

  return v_serial;
end
$$;

revoke execute on function send_finished_pallets_to_rezka(uuid, uuid, text[], numeric) from anon, authenticated;

-- ------------------------------------------------------------------
-- 4. finished_pallet_availability (+ gate)
-- ------------------------------------------------------------------
create or replace view finished_pallet_availability as
 SELECT fp.barcode2,
    fp.serial,
    fp.type_id,
    fp.calibre_id,
    fp.is_old_stock,
    fp.created_at,
    GREATEST((0)::numeric, (fp.weight_kg - COALESCE(c.consumed_kg, (0)::numeric) - COALESCE(d.drawn_kg, (0)::numeric))) AS available_kg
   FROM ((((finished_pallets fp
     LEFT JOIN LATERAL ( SELECT wc2.id
           FROM wash_cycles wc2
          WHERE (wc2.serial = fp.serial)
         LIMIT 1) wc ON (true))
     LEFT JOIN LATERAL ( SELECT lr_1.verdict
           FROM lab_results lr_1
          WHERE ((lr_1.scope = 'chiqim'::direction) AND (lr_1.wash_cycle_id = wc.id))
          ORDER BY lr_1.created_at DESC
         LIMIT 1) lr ON (true))
     LEFT JOIN ( SELECT chiqim_pallet_consumption.barcode2,
            sum(chiqim_pallet_consumption.qty_kg) AS consumed_kg
           FROM chiqim_pallet_consumption
          GROUP BY chiqim_pallet_consumption.barcode2) c ON ((c.barcode2 = fp.barcode2)))
     LEFT JOIN ( SELECT rezka_kn_draws.barcode2,
            sum(rezka_kn_draws.qty_kg) AS drawn_kg
           FROM rezka_kn_draws
          GROUP BY rezka_kn_draws.barcode2) d ON ((d.barcode2 = fp.barcode2)))
  WHERE ((fp.status = 'in_stock'::pallet_status)
    AND ((lr.verdict = 'o_tdi'::text)
      OR (EXISTS ( SELECT 1 FROM rezka_cycles rc WHERE (rc.serial = fp.serial)))));

-- ------------------------------------------------------------------
-- 5. attribute_chiqim_line_fifo (+ gate)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attribute_chiqim_line_fifo(p_line_id uuid, p_loaded_kg numeric, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      select wc2.id from public.wash_cycles wc2 where wc2.serial = fp.serial limit 1
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
      and (lr.verdict = 'o_tdi'
           or exists (select 1 from public.rezka_cycles rc where rc.serial = fp.serial))
    order by fp.created_at
    for update of fp
  loop
    exit when v_remaining <= 0;
    v_take := least(
      v_remaining,
      r.weight_kg
        - coalesce((select sum(qty_kg) from public.chiqim_pallet_consumption where barcode2 = r.barcode2), 0)
        - coalesce((select sum(qty_kg) from public.rezka_kn_draws where barcode2 = r.barcode2), 0)
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

-- ------------------------------------------------------------------
-- 6. mint_serial_from_sources -- whole-pallet eligibility nets out draws
--    (a partly-drawn pallet may still be re-minted whole; its drawn kg is
--    already gone, so only weight - departed - drawn > 0 qualifies it).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mint_serial_from_sources(p_owner_id uuid, p_type_id uuid, p_declared_qty numeric, p_pallet_barcodes text[] DEFAULT NULL::text[], p_pool_id uuid DEFAULT NULL::uuid, p_pool_weight_kg numeric DEFAULT NULL::numeric)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor qayta ishlash uchun seriya ocha oladi' using errcode = '42501';
  end if;
  if p_declared_qty is null or p_declared_qty <= 0 then
    raise exception 'Og''irlik kiritilmagan' using errcode = '22023';
  end if;

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
      left join lateral (
        select coalesce(sum(d.qty_kg), 0) as drawn_kg
        from rezka_kn_draws d where d.barcode2 = fp.barcode2
      ) drw on true
     where fp.barcode2 = any(p_pallet_barcodes)
       and fp.status   = 'in_stock'
       and ko.owner_id = p_owner_id
       and fp.type_id  = p_type_id
       and coalesce(cons.pending_kg, 0) = 0
       and fp.weight_kg - coalesce(cons.departed_kg, 0) - coalesce(drw.drawn_kg, 0) > 0
       and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2);

    if v_ok <> v_expected then
      raise exception
        'Pallet mavjud emas, boshqa so''rovga band qilingan yoki allaqachon ishlatilgan (% / % yaroqli)',
        v_ok, v_expected using errcode = '23514';
    end if;
  else
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

-- ------------------------------------------------------------------
-- 7. stock_on_hand_rows -- draws netted out of pallet qty; Rezka pallets
--    (no lab by design) land in 'available', not 'awaiting_lab'.
-- ------------------------------------------------------------------
create or replace view stock_on_hand_rows with (security_invoker = true) as
 WITH pallet_base AS (
         SELECT fp.barcode2,
            fp.serial,
            ko.owner_id,
            fp.type_id,
            kl.partiya_no,
            fp.calibre_id,
            fp.received_date,
            fp.is_old_stock,
            fp.weight_is_estimate,
            lr.verdict,
            lr.moisture_pct AS lab_moisture_pct,
            wc.id AS wash_cycle_id,
            (EXISTS ( SELECT 1
                   FROM rezka_cycles rc
                  WHERE rc.serial = fp.serial)) AS is_rezka
           FROM finished_pallets fp
             JOIN kirim_lines kl ON kl.serial = fp.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             LEFT JOIN LATERAL ( SELECT wc2.id
                   FROM wash_cycles wc2
                  WHERE wc2.serial = fp.serial
                 LIMIT 1) wc ON true
             LEFT JOIN LATERAL ( SELECT lr3.verdict,
                    lr3.moisture_pct
                   FROM lab_results lr3
                  WHERE lr3.scope = 'chiqim'::direction AND lr3.wash_cycle_id = wc.id
                  ORDER BY lr3.created_at DESC
                 LIMIT 1) lr ON true
          WHERE fp.status = 'in_stock'::pallet_status AND ko.plate !~~ 'TEST-%'::text
        ), lab_bucketed AS (
         SELECT
                CASE
                    WHEN pallet_base.verdict = 'qayta_yuvish'::text THEN 'qayta_yuvish'::text
                    WHEN pallet_base.verdict IS NULL AND NOT pallet_base.is_rezka THEN 'awaiting_lab'::text
                    ELSE NULL::text
                END AS forced_bucket,
            pallet_base.barcode2,
            pallet_base.serial,
            pallet_base.owner_id,
            pallet_base.type_id,
            pallet_base.partiya_no,
            pallet_base.calibre_id,
            pallet_base.received_date,
            pallet_base.is_old_stock,
            pallet_base.weight_is_estimate,
            pallet_base.lab_moisture_pct
           FROM pallet_base
        ), consumed_by_pallet AS (
         SELECT c.barcode2,
            sum(c.qty_kg) FILTER (WHERE cgw.completed_at IS NOT NULL) AS departed_kg,
            sum(c.qty_kg) FILTER (WHERE cgw.completed_at IS NULL) AS pending_kg
           FROM chiqim_pallet_consumption c
             JOIN chiqim_lines cl ON cl.id = c.chiqim_line_id
             JOIN chiqim_requests cr ON cr.id = cl.request_id
             LEFT JOIN LATERAL ( SELECT chiqim_departed_at(cr.id) AS completed_at) cgw ON true
          WHERE cr.plate !~~ 'TEST-%'::text
          GROUP BY c.barcode2
        ), drawn_by_pallet AS (
         SELECT d.barcode2,
            sum(d.qty_kg) AS drawn_kg
           FROM rezka_kn_draws d
          GROUP BY d.barcode2
        ), pallet_qty AS (
         SELECT fp.barcode2,
            fp.weight_kg,
            COALESCE(cbp.departed_kg, 0::numeric) AS departed_kg,
            COALESCE(cbp.pending_kg, 0::numeric) AS pending_kg,
            COALESCE(dbp.drawn_kg, 0::numeric) AS drawn_kg
           FROM finished_pallets fp
             LEFT JOIN consumed_by_pallet cbp ON cbp.barcode2 = fp.barcode2
             LEFT JOIN drawn_by_pallet dbp ON dbp.barcode2 = fp.barcode2
        ), pallet_rows AS (
         SELECT COALESCE(lb.forced_bucket, 'available'::text) AS bucket,
            lb.barcode2 AS row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            GREATEST(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg - pq.drawn_kg) AS qty_kg,
            lb.received_date AS anchor_date,
            lb.lab_moisture_pct AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no
           FROM lab_bucketed lb
             JOIN pallet_qty pq ON pq.barcode2 = lb.barcode2
          WHERE GREATEST(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg - pq.drawn_kg) > 0::numeric OR lb.forced_bucket IS NOT NULL
        UNION ALL
         SELECT 'band_qilingan'::text AS bucket,
            lb.barcode2 || ':band'::text AS row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            pq.pending_kg AS qty_kg,
            lb.received_date AS anchor_date,
            lb.lab_moisture_pct AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no
           FROM lab_bucketed lb
             JOIN pallet_qty pq ON pq.barcode2 = lb.barcode2
          WHERE lb.forced_bucket IS NULL AND pq.pending_kg > 0::numeric
        ), raw_rows AS (
         SELECT 'raw_not_washed'::text AS bucket,
            r.row_key,
            r.serial,
            NULL::text AS barcode2,
            r.owner_id,
            r.type_id,
            NULL::uuid AS calibre_id,
            r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric) AS qty_kg,
            r.date_basis AS anchor_date,
            kirim_lr.moisture_pct,
            r.box_mass_kg,
            r.origin = 'opening_stock'::text AS is_old_stock,
            false AS weight_is_estimate,
            r.partiya_no
           FROM report_kirim_rows r
             JOIN storage_intake si ON si.serial = r.serial
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(ms.qty_kg), 0::numeric) AS total_sent
                   FROM moyka_sends ms
                  WHERE ms.serial = r.serial) sent ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rs.qty_kg), 0::numeric) AS total_rezka_sent
                   FROM rezka_sends rs
                  WHERE rs.serial = r.serial) rezka ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rdl.net_kg), 0::numeric) AS total_raw
                   FROM raw_dispatch_lines rdl
                  WHERE rdl.serial = r.serial) raw ON true
             LEFT JOIN LATERAL ( SELECT lr4.moisture_pct
                   FROM lab_results lr4
                  WHERE lr4.scope = 'kirim'::direction AND lr4.parent_serial = r.serial
                  ORDER BY lr4.created_at DESC
                 LIMIT 1) kirim_lr ON true
          WHERE (r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric)) > 0::numeric AND NOT (EXISTS ( SELECT 1
                   FROM old_stock_closeouts osc
                  WHERE osc.kind = 'old_raw'::text AND osc.owner_id = r.owner_id AND osc.type_id = r.type_id))
        ), old_kn_rows AS (
         SELECT 'old_kn'::text AS bucket,
            p.id::text AS row_key,
            NULL::text AS serial,
            NULL::text AS barcode2,
            p.owner_id,
            p.type_id,
            NULL::uuid AS calibre_id,
            p.opening_kg - COALESCE(c.collected, 0::numeric) - COALESCE(m.minted, 0::numeric) AS qty_kg,
            NULL::date AS anchor_date,
            NULL::numeric AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            true AS is_old_stock,
            NULL::boolean AS weight_is_estimate,
            NULL::integer AS partiya_no
           FROM old_kn_pools p
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(oc.collected_kg), 0::numeric) AS collected
                   FROM old_kn_collections oc
                  WHERE oc.pool_id = p.id) c ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(sms.weight_kg), 0::numeric) AS minted
                   FROM serial_mint_sources sms
                  WHERE sms.source_kind = 'weight_pool'::text AND sms.source_pool_id = p.id) m ON true
          WHERE (p.opening_kg - COALESCE(c.collected, 0::numeric) - COALESCE(m.minted, 0::numeric)) > 0::numeric AND p.closed_at IS NULL
        )
 SELECT pallet_rows.bucket,
    pallet_rows.row_key,
    pallet_rows.serial,
    pallet_rows.barcode2,
    pallet_rows.owner_id,
    pallet_rows.type_id,
    pallet_rows.calibre_id,
    pallet_rows.qty_kg,
    pallet_rows.anchor_date,
    CURRENT_DATE - pallet_rows.anchor_date AS days_held,
    (CURRENT_DATE - pallet_rows.anchor_date) > 90 AS aged_90,
    pallet_rows.moisture_pct,
    pallet_rows.box_mass_kg,
    pallet_rows.is_old_stock,
    pallet_rows.weight_is_estimate,
    pallet_rows.partiya_no
   FROM pallet_rows
UNION ALL
 SELECT raw_rows.bucket,
    raw_rows.row_key,
    raw_rows.serial,
    raw_rows.barcode2,
    raw_rows.owner_id,
    raw_rows.type_id,
    raw_rows.calibre_id,
    raw_rows.qty_kg,
    raw_rows.anchor_date,
    CURRENT_DATE - raw_rows.anchor_date AS days_held,
    (CURRENT_DATE - raw_rows.anchor_date) > 90 AS aged_90,
    raw_rows.moisture_pct,
    raw_rows.box_mass_kg,
    raw_rows.is_old_stock,
    raw_rows.weight_is_estimate,
    raw_rows.partiya_no
   FROM raw_rows
UNION ALL
 SELECT old_kn_rows.bucket,
    old_kn_rows.row_key,
    old_kn_rows.serial,
    old_kn_rows.barcode2,
    old_kn_rows.owner_id,
    old_kn_rows.type_id,
    old_kn_rows.calibre_id,
    old_kn_rows.qty_kg,
    old_kn_rows.anchor_date,
    NULL::integer AS days_held,
    false AS aged_90,
    old_kn_rows.moisture_pct,
    old_kn_rows.box_mass_kg,
    old_kn_rows.is_old_stock,
    old_kn_rows.weight_is_estimate,
    old_kn_rows.partiya_no
   FROM old_kn_rows;
