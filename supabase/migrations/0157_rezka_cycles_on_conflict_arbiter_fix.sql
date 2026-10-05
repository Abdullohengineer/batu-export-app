-- Fixes the first live Rezka send's failure. Follow-up to
-- 0141_rezka_process_and_cycles.sql, same bug pattern 0125_wash_cycles_
-- upsert_fix.sql already fixed once for wash_cycles.
--
-- 0141 dropped rezka_cycles' unique(serial) in favor of
-- unique(serial, cycle_no) + rezka_cycles_one_open_per_serial (a partial
-- index, WHERE closed_at IS NULL) -- confirmed live, no drift.
-- ensure_open_rezka_cycle was updated in 0141 itself
-- (on conflict (serial, cycle_no)); these two call sites, carried over
-- unchanged from 0076, were not:
--   1. send_finished_pallets_to_rezka
--   2. send_old_kn_pool_to_rezka
-- Both still used `on conflict (serial)`, which Postgres rejects at parse
-- time (42P10, "no unique or exclusion constraint matching the ON CONFLICT
-- specification") regardless of whether a conflict would ever actually
-- occur -- this is exactly what broke the first live Rezka send.
--
-- NOT a new unique index on status='active', despite the original bug
-- report suggesting one: status is set once at insert and never updated by
-- close_rezka_cycle_if_settled/close_rezka_cycle_serial (only closed_at
-- changes on close), so such an index would just duplicate
-- rezka_cycles_one_open_per_serial's closed_at-based signal forever --
-- a second "is this cycle open" column that can never diverge from the
-- first, not matching the live multi-cycle design 0141 already built. The
-- actual missing piece is simply pointing ON CONFLICT at the constraint
-- that exists, exactly as 0125 did for the identical wash_cycles bug: a
-- v_serial fresh out of mint_serial_from_sources can never actually
-- conflict here (it has no prior rezka_cycles row of its own), so the
-- arbiter just needs to be valid, not load-bearing.
--
-- 🚩 Flagged, NOT fixed here -- fixing the arbiter alone does not make
-- either function callable end-to-end today; out of scope for this
-- migration, needs a separate decision before anyone relies on it:
--   - EXECUTE on send_finished_pallets_to_rezka was revoked from anon/
--     authenticated in 0142 (confirmed live: only service_role/postgres
--     can call it today). docs/decisions/0219 and 0220 record why: the
--     product owner rejected whole-pallet Rezka sourcing on 2026-09-23,
--     specifically because it bypasses rezka_kn_draws' overdraw
--     protection, in favor of the kg-based, ledger-tracked
--     send_kn_to_rezka. send_old_kn_pool_to_rezka keeps its EXECUTE grant
--     (dead code by the same decision, but not permission-gated).
--   - Even with EXECUTE granted, both functions mint through
--     mint_serial_from_sources (shared with Moyka), which inserts
--     kirim_lines with no `process` column -- it defaults to 'moyka'. The
--     very next statement in either function (insert into rezka_cycles)
--     would then fail 0141's own enforce_serial_process trigger ("...
--     Rezkaga yuborib bo'lmaydi"), trading one error for another.
-- Fixed anyway: docs/decisions/0219 explicitly keeps both functions in
-- place rather than dropping them ("not dropped either, for the same
-- reason") -- dead code should still not be silently broken.
--
-- CREATE OR REPLACE preserves each function's existing grants (no DROP),
-- so this migration does not change who can call either function.

create or replace function send_finished_pallets_to_rezka(
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
    raise exception 'Faqat Ombor Rezkaga yubora oladi' using errcode = '42501';
  end if;
  if p_weighed_kg is null or p_weighed_kg <= 0 then
    raise exception 'Tarozidagi og''irlikni kiriting' using errcode = '22023';
  end if;

  select coalesce(sum(weight_kg), 0) into v_book
    from finished_pallets where barcode2 = any(p_pallet_barcodes);

  v_serial := mint_serial_from_sources(p_owner_id, p_type_id, p_weighed_kg,
                                       p_pallet_barcodes, null, null);

  -- cycle_no added (matches ensure_open_rezka_cycle / 0141): v_serial is
  -- always freshly minted here, so this insert always succeeds -- the
  -- arbiter just needs to be valid, same reasoning 0125 used for the
  -- wash_cycles twin of this exact bug.
  insert into rezka_cycles (serial, cycle_no, status) values (v_serial, 1, 'active')
    on conflict (serial, cycle_no) do nothing;

  insert into rezka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_weighed_kg, v_actor);

  insert into notes (entity_type, entity_id, author, body)
  values ('rezka', v_serial, v_actor,
    format('Yuvilgan KN dan Rezkaga: %s ta pallet ishlatildi, kitob bo''yicha ~%s kg, tarozida %s kg yuborildi.',
           v_count, round(v_book), round(p_weighed_kg)));

  return v_serial;
end
$function$;

create or replace function send_old_kn_pool_to_rezka(
  p_owner_id       uuid,
  p_type_id        uuid,
  p_pool_id        uuid,
  p_pool_weight_kg numeric
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_serial text;
  v_actor  uuid := auth.uid();
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor Rezkaga yubora oladi' using errcode = '42501';
  end if;
  if p_pool_weight_kg is null or p_pool_weight_kg <= 0 then
    raise exception 'Og''irlik kiritilmagan' using errcode = '22023';
  end if;

  v_serial := mint_serial_from_sources(p_owner_id, p_type_id, p_pool_weight_kg,
                                       null, p_pool_id, p_pool_weight_kg);

  -- cycle_no added, same fix as above.
  insert into rezka_cycles (serial, cycle_no, status) values (v_serial, 1, 'active')
    on conflict (serial, cycle_no) do nothing;

  insert into rezka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_pool_weight_kg, v_actor);

  insert into notes (entity_type, entity_id, author, body)
  values ('rezka', v_serial, v_actor,
    format('Eski KN havzasidan Rezkaga: %s kg tortib olindi.', round(p_pool_weight_kg)));

  return v_serial;
end
$function$;
