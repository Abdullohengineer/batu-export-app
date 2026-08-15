-- Hisobot gains "E'lon qilingan" (declared/waybill figure, kirim_lines.
-- declared_qty -- already exposed on report_rows/report_filtered_rows as
-- declared_qty, no new join needed) and "Hisobiy" (= least(netto,
-- declared) per row, derived on the fly, never stored, never the
-- accounting basis -- display only, so Abdulloh can see what the rule is
-- worth before deciding whether to adopt it). Per-row values need no SQL
-- change at all (report_query_page already returns declared_qty and
-- qty_kg; Hisobiy is computed client-side, see reportQuery.ts). Only the
-- totals strip needs a server-side change, since it aggregates over the
-- FULL filtered set, not just the loaded page.
--
-- report_totals is the only function that needs editing -- its own call
-- graph (report_totals -> report_filtered_rows -> report_rows) never
-- touches report_kirim_rows_as_of, stock_on_hand_rows, get_client_report,
-- or any Rahbar dashboard function (confirmed via pg_get_functiondef
-- before writing this; report_kirim_rows_as_of is a separate function
-- used only by get_client_report, not a variant of the view Hisobot
-- reads).
--
-- total_declared: a bare `sum(declared_qty)` is correct unguarded --
-- declared_qty is NULL::numeric on every non-kirim row (chiqim/
-- chiqim_raw/chiqim_old_kn), and SQL's SUM already skips NULLs per
-- ordinary aggregate semantics.
--
-- total_hisobiy: NOT a bare `least(qty_kg, declared_qty)` -- confirmed
-- live that Postgres's LEAST/GREATEST IGNORE null arguments rather than
-- propagating them (least(5, null) = 5, the opposite of ordinary
-- comparison-operator NULL semantics). Since declared_qty is
-- unconditionally null on every non-kirim row, a bare least() would
-- silently return qty_kg itself for every one of them, making Hisobiy
-- look like a real "capped at declared" figure on rows where the concept
-- doesn't even exist. Guarded with `kind = 'kirim'` instead, same pattern
-- already used for total_kg_in/total_kg_tara_in below it.
--
-- DROP + CREATE, not CREATE OR REPLACE: Postgres refuses to change a
-- RETURNS TABLE shape in place (42P13). Same pattern this function's own
-- history already used three times (0041, 0043, 0063).
drop function report_totals(text, date, date, uuid, uuid, uuid, text, text, text, text, text, text, text);

create function report_totals(
  p_direction text, p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text
)
returns table(
  total_count bigint,
  total_kg_in numeric,
  total_kg_out numeric,
  total_kg_tara_in numeric,
  total_kg_tara_out numeric,
  total_declared numeric,
  total_hisobiy numeric
)
language sql stable
as $function$
  select
    count(*),
    coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0),
    coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn') then qty_kg else 0 end), 0),
    coalesce(sum(case when kind = 'kirim' then box_mass_kg else 0 end), 0),
    coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0),
    coalesce(sum(declared_qty), 0),
    coalesce(sum(case when kind = 'kirim' then least(qty_kg, declared_qty) else 0 end), 0)
  from report_filtered_rows(
    p_direction, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
  );
$function$;
