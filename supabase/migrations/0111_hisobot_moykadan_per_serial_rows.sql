-- Hisobot: MOYKADAN collapsed to one row per serial per period (2026-09-03).
--
-- ============================================================
-- WHAT WAS WRONG, AND WHAT THIS DOES NOT CHANGE
--
-- MOYKADAN's row source, report_moyka_output_rows, is one row per
-- finished_pallets entry (one row per pallet) -- deliberate, 🔒-locked
-- since v1.34 (SPEC.md §3.2.2, "MOYKADAN is deliberately NOT status-filtered
-- at the row level ... matching CHIQIM (tayyor)'s own confirmed philosophy
-- (an event log, not a current-state snapshot)"). A serial with several
-- pallets in a period showed as several rows, and each row's own qty_kg was
-- unfiltered by pallet status (voided/consumed/storage-loss pallets counted
-- in full), because that was correct FOR AN EVENT LOG.
--
-- This migration reverses that specific decision for MOYKADAN only, on
-- explicit instruction (see DECISIONS.md "Hisobot: MOYKADAN per-serial rows"
-- for the tradeoff this accepts: Barcode #2/kalibr no longer identify a
-- single MOYKADAN row -- they never meaningfully narrowed a moyka_output row
-- anyway, see below). KIRIM, CHIQIM (tayyor/xom/eski KN), and MOYKAGA are
-- completely untouched -- still row-per-event, still unfiltered by status,
-- exactly as v1.34 left them. report_moyka_output_rows itself is untouched
-- too (still the per-pallet event log SPEC.md §3.2.5's serial passport and
-- this migration's own aggregation both read from) -- this migration only
-- changes what report_filtered_rows/report_query_page/report_totals RETURN
-- for the moyka_output kind, not the underlying event data.
--
-- ============================================================
-- report_moyka_output_rows_by_serial() -- the thin wrapper
--
-- GROUP BY serial over report_moyka_output_rows, date-filtered first (so
-- "per period" holds -- a static view can't take p_from/p_to, hence a
-- function). qty_kg becomes "received from Moyka, final production output
-- only": excludes bekor_qilingan (voided), saqlashda_yoqolgan (storage
-- loss), and any pallet consumed via serial_mint_sources -- the EXACT SAME
-- 3-category exclusion set migration 0106 established for
-- rahbar_dashboard_ledger.processed_output (0106's own header: "Exclusion
-- set is pallet_base's, verbatim, so both ledgers count one set"). Sync-twin
-- of that predicate; see DECISIONS.md for the cross-reference both ways --
-- if either exclusion set ever gains a category, the other must gain the
-- identical one in the same commit, same rule 0106 itself established.
--
-- No new balance calculation: this is a filtered SUM/GROUP BY over a view
-- that already exists (report_moyka_output_rows) and an exclusion predicate
-- that already exists (0106's), not a new figure.
--
-- p_status/p_lab_verdict are applied INSIDE this function, narrowing which
-- PALLETS get summed into a serial's row, not re-applied by the caller
-- against the (now null) aggregate pallet_status/lab_verdict columns --
-- see the report_filtered_rows rewrite below for why.
create or replace function report_moyka_output_rows_by_serial(
  p_from date, p_to date, p_owner_id uuid, p_type_id uuid,
  p_serial text, p_partiya_no integer, p_status text, p_lab_verdict text
)
returns setof report_rows_v2
language sql stable
as $function$
  select
    'moyka_output'::text as kind,
    'moyka-output-serial-' || r.serial || '-' || p_from::text || '-' || p_to::text as row_key,
    r.serial,
    null::text as barcode2, -- multiple pallets per row now -- see MoykaOutputRowDetail.tsx / serial passport for the per-pallet breakdown
    (array_agg(r.order_id))[1] as order_id, -- constant per serial (kirim_lines is per-serial); uuid has no min/max aggregate
    null::uuid as request_id,
    (array_agg(r.owner_id))[1] as owner_id,
    (array_agg(r.type_id))[1] as type_id,
    null::uuid as calibre_id, -- a serial can produce several calibres -- no single value to show at this grain
    null::text as plate,
    null::text as driver,
    max(r.date_basis) as date_basis, -- most recent production event in the period; sort stays newest-first
    'received_date'::text as date_basis_source,
    coalesce(sum(r.qty_kg) filter (
      where r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
        and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
    ), 0) as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
    null::text as pallet_status, -- a serial's pallets can carry mixed statuses -- genuinely inapplicable at this grain, not a missing value
    null::text as lab_verdict,
    null::numeric as target_moisture_pct,
    null::numeric as target_so2_mg_kg,
    null::numeric as moisture_pct,
    null::numeric as so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    min(r.partiya_no) as partiya_no
  from report_moyka_output_rows r
  where r.date_basis between p_from and p_to
    and (p_owner_id is null or r.owner_id = p_owner_id)
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%')
    and (p_partiya_no is null or r.partiya_no = p_partiya_no)
    and (p_status is null or p_status = '' or r.pallet_status = p_status)
    and (p_lab_verdict is null or p_lab_verdict = ''
         or (p_lab_verdict = 'tekshirilmagan' and r.lab_verdict is null)
         or r.lab_verdict = p_lab_verdict)
  group by r.serial
$function$;

-- report_filtered_rows(text[], ...) -- split into a UNION ALL: every other
-- kind stays exactly as before (row-level from report_rows_v2, byte-for-byte
-- the same WHERE clause that was here before this migration); moyka_output
-- is sourced from the aggregation above instead.
--
-- The calibre_id/barcode2/wash_cycle all-or-nothing gate on moyka_output
-- (kept, unchanged) already meant those three filters never NARROWED a
-- moyka_output row -- setting any of them made moyka_output rows disappear
-- entirely, both before and after this migration (confirmed by reading the
-- pre-existing WHERE clause: `r.kind = 'moyka_output' and p_calibre_id is
-- null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null
-- or p_wash_cycle = '')`). So collapsing the row grain does not change that
-- behaviour at all -- it was already all-or-nothing, never a per-pallet
-- narrowing, for MOYKADAN specifically.
--
-- p_status/p_lab_verdict WERE real per-pallet narrowing filters on the old
-- row-level moyka_output rows (e.g. "only omborda pallets"). They are passed
-- into report_moyka_output_rows_by_serial() instead of re-applied out here,
-- because the outer WHERE's generic status/lab_verdict clauses test
-- r.pallet_status/r.lab_verdict, which are now always null on an aggregated
-- row -- applying them out here would either wrongly exclude every
-- moyka_output row (status filter: null = p_status is never true) or wrongly
-- include every one regardless of its pallets' real verdicts (lab_verdict =
-- 'tekshirilmagan' branch: null IS null is always true). Filtering the
-- PALLETS before the GROUP BY, inside the function, is the only place these
-- two filters can still mean what they meant before.
create or replace function report_filtered_rows(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid,
  p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text,
  p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer default null
)
returns setof report_rows_v2
language sql stable
as $function$
  select r.*
  from report_rows_v2 r
  where r.kind <> 'moyka_output'
    and (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
    and (
      r.kind = 'chiqim'
      or (r.kind = 'kirim' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
      or (r.kind = 'chiqim_raw' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = ''))
      or (r.kind = 'chiqim_old_kn' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = ''))
      or (r.kind = 'moyka_send' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
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
    and (p_partiya_no is null or r.partiya_no = p_partiya_no)

  union all

  select *
  from report_moyka_output_rows_by_serial(p_from, p_to, p_owner_id, p_type_id, p_serial, p_partiya_no, p_status, p_lab_verdict)
  where (p_directions is null or array_length(p_directions, 1) is null or 'moyka_output' = any(p_directions))
    and p_calibre_id is null
    and (p_barcode2 is null or p_barcode2 = '')
    and (p_wash_cycle is null or p_wash_cycle = '');
$function$;

-- report_totals(text[], ...) -- total_kg_from_moyka simplified, not
-- re-derived: `filtered` now already carries the per-serial-aggregated,
-- 0106-exclusion-filtered qty_kg for every moyka_output row (via the
-- report_filtered_rows rewrite above), so the old inline
-- `coalesce(pallet_status,'') <> 'bekor_qilingan'` guard is both redundant
-- (pallet_status is always null now, so it was always true) and, before
-- this migration, the ONLY exclusion applied here -- it never excluded
-- storage_loss or serial_mint_sources-consumed pallets, an incomplete
-- exclusion set relative to 0106 that happened not to matter while this
-- project had zero storage_loss/mint-consumed pallets inside a reported
-- period (see DECISIONS.md for the live figures this was checked against).
-- Removed outright: qty_kg is the correct figure straight off `filtered`
-- now, with no separate exclusion logic left to drift out of sync.
create or replace function report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid,
  p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text,
  p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer default null
)
returns table(
  total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric,
  total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric,
  total_kg_to_moyka numeric, total_kg_from_moyka numeric,
  state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric,
  state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric,
  state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric,
  state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric,
  state_yoqotish numeric
)
language sql stable
as $function$
  with filtered as materialized (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
  ),
  movement as (
    select
      count(*) as total_count,
      coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn') then qty_kg else 0 end), 0) as total_kg_out,
      coalesce(sum(case when kind = 'kirim' then box_mass_kg else 0 end), 0) as total_kg_tara_in,
      coalesce(sum(case when kind = 'chiqim_raw' then box_mass_kg else 0 end), 0) as total_kg_tara_out,
      coalesce(sum(declared_qty), 0) as total_declared,
      coalesce(sum(case when kind = 'kirim' then least(qty_kg, declared_qty) else 0 end), 0) as total_hisobiy,
      coalesce(sum(case when kind = 'moyka_send' then qty_kg else 0 end), 0) as total_kg_to_moyka,
      -- qty_kg is already 0106-exclusion-filtered per serial/period, see the
      -- report_moyka_output_rows_by_serial()/report_filtered_rows header above.
      coalesce(sum(case when kind = 'moyka_output' then qty_kg else 0 end), 0) as total_kg_from_moyka
    from filtered
  ),
  distinct_serials as (
    select distinct serial from filtered where serial is not null
  ),
  state as (
    select
      count(*) as state_serial_count,
      coalesce(sum(s.qabul_qilingan), 0) as state_qabul_qilingan,
      coalesce(sum(s.omborda_qoldi), 0) as state_omborda_qoldi,
      coalesce(sum(s.moykaga_yuborilgan), 0) as state_moykaga_yuborilgan,
      coalesce(sum(s.moykada), 0) as state_moykada,
      coalesce(sum(s.moykadan_chiqgan), 0) as state_moykadan_chiqgan,
      coalesce(sum(s.xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(s.olib_ketilgan), 0) as state_olib_ketilgan
    from distinct_serials ds
    cross join lateral kirim_line_state(ds.serial) s
  ),
  calibre_output as (
    select
      coalesce(sum(co.k1), 0) as state_k1,
      coalesce(sum(co.k2), 0) as state_k2,
      coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4,
      coalesce(sum(co.k5), 0) as state_k5,
      coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7,
      coalesce(sum(co.k8), 0) as state_k8,
      coalesce(sum(co.kn), 0) as state_kn
    from distinct_serials ds
    cross join lateral kirim_line_calibre_output(ds.serial) co
  ),
  realized_loss as (
    select coalesce(sum(client_serial_loss_kg(ds.serial)), 0) as state_yoqotish
    from distinct_serials ds
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    state.state_serial_count, state.state_qabul_qilingan, state.state_omborda_qoldi,
    state.state_moykaga_yuborilgan, state.state_moykada, state.state_moykadan_chiqgan,
    state.state_xom_jonatilgan, state.state_olib_ketilgan,
    calibre_output.state_k1, calibre_output.state_k2, calibre_output.state_k3, calibre_output.state_k4,
    calibre_output.state_k5, calibre_output.state_k6, calibre_output.state_k7, calibre_output.state_k8,
    calibre_output.state_kn,
    realized_loss.state_yoqotish
  from movement, state, calibre_output, realized_loss;
$function$;
