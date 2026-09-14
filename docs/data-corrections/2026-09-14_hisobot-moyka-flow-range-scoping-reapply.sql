-- Applied 2026-09-14 against project qohoqbapevrcjqxbstxi.
-- Schema-level fix, not a data correction — archived here anyway per this
-- session's established convention of archiving every applied SQL change.
--
-- Re-applies commit 97f5444 ("Range-scope Hisobot moyka flow columns
-- (shared RPC, affects Приход too)"), reverting the DB half of
-- docs/decisions/0184 — 0184 reverted 97f5444 on a misreading of operator
-- intent ("should be able to see their incoming number" was read as a
-- request for LIFETIME figures; it meant the incoming figure FOR THAT
-- PERIOD). See docs/decisions/0185-2026-09-14-hisobot-row-column-model-
-- correction-ii.md for the full reasoning.
--
-- The rule, restated: the selected date range governs both row selection
-- AND column values, for every direction. moykaga_yuborilgan/
-- moykadan_chiqgan/k1-k8/kn go back to sourcing from
-- kirim_line_moyka_range/kirim_line_calibre_output_range (both already
-- live in the DB, unused since 0184 — created originally by 97f5444, kept
-- deliberately through 0184's revert per that entry's own note).
--
-- One addition beyond a byte-for-byte re-apply of 97f5444: this re-apply
-- keeps the SAME return-table shape 97f5444 already had (two new trailing
-- state_moykaga_yuborilgan_lifetime/state_moykadan_chiqgan_lifetime
-- columns, sourced from the unchanged kirim_line_state) — these preserve
-- the Qabul qilingan identity (Qabul qilingan = Omborda qoldi + Moykaga
-- yuborilgan + Xom jo'natilgan) and the Moyka-internal identity (Moykaga
-- yuborilgan = Moykadan chiqgan + Moykada + Yo'qotish), both of which
-- depend on those two fields staying lifetime somewhere even though the
-- plain moyka columns are range-scoped again. This part is unchanged from
-- 97f5444's own design — 0184 never touched it since it reverted this
-- whole mechanism wholesale.
--
-- What is NOT a byte-for-byte re-apply of 97f5444: the app-layer strip
-- chips. 97f5444 kept a range-scoped STATE chip for the moyka pair
-- alongside its existing MOVEMENT chip (relabelled to disambiguate). This
-- re-apply drops that state chip instead — confirmed live it is either
-- exactly redundant with the movement chip (identical number under any
-- filter that includes moyka rows) or actively misleading under a
-- KIRIM-only filter (movement correctly reads 0; a naive range-scoped
-- state chip would have shown a real but coincidental 8,292 kg for
-- September/Global — moyka activity from serials that merely happened to
-- arrive that month). K1-K8/KN's state chip IS restored (no movement
-- counterpart exists for kalibr output to collide with, so it's a
-- genuinely new, non-duplicate, now-additive number). See reportColumns.ts
-- and TotalsStrip.tsx for the app-side detail; this SQL file is DB-only.
--
-- kirim_line_state stays joined, unchanged, for the 5 genuinely as-of-now
-- balance columns (qabul_qilingan/omborda_qoldi/moyka/xom_jonatilgan/
-- olib_ketilgan). Yo'qotish stays lifetime-only, no range-scoped source —
-- explicitly out of scope for this pass, same as when 97f5444 first
-- deferred it and same as 0184 correctly left it (0184's Yo'qotish chip
-- removal was NOT wrong and is not touched by this re-apply).
--
-- report_query_page/report_totals both change RETURN TABLE shape (2 new
-- trailing columns vs. the currently-live lifetime version), so DROP
-- FUNCTION before CREATE (CREATE OR REPLACE cannot add OUT columns to an
-- existing RETURNS TABLE).
--
-- Verified after applying (live, not dry-run):
--   - Qabul qilingan identity holds exactly (diff = 0) via the new
--     Moykaga yuborilgan (jami) twin, full year, no filter:
--     state_qabul_qilingan=195618, identity_rhs=195618, diff=0.
--   - report_query_page spot-check, MOYKADAN direction + September, for the
--     5 known cross-month serials: period-scoped and lifetime-twin values
--     both correct and independently verified against kirim_line_moyka_range/
--     kirim_line_calibre_output_range computed directly (see the proposal
--     phase's own verification, same session). 110826-002: period_to_moyka=0,
--     period_from_moyka=70, lifetime twins 7,345/7,400, K2=70 — all match.
--   - npx tsc --noEmit clean across all 8 changed app files.

drop function if exists public.report_query_page(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer);
drop function if exists public.report_totals(text[], date, date, uuid, uuid, uuid, text, text, text, text, text, text, text, integer);

create function public.report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_partiya_no integer DEFAULT NULL::integer
)
returns table(
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid,
  calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean,
  declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean,
  wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric,
  moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, partiya_no integer,
  state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric,
  state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric,
  state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
)
language sql
stable
as $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, mr.to_moyka_kg, s.moykada,
         mr.from_moyka_kg, s.xom_jonatilgan, s.olib_ketilgan,
         cor.k1, cor.k2, cor.k3, cor.k4, cor.k5, cor.k6, cor.k7, cor.k8, cor.kn,
         client_serial_loss_kg(f.serial),
         s.moykaga_yuborilgan, s.moykadan_chiqgan
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
  left join lateral kirim_line_calibre_output_range(f.serial, p_from, p_to) cor on f.serial is not null
  left join lateral kirim_line_moyka_range(f.serial, p_from, p_to) mr on f.serial is not null;
$function$;

create function public.report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_partiya_no integer DEFAULT NULL::integer
)
returns table(
  total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric,
  total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric, total_kg_from_moyka numeric,
  state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric,
  state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric,
  state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric,
  state_k7 numeric, state_k8 numeric, state_kn numeric, state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
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
      coalesce(sum(s.moykada), 0) as state_moykada,
      coalesce(sum(s.xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(s.olib_ketilgan), 0) as state_olib_ketilgan,
      coalesce(sum(s.moykaga_yuborilgan), 0) as state_moykaga_yuborilgan_lifetime,
      coalesce(sum(s.moykadan_chiqgan), 0) as state_moykadan_chiqgan_lifetime
    from distinct_serials ds
    cross join lateral kirim_line_state(ds.serial) s
  ),
  moyka_range as (
    select
      coalesce(sum(mr.to_moyka_kg), 0) as state_moykaga_yuborilgan,
      coalesce(sum(mr.from_moyka_kg), 0) as state_moykadan_chiqgan
    from distinct_serials ds
    cross join lateral kirim_line_moyka_range(ds.serial, p_from, p_to) mr
  ),
  calibre_output as (
    select
      coalesce(sum(co.k1), 0) as state_k1, coalesce(sum(co.k2), 0) as state_k2, coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4, coalesce(sum(co.k5), 0) as state_k5, coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7, coalesce(sum(co.k8), 0) as state_k8, coalesce(sum(co.kn), 0) as state_kn
    from distinct_serials ds
    cross join lateral kirim_line_calibre_output_range(ds.serial, p_from, p_to) co
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
    moyka_range.state_moykaga_yuborilgan, state.state_moykada, moyka_range.state_moykadan_chiqgan,
    state.state_xom_jonatilgan, state.state_olib_ketilgan,
    calibre_output.state_k1, calibre_output.state_k2, calibre_output.state_k3, calibre_output.state_k4,
    calibre_output.state_k5, calibre_output.state_k6, calibre_output.state_k7, calibre_output.state_k8,
    calibre_output.state_kn,
    realized_loss.state_yoqotish,
    state.state_moykaga_yuborilgan_lifetime, state.state_moykadan_chiqgan_lifetime
  from movement, state, moyka_range, calibre_output, realized_loss;
$function$;
