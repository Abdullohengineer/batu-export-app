-- Multi-wash support, schema only (DDL). No data migration in this file --
-- see 0126 for the three-serial backfill, deliberately unapplied until
-- this file and 0125 are reviewed and merged. docs/decisions/0191.
--
-- Semantic shift: wash_cycles now represents ONE WASH OF ONE PORTION of a
-- serial, not one wash per serial for the serial's whole life. Table name
-- kept (rename to `washes` is a deliberate, tracked follow-up -- see
-- docs/decisions/0191 -- not bundled here to keep this diff reviewable).
--
-- Trigger: a raw remainder sent to Moyka again after a serial's first wash
-- had already closed (wash_cycles.closed_at set) was permanently invisible
-- in Ombor's "Moykada" window -- isInMoyka() excludes any closed serial,
-- full stop, by design (Yakunlash = "no more material expected"). That
-- assumption breaks the moment more raw material for the same serial is
-- genuinely sent later. Fixing this by simply clearing closed_at was
-- rejected: every consumer of wash_cycles (yield_rows chief among them)
-- sums moyka_sends/finished_pallets for the WHOLE serial, so clearing
-- closed_at would have retroactively folded the serial's already-realized,
-- already-reported loss back into "still in process."

-- 1. wash_no, defaulting every existing row to 1 -- preserves the current
--    one-row-per-serial history as "wash 1" of each serial.
alter table wash_cycles add column wash_no int not null default 1;

-- 2. Composite uniqueness replaces the single-column one -- a serial may
--    now have wash_no 1, 2, 3...
alter table wash_cycles drop constraint wash_cycles_serial_key;
alter table wash_cycles add constraint wash_cycles_serial_wash_no_key unique (serial, wash_no);

-- 3. At most one OPEN wash per serial, ever. This is also the fact
--    close_wash_cycle_if_settled/close_wash_cycle_serial's own
--    `where serial = p_serial and closed_at is null` predicates rely on
--    (0125) to unambiguously target "the" open row without a separate
--    wash_no lookup, and what open_or_continue_wash's gate (0125) depends
--    on to safely decide whether a new wash may be opened.
create unique index wash_cycles_one_open_per_serial on wash_cycles (serial) where closed_at is null;

-- 4. moyka_sends: which wash a send belongs to. NOT NULL is safe here --
--    a moyka_sends row never exists without a wash_cycles row (both
--    OmborMoykaTab.handleSend and send_old_stock_to_moyka write
--    wash_cycles immediately before moyka_sends) -- never a Rezka
--    concern (Rezka never touches moyka_sends).
alter table moyka_sends add column wash_no int;
update moyka_sends set wash_no = 1 where wash_no is null;
alter table moyka_sends alter column wash_no set not null;
alter table moyka_sends add constraint moyka_sends_serial_wash_no_fkey
  foreign key (serial, wash_no) references wash_cycles (serial, wash_no);

-- 5. finished_pallets: DELIBERATELY NULLABLE, not NOT NULL. finished_pallets
--    is shared with Rezka (rezka_cycles, not wash_cycles -- see
--    0076_rezka_data_layer.sql and the live finished_pallets_ombor_writes
--    policy's `or exists (select 1 from rezka_cycles ...)` OR-branch,
--    already in production even though Rezka stage 2 hasn't shipped;
--    prevent_dual_process_serial guarantees a serial can never have both
--    a wash_cycles row and a rezka_cycles row). A Rezka-cut pallet has no
--    wash_cycles row, ever. Backfilling wash_no=1 NOT NULL here would
--    either fail outright once a Rezka serial exists (no matching
--    wash_cycles(serial,1) row to satisfy the FK) or, worse, silently
--    mis-tag a real Rezka pallet as Moyka wash-1 output. NULL = "not
--    Moyka-wash output" (Rezka, or any other non-wash origin). The FK
--    only checks non-null values (Postgres default MATCH SIMPLE) -- 0
--    Rezka pallets exist today (confirmed live), so this is a no-op now
--    and the correct guard once Rezka ships.
alter table finished_pallets add column wash_no int;
update finished_pallets set wash_no = 1
  where exists (select 1 from wash_cycles wc where wc.serial = finished_pallets.serial);
alter table finished_pallets add constraint finished_pallets_serial_wash_no_fkey
  foreign key (serial, wash_no) references wash_cycles (serial, wash_no);
