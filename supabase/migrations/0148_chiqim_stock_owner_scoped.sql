-- Post-Rezka cleanup, item 2 (2026-09-28): CHIQIM stock is client-scoped.
-- Decision: docs/decisions/0228-*.
--
-- Before: finished_calibre_availability summed every client's pallets per
-- type + calibre + old/new, and attribute_chiqim_line_fifo drew down every
-- client's pallets of that type + calibre oldest-first. So Menejer's
-- "Mavjud" hint counted other clients' stock, and Ombor's finalize could
-- consume another client's pallets on this client's truck (logged in
-- HANDOFF since Rezka Prompt 3; pre-existing since 0087).
--
-- After: a pallet's owner is its serial's order owner (kirim_lines ->
-- kirim_orders.owner_id; every in-stock pallet has one, checked live:
-- 148 delivery, 5 internal_reprocess, 67 opening_stock, 0 without).
--   * finished_pallet_availability gains owner_id (appended last column;
--     every existing column and row unchanged).
--   * finished_calibre_availability gains owner_id (appended last) and
--     groups by it: one row per owner + type + calibre + old/new. A caller
--     that sums across owners gets the old total back.
--   * attribute_chiqim_line_fifo only takes pallets whose owner is the
--     request's owner. Everything else is as 0142 left it: same lab gate
--     (o_tdi, or a Rezka serial), same old/new split, same Rezka-draw and
--     consumption netting, same oldest-first order, same shortfall error.
-- Old stock: opening_stock orders carry the owner, so old-washed pallets
-- scope the same way. Rezka: a Standard pallet belongs to its Rezka serial's
-- owner (Tashqi: the delivering client; Ichki: the owner the KN was drawn
-- for, send_kn_to_rezka's own p_owner_id). finished_serial_calibre_
-- availability (no caller in the app) is untouched -- a serial has one owner.

create or replace view public.finished_pallet_availability as
select fp.barcode2,
  fp.serial,
  fp.type_id,
  fp.calibre_id,
  fp.is_old_stock,
  fp.created_at,
  greatest(0::numeric, fp.weight_kg - coalesce(c.consumed_kg, 0::numeric) - coalesce(d.drawn_kg, 0::numeric)) as available_kg,
  ko.owner_id
from finished_pallets fp
  left join lateral (
    select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
  ) wc on true
  left join lateral (
    select lr_1.verdict
    from lab_results lr_1
    where lr_1.scope = 'chiqim'::direction and lr_1.wash_cycle_id = wc.id
    order by lr_1.created_at desc
    limit 1
  ) lr on true
  left join (
    select chiqim_pallet_consumption.barcode2, sum(chiqim_pallet_consumption.qty_kg) as consumed_kg
    from chiqim_pallet_consumption
    group by chiqim_pallet_consumption.barcode2
  ) c on c.barcode2 = fp.barcode2
  left join (
    select rezka_kn_draws.barcode2, sum(rezka_kn_draws.qty_kg) as drawn_kg
    from rezka_kn_draws
    group by rezka_kn_draws.barcode2
  ) d on d.barcode2 = fp.barcode2
  left join kirim_lines kl on kl.serial = fp.serial
  left join kirim_orders ko on ko.order_id = kl.order_id
where fp.status = 'in_stock'::pallet_status
  and (lr.verdict = 'o_tdi'::text or exists (select 1 from rezka_cycles rc where rc.serial = fp.serial));

create or replace view public.finished_calibre_availability as
select type_id,
  calibre_id,
  is_old_stock,
  sum(available_kg) as available_kg,
  owner_id
from finished_pallet_availability
group by type_id, calibre_id, is_old_stock, owner_id;

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
  v_owner_id uuid;
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

  select cl.type_id, cl.calibre_id, cl.line_kind = 'old_washed', cr.owner_id
    into v_type_id, v_calibre_id, v_is_old, v_owner_id
  from public.chiqim_lines cl
  join public.chiqim_requests cr on cr.id = cl.request_id
  where cl.id = p_line_id;

  if v_calibre_id is null then
    raise exception 'chiqim_line % has no calibre_id -- FIFO attribution only applies to finished/old_washed lines', p_line_id;
  end if;

  for r in
    select fp.barcode2, fp.weight_kg
    from public.finished_pallets fp
    join public.kirim_lines kl on kl.serial = fp.serial
    join public.kirim_orders ko on ko.order_id = kl.order_id
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
      and ko.owner_id = v_owner_id
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
