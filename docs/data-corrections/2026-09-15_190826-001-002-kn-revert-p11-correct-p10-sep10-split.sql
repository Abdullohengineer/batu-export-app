-- Applied 2026-09-15 against project qohoqbapevrcjqxbstxi.
-- Corrects a scoping mistake in the immediately preceding correction
-- (docs/data-corrections/2026-09-15_190826-001-002-kn-rounding-and-sep10-
-- split.sql / docs/decisions/0190-2026-09-15-190826-001-002-kn-rounding-
-- and-sep10-split.md). See docs/decisions/0191-2026-09-15-190826-001-kn-
-- sep10-split-corrected-to-p10-only.md for full context.
--
-- The mistake: the "Sep 10 KN output must total 2,260kg" requirement was
-- scoped to P10 (serial 190826-001, Partiya 10) ONLY -- the operator never
-- asked to touch P11 (serial 190826-002, Partiya 11) for this. The prior
-- correction wrongly read it as a factory-wide total and sourced the
-- extra 260kg by splitting P11's own PLT-190826-002-KN-1 pallet. Operator
-- caught this and corrected it.
--
-- Part 1 -- revert the wrongful P11 split entirely:
--   PLT-190826-002-KN-3 (260kg, 2026-09-10, inserted in error) -- deleted.
--   PLT-190826-002-KN-1 -- restored from 2,310kg back to 2,570kg (its
--     correctly-rounded value from the FIRST correction, before the
--     erroneous split). received_date unchanged (2026-09-12).
--   P11's own total KN output and computed loss are therefore back to
--   exactly what the first correction produced (692kg) -- P11 is
--   untouched beyond that original 10kg-rounding fix, as intended all
--   along.
--
-- Part 2 -- apply the SAME split mechanism (already operator-approved),
-- correctly scoped to P10's own pallets this time:
--   PLT-190826-001-KN-1 (910kg, 2026-09-09) -- reduced to 650kg, stays
--     dated 2026-09-09.
--   PLT-190826-001-KN-3 (new): 260kg, dated 2026-09-10.
--   PLT-190826-001-KN-2 (2,000kg, 2026-09-10) -- untouched, already
--     correctly rounded.
--   P10's own total KN output (910+2000=2910 before, 650+260+2000=2910
--   after) is unchanged, so its computed loss (685kg, confirmed in the
--   first correction) is unaffected by this split either.
--
-- Result: P10's own Sep 10 KN total = 2,000 + 260 = 2,260kg, entirely on
-- P10 as requested. Factory-wide Sep 10 KN total is also 2,260kg (P11
-- contributes nothing to Sep 10 any more). No Kalibr pallets touched --
-- confirmed live both before and after that PLT-190826-001-02-1 (Kalibr
-- 2, 250kg, 2026-09-10) is unaffected.

begin;

-- Part 1: revert the wrongful P11 split
insert into audit_log (table_name, row_id, action, before, after)
values ('finished_pallets', 'PLT-190826-002-KN-3', 'delete',
  jsonb_build_object('barcode2','PLT-190826-002-KN-3','serial','190826-002','weight_kg',260,'received_date','2026-09-10'),
  jsonb_build_object('reason','erroneous insert -- the Sep 10 KN total requirement was scoped to P10 (190826-001) only, never P11 (190826-002); reverting this session''s own mistake')
);
delete from finished_pallets where barcode2 = 'PLT-190826-002-KN-3';

insert into audit_log (table_name, row_id, action, before, after)
values ('finished_pallets', 'PLT-190826-002-KN-1', 'update',
  jsonb_build_object('barcode2','PLT-190826-002-KN-1','weight_kg',2310,'received_date','2026-09-12'),
  jsonb_build_object('barcode2','PLT-190826-002-KN-1','weight_kg',2570,'received_date','2026-09-12','note','restored to the 10kg-rounded value; the wrongful split into this row + PLT-190826-002-KN-3 is fully reverted')
);
update finished_pallets set weight_kg = 2570 where barcode2 = 'PLT-190826-002-KN-1';

-- Part 2: correct fix, scoped to P10's own pallets
insert into audit_log (table_name, row_id, action, before, after)
values ('finished_pallets', 'PLT-190826-001-KN-1', 'update',
  jsonb_build_object('barcode2','PLT-190826-001-KN-1','weight_kg',910,'received_date','2026-09-09'),
  jsonb_build_object('barcode2','PLT-190826-001-KN-1','weight_kg',650,'received_date','2026-09-09','note','260kg split off to new pallet PLT-190826-001-KN-3, dated 2026-09-10, so P10''s own Sep 10 KN total reaches 2,260kg')
);
update finished_pallets set weight_kg = 650 where barcode2 = 'PLT-190826-001-KN-1';

insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status, created_by, is_old_stock, weight_is_estimate)
select 'PLT-190826-001-KN-3', serial, type_id, calibre_id, 260, '2026-09-10', status, created_by, is_old_stock, weight_is_estimate
from finished_pallets where barcode2 = 'PLT-190826-001-KN-1';

insert into audit_log (table_name, row_id, action, before, after)
values ('finished_pallets', 'PLT-190826-001-KN-3', 'insert', null,
  jsonb_build_object('barcode2','PLT-190826-001-KN-3','serial','190826-001','weight_kg',260,'received_date','2026-09-10','note','split off from PLT-190826-001-KN-1 so P10''s own Sep 10 KN total is 2,260kg, per operator correction')
);

commit;

-- Verified live after applying:
--   - PLT-190826-001-KN-1: 650 kg, 2026-09-09
--   - PLT-190826-001-KN-2: 2,000 kg, 2026-09-10 (unchanged)
--   - PLT-190826-001-KN-3: 260 kg, 2026-09-10 (new)
--   - PLT-190826-002-KN-1: 2,570 kg, 2026-09-12 (restored)
--   - PLT-190826-002-KN-2: 990 kg, 2026-09-13 (unchanged throughout)
--   - client_serial_loss_kg('190826-001') = 685 (unchanged)
--   - client_serial_loss_kg('190826-002') = 692 (restored)
--   - Sep 10 KN total (P10's own, and factory-wide) = 2,260
--   - audit_log entries record all four row changes (2 for the revert,
--     2 for the corrected split)
