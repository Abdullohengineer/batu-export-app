-- Data correction (not a schema migration — one-off, applied directly via
-- SQL, archived here per docs/DECISIONS.md "2026-09-08 — P8/P9 moyka batch
-- reconciliation" for the full context).
--
-- On 2026-09-05, ~590 kg of serial 110826-003's (Partiya 8) moyka output was
-- physically mixed into serial 180826-001's (Partiya 9) processing run and
-- registered entirely under 180826-001. This corrects the split: voids the
-- 3 finished_pallets rows on 180826-001 whose weight needs reducing,
-- replaces them with corrected weights, and adds the material that
-- physically belongs to 110826-003 as new rows there.
--
-- Dates: the 3 new 110826-003 rows are dated 2026-09-03 (that serial's real
-- finish date, confirmed by Abdulloh); the 3 replacement 180826-001 rows
-- are dated 2026-09-05 (that serial's real finish date) — not the
-- 2026-09-07 registration date the now-voided rows carried. Same dating
-- principle as the 2026-09-03 K6/110826-001 correction: real physical
-- event date, not the SQL-registration date.
--
-- Dry-run verified first (BEGIN...ROLLBACK) against live data: reproduced
-- the exact target end state (P8 6,590 kg output / P9 7,290 kg output,
-- both broken down by calibre) before anything was committed. Applied for
-- real only after the dry run matched exactly.
--
-- `moyka_sends` (7,190 kg / 7,960 kg) was already correct for both serials
-- and is untouched. No chiqim_pallet_consumption, serial_mint_sources, or
-- sampled-pallet lab_results referenced any of the touched pallets —
-- confirmed before writing, nothing downstream needed unwinding.

begin;

-- Void the 3 pallets on 180826-001 whose recorded weight needs reducing.
update finished_pallets
set status = 'bekor_qilindi', voided_at = now()
where barcode2 in ('PLT-180826-001-04-2', 'PLT-180826-001-06-1', 'PLT-180826-001-KN-2');

insert into audit_log (table_name, row_id, actor, action, before, after, at) values
('finished_pallets','PLT-180826-001-04-2',null,'update_correction',
  jsonb_build_object('status','in_stock','weight_kg',3610),
  jsonb_build_object('status','bekor_qilindi','reason','P8/P9 moyka batch reconciliation -- superseded by corrected split'),
  now()),
('finished_pallets','PLT-180826-001-06-1',null,'update_correction',
  jsonb_build_object('status','in_stock','weight_kg',580),
  jsonb_build_object('status','bekor_qilindi','reason','P8/P9 moyka batch reconciliation -- superseded by corrected split'),
  now()),
('finished_pallets','PLT-180826-001-KN-2',null,'update_correction',
  jsonb_build_object('status','in_stock','weight_kg',1430),
  jsonb_build_object('status','bekor_qilindi','reason','P8/P9 moyka batch reconciliation -- superseded by corrected split'),
  now());

-- Replacement pallets on 180826-001, corrected weight, real finish date.
insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, is_old_stock, weight_is_estimate)
values
('PLT-180826-001-04-3','180826-001','48aebd73-1de9-4edb-802a-ad38e197fc7e','930b7b1b-4069-46ef-b9d6-dbe657c38aa0',3230,'2026-09-05','in_stock',false,false),
('PLT-180826-001-06-2','180826-001','48aebd73-1de9-4edb-802a-ad38e197fc7e','7fc8a3a9-a347-499b-8475-150060605bd6',520,'2026-09-05','in_stock',false,false),
('PLT-180826-001-KN-3','180826-001','48aebd73-1de9-4edb-802a-ad38e197fc7e','445fd28d-1f1a-4612-950b-3d5bc7b541ac',1280,'2026-09-05','in_stock',false,false);

insert into audit_log (table_name, row_id, actor, action, before, after, at) values
('finished_pallets','PLT-180826-001-04-3',null,'insert_correction', null,
  jsonb_build_object('serial','180826-001','weight_kg',3230,'received_date','2026-09-05','reason','P8/P9 moyka batch reconciliation -- replaces voided PLT-180826-001-04-2'),
  now()),
('finished_pallets','PLT-180826-001-06-2',null,'insert_correction', null,
  jsonb_build_object('serial','180826-001','weight_kg',520,'received_date','2026-09-05','reason','P8/P9 moyka batch reconciliation -- replaces voided PLT-180826-001-06-1'),
  now()),
('finished_pallets','PLT-180826-001-KN-3',null,'insert_correction', null,
  jsonb_build_object('serial','180826-001','weight_kg',1280,'received_date','2026-09-05','reason','P8/P9 moyka batch reconciliation -- replaces voided PLT-180826-001-KN-2'),
  now());

-- New pallets on 110826-003 for the material that physically belongs to it.
insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, is_old_stock, weight_is_estimate)
values
('PLT-110826-003-04-3','110826-003','48aebd73-1de9-4edb-802a-ad38e197fc7e','930b7b1b-4069-46ef-b9d6-dbe657c38aa0',380,'2026-09-03','in_stock',false,false),
('PLT-110826-003-06-1','110826-003','48aebd73-1de9-4edb-802a-ad38e197fc7e','7fc8a3a9-a347-499b-8475-150060605bd6',60,'2026-09-03','in_stock',false,false),
('PLT-110826-003-KN-3','110826-003','48aebd73-1de9-4edb-802a-ad38e197fc7e','445fd28d-1f1a-4612-950b-3d5bc7b541ac',150,'2026-09-03','in_stock',false,false);

insert into audit_log (table_name, row_id, actor, action, before, after, at) values
('finished_pallets','PLT-110826-003-04-3',null,'insert_correction', null,
  jsonb_build_object('serial','110826-003','weight_kg',380,'received_date','2026-09-03','reason','P8/P9 moyka batch reconciliation -- material physically produced by 110826-003, mistakenly registered under 180826-001 as PLT-180826-001-04-2'),
  now()),
('finished_pallets','PLT-110826-003-06-1',null,'insert_correction', null,
  jsonb_build_object('serial','110826-003','weight_kg',60,'received_date','2026-09-03','reason','P8/P9 moyka batch reconciliation -- material physically produced by 110826-003, mistakenly registered under 180826-001 as PLT-180826-001-06-1'),
  now()),
('finished_pallets','PLT-110826-003-KN-3',null,'insert_correction', null,
  jsonb_build_object('serial','110826-003','weight_kg',150,'received_date','2026-09-03','reason','P8/P9 moyka batch reconciliation -- material physically produced by 110826-003, mistakenly registered under 180826-001 as PLT-180826-001-KN-2'),
  now());

commit;
