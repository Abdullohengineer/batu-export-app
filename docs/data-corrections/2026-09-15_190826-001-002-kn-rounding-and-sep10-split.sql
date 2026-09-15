-- Applied 2026-09-15 against project qohoqbapevrcjqxbstxi.
-- Two related data corrections to KN (Konditerka) pallets on serials
-- 190826-001 (P10-S) and 190826-002 (P11), applied together in one
-- transaction. See docs/decisions/0190-2026-09-15-190826-001-002-kn-
-- rounding-and-sep10-split.md for full context and verification.
--
-- Correction 1 -- 10kg-box rounding. KN pallets are packed in 10kg boxes,
-- so quantities must be multiples of 10. Two live KN pallets weren't:
--   PLT-190826-001-KN-2: 1,997 -> 2,000 kg
--   PLT-190826-002-KN-1: 2,573 -> corrected further by Correction 2 below
--     (not left at the rounded 2,570 -- see next section)
--
-- Correction 2 -- Sep 10 KN output total. Operator confirmed a real
-- physical event: part of PLT-190826-002-KN-1's contents came out
-- 2026-09-10, the rest 2026-09-12, but the whole 2,573kg had been logged
-- as one pallet dated 2026-09-12. Requested total KN output on 2026-09-10
-- (factory-wide, across all serials): exactly 2,260kg. Before this
-- correction, only PLT-190826-001-KN-2 (2,000kg after Correction 1) was
-- dated 2026-09-10 -- 260kg short of the target.
--
-- Fixed by splitting PLT-190826-002-KN-1 into two records for the SAME
-- serial (190826-002) -- never redistributing weight across DIFFERENT
-- serials, which would mean attributing one wash cycle's physical output
-- to another's:
--   PLT-190826-002-KN-1: reduced to 2,310 kg, stays dated 2026-09-12 ("the
--     rest, later")
--   PLT-190826-002-KN-3 (new): 260 kg, dated 2026-09-10 -- confirmed by
--     operator as a real event; confirmed a synthetic new barcode (no
--     pre-existing physical label for this split) was acceptable.
--
-- 2,310 + 260 = 2,570 = the Correction-1-rounded total for this pallet --
-- serial 190826-002's own aggregate KN output, and therefore its own
-- computed loss (client_serial_loss_kg), is UNCHANGED by the split.
--
-- No Kalibr (K1-K8) pallets touched -- confirmed live before applying that
-- PLT-190826-001-02-1 (Kalibr 2, 250kg, dated 2026-09-10, the operator's
-- own reference point) is untouched, and this SQL only ever names KN
-- barcodes.
--
-- Expected/verified results (client_serial_loss_kg, live before and after):
--   190826-001 (P10-S): loss 688 -> 685 kg
--   190826-002 (P11):   loss 689 -> 692 kg  (7 kg apart, per operator)
--   Sep 10 KN total (factory-wide): 2,000 -> 2,260 kg
--   Sep 10 Kalibr-2 total: 250 kg, unchanged

begin;

insert into audit_log (table_name, row_id, action, before, after)
values (
  'finished_pallets', 'PLT-190826-001-KN-2', 'update',
  jsonb_build_object('barcode2','PLT-190826-001-KN-2','weight_kg',1997),
  jsonb_build_object('barcode2','PLT-190826-001-KN-2','weight_kg',2000)
);
update finished_pallets set weight_kg = 2000 where barcode2 = 'PLT-190826-001-KN-2';

insert into audit_log (table_name, row_id, action, before, after)
values (
  'finished_pallets', 'PLT-190826-002-KN-1', 'update',
  jsonb_build_object('barcode2','PLT-190826-002-KN-1','weight_kg',2573,'received_date','2026-09-12'),
  jsonb_build_object('barcode2','PLT-190826-002-KN-1','weight_kg',2310,'received_date','2026-09-12', 'note', '260kg split off to new pallet PLT-190826-002-KN-3, dated 2026-09-10')
);
update finished_pallets set weight_kg = 2310 where barcode2 = 'PLT-190826-002-KN-1';

insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate)
values ('PLT-190826-002-KN-3', '190826-002', '48aebd73-1de9-4edb-802a-ad38e197fc7e', '445fd28d-1f1a-4612-950b-3d5bc7b541ac', 260, '2026-09-10', 'in_stock', 'b9513ec3-f687-4d59-b491-e47fd30ecbeb', false, false);

insert into audit_log (table_name, row_id, action, before, after)
values (
  'finished_pallets', 'PLT-190826-002-KN-3', 'insert',
  null,
  jsonb_build_object('barcode2','PLT-190826-002-KN-3','serial','190826-002','weight_kg',260,'received_date','2026-09-10','note','split off from PLT-190826-002-KN-1 to correctly date the Sep 10 portion of that batch''s KN output')
);

commit;

-- Verified live after applying:
--   - PLT-190826-001-KN-2: 2,000 kg, 2026-09-10
--   - PLT-190826-002-KN-1: 2,310 kg, 2026-09-12
--   - PLT-190826-002-KN-3: 260 kg, 2026-09-10 (new)
--   - client_serial_loss_kg('190826-001') = 685
--   - client_serial_loss_kg('190826-002') = 692
--   - Sep 10 KN total (factory-wide) = 2,260
--   - audit_log ids 1368, 1369, 1370 record all three changes
