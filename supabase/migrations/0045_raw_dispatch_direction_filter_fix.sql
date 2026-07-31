-- Bug found during hand-verification against seeded data (2026-07-31, see
-- DECISIONS.md "Raw dispatch"): report_filtered_rows' direction predicate
-- was `p_direction = 'both' or r.kind = p_direction` -- selecting the
-- CHIQIM direction in Hisobot (one of only three options: kirim/chiqim/
-- both) requires r.kind = 'chiqim' exactly, which a 'chiqim_raw' row never
-- satisfies. Confirmed live: report_totals('chiqim', ...) returned
-- total_count=0 against seeded raw-dispatch fixture rows that
-- report_totals('both', ...) correctly counted. Raw dispatch rows would
-- have silently vanished from the Hisobot screen the instant anyone
-- filtered to CHIQIM specifically -- the most common single-direction
-- filter choice, not an edge case.

create or replace function report_filtered_rows(
  p_direction text,
  p_from date,
  p_to date,
  p_owner_id uuid,
  p_type_id uuid,
  p_calibre_id uuid,
  p_serial text,
  p_barcode2 text,
  p_plate text,
  p_driver text,
  p_wash_cycle text,
  p_lab_verdict text,
  p_status text
)
returns setof report_rows
language sql
stable
security invoker
as $$
  select r.*
  from report_rows r
  where (p_direction = 'both' or r.kind = p_direction or (p_direction = 'chiqim' and r.kind = 'chiqim_raw'))
    and (
      r.kind = 'chiqim'
      or (
        r.kind = 'kirim'
        and p_calibre_id is null
        and (p_barcode2 is null or p_barcode2 = '')
        and (p_wash_cycle is null or p_wash_cycle = '')
        and (p_lab_verdict is null or p_lab_verdict = '')
        and (p_status is null or p_status = '')
      )
      or (
        r.kind = 'chiqim_raw'
        and p_calibre_id is null
        and (p_barcode2 is null or p_barcode2 = '')
        and (p_wash_cycle is null or p_wash_cycle = '')
        and (p_lab_verdict is null or p_lab_verdict = '')
      )
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
    and (
      p_wash_cycle is null or p_wash_cycle = ''
      or (p_wash_cycle = '1' and r.wash_cycle = 1)
      or (p_wash_cycle = '2+' and r.wash_cycle >= 2)
    )
    and (
      p_lab_verdict is null or p_lab_verdict = ''
      or (p_lab_verdict = 'tekshirilmagan' and r.lab_verdict is null)
      or r.lab_verdict = p_lab_verdict
    );
$$;
