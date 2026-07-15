-- Re-point finished_pallets.serial and wash_cycles.serial FKs →
-- kirim_lines(serial) (SPEC §5.3, §8; CLAUDE.md "Serial lives on
-- kirim_lines"). The last two tables still carrying the Phase-0 FK ripple.
--
-- Background (verified from migration files — no live DB/MCP this session):
-- both tables' serial FK referenced kirim_orders(serial); 0009 dropped both
-- when serial moved onto kirim_lines, and no later migration re-pointed them
-- — so both serial columns have been unconstrained text since. Steps 2/3/5
-- fixed gate_weighings / storage_intake / moyka_sends the same way; this
-- step is the first to write finished_pallets and wash_cycles, so it
-- restores their integrity now.
--
-- NOT changed: RLS is already correct on both (read_all + ombor_writes +
-- ombor_updates, 0007). No columns added — Tugallash's locked yield-loss
-- uses the existing wash_cycles.final_loss_pct + status='final'; per-serial
-- Yuborilgan/Qabul qilingan/Jarayonda totals are DERIVED (Σ moyka_sends vs
-- Σ finished_pallets), not stored (CLAUDE.md "derive, don't store").

alter table finished_pallets
  add constraint finished_pallets_serial_fkey foreign key (serial) references kirim_lines(serial);

alter table wash_cycles
  add constraint wash_cycles_serial_fkey foreign key (serial) references kirim_lines(serial);
