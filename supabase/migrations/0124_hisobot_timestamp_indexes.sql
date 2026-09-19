-- indexes only, no logic changes.
--
-- Hisobot perf pass, Change 4 (D5) -- four btree indexes on timestamp
-- columns the reporting engine filters directly but that had no supporting
-- index (confirmed via the prior diagnostic's `pg_indexes` listing):
--   - kirim_orders.order_date       -- report_kirim_rows' own date-range filter (the KIRIM direction's date basis)
--   - finished_pallets.received_date -- kirim_line_calibre_output_range / kirim_line_report_bundle's fp_all, and report_moyka_output_rows' own date_basis
--   - moyka_sends.sent_date          -- kirim_line_moyka_range / kirim_line_report_bundle's ms_all
--   - rezka_sends.serial             -- the genuinely missing one: kirim_line_state's rezka_sent CTE filters `where serial = p_serial` against a table that had no index at all beyond its own primary key (id)
--
-- All four are Seq Scans today and that is currently the CORRECT plan
-- choice (kirim_orders: 33 rows, finished_pallets: 255 rows, moyka_sends:
-- 28 rows, rezka_sends: 0 rows) -- these indexes don't change today's
-- query plans or today's latency. They exist so the plan flips to an index
-- scan automatically once these tables cross Postgres's seq-scan-vs-
-- index-scan threshold, instead of silently regressing to O(table size)
-- scans repeated once per distinct serial inside
-- kirim_line_report_bundle/kirim_line_state/etc, which is exactly the
-- "gets worse as data grows" failure mode this whole pass targets.
--
-- pg_trgm GIN indexes on the ILIKE '%...%' search columns (serial,
-- barcode2, plate, driver) are explicitly deferred (D4/D5 split from the
-- fix prompt) -- not yet worth the write overhead at current data volume.

create index if not exists idx_kirim_orders_order_date
  on public.kirim_orders (order_date);

create index if not exists idx_finished_pallets_received_date
  on public.finished_pallets (received_date);

create index if not exists idx_moyka_sends_sent_date
  on public.moyka_sends (sent_date);

create index if not exists idx_rezka_sends_serial
  on public.rezka_sends (serial);
