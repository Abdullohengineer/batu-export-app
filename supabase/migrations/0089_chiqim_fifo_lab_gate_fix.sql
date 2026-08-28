-- Corrective fix to 0087: attribute_chiqim_line_fifo and
-- finished_pallet_availability (and its calibre_availability/
-- serial_calibre_availability rollups, which inherit automatically)
-- selected FIFO candidates on `status = 'in_stock'` alone, missing the
-- pre-existing hard gate (labVerdict.ts `currentLabStatus`, SPEC.md
-- Laborator v2) that a serial's CURRENT wash-cycle lab verdict must be
-- 'o_tdi' before its finished pallets are dispatchable. Untested
-- (no lab_results row yet) and 'qayta_yuvish' (needs rewash) pallets were
-- reachable by the FIFO cascade and by the availability views feeding
-- Menejer's feasibility check -- caught before any UI code was built on
-- top of it. stock_on_hand_rows already enforces this exact gate for its
-- own 'available' bucket (lab_bucketed's forced_bucket is null only when
-- verdict = 'o_tdi'); this migration brings the FIFO/availability path
-- into agreement with that same rule, reusing the identical wash_cycles +
-- latest-lab_results-by-scope='chiqim' pattern.

-- ============================================================
-- 1. finished_pallet_availability: add the lab-gate join. The two
--    aggregate views built on top (finished_calibre_availability,
--    finished_serial_calibre_availability) are unchanged -- they inherit
--    the fix automatically, same "fix the base view once" pattern as
--    rahbar_stock_snapshot inheriting stock_on_hand_rows' own fixes.
-- ============================================================
create or replace view public.finished_pallet_availability as
select
  fp.barcode2,
  fp.serial,
  fp.type_id,
  fp.calibre_id,
  fp.is_old_stock,
  fp.created_at,
  greatest(0, fp.weight_kg - coalesce(c.consumed_kg, 0)) as available_kg
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
left join (
  select barcode2, sum(qty_kg) as consumed_kg
  from public.chiqim_pallet_consumption
  group by barcode2
) c on c.barcode2 = fp.barcode2
where fp.status = 'in_stock'
  and lr.verdict = 'o_tdi';

-- ============================================================
-- 2. attribute_chiqim_line_fifo: same lab-gate predicate added to the
--    candidate cursor. Kept as a direct query against finished_pallets
--    (not the view above) because `for update of fp` row-locking must
--    target the base table directly.
-- ============================================================
create or replace function public.attribute_chiqim_line_fifo(p_line_id uuid, p_loaded_kg numeric, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_id uuid;
  v_calibre_id uuid;
  v_is_old boolean;
  v_remaining numeric := p_loaded_kg;
  v_take numeric;
  r record;
begin
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
$$;
