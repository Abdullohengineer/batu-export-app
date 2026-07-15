-- Re-point moyka_sends.serial FK → kirim_lines(serial) (SPEC §5.2, §8;
-- DECISIONS.md "Serial is per type-line" + the FK-ripple notes from Steps
-- 1–3). Same fix Step 3 applied to storage_intake, now for moyka_sends.
--
-- Background (verified from the migration files — this session had no live
-- DB/MCP): Phase 0's moyka_sends.serial referenced kirim_orders(serial);
-- 0009 dropped that FK when serial moved off kirim_orders onto kirim_lines,
-- and no later migration re-pointed it — so moyka_sends.serial has been
-- unconstrained text ever since. This step is the first to write Moyka
-- sends, so it's the right time to restore referential integrity.
--
-- NOT touched (deliberately): moyka_sends keeps its existing shape
-- (id, serial, wash_cycle default 1, sent_date, qty_kg, created_by) — the
-- append-only event log. No komment column added: "Qaydlar qo'shish" (§5.2)
-- uses the shared, append-only `notes` table instead (see DECISIONS.md).
-- No sent_to_moyka_qty / available_qty column added to storage_intake:
-- available balance is DERIVED by summing moyka_sends, per §2.15's
-- "store events, derive numbers" — the same reason wash_cycles has no
-- stored sent_qty. RLS already correct (read_all + ombor_writes, 0007).

alter table moyka_sends
  add constraint moyka_sends_serial_fkey foreign key (serial) references kirim_lines(serial);
