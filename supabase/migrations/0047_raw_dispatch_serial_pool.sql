-- Raw dispatch pool rework: Menejer selects a POOL of raw serials on a
-- line (chiqim_line_raw_serials), Ombor records actual per-serial draws on
-- the floor -- supersedes the one-serial-per-line model (chiqim_lines.raw_serial).
-- Mirrors the finished side structurally: chiqim_line_pallets is the
-- reservation pool, dispatch_manifest is what actually loaded; raw becomes
-- the same shape (chiqim_line_raw_serials = pool, raw_dispatch_lines =
-- actual draws, unchanged). See DECISIONS.md "Raw dispatch serial pool".
--
-- The junction table deliberately does NOT copy chiqim_line_pallets'
-- reservation semantics (released_at, active-unique-index): raw is bulk
-- and divisible, so two requests may legitimately draw from the same
-- serial -- there is nothing to reserve or release, only pool membership.

-- ============================================================
-- 1. chiqim_line_raw_serials -- the pool, Menejer-written once at line
--    creation, exactly like chiqim_line_pallets today.
-- ============================================================
create table chiqim_line_raw_serials (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references chiqim_lines(id) on delete cascade,
  serial text not null references kirim_lines(serial),
  created_at timestamptz not null default now(),
  unique (line_id, serial)
);
create index on chiqim_line_raw_serials(line_id);
create index on chiqim_line_raw_serials(serial);

alter table chiqim_line_raw_serials enable row level security;
create policy read_all on chiqim_line_raw_serials for select using (auth.uid() is not null);
create policy menejer_writes on chiqim_line_raw_serials for insert with check (my_role() = 'menejer');

-- ============================================================
-- 2. line_kind -- added nullable, backfilled from the existing
--    calibre_id/raw_serial XOR shape, then locked NOT NULL. Replaces
--    raw_serial IS NOT NULL as the raw-line marker (requirement 2).
-- ============================================================
alter table chiqim_lines add column line_kind text;
update chiqim_lines set line_kind = case when raw_serial is not null then 'raw' else 'finished' end;
alter table chiqim_lines alter column line_kind set not null;

-- ============================================================
-- 3. Migrate every existing raw line's single serial into the pool as a
--    one-row pool -- every historical raw_dispatch_lines draw already
--    matches this exact serial, so nothing becomes retroactively
--    "out of pool".
-- ============================================================
insert into chiqim_line_raw_serials (line_id, serial)
select id, raw_serial from chiqim_lines where raw_serial is not null;

-- ============================================================
-- 4. Drop the old XOR + raw_serial column; qty_kg becomes nullable for
--    raw lines (requirement 3). The existing `check (qty_kg > 0)` from
--    0003 needs no change -- NULL trivially satisfies a CHECK constraint
--    in Postgres (unknown, not violated).
-- ============================================================
alter table chiqim_lines drop constraint chiqim_lines_calibre_xor_raw;
alter table chiqim_lines drop column raw_serial;
alter table chiqim_lines alter column qty_kg drop not null;

-- ============================================================
-- 5. Replacement shape constraint -- folds "line_kind is one of the two
--    values" and "a finished line still requires calibre_id + qty_kg"
--    into one check (any other line_kind value fails both branches).
--    A raw line requires calibre_id null; qty_kg is unconstrained.
-- ============================================================
alter table chiqim_lines add constraint chiqim_lines_kind_shape check (
  (line_kind = 'finished' and calibre_id is not null and qty_kg is not null)
  or
  (line_kind = 'raw' and calibre_id is null)
);
