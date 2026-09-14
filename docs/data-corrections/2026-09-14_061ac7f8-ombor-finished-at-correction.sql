-- Applied 2026-09-14 against project qohoqbapevrcjqxbstxi.
-- Data correction (isolated) -- see docs/decisions/0188-2026-09-14-chiqim-
-- regrain-departure-date-dispatch-rollup.md for the full context: this
-- correction was found mid-way through wiring Change 3 of that task, when
-- request 061ac7f8 (plate PIYODA, 30 kg) turned up as a genuine third
-- September 1-12 dispatch line under the new departure-date basis, instead
-- of the two expected.
--
-- Root cause: chiqim_requests.ombor_finished_at for 061ac7f8 was
-- 2026-09-02 05:31 -- the moment the Ombor operator got around to entering
-- the record, not when the truck actually departed. The goods physically
-- left 2026-08-28 (matching request_date), corroborated by created_by
-- being a distinct operator account (b9513ec3...) from every other live
-- chiqim_request (all created by the normal Ombor account, 13a62281...) --
-- consistent with a backfilled/late entry.
--
-- Systemic check performed BEFORE applying (see decision doc for the full
-- table): of all 10 live chiqim_requests with ombor_finished_at set, only
-- 061ac7f8 crosses a month boundary (request_date 2026-08-28 vs
-- ombor_finished_at originally 2026-09-02). d43103ff has a 2-day gap but
-- stays within August; every other request has gap_days=0. Confirmed
-- ISOLATED, not a systemic late-entry pattern -- Change 2's departure-date
-- basis logic itself is not called into question by this one bad record.
--
-- Before: ombor_finished_at = 2026-09-02T05:31:18.710974+00:00
-- After:  ombor_finished_at = 2026-08-28T12:00:00+00:00

begin;

insert into audit_log (table_name, row_id, actor, action, before, after)
select
  'chiqim_requests',
  id::text,
  auth.uid(),
  'update',
  jsonb_build_object('id', id, 'ombor_finished_at', ombor_finished_at),
  jsonb_build_object('id', id, 'ombor_finished_at', '2026-08-28T12:00:00+00:00'::timestamptz)
from chiqim_requests
where id = '061ac7f8-e3f7-4fd0-a2ba-06dbc3723683';

update chiqim_requests
set ombor_finished_at = '2026-08-28T12:00:00+00:00'::timestamptz
where id = '061ac7f8-e3f7-4fd0-a2ba-06dbc3723683';

commit;

-- Verified live after applying:
--   - chiqim_requests.061ac7f8.ombor_finished_at = 2026-08-28 12:00:00+00
--   - chiqim_departed_at('061ac7f8') now returns 2026-08-28
--   - report_dispatch_rows_v2 Sep 1-12: exactly 2 lines, 28,970 kg total
--     (4b639af5 8,640 + 545883f6 20,330) -- the 30 kg moved to August as
--     expected (August total: 69,151 kg, includes this 30 kg)
--   - audit_log row 1356 records the before/after pair
