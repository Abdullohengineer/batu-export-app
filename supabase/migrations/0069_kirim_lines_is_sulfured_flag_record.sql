-- Historical record of a migration applied via the MCP apply_migration tool
-- directly on 2026-08-15 (version 20260815031646, name
-- "kirim_lines_is_sulfured_flag") that was never pulled down into
-- supabase/migrations/ afterward -- found during the 2026-08-16
-- migration-history reconciliation (see DECISIONS.md "Rezka data layer:
-- partial-send fix folded into stage 1, decisions 1-5 resolved,
-- migration-history audit"). Same class of gap 0075 (formerly 0074)
-- already fixed for wash_cycles_finalize_lab_gate.
--
-- UNLIKE the three sibling record files (0077/0078/0079), this one is NOT
-- superseded -- the column and its meaning are still exactly what's live
-- today, so this file replays for real, not as an inert comment.
--
-- POSITION MATTERS HERE, unlike 0075's (formerly 0074's) precedent. This
-- column is a hard forward-dependency: 0070_wip_rows_is_sulfured_flag.sql
-- and 0071_classify_kirim_line_sulfur_rpc.sql (a view and a plpgsql
-- function body) both reference kirim_lines.is_sulfured directly and fail
-- at CREATE time, not just at runtime, if the column doesn't exist yet.
-- Before this file existed, a genuine fresh rebuild of this repo's
-- migrations from empty would already fail at (what was then) local file
-- 0069 -- no local file created this column at all. That was a real,
-- pre-existing gap, not introduced here.
--
-- Fixed by renumbering: this file takes the vacated slot at 0069, ahead of
-- the two files that depend on it, so a fresh rebuild succeeds end to end.
-- Local files formerly 0069-0078 shifted to 0070-0079 (10 files, git mv,
-- descriptive names unchanged) to open this slot -- see the same
-- DECISIONS.md entry for the full list of renames.
--
-- Original statement, applied 2026-08-15, made idempotent for safe replay
-- at any position (the historical version had neither guard -- a plain
-- `add column` and an unconditional backfill -- both fine the one time it
-- actually ran against the real database, neither safe to literally
-- replay against a database that already has real, possibly
-- human-overridden classifications):
alter table kirim_lines add column if not exists is_sulfured boolean;

comment on column kirim_lines.is_sulfured is
  'Explicit natural/sulphured classification, set deliberately by Menejer at intake. NULL = not yet classified -- every consumer treats NULL as sulfured (shows the sulfur field, defers verdict). Replaces the old target_so2_mg_kg IS NULL inference (SPEC.md #5.5.1, amended 2026-08-14).';

-- Original backfill: "update kirim_lines set is_sulfured = true where
-- target_so2_mg_kg is not null" -- safe as a ONE-TIME statement against a
-- database where every row's is_sulfured was still unset, unsafe to
-- literally replay: by the time this file might run again, real rows can
-- carry an explicit is_sulfured value a human set later via
-- classify_kirim_line_sulfur (0071) -- including deliberately setting
-- false for a row that also happens to carry a non-null
-- target_so2_mg_kg. The added `and is_sulfured is null` guard makes this
-- correctly idempotent: it only ever fills the gap the original one-time
-- backfill filled, never overwrites a later explicit decision, regardless
-- of how many times or when this file runs.
update kirim_lines set is_sulfured = true where target_so2_mg_kg is not null and is_sulfured is null;
