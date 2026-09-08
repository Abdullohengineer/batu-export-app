-- Drop the client-portal RPCs orphaned by the 2026-09-02 rebuild
-- (client_serial_ledger/client_chiqim_ledger, migration 0109) that 0109's
-- own header deliberately left in place ("dropping functions is separate
-- schema surgery, not bundled into a feature migration"). Confirmed dead
-- before dropping, not assumed (CLAUDE.md):
--   - grep over src/ found zero call sites for any of the four.
--   - a regex search over every live public function's pg_get_functiondef
--     found nothing else in the database calling client_report_rows,
--     client_report_totals, or client_serial_summary.
--
-- client_calibre_split is deliberately NOT dropped here, unlike the other
-- three -- it is a live dependency of client_serial_loss_kg (0101, backs
-- the *internal staff* Hisobot's Yo'qotish column, v1.44/0107) and of
-- client_serial_moyka_kg, both found by the same dependency search.
-- Dropping it would have broken an unrelated, currently-shipped feature.
drop function if exists public.client_report_rows(text[], date, date, uuid, text, integer, integer);
drop function if exists public.client_report_totals(text[], date, date, uuid, text);
drop function if exists public.client_serial_summary(text);
