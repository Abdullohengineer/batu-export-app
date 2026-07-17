-- §5.4 CHIQIM per-role finalization (SPEC.md §5 intro, DECISIONS.md same
-- title, 2026-07-17) — Ombor's own finish signal (scan + `Yuklashni
-- yakunlash`), independent of Qorovul's gate weighing and Menejer's
-- truck-level `chiqim_requests.status`. Proposed in the prior Step 7 prompt
-- (Menejer CHIQIM request creation), applied now that it's actually needed.
--
-- Nullable, no backfill: every existing chiqim_requests row predates this
-- column and none of them have been through the (not-yet-built) Ombor scan
-- flow, so null correctly means "not yet finished by Ombor" for all of them
-- — there is nothing to backfill.
--
-- Deliberately NOT a trigger-driven flip off chiqim_requests.status (unlike
-- KIRIM's complete_kirim_stage2()) — per the per-role invariant, this column
-- is written directly by Ombor's own finish action, not derived from or
-- synced to any other role's field.

alter table chiqim_requests add column ombor_finished_at timestamptz;
