-- Partiya raqami (0093/0094) follow-up: client_report_rows is the actual
-- RPC the client portal calls (clientPortalReport.ts) -- it wraps
-- client_filtered_report_rows (already carrying partiya_no as of 0094) but
-- has its OWN explicit RETURNS TABLE column list selecting named columns
-- from `f`, not `f.*`, so it did NOT inherit the new column automatically.
-- Missed in 0094's own object list (client_filtered_report_rows was
-- updated, its caller was not) -- caught while wiring the client-portal TS
-- layer. Same RETURNS TABLE restriction as before: DROP + CREATE, not
-- REPLACE (see 0094's header comment for the full explanation).
drop function if exists public.client_report_rows(text[], date, date, uuid, text, integer, integer);

create function public.client_report_rows(p_directions text[], p_from date, p_to date, p_type_id uuid, p_serial text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 returns TABLE(kind text, row_key text, serial text, type_id uuid, partiya_no integer, plate text, driver text, date_basis date, qty_kg numeric, declared_qty numeric, state_omborda_qoldi numeric, state_calibre_kg numeric, state_kn_kg numeric, state_olib_ketilgan numeric, state_xom_jonatilgan numeric, state_loss_kg numeric)
 language sql
 stable
as $function$
  select
    f.kind, f.row_key, f.serial, f.type_id, f.partiya_no, f.plate, f.driver, f.date_basis, f.qty_kg, f.declared_qty,
    s.omborda_qoldi, cs.calibre_kg, cs.kn_kg, s.olib_ketilgan, s.xom_jonatilgan, l.loss_kg
  from client_filtered_report_rows(p_directions, p_from, p_to, p_type_id, p_serial) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral client_calibre_split(f.serial) cs on f.serial is not null
  left join lateral (select client_serial_loss_kg(f.serial) as loss_kg) l on f.serial is not null
  order by f.date_basis desc nulls last, f.row_key desc
  limit p_limit offset p_offset;
$function$;
