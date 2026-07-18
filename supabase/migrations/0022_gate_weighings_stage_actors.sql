-- Full per-stage accountability on gate_weighings + Ombor's own finish
-- signal (Menejer finished-request view, prompt 4 follow-up). Before this,
-- gate_weighings had exactly one actor column (created_by, written only at
-- stage-1 INSERT, never read anywhere in the app) and one timestamp
-- (completed_at, stage 2 only, already flagged as a known limitation in
-- useGateHistory.ts's own comments) -- no way to know who did stage 1, when
-- stage 1 happened, or whether the same person did both stages.
--
-- completed_at is deliberately NOT renamed despite being used elsewhere
-- (7 files across both KIRIM and CHIQIM, including both direction triggers
-- via `old.completed_at is null / new.completed_at is not null`) -- it was
-- already unambiguous (the table's only completion timestamp, exclusively
-- stage 2 in both directions); stage1_completed_at existing alongside it
-- removes the remaining ambiguity by contrast, at zero rename blast radius.
--
-- created_by IS renamed -> stage2_created_by: grepped every reference first,
-- confirmed it was write-only (only QorovulKirimTab.tsx/QorovulChiqimTab.tsx
-- stage-1 insert handlers wrote it, nothing ever read it), so the rename is
-- safe and matches the table's own existing stage1_/stage2_ prefix
-- convention already used on the photo columns.
alter table gate_weighings
  add column stage1_created_by uuid references profiles,
  add column stage1_completed_at timestamptz;

update gate_weighings set stage1_created_by = created_by;

alter table gate_weighings rename column created_by to stage2_created_by;

-- Correction applied live, folded in here: the rename above carries the old
-- created_by VALUE forward into stage2_created_by too (a rename doesn't
-- clear data) -- for every pre-existing row that value is really stage 1's
-- actor (the only actor ever captured), not stage 2's. Left as-is it would
-- misattribute stage 2 to whoever did stage 1. Nulled explicitly instead --
-- honestly unknown for historical rows, never re-derivable.
update gate_weighings set stage2_created_by = null;

-- chiqim_requests: same gap for Ombor's own finish signal (§5 CHIQIM
-- per-role finalization invariant) -- ombor_finished_at (0018) never had a
-- matching actor column.
alter table chiqim_requests
  add column ombor_finished_by uuid references profiles;
