-- Applied 2026-09-14 against project qohoqbapevrcjqxbstxi.
-- Schema-level revert, not a data correction — archived here anyway per this
-- session's established convention of archiving every applied SQL change.
--
-- Reverts the DB half of commit 97f5444 ("Range-scope Hisobot moyka flow
-- columns (shared RPC, affects Приход too)"), which had range-scoped
-- moykaga_yuborilgan/moykadan_chiqgan/k1-k8/kn/yoqotish in report_query_page
-- and report_totals using the (still-live, deliberately kept) helper
-- functions kirim_line_moyka_range/kirim_line_calibre_output_range.
--
-- Per user direction, the column layer was never the bug — every table cell
-- goes back to LIFETIME (via kirim_line_state/kirim_line_calibre_output,
-- unchanged, no date args), matching pre-97f5444 behaviour exactly. The
-- actual bug (a state-basis chip summing a lifetime figure once per distinct
-- serial, double-counting across stacked periods) is fixed separately, in
-- the app layer (src/lib/reportColumns.ts's totalBasis + TotalsStrip.tsx /
-- ClientPrihodTab.tsx chip removal) — see
-- docs/decisions/0184-2026-09-14-hisobot-row-column-model-correction.md.
--
-- kirim_line_moyka_range/kirim_line_calibre_output_range are NOT dropped —
-- kept live, currently unused by any caller, see that decision doc for why.
--
-- CREATE OR REPLACE cannot change a TABLE-returning function's OUT columns,
-- so both functions require DROP FUNCTION (exact prior signature) then
-- CREATE FUNCTION, same as the original 97f5444 migration did.

begin;

drop function if exists report_query_page(
  text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text,
  integer, integer, integer
);

create function report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid,
  p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text,
  p_wash_cycle text, p_lab_verdict text, p_status text,
  p_limit integer default 100, p_offset integer default 0, p_partiya_no integer default null
)
returns table(
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid,
  owner_id uuid, type_id uuid, calibre_id uuid, plate text, driver text,
  date_basis date, date_basis_source text, qty_kg numeric, provisional boolean,
  declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric,
  provisional_variance_flag boolean, wash_cycle integer, pallet_status text,
  lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric,
  moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[],
  box_mass_kg numeric, partiya_no integer,
  state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric,
  state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric,
  state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric,
  state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric,
  state_kn numeric, state_yoqotish numeric
)
language sql stable as $$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, s.moykaga_yuborilgan, s.moykada,
         s.moykadan_chiqgan, s.xom_jonatilgan, s.olib_ketilgan,
         co.k1, co.k2, co.k3, co.k4, co.k5, co.k6, co.k7, co.k8, co.kn,
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
$$;

drop function if exists report_totals(
  text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer
);

create function report_totals(
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
  state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric
)
language sql stable as $$
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
      coalesce(sum(co.k1), 0) as state_k1, coalesce(sum(co.k2), 0) as state_k2, coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4, coalesce(sum(co.k5), 0) as state_k5, coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7, coalesce(sum(co.k8), 0) as state_k8, coalesce(sum(co.kn), 0) as state_kn
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
$$;

commit;

-- Post-apply verification (both run live, matched expected):
--
-- 1. Reconciliation identity, full year, no filter — unchanged by this revert:
--   select state_qabul_qilingan,
--          state_omborda_qoldi + state_moykaga_yuborilgan + state_xom_jonatilgan as identity_rhs,
--          state_qabul_qilingan - (state_omborda_qoldi + state_moykaga_yuborilgan + state_xom_jonatilgan) as diff
--   from report_totals(null,'2026-01-01','2026-12-31',null,null,null,null,null,null,null,null,null,null,null);
--   -- state_qabul_qilingan=195618, identity_rhs=195618, diff=0
--
-- 2. Cross-month serials' table cells now show LIFETIME figures again,
--    matching kirim_line_state/kirim_line_calibre_output directly regardless
--    of the date filter (spot-checked 110826-003, 180826-001 against an
--    August-only KIRIM report — values identical to calling the two helper
--    functions directly with no date args).
