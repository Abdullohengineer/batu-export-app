-- Partiya raqami (0093/0094) follow-up: the task's own requirement --
-- "partiya_no becomes a filterable, visible column" -- needs a real SQL
-- filter param, not client-side narrowing of an already-paginated page
-- (report_query_page is LIMIT/OFFSET paginated server-side; filtering only
-- the fetched page would silently miss matches beyond it). Adds
-- p_partiya_no integer to report_filtered_rows and report_query_page.
--
-- Adding a parameter is a signature change like any other for these
-- purposes -- CREATE OR REPLACE FUNCTION would create a co-existing
-- overload rather than truly replacing the old one (exactly the
-- p_direction/p_directions duplicate-overload situation already on file
-- for report_query_page from an earlier prompt). DROP + CREATE, same as
-- every RETURNS-signature change in 0094/0095.
drop function if exists public.report_filtered_rows(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text);

create function public.report_filtered_rows(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer default null)
 returns SETOF report_rows_v2
 language sql
 stable
as $function$
  select r.*
  from report_rows_v2 r
  where (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
    and (
      r.kind = 'chiqim'
      or (r.kind = 'kirim' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
      or (r.kind = 'chiqim_raw' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = ''))
      or (r.kind = 'chiqim_old_kn' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = ''))
      or (r.kind = 'moyka_send' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
      or (r.kind = 'moyka_output' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = ''))
    )
    and (
      (r.date_basis is not null and r.date_basis between p_from and p_to)
      or (r.date_basis is null and p_status is not null and p_status <> '' and r.pallet_status = p_status)
    )
    and (p_status is null or p_status = '' or r.pallet_status = p_status)
    and (p_owner_id is null or r.owner_id = p_owner_id)
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_calibre_id is null or r.calibre_id = p_calibre_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%')
    and (p_barcode2 is null or p_barcode2 = '' or r.barcode2 ilike '%' || p_barcode2 || '%')
    and (p_plate is null or p_plate = '' or r.plate ilike '%' || p_plate || '%')
    and (p_driver is null or p_driver = '' or r.driver ilike '%' || p_driver || '%')
    and (p_wash_cycle is null or p_wash_cycle = '' or (p_wash_cycle = '1' and r.wash_cycle = 1) or (p_wash_cycle = '2+' and r.wash_cycle >= 2))
    and (p_lab_verdict is null or p_lab_verdict = '' or (p_lab_verdict = 'tekshirilmagan' and r.lab_verdict is null) or r.lab_verdict = p_lab_verdict)
    and (p_partiya_no is null or r.partiya_no = p_partiya_no);
$function$;

drop function if exists public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer);

create function public.report_query_page(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_partiya_no integer DEFAULT null)
 returns TABLE(kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric)
 language sql
 stable
as $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, s.moykaga_yuborilgan, s.moykada, s.moykadan_chiqgan, s.xom_jonatilgan, s.olib_ketilgan
  from (
    select * from report_filtered_rows(p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id, p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no)
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null;
$function$;
