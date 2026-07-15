-- storage_intake → v1.9 shape (SPEC §2.1, §2.2, §5.1, §8; DECISIONS.md
-- "Serial is per type-line" + the FK-ripple notes from Steps 1 and 2).
--
-- Inspected the real table before writing this, per the same discipline as
-- Steps 1 and 2 (this session had no live DB/MCP access, so this is from
-- the migration files, which is how the schema was confirmed live as of
-- Step 2's PR): Phase 0's 0004_storage.sql created `storage_intake` with
-- serial (PK), confirmed_at, pile_photo, barcode1, confirmed_by — same
-- ripple as gate_weighings: its FK to kirim_orders(serial) was dropped in
-- 0009 because kirim_orders no longer has a serial, leaving `serial`
-- unconstrained (still the PK, just not FK-linked to anything). No
-- actual_qty/status/komment/moisture/sulfur columns ever existed — §8's
-- STORAGE_STOCK pseudocode listed them from the start, but Phase 0's real
-- table never had them.

alter table storage_intake
  add constraint storage_intake_serial_fkey foreign key (serial) references kirim_lines(serial);

alter table storage_intake
  add column actual_qty numeric not null check (actual_qty >= 0),
  add column komment text,
  add column status text not null default 'skladda_turibdi',
  -- §8: "namligi, sulfur(pending)" — placeholder columns per §8's own
  -- design; NOT written by this step (Laborator's job, §5.5, a future
  -- step). Named to match lab_results.moisture_pct/so2_mg_kg for
  -- vocabulary consistency across the schema, not the literal Uzbek labels
  -- (same translation convention as every other table — sana -> order_date
  -- etc., see "Phase 0 database migrations" in DECISIONS.md).
  add column moisture_pct numeric,
  add column so2_mg_kg numeric;

-- §2.14-style configurable threshold for "Kam chiqdi" (declared vs actual
-- shortfall at intake) — no such key existed; §2.14's three thresholds are
-- for sulfur-overdue, Moyka-idle, and abnormal yield-loss, none of which is
-- this. Default 5%, editable in Administration like the others.
insert into settings_limits (key, value) values ('kam_chiqdi_pct', 5)
on conflict (key) do nothing;
