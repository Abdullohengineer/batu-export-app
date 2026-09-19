-- One-off manual reversal: fully undo the Moyka send for serial 150926-003
-- (2,900 kg, sent 2026-09-15). Requested reversal -- nothing downstream had
-- happened (confirmed zero finished_pallets, zero lab_results in either
-- KIRIM or CHIQIM scope, zero rezka_sends for this serial before writing
-- this migration; see the accompanying findings report).
--
-- 150926-003 was minted by send_old_stock_to_moyka (0055/0123) from 5
-- old-washed Subxon pallets (parent serial 020826-034, calibre 6):
-- PLT-020826-034-06-{5,6,7,8,9}. All 5 serial_mint_sources rows are
-- source_kind='pallet' -- no old_kn_pools/old_kn_collections weight-pool
-- draw was involved, so there is nothing to refund on that side.
--
-- PLT-020826-034-06-5 already carried a pre-existing, unrelated
-- chiqim_pallet_consumption row (700kg, a completed/departed dispatch from
-- 2026-09-10, 5 days before this mint) -- this is the exact live scenario
-- migration 0123's own comment describes as its real-world repro (same
-- barcode, same 720kg/700kg figures). Restoring only its `status` to
-- 'in_stock' (never touching weight_kg or the unrelated consumption row)
-- returns it to its true pre-mint state: stock_on_hand_rows will again show
-- it in bucket='available' at 720 - 700 = 20kg, exactly as before
-- 2026-09-15. The other 4 pallets were full, untouched 720kg pallets.
--
-- This is a one-off data reversal for a single serial, not a generalized
-- "undo mint" feature, and does not touch send_old_stock_to_moyka itself.

do $$
declare
  v_guard    int;
  v_snapshot jsonb;
begin
  -- Preconditions, re-checked at apply time (not just at investigation
  -- time): abort rather than silently partially reverse if anything
  -- downstream now exists.
  select count(*) into v_guard from finished_pallets where serial = '150926-003';
  if v_guard <> 0 then
    raise exception 'Guard failed: finished_pallets exists for 150926-003 -- aborting reversal' using errcode = '22023';
  end if;

  select count(*) into v_guard
    from lab_results lr
   where (lr.scope = 'kirim' and lr.parent_serial = '150926-003')
      or lr.wash_cycle_id in (select id from wash_cycles where serial = '150926-003');
  if v_guard <> 0 then
    raise exception 'Guard failed: lab_results exist for 150926-003 -- aborting reversal' using errcode = '22023';
  end if;

  select count(*) into v_guard from rezka_sends where serial = '150926-003';
  if v_guard <> 0 then
    raise exception 'Guard failed: rezka_sends exist for 150926-003 -- aborting reversal' using errcode = '22023';
  end if;

  -- Full pre-reversal snapshot for the audit trail, captured before any write.
  select jsonb_build_object(
    'kirim_lines', (select row_to_json(kl) from kirim_lines kl where kl.serial = '150926-003'),
    'kirim_orders', (select row_to_json(ko) from kirim_orders ko
                     where ko.order_id = (select order_id from kirim_lines where serial = '150926-003')),
    'moyka_sends', (select jsonb_agg(row_to_json(ms)) from moyka_sends ms where ms.serial = '150926-003'),
    'wash_cycles', (select jsonb_agg(row_to_json(wc)) from wash_cycles wc where wc.serial = '150926-003'),
    'serial_mint_sources', (select jsonb_agg(row_to_json(sms)) from serial_mint_sources sms where sms.minted_serial = '150926-003'),
    'source_pallets_before', (select jsonb_agg(row_to_json(fp)) from finished_pallets fp
                              where fp.barcode2 in (
                                'PLT-020826-034-06-5','PLT-020826-034-06-6','PLT-020826-034-06-7',
                                'PLT-020826-034-06-8','PLT-020826-034-06-9'))
  ) into v_snapshot;

  -- 1. moyka_sends
  delete from moyka_sends where serial = '150926-003';

  -- 2. wash_cycles active row -- only the one opened by this mint, and
  -- only if it still carries no lab data (belt-and-braces; already
  -- guarded above).
  delete from wash_cycles
   where serial = '150926-003'
     and closed_at is null
     and not exists (select 1 from lab_results lr where lr.wash_cycle_id = wash_cycles.id);

  -- 3. restore consumed source pallets to their pre-mint state. Weight_kg
  -- and any pre-existing chiqim_pallet_consumption rows are untouched --
  -- only the mint's own status flip is undone.
  update finished_pallets
     set status = 'in_stock'
   where barcode2 in (
     'PLT-020826-034-06-5','PLT-020826-034-06-6','PLT-020826-034-06-7',
     'PLT-020826-034-06-8','PLT-020826-034-06-9'
   ) and status = 'consumed';

  -- No old_kn_collections/old_kn_pools weight-pool draws to refund here --
  -- all 5 serial_mint_sources rows for 150926-003 are source_kind='pallet'.

  -- 4. serial_mint_sources lineage rows
  delete from serial_mint_sources where minted_serial = '150926-003';

  -- 5. the minted kirim_lines row and its dedicated kirim_orders row (the
  -- order was created solely for this mint by mint_serial_from_sources --
  -- confirmed exactly one kirim_lines row references it, and zero
  -- gate_weighings/storage_intake rows exist for it, so there are no
  -- gate/intake dependencies to worry about).
  delete from kirim_lines where serial = '150926-003';
  delete from kirim_orders where order_id = (v_snapshot->'kirim_orders'->>'order_id')::uuid;

  -- 6. audit trail -- one entry naming this as a manual reversal, carrying
  -- the full pre-reversal snapshot.
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('kirim_lines', '150926-003', null, 'manual_reversal',
    v_snapshot || jsonb_build_object('reason',
      'Full manual reversal of the Moyka send for 150926-003 (2900kg, sent 2026-09-15). Nothing downstream existed (zero finished_pallets, zero lab_results, zero rezka_sends). Un-retired the 5 source pallets (PLT-020826-034-06-5..9) back to in_stock, refunded no weight-pool draws (none existed), removed the serial_mint_sources/wash_cycles/moyka_sends rows, and deleted the minted kirim_lines + kirim_orders rows.'),
    null, now());
end $$;
