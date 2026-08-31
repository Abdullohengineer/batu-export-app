-- Hisobot: "Yo'qotish, kg" column (2026-08-31). One new serial-state column
-- on §3.2.4's results table + its own chip in the filtered-totals strip.
--
-- ============================================================
-- WHICH LOSS FIGURE, AND WHY THIS ONE
--
-- reportQuery.ts' SerialState comment has said since 2026-08-15 that
-- "Yo'qotish deliberately not included -- no canonical per-serial
-- loss-in-kg figure exists yet." That stopped being true on 2026-08-29:
-- migration 0101 (Yakunlash / realized-vs-unrealized split) made
-- `client_serial_loss_kg(serial)` exactly that figure -- NULL while the
-- serial's wash cycle is open (the gap is still in-process, and reads as
-- Moykada), the signed booked figure once wash_cycles.closed_at is set.
--
-- So this migration adds NO new arithmetic. It reuses that one function,
-- unchanged, the same way 0098 reused kirim_line_state's basis for the
-- K1-K8/KN columns rather than re-deriving output per calibre.
--
-- The `client_` prefix is historical, not a scope: the function takes a
-- serial and reads wash_cycles + client_calibre_split. Nothing in it is
-- client-portal-specific, and its basis is the SAME base_pallets exclusion
-- set kirim_line_state itself uses (voided / storage_loss / re-wash-consumed
-- pallets excluded) -- confirmed by direct comparison of both function
-- bodies, and re-confirmed empirically on live data before writing this:
--
--   for all 10 closed serials today,
--     client_serial_loss_kg(serial) = moykaga_yuborilgan - moykadan_chiqgan
--   holds exactly (220/150/567/20/58/50/45/27/242/53 kg, 1,432 kg total).
--
-- That identity is the whole point of reusing this function instead of
-- writing a new one: the new column can never disagree with the two
-- neighbouring columns a reader will subtract it from by eye. Together with
-- 0101's Moykada gating (0 once closed) the four state columns close:
--
--   Moykaga yuborilgan = Moykadan chiqgan + Moykada + coalesce(Yo'qotish, 0)
--
-- Open serial: Yo'qotish is NULL (renders "--"), the gap sits in Moykada.
-- Closed serial: Moykada is 0, the gap is booked in Yo'qotish. Never both.
--
-- ============================================================
-- WHY NOT yield_rows.loss_kg
--
-- yield_rows carries a per-serial loss_kg on the same closed_at gate, but
-- it is a different SET, not a different formula: it excludes
-- origin = 'opening_stock' and TEST- plates, per CLAUDE.md's processing-
-- aggregate rule. Hisobot is a row-level ledger of whatever the filter
-- selects, including opening stock -- clipping this column to yield_rows'
-- cohort would make it silently blank on rows Hisobot deliberately shows.
-- The totals chip is therefore expected to read slightly differently from
-- Yield's own total whenever opening-stock serials are in the filtered set;
-- that is the same movement-vs-cohort distinction the screen already
-- carries between its two chip groups, not a discrepancy.
--
-- ============================================================
-- TOTALLING BASIS: 'state' -- summed once per DISTINCT serial in the
-- filtered set, never once per row ("the trap" report_totals' own header
-- names). NULLs are skipped by sum(), so the chip is the total REALIZED
-- loss only: an unclosed serial contributes nothing, exactly as it
-- contributes nothing to the Yakunlash books.
--
-- Both functions below use RETURNS TABLE, so a new output column needs
-- DROP + CREATE (CREATE OR REPLACE cannot change the return type) -- same
-- mechanic as 0094/0098. Reproduced verbatim from the live definitions
-- apart from the one new column each. The legacy single-`text`
-- p_directions overloads are deliberately left untouched (the frontend
-- calls only the text[] pair -- same call as 0098 made).
-- ============================================================

drop function if exists public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer);

create function public.report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_limit integer default 100, p_offset integer default 0, p_partiya_no integer default null
)
returns table (
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid,
  type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text,
  qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric,
  truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer,
  pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric,
  moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric,
  partiya_no integer, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric,
  state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric,
  state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric,
  state_yoqotish numeric
)
language sql
stable
as $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, s.moykaga_yuborilgan, s.moykada,
         s.moykadan_chiqgan, s.xom_jonatilgan, s.olib_ketilgan,
         co.k1, co.k2, co.k3, co.k4, co.k5, co.k6, co.k7, co.k8, co.kn,
         -- Scalar, not a third LEFT JOIN LATERAL: client_serial_loss_kg
         -- already returns NULL for a serial it cannot find (its `wc` CTE
         -- comes back empty, so the CASE falls to NULL), which is exactly
         -- what the two laterals above produce for a serial-less row
         -- (chiqim_old_kn). No `on f.serial is not null` guard needed.
         client_serial_loss_kg(f.serial)
  from (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral kirim_line_calibre_output(f.serial) co on f.serial is not null;
$function$;

drop function if exists public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer);

create function public.report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_partiya_no integer default null
)
returns table (
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
language sql
stable
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
      -- voided pallets excluded: a reversed pallet never came out of moyka.
      -- The row itself stays in the listing; only this sum skips it.
      coalesce(sum(case when kind = 'moyka_output'
                         and coalesce(pallet_status, '') <> 'bekor_qilingan'
                        then qty_kg else 0 end), 0) as total_kg_from_moyka
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
  -- Mirrors the two CTEs above exactly: one call per DISTINCT serial, never
  -- per row. sum() skips NULLs, so open serials contribute nothing and the
  -- chip reads total REALIZED (booked) loss for the filtered set.
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
