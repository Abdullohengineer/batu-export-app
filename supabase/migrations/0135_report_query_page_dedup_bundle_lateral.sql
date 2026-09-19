-- Hisobot performance: report_query_page called kirim_line_report_bundle()
-- once per ROW, but multiple rows share the same serial (a serial produces a
-- kirim row, moyka_send rows, moyka_output rows...). Measured on the real
-- unfiltered page-1 query: 89 rows, 77 with a serial, but only **32 distinct
-- serials** -- the bundle was being recomputed 2.4x more often than needed.
--
-- Fix: compute the bundle once per DISTINCT serial in a CTE, then plain-JOIN
-- it back onto the rows. kirim_line_report_bundle itself is UNCHANGED -- no
-- business logic touched, only how many times it's invoked.
--
-- Measured (client role, full-year range, no filters, EXPLAIN ANALYZE):
--   before: Planning 437ms + Execution 2845ms = 3282ms
--   after:  Planning 314ms + Execution 1643ms = 1957ms   (-42% execution)
--
-- Verified byte-identical output (md5 of the full ordered result set) against
-- the previous implementation across 4 combinations before shipping:
--   client role / no filters / limit 100      -> 89 rows, identical
--   client role / directions=['kirim']        -> 25 rows, identical
--   client role / chiqim+chiqim_raw+old_kn    -> 12 rows, identical (exercises
--                                                the chiqim_dispatch_calibre_
--                                                breakdown LATERAL)
--   rahbar role / no filters / limit 50 off50 -> 39 rows, identical
--
-- Also REJECTED, on evidence, before landing here: converting
-- kirim_line_report_bundle to LANGUAGE plpgsql to stop the planner inlining
-- its ~1458-node plan tree. Tested in a rolled-back transaction: planning
-- time did drop (437->212ms) but execution EXPLODED to 12,007ms, because
-- inlining is what lets the per-serial work stay cheap (~32ms/call inlined
-- vs ~135ms/call opaque). Inlining is load-bearing here, not the problem.
--
-- One deliberate hardening change beyond the dedup: the outer SELECT now
-- carries an explicit ORDER BY. The previous implementation's row order was
-- an *accident* of nested-loop LATERAL joins preserving the driving side's
-- order -- a plain JOIN is free to reorder. The explicit ORDER BY reproduces
-- exactly the order the inner subquery already sorted by, so output is
-- unchanged, but it is now guaranteed rather than incidental.

create or replace function public.report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text,
  p_status text, p_limit integer default 100, p_offset integer default 0, p_partiya_no integer default null::integer
)
returns table(kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric, dispatch_k1 numeric, dispatch_k2 numeric, dispatch_k3 numeric, dispatch_k4 numeric, dispatch_k5 numeric, dispatch_k6 numeric, dispatch_k7 numeric, dispatch_k8 numeric, dispatch_kn numeric)
language sql
stable
as $function$
  with f as materialized (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ),
  b as materialized (
    select ds.serial as b_serial, bb.*
    from (select distinct f.serial from f where f.serial is not null) ds
    cross join lateral kirim_line_report_bundle(ds.serial, p_from, p_to) bb
  )
  select f.*, b.state_qabul_qilingan, b.state_omborda_qoldi, b.moyka_range_to_moyka_kg, b.moyka_asof,
         b.moyka_range_from_moyka_kg, b.state_xom_jonatilgan, b.state_olib_ketilgan,
         b.calibre_output_k1, b.calibre_output_k2, b.calibre_output_k3, b.calibre_output_k4, b.calibre_output_k5,
         b.calibre_output_k6, b.calibre_output_k7, b.calibre_output_k8, b.calibre_output_kn,
         b.loss_range,
         b.state_moykaga_yuborilgan, b.state_moykadan_chiqgan,
         cdc.k1, cdc.k2, cdc.k3, cdc.k4, cdc.k5, cdc.k6, cdc.k7, cdc.k8, cdc.kn
  from f
  left join b on b.b_serial = f.serial
  left join lateral chiqim_dispatch_calibre_breakdown(
    f.request_id, p_directions, p_from, p_to, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
  ) cdc on f.kind = 'chiqim_dispatch'
  order by f.date_basis desc nulls last, f.row_key desc;
$function$;
