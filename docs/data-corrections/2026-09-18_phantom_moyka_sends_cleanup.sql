-- Applied 2026-09-18 against project qohoqbapevrcjqxbstxi.
-- One-off data correction (three rows), see
-- docs/decisions/0195-2026-09-18-phantom-moyka-sends-cleanup-290726-068-069-072.md.
--
-- Serials 290726-068/069/072 each had their main processing closed
-- (Yakunlash) on 2026-08-29, leaving a genuine raw residual (92/29/36 kg)
-- unsent in Ombor. On 2026-09-15, an attempted combined Moyka send of the
-- three residuals (157 kg total) read as additional loss on the closed
-- serials -- traced (see the read-only investigation preceding this
-- correction) to client_serial_loss_kg / yield_rows / kirim_line_state all
-- computing an unconditional, all-time sum(moyka_sends) per serial once
-- closed_at is set, with no upper date bound and no check that the serial
-- is even still open. Abdulloh backed out of the attempt in the app, but
-- the send itself had already been written -- moyka_sends has no
-- status/void column, so there was nothing for the app's own undo (there
-- isn't one) to reverse. The three rows sat there, live-corrupting
-- Hisobot/Yield/Rahbar/client-report loss figures for all three serials
-- until this correction:
--   32c7e5c3-8c04-48a5-b9a6-97b922f1fd20  290726-068  92 kg  2026-09-15
--   fc2fadfa-831d-4d96-8f22-49ee7d8376b3  290726-069  29 kg  2026-09-15
--   f80f57f8-705f-4c9f-b88f-fdd461b28d41  290726-072  36 kg  2026-09-15
--
-- Correction: DELETE the three rows outright -- an explicit, documented
-- exception to CLAUDE.md's never-DELETE rule (see the DECISIONS.md entry
-- above for the justification: moyka_sends has no void column to soften
-- this with, and these rows never corresponded to a real send event in the
-- first place -- the actual 157 kg combined reprocess will be re-registered
-- properly once Path E (multi-cycle wash_cycles) ships, as its own real
-- send event, not by resurrecting these three).
--
-- Pre-flight verification (read-only, before touching anything):
--   select id, serial, sent_date, qty_kg from moyka_sends where id in (
--     '32c7e5c3-8c04-48a5-b9a6-97b922f1fd20',
--     'fc2fadfa-831d-4d96-8f22-49ee7d8376b3',
--     'f80f57f8-705f-4c9f-b88f-fdd461b28d41'
--   );
-- Confirmed all three rows present, matching serial/sent_date/qty_kg above,
-- no extras -- before proceeding.

begin;

with before_rows as (
  select id, serial, sent_date, qty_kg, created_by
  from moyka_sends
  where id in (
    '32c7e5c3-8c04-48a5-b9a6-97b922f1fd20',
    'fc2fadfa-831d-4d96-8f22-49ee7d8376b3',
    'f80f57f8-705f-4c9f-b88f-fdd461b28d41'
  )
),
deleted as (
  delete from moyka_sends
  where id in (
    '32c7e5c3-8c04-48a5-b9a6-97b922f1fd20',
    'fc2fadfa-831d-4d96-8f22-49ee7d8376b3',
    'f80f57f8-705f-4c9f-b88f-fdd461b28d41'
  )
  returning id
)
insert into audit_log (table_name, row_id, action, before, after, at)
select
  'moyka_sends',
  br.id::text,
  'delete',
  jsonb_build_object('serial', br.serial, 'sent_date', br.sent_date, 'qty_kg', br.qty_kg, 'created_by', br.created_by),
  null,
  now()
from before_rows br
join deleted d on d.id = br.id;

commit;

-- Verified after applying (live, all four affected surfaces):
--   client_serial_loss_kg: 068=50, 069=45, 072=53 (was 142/74/89)
--   yield_rows.loss_kg / loss_pct: 068=50/2.2, 069=45/2.0, 072=53/2.4
--     (was 142/5.9, 74/3.2, 89/4.0)
--   stock_on_hand_rows, bucket raw_not_washed: 068=92kg, 069=29kg, 072=36kg
--     (previously no row -- balance was exactly zeroed by the phantom sends)
--   kirim_line_state: moykaga_yuborilgan 068=2320/069=2255/072=2203,
--     omborda_qoldi 068=92/069=29/072=36, moykada=0 for all three (unchanged
--     -- gated on closed_at, which this correction does not touch)
-- No other table touched: wash_cycles.closed_at/status, finished_pallets,
-- lab_results all unaffected -- the original, correctly-booked 50/45/53 kg
-- loss and the serials' closed/final state are exactly as they were before
-- the 2026-09-15 attempt.
