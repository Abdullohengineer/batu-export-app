-- Corrective fix: get_advisors (security) flagged attribute_chiqim_line_fifo
-- and finalize_chiqim_dispatch (0087) as callable by anon/authenticated over
-- PostgREST as SECURITY DEFINER functions with no role gate -- unlike every
-- other SECURITY DEFINER RPC in this schema (mint_serial_from_sources,
-- close_out_old_stock, both gate on my_role() as their very first check),
-- these two had none. An unauthenticated or wrong-role caller could invoke
-- attribute_chiqim_line_fifo directly to attribute arbitrary FIFO
-- consumption against arbitrary chiqim_lines, or finalize_chiqim_dispatch to
-- do the same AND stamp ombor_finished_at on any chiqim_requests row.
--
-- Fixed by adding the identical my_role() = 'ombor' gate every other
-- SECURITY DEFINER write path in this schema already uses -- matches who
-- actually calls these (OmborChiqimTab.tsx's handleFinish, ombor-only).
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

create or replace function public.finalize_chiqim_dispatch(p_request_id uuid, p_lines jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor yuklashni yakunlay oladi' using errcode = '42501';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    perform public.attribute_chiqim_line_fifo(
      (v_line->>'line_id')::uuid,
      (v_line->>'loaded_kg')::numeric,
      p_actor
    );
  end loop;

  update public.chiqim_requests
  set ombor_finished_at = now(), ombor_finished_by = p_actor
  where id = p_request_id;
end;
$$;
