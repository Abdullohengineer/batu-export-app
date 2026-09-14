-- Applied 2026-09-14 against project qohoqbapevrcjqxbstxi.
-- One-off data correction (single row), see
-- docs/decisions/0187-2026-09-14-110826-001-closed-at-restored-to-august.md.
--
-- Serial 110826-001: finalized 2026-08-28, closed 2026-08-29 (10:11:17+00).
-- On 2026-09-02, docs/decisions/0161 reopened it (closed_at -> null) to
-- register a post-hoc K6 pallet (10 kg, received_date backdated to
-- 2026-08-28 -- confirmed live, not the 2026-09-02 collection date 0161's
-- own text originally described). It was re-closed the same day
-- (2026-09-02 09:51:19+00) via a real Yakunlash action, landing the 140 kg
-- realized loss (kirim_line_state confirms unchanged: sent 7320, received
-- 7180) in September under this session's new period-scoped Yo'qotish
-- design (docs/decisions/0186) -- even though every physical event for
-- this serial (arrival, moyka send, all output pallets including the K6
-- correction) happened in August. The only September event at all is an
-- unrelated CHIQIM dispatch on 2026-09-12 of one already-produced pallet.
--
-- Correction: restore closed_at to its pre-reopen, already-documented
-- value (2026-08-29 10:11:17+00, quoted verbatim in 0161's own text) now
-- that the K6 correction it was reopened for is already reflected in
-- finished_pallets. This does not change the loss AMOUNT (client_serial_
-- loss_kg is a lifetime sum, unaffected by closed_at's exact date) -- only
-- which period recognizes it, correctly moving it back to August where the
-- material was actually, physically accounted for.

begin;

with before_row as (
  select id, closed_at, status, finalized_at from wash_cycles where serial = '110826-001'
),
updated as (
  update wash_cycles
  set closed_at = '2026-08-29 10:11:17+00'::timestamptz
  where serial = '110826-001'
  returning id, closed_at, status, finalized_at
)
insert into audit_log (table_name, row_id, action, before, after, at)
select
  'wash_cycles',
  (select id::text from before_row),
  'update',
  jsonb_build_object('serial', '110826-001', 'closed_at', (select closed_at from before_row), 'status', (select status from before_row)),
  jsonb_build_object('serial', '110826-001', 'closed_at', (select closed_at from updated), 'status', (select status from updated)),
  now()
from updated;

commit;

-- Verified after applying (live report_query_page, not just kirim_line_state):
--   August (all 5 rows -- kirim/moyka_send/2 chiqim/moyka_output): state_moykada=0, state_yoqotish=140
--   September (the one chiqim dispatch row): state_moykada=0, state_yoqotish=null (blank)
-- Full-dataset invariant sweep (every serial with a wash cycle, every month
-- Jan 2025-Sep 2026, re-run after this correction): 0 violations.
