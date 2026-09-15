-- ============================================================================
-- DO NOT APPLY YET.
--
-- This file is NOT to be run against the live project until 0124 (schema)
-- and 0125 (SQL batch 1) -- plus get_client_report and rahbar_dashboard_ledger
-- (their own follow-up commits) and the frontend batch -- have all been
-- reviewed and merged to main. Applying this alone, against the CURRENT
-- (pre-multi-wash) live schema, will fail outright (wash_no doesn't exist
-- yet); applying it after 0124/0125 but before the report-layer fixes land
-- would silently misreport these three serials in every consumer this
-- migration series touches. docs/decisions/0191.
--
-- Deliberate exception to "never mutate, only append" (CLAUDE.md workflow
-- rule) -- this is the one-time backfill that makes the new schema match
-- reality for rows that predate it, not a routine data correction. See
-- docs/decisions/0191 for the full incident writeup.
-- ============================================================================

-- Opens wash 2 for the three serials whose raw remainder was sent to Moyka
-- on 2026-09-15 while wash 1 was already closed under the pre-0086
-- Tugallash system. Wash 1 rows are untouched by this file -- already
-- wash_no=1 via 0124's backfill default; status='final', final_loss_pct
-- 2.24/2.22/2.27 (stored on wash_cycles, confirmed live), closed_at
-- 2026-08-29 stay exactly as they are.
--
-- moyka_sends ids and amounts verified directly against the live database
-- before writing this file:
--   290726-068 (P1): id 32c7e5c3-8c04-48a5-b9a6-97b922f1fd20, 92 kg
--   290726-069 (P2): id fc2fadfa-831d-4d96-8f22-49ee7d8376b3, 29 kg
--   290726-072 (P4): id f80f57f8-705f-4c9f-b88f-fdd461b28d41, 36 kg

do $$
begin
  insert into wash_cycles (serial, wash_no, status, closed_at) values ('290726-068', 2, 'active', null);
  update moyka_sends set wash_no = 2 where id = '32c7e5c3-8c04-48a5-b9a6-97b922f1fd20';

  insert into wash_cycles (serial, wash_no, status, closed_at) values ('290726-069', 2, 'active', null);
  update moyka_sends set wash_no = 2 where id = 'fc2fadfa-831d-4d96-8f22-49ee7d8376b3';

  insert into wash_cycles (serial, wash_no, status, closed_at) values ('290726-072', 2, 'active', null);
  update moyka_sends set wash_no = 2 where id = 'f80f57f8-705f-4c9f-b88f-fdd461b28d41';
end $$;
