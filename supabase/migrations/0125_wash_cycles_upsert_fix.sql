-- Follow-up fix to 0124_wash_cycles_multi_cycle_scoping.sql, same session.
-- Dropping wash_cycles_serial_key (unique(serial)) in 0124 silently broke
-- every ON CONFLICT (serial) upsert against this table -- Postgres
-- validates the arbiter at parse time regardless of whether a conflict
-- ever actually occurs, so this was not a dormant/second-cycle-only bug:
-- it would have raised on the very next ordinary Ombor Moyka send.
-- Caught before any TS/UI work in this same session, applied immediately.
--
-- Two call sites used `on conflict (serial)`:
--   1. send_old_stock_to_moyka (SQL RPC) -- fixed here.
--   2. OmborMoykaTab.tsx's handleSend (frontend upsert via supabase-js) --
--      cannot target unique(serial, cycle_no) or the partial open-cycle
--      index through PostgREST's upsert API (no predicate support), so
--      it's replaced with a dedicated RPC, ensure_open_wash_cycle, added
--      here. See the TS diff in the same commit as this migration.
--
-- Both replacements preserve the EXACT old behavior for every existing
-- call: insert a cycle_no=1 row only if this serial has never had ANY
-- wash_cycles row before; if one already exists (open OR closed), do
-- nothing. A closed serial's ordinary send picker (useMoykaSerials.ts,
-- already flagged separately as not checking closed_at) still does not
-- silently open a second cycle -- the only way to get cycle_no >= 2 is
-- still exclusively through 0124's open_second_wash_cycle RPC, admin-only.
-- Deliberately NOT changing that picker's own behavior here -- out of
-- scope for this migration, tracked separately.

begin;

create or replace function public.ensure_open_wash_cycle(p_serial text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Ruxsat yo''q' using errcode = '42501';
  end if;

  insert into wash_cycles (serial, cycle_no, status)
  values (p_serial, 1, 'active')
  on conflict (serial, cycle_no) do nothing;
end
$function$;

revoke all on function ensure_open_wash_cycle(text) from public;
grant execute on function ensure_open_wash_cycle(text) to authenticated;

create or replace function public.send_old_stock_to_moyka(p_owner_id uuid, p_type_id uuid, p_pallet_barcodes text[], p_weighed_kg numeric)
returns text
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

  -- cycle_no added (0124/0125) -- v_serial is always freshly minted here,
  -- so this insert always succeeds; the arbiter just needs to be valid.
  insert into wash_cycles (serial, cycle_no, status) values (v_serial, 1, 'active')
    on conflict (serial, cycle_no) do nothing;

  insert into moyka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_weighed_kg, v_actor);

  insert into notes (entity_type, entity_id, author, body)
  values ('moyka', v_serial, v_actor,
    format('Eski zaxiradan qayta yuvish: %s ta eski pallet ishlatildi, kitob bo''yicha ~%s kg, tarozida %s kg yuborildi.',
           v_count, round(v_book), round(p_weighed_kg)));

  return v_serial;
end
$function$;

commit;
