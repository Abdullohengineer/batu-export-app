-- Client-report as-of-date fix (2026-08-02). Voiding a pallet left no
-- timestamp anywhere: finished_pallets had no voided_at, no created_at, no
-- updated_at and no triggers, so a voided pallet's status could never be
-- reconstructed for a historical period.
--
-- Added now precisely because the table is clean: zero rows have ever been
-- bekor_qilindi, and nothing in the app writes that status (the void UI was
-- removed in the Laborator v2 rework; only two read sites remain, and
-- report_chiqim_rows' void_successor_barcodes still references a wash_cycle
-- column that no longer exists). So there is no backfill ambiguity today
-- and there never will be.
--
-- Convention: a bekor_qilindi row with a NULL voided_at means "void date
-- unknown" and stays excluded from every period -- identical to today's
-- behaviour, so this column is future-proofing, not a behaviour change.
alter table finished_pallets add column voided_at timestamptz;

comment on column finished_pallets.voided_at is
  'When status became bekor_qilindi. Required for as-of-date reconstruction in get_client_report; NULL on a voided row means the date is unknown and the pallet is excluded from all periods.';
