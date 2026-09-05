-- Data correction (not a schema migration — one-off, applied directly via
-- SQL, archived here per docs/DECISIONS.md "2026-09-03 — K6/110826-001
-- redate: correcting the 2026-09-02 correction" for the full context).
--
-- Re-dates the post-hoc K6 pallet on serial 110826-001
-- (PLT-110826-001-06-1) from its SQL-registration date (2026-09-02) to its
-- real physical event date (2026-08-28), matching the serial's other real
-- pallets. Confirmed by Abdulloh directly (account owner, first-hand
-- knowledge of the physical event) after investigation could not itself
-- corroborate either date from the data alone.
--
-- Dry-run verified first (BEGIN...ROLLBACK) against live data: produced
-- Hisobot MOYKADAN August 2026 = 40,200 kg (was 40,190), September 2026 =
-- 3,180 kg (was 3,190), rahbar_dashboard_ledger and get_client_report
-- (Global Export Company) agreeing exactly, yield_rows(110826-001) loss
-- unchanged at 140 kg. Applied for real only after the dry run matched.
--
-- Request B (chiqim_requests 061ac7f8-e3f7-4fd0-a2ba-06dbc3723683, plate
-- PIYODA) is explicitly NOT touched by this correction — see the
-- DECISIONS.md entry for why (it becomes temporally consistent once this
-- pallet's date is corrected, and was left as the record of what actually
-- happened rather than voided or deleted).

begin;

update finished_pallets
set received_date = '2026-08-28'
where barcode2 = 'PLT-110826-001-06-1';

insert into audit_log (table_name, row_id, actor, action, before, after, at)
values (
  'finished_pallets',
  'PLT-110826-001-06-1',
  null, -- SQL correction, not an app action by any one user — same convention
        -- the original 2026-09-02 correction used, for the same reason.
  'update_correction',
  jsonb_build_object('received_date', '2026-09-02'),
  jsonb_build_object('received_date', '2026-08-28'),
  now()
);

commit;
