-- Data correction (2026-08-03). Two problems on the same 1,040 kg of
-- opening stock, fixed together because the second caused the first to be
-- discovered:
--
-- Problem 1 (the user's own transcription error, owned and reported by
-- them): 1,040 kg of K6 old-washed stock was seeded as "Qand" from a
-- misread of the original spreadsheet screenshot. It belongs to "Qand
-- Qizil" instead. Qand should only ever have carried the 50 kg K8 line.
--
-- Problem 2 (this agent's error): the Stage 3 live-verification test
-- (migrations 0053-0056) re-washed two real seeded pallets
-- (PLT-020826-037-06-1/-2, serial 020826-040) instead of using disposable
-- TEST- fixtures, per the standing rule added to CLAUDE.md alongside this
-- migration. Those two pallets are exactly the misattributed K6 stock, so
-- the revert and the reattribution have to happen in the same operation --
-- reverting first, then reattributing, would leave a moment where the
-- reverted pallets still carried the wrong product type.
--
-- PART A reverts the entire Stage 3 test chain in FK-safe order, restoring
-- serial 020826-040's two consumed pallets back to a clean pre-mint state.
-- PART B then reissues those two pallets onto the correct Qand Qizil
-- serial (020826-038) under new barcodes -- barcode2 encodes the parent
-- serial (PLT-<serial>-<calibre>-<seq>), so moving product between serials
-- means a new barcode2, not an update. Safe here specifically because
-- old-washed pallets are never physically labelled at seed time (Stage 2's
-- print-per-row/print-all exists precisely because of that), confirmed
-- with the user before running: "No labels have been printed from old
-- stock -- proceed with the barcode reissue as planned."
--
-- Pallet weights (720/320) match Stage 1's own bucketing rule (720 kg/full
-- pallet + remainder) applied to 1,040 kg. declared_qty on both kirim_lines
-- is corrected to match: Qand 50 (K8 only), Qand Qizil 1,220 (1,040 K6 +
-- 180 K8).
--
-- See docs/DECISIONS.md "Opening stock data correction + test-pollution
-- revert" for the full verification trail.

-- PART A: revert the Stage 3 test chain (FK-safe order)
delete from notes where entity_type = 'moyka' and entity_id = '020826-040';
delete from lab_results where wash_cycle_id in (select id from wash_cycles where serial = '020826-040');
delete from finished_pallets where serial = '020826-040';
delete from moyka_sends where serial = '020826-040';
delete from wash_cycles where serial = '020826-040';
delete from serial_mint_sources where minted_serial = '020826-040';
delete from kirim_orders where order_id in (select order_id from kirim_lines where serial = '020826-040');
delete from kirim_lines where serial = '020826-040';

-- PART B: reattribute the 1,040 kg K6 from Qand to Qand Qizil
delete from finished_pallets where barcode2 in ('PLT-020826-037-06-1', 'PLT-020826-037-06-2');
insert into finished_pallets
  (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, is_old_stock, weight_is_estimate)
select v.barcode2, '020826-038',
       '35c5c93a-d5be-410e-8694-fac3a7ab861b'::uuid,   -- Qand qizil
       '7fc8a3a9-a347-499b-8475-150060605bd6'::uuid,   -- Kalibr 6
       v.kg, '2025-01-01'::date, 'in_stock'::pallet_status, true, true
from (values ('PLT-020826-038-06-1', 720::numeric),
             ('PLT-020826-038-06-2', 320::numeric)) as v(barcode2, kg)
where exists (select 1 from kirim_lines where serial = '020826-038')
on conflict (barcode2) do nothing;

update kirim_lines set declared_qty = 50   where serial = '020826-037';  -- Qand: K8 50
update kirim_lines set declared_qty = 1220 where serial = '020826-038';  -- Qand Qizil: K6 1040 + K8 180
