-- Applied 2026-09-19 against project qohoqbapevrcjqxbstxi.
-- Hisobot perf pass, Changes 2 + 3 (Change 1 is a frontend-only debounce in
-- useReportQuery.ts, no SQL; Change 4 is four btree indexes, shipped as a
-- proper supabase/migrations/ file since indexes are schema, not this file).
-- Follows the docs/data-corrections/ precedent (2026-09-14/2026-09-15) for
-- reporting-engine SQL -- the drift between this directory and
-- supabase/migrations/ for the reporting engine is known, logged debt, NOT
-- reconciled here (out of scope for this prompt).
--
-- Root cause (full diagnostic in the prior conversation, summarized in the
-- fix-prompt that produced this file): report_totals calls FIVE separate
-- per-serial functions (kirim_line_state, kirim_line_moyka_asof,
-- kirim_line_moyka_range, kirim_line_calibre_output_range,
-- kirim_line_loss_range) via five separate `cross join lateral`s over
-- every DISTINCT SERIAL in the filtered set; report_query_page does the
-- same via five separate `left join lateral`s per PAGE ROW. That's five
-- independent nested-loop drives over the same serial set, each one
-- re-querying moyka_sends/wash_cycles/finished_pallets from scratch --
-- observed as 152-431 nested-loop iterations at only 34 serials today.
-- Purely procedural/call-count overhead (100% buffer-cache hits, zero
-- disk I/O, zero sort spills at current data volume) -- so it gets worse
-- as kirim_lines grows, independent of any index.
--
-- CHANGE 2 (D2a) -- kirim_line_report_bundle(serial, from, to): one
-- function, one lateral, that computes everything the five functions used
-- to compute, sharing base row-sets where it is SAFE to (moyka_sends and
-- wash_cycles for the serial are each fetched once into a CTE and reused
-- via FILTER-clause sums instead of five separate re-scans; finished_pallets
-- likewise once via fp_all). report_totals and report_query_page each go
-- from five lateral joins to one.
--
-- CRITICAL INVARIANT: every bundle field matches its corresponding old
-- function's output byte-for-byte for a fixed (serial, from, to) -- no new
-- balance math, no corrected semantics, including one deliberately
-- reproduced inconsistency (see NOTE A below). Verified for all 34 distinct
-- serials currently in kirim_lines before this file was wired into
-- report_totals/report_query_page -- see the verification query run
-- alongside this file (not part of the applied schema; ad hoc, in the
-- session transcript) and the benchmark note at the bottom of this file.
--
-- Two base row-sets were deliberately NOT fused despite being drawn from
-- the same underlying table, because doing so would have required hand-
-- proving an equivalence between two independently-evolved exclusion
-- predicates under time pressure with a byte-identity gate that HALTs on
-- any mismatch -- not worth the risk for a `moyka_sends`/`finished_pallets`
-- table that has 28/255 rows today:
--   - kirim_line_state's own `base_pallets`/`moyka_out` (state_moykadan_chiqgan
--     below) reads `finished_pallets` directly (status not in ('bekor_qilindi',
--     'storage_loss') + NOT EXISTS serial_mint_sources). Consolidated into
--     `fp_all` below (shared with kirim_line_calibre_output_range's own
--     identical exclusion set).
--   - kirim_line_moyka_asof/kirim_line_moyka_range instead read the VIEW
--     `report_moyka_output_rows` (pallet_status not in ('bekor_qilingan',
--     'saqlashda_yoqolgan') + the same NOT EXISTS). These two predicates are
--     very likely equivalent sets (report_moyka_output_rows' pallet_status
--     mapping translates fp.status='bekor_qilindi'/'storage_loss' to exactly
--     those two labels, and 'ishlatilgan'/consumed pallets are separately
--     excluded by the shared NOT EXISTS on both sides) -- but "very likely"
--     is not the bar a HALT-on-mismatch invariant asks for, so they stay as
--     two CTEs (`fp_all` and `moyka_out_all`) rather than one. Real win kept:
--     each of the two is still computed ONCE per bundle call and shared by
--     every downstream field that needs it, instead of once per *function*
--     call as before.
--
-- NOTE A -- reproduced bug-for-bug, not "fixed": kirim_line_state's
-- moykada_per_cycle and kirim_line_moyka_asof each compare a wash_cycles
-- open date against moyka_sends/finished_pallets rows using a bare
-- `opened_at::date` cast in one place and `(opened_at at time zone
-- 'utc')::date` in another, inconsistently, in the ORIGINAL functions. The
-- bundle reproduces this exact inconsistency verbatim (see moykada_per_cycle
-- and moyka_asof_calc below) because "byte-identical to the old function"
-- is the explicit, mandatory invariant here -- fixing it would change
-- output and fail the verification gate. Flagging, not fixing (CLAUDE.md
-- scope-discipline rule) -- a real fix belongs in a future prompt that
-- touches state-column semantics, explicitly out of scope for this one.
--
-- The five original functions (kirim_line_state, kirim_line_moyka_asof,
-- kirim_line_moyka_range, kirim_line_calibre_output_range,
-- kirim_line_loss_range) are left in place, UNCHANGED -- they're called
-- from get_serial_passport, get_client_report, rahbar_dashboard_ledger,
-- yield_rows and possibly other frontend hooks not touched by this prompt.
-- Dropping them is explicitly deferred.
--
-- CHANGE 3 (D3) -- report_filtered_rows_v2's kirim/moyka_send branch and
-- moyka_output branch used to always fully evaluate their underlying view/
-- function (report_rows_v2 restricted to kind in ('kirim','moyka_send'),
-- and report_moyka_output_rows_by_serial), filtering by p_directions only
-- in a WHERE clause AFTERWARD -- wasted work when neither direction was
-- actually requested. Only the chiqim/chiqim_raw/chiqim_old_kn branch
-- (report_dispatch_rows_v2) pre-narrowed before doing work. This change
-- wraps the other two branches in the standard Postgres zero-row-LATERAL
-- short-circuit idiom: `(select 1 where <gate>) cross join lateral
-- (<expensive query>)` -- when <gate> is false the outer relation has zero
-- rows, so the LATERAL subquery is never invoked at all (verified via
-- EXPLAIN: with a single-direction filter that excludes a branch, that
-- branch's subplan is absent from the plan entirely, not merely filtered
-- to zero rows afterward). This is a stronger, verified version of branch
-- 2's existing "gate in the outer WHERE" idea, not just a textual copy of
-- it -- branch 2's own WHERE-after-the-call gate doesn't by itself prevent
-- report_dispatch_rows_v2 from being invoked; the LATERAL-zero-row form
-- used here does, for both of these two branches.

-- ============================================================
-- CHANGE 2 -- kirim_line_report_bundle
-- ============================================================
create or replace function public.kirim_line_report_bundle(p_serial text, p_from date, p_to date)
returns table (
  state_qabul_qilingan numeric,
  state_omborda_qoldi numeric,
  state_moykaga_yuborilgan numeric,     -- kirim_line_state's own LIFETIME "sent" figure
  state_moykada numeric,                -- kirim_line_state's own per-cycle-open figure (currently unread by report_totals/report_query_page, kept for fidelity with the old function's full output)
  state_moykadan_chiqgan numeric,       -- kirim_line_state's own LIFETIME "moyka_out" figure
  state_xom_jonatilgan numeric,
  state_olib_ketilgan numeric,
  moyka_asof numeric,                   -- kirim_line_moyka_asof(serial, p_to)
  moyka_range_to_moyka_kg numeric,      -- kirim_line_moyka_range(serial, p_from, p_to).to_moyka_kg
  moyka_range_from_moyka_kg numeric,    -- kirim_line_moyka_range(serial, p_from, p_to).from_moyka_kg
  calibre_output_k1 numeric,
  calibre_output_k2 numeric,
  calibre_output_k3 numeric,
  calibre_output_k4 numeric,
  calibre_output_k5 numeric,
  calibre_output_k6 numeric,
  calibre_output_k7 numeric,
  calibre_output_k8 numeric,
  calibre_output_kn numeric,
  loss_range numeric                    -- kirim_line_loss_range(serial, p_from, p_to)
)
language sql
stable
as $function$
  with
  eq as (
    select kirim_line_effective_qty(p_serial) as v
  ),
  -- moyka_sends for this serial, fetched ONCE -- every downstream consumer
  -- (state.sent, state.moykada_per_cycle, moyka_asof, moyka_range.to_moyka_kg,
  -- loss_range) sums this same CTE with a different date FILTER instead of
  -- re-querying moyka_sends from scratch.
  ms_all as materialized (
    select qty_kg, sent_date from moyka_sends where serial = p_serial
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as v from ms_all
  ),
  rezka_sent as (
    select coalesce(sum(qty_kg), 0) as v from rezka_sends where serial = p_serial
  ),
  raw_disp as (
    select coalesce(sum(net_kg), 0) as v from raw_dispatch_lines where serial = p_serial
  ),
  -- finished_pallets for this serial (kirim_line_state's own exclusion set,
  -- identical to kirim_line_calibre_output_range's), fetched ONCE -- feeds
  -- state.moyka_out/state.moykada_per_cycle/state.departed AND
  -- calibre_output_k1..kn. LEFT JOIN (not the original calibre_output_range's
  -- INNER JOIN) so a pallet with no calibre_id still counts toward
  -- state_moykadan_chiqgan/departed -- its `code` is simply null, which
  -- correctly matches none of the '01'..'08'/'KN' FILTERs below, reproducing
  -- the INNER JOIN's effect for calibre_output specifically without dropping
  -- the row for the fields that never joined to calibres in the first place.
  fp_all as materialized (
    select fp.weight_kg, fp.barcode2, fp.received_date, c.code
    from finished_pallets fp
    left join calibres c on c.id = fp.calibre_id
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  ),
  -- report_moyka_output_rows for this serial (kirim_line_moyka_asof/
  -- kirim_line_moyka_range's own source and exclusion set -- see the header
  -- comment on why this stays separate from fp_all), fetched ONCE, feeds
  -- both moyka_asof_calc and moyka_range_calc.
  moyka_out_all as materialized (
    select qty_kg, date_basis
    from report_moyka_output_rows r
    where r.serial = p_serial
      and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
  ),
  -- wash_cycles for this serial, fetched ONCE -- feeds state.moykada_per_cycle,
  -- moyka_asof_calc's active-cycle lookup, and loss_range_calc's
  -- closed-in-range lookup (cycle_no/next_opened_at reproduced exactly as
  -- kirim_line_loss_range's own `cycles` CTE defines them).
  cycles_all as materialized (
    select id, cycle_no, opened_at, closed_at,
           lead(opened_at) over (order by cycle_no) as next_opened_at
    from wash_cycles where serial = p_serial
  ),
  moyka_out as (
    select coalesce(sum(weight_kg), 0) as v from fp_all
  ),
  -- Verbatim from kirim_line_state.moykada_per_cycle, referencing ms_all/
  -- fp_all instead of re-querying moyka_sends/base_pallets -- same rows,
  -- same predicate. NOTE A: `c.opened_at::date` is a bare cast here (no `at
  -- time zone 'utc'`), reproduced exactly as the original has it.
  moykada_per_cycle as (
    select coalesce(sum(
      case when c.closed_at is not null then 0
        else greatest(0,
          coalesce((select sum(qty_kg) from ms_all where sent_date >= c.opened_at::date), 0)
          - coalesce((select sum(weight_kg) from fp_all where received_date >= c.opened_at::date), 0)
        )
      end
    ), 0) as v
    from cycles_all c
  ),
  departed as (
    select coalesce(sum(c.qty_kg), 0) as v
    from chiqim_pallet_consumption c
    join fp_all bp on bp.barcode2 = c.barcode2
    join chiqim_lines cl on cl.id = c.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where chiqim_departed_at(cr.id) is not null
  ),
  -- Verbatim from kirim_line_moyka_asof's `active` CTE.
  active_cycle as (
    select opened_at, closed_at from cycles_all
    where (opened_at at time zone 'utc')::date <= p_to
    order by opened_at desc limit 1
  ),
  -- Verbatim from kirim_line_moyka_asof's body. NOTE A: the active-cycle
  -- WHERE above uses `at time zone 'utc'`, but the sums just below compare
  -- `sent_date`/`date_basis` against a bare `(select opened_at from
  -- active_cycle)::date` -- same inconsistency as moykada_per_cycle,
  -- reproduced exactly.
  moyka_asof_calc as (
    select case
      when not exists (select 1 from active_cycle) then 0
      when (select closed_at from active_cycle) is not null
           and ((select closed_at from active_cycle) at time zone 'utc')::date <= p_to then 0
      else greatest(0,
        coalesce((select sum(qty_kg) from ms_all where sent_date >= (select opened_at from active_cycle)::date and sent_date <= p_to), 0)
        - coalesce((select sum(qty_kg) from moyka_out_all where date_basis >= (select opened_at from active_cycle)::date and date_basis <= p_to), 0)
      )
    end as v
  ),
  -- Verbatim from kirim_line_moyka_range's body.
  moyka_range_calc as (
    select
      coalesce((select sum(qty_kg) from ms_all where sent_date between p_from and p_to), 0) as to_moyka_kg,
      coalesce((select sum(qty_kg) from moyka_out_all where date_basis between p_from and p_to), 0) as from_moyka_kg
  ),
  -- Verbatim from kirim_line_loss_range's `closed_in_range` CTE, reading
  -- cycles_all instead of re-querying wash_cycles.
  closed_in_range as (
    select * from cycles_all
    where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to
  ),
  -- Verbatim from kirim_line_loss_range's body -- client_calibre_split(...)
  -- called exactly as before, not inlined (it's not one of the five
  -- functions this prompt consolidates).
  loss_range_calc as (
    select case when not exists (select 1 from closed_in_range) then null else
      (select coalesce(sum(
        coalesce((select sum(qty_kg) from ms_all where sent_date >= (cir.opened_at at time zone 'utc')::date and sent_date <= (cir.closed_at at time zone 'utc')::date), 0)
        - (select calibre_kg + kn_kg from client_calibre_split(p_serial, cir.opened_at, case when cir.next_opened_at is null then null else cir.next_opened_at - interval '1 day' end))
      ), 0) from closed_in_range cir)
    end as v
  )
  select
    eq.v as state_qabul_qilingan,
    greatest(0, eq.v - sent.v - rezka_sent.v - raw_disp.v) as state_omborda_qoldi,
    sent.v as state_moykaga_yuborilgan,
    (select v from moykada_per_cycle) as state_moykada,
    moyka_out.v as state_moykadan_chiqgan,
    raw_disp.v as state_xom_jonatilgan,
    departed.v as state_olib_ketilgan,
    (select v from moyka_asof_calc) as moyka_asof,
    moyka_range_calc.to_moyka_kg as moyka_range_to_moyka_kg,
    moyka_range_calc.from_moyka_kg as moyka_range_from_moyka_kg,
    coalesce((select sum(weight_kg) filter (where code = '01' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k1,
    coalesce((select sum(weight_kg) filter (where code = '02' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k2,
    coalesce((select sum(weight_kg) filter (where code = '03' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k3,
    coalesce((select sum(weight_kg) filter (where code = '04' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k4,
    coalesce((select sum(weight_kg) filter (where code = '05' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k5,
    coalesce((select sum(weight_kg) filter (where code = '06' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k6,
    coalesce((select sum(weight_kg) filter (where code = '07' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k7,
    coalesce((select sum(weight_kg) filter (where code = '08' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_k8,
    coalesce((select sum(weight_kg) filter (where code = 'KN' and received_date between p_from and p_to) from fp_all), 0) as calibre_output_kn,
    (select v from loss_range_calc) as loss_range
  from eq, sent, rezka_sent, raw_disp, moyka_out, departed, moyka_range_calc;
$function$;

-- report_totals -- five `cross join lateral`s (state / moykada_asof /
-- moyka_range / calibre_output / realized_loss) collapsed into one
-- `cross join lateral kirim_line_report_bundle`. Output columns, names and
-- order unchanged -- verify against the RETURNS TABLE list, unchanged from
-- the live definition this replaces.
create or replace function public.report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_partiya_no integer default null
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
  state_yoqotish numeric,
  state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric
)
language sql
stable
as $function$
  with filtered as materialized (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
  ),
  movement as (
    select
      count(*) as total_count,
      coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0) as total_kg_in,
      coalesce(sum(case when kind in ('chiqim', 'chiqim_raw', 'chiqim_old_kn', 'chiqim_dispatch') then qty_kg else 0 end), 0) as total_kg_out,
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
  -- ONE lateral over distinct_serials (was five) -- kirim_line_report_bundle
  -- itself fetches moyka_sends/wash_cycles/finished_pallets/
  -- report_moyka_output_rows once each per serial, not once each per
  -- function per serial.
  bundled as (
    select b.*
    from distinct_serials ds
    cross join lateral kirim_line_report_bundle(ds.serial, p_from, p_to) b
  ),
  agg as (
    select
      count(*) as state_serial_count,
      coalesce(sum(state_qabul_qilingan), 0) as state_qabul_qilingan,
      coalesce(sum(state_omborda_qoldi), 0) as state_omborda_qoldi,
      coalesce(sum(state_xom_jonatilgan), 0) as state_xom_jonatilgan,
      coalesce(sum(state_olib_ketilgan), 0) as state_olib_ketilgan,
      coalesce(sum(state_moykaga_yuborilgan), 0) as state_moykaga_yuborilgan_lifetime,
      coalesce(sum(state_moykadan_chiqgan), 0) as state_moykadan_chiqgan_lifetime,
      coalesce(sum(moyka_asof), 0) as state_moykada,
      coalesce(sum(moyka_range_to_moyka_kg), 0) as state_moykaga_yuborilgan,
      coalesce(sum(moyka_range_from_moyka_kg), 0) as state_moykadan_chiqgan,
      coalesce(sum(calibre_output_k1), 0) as state_k1,
      coalesce(sum(calibre_output_k2), 0) as state_k2,
      coalesce(sum(calibre_output_k3), 0) as state_k3,
      coalesce(sum(calibre_output_k4), 0) as state_k4,
      coalesce(sum(calibre_output_k5), 0) as state_k5,
      coalesce(sum(calibre_output_k6), 0) as state_k6,
      coalesce(sum(calibre_output_k7), 0) as state_k7,
      coalesce(sum(calibre_output_k8), 0) as state_k8,
      coalesce(sum(calibre_output_kn), 0) as state_kn,
      coalesce(sum(loss_range), 0) as state_yoqotish
    from bundled
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    agg.state_serial_count, agg.state_qabul_qilingan, agg.state_omborda_qoldi,
    agg.state_moykaga_yuborilgan, agg.state_moykada, agg.state_moykadan_chiqgan,
    agg.state_xom_jonatilgan, agg.state_olib_ketilgan,
    agg.state_k1, agg.state_k2, agg.state_k3, agg.state_k4,
    agg.state_k5, agg.state_k6, agg.state_k7, agg.state_k8,
    agg.state_kn,
    agg.state_yoqotish,
    agg.state_moykaga_yuborilgan_lifetime, agg.state_moykadan_chiqgan_lifetime
  from movement, agg;
$function$;

-- report_query_page -- five `left join lateral`s (kirim_line_state /
-- kirim_line_calibre_output_range / kirim_line_moyka_range /
-- kirim_line_moyka_asof / kirim_line_loss_range) collapsed into one
-- `left join lateral kirim_line_report_bundle`, PER PAGE ROW instead of
-- per distinct serial (report_query_page was already correctly bounded to
-- the page, see the prior diagnostic's finding #3 -- this only cuts the
-- five-calls-per-row down to one). chiqim_dispatch_calibre_breakdown is
-- untouched -- out of scope (it's keyed by request_id, not serial, and
-- wasn't one of the five functions named in this prompt). Output columns,
-- names, order and positional mapping onto the RETURNS TABLE list are
-- unchanged from the live definition this replaces.
create or replace function public.report_query_page(
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
  state_yoqotish numeric, state_moykaga_yuborilgan_lifetime numeric, state_moykadan_chiqgan_lifetime numeric,
  dispatch_k1 numeric, dispatch_k2 numeric, dispatch_k3 numeric, dispatch_k4 numeric, dispatch_k5 numeric,
  dispatch_k6 numeric, dispatch_k7 numeric, dispatch_k8 numeric, dispatch_kn numeric
)
language sql
stable
as $function$
  select f.*, b.state_qabul_qilingan, b.state_omborda_qoldi, b.moyka_range_to_moyka_kg, b.moyka_asof,
         b.moyka_range_from_moyka_kg, b.state_xom_jonatilgan, b.state_olib_ketilgan,
         b.calibre_output_k1, b.calibre_output_k2, b.calibre_output_k3, b.calibre_output_k4, b.calibre_output_k5,
         b.calibre_output_k6, b.calibre_output_k7, b.calibre_output_k8, b.calibre_output_kn,
         b.loss_range,
         b.state_moykaga_yuborilgan, b.state_moykadan_chiqgan,
         cdc.k1, cdc.k2, cdc.k3, cdc.k4, cdc.k5, cdc.k6, cdc.k7, cdc.k8, cdc.kn
  from (
    select *
    from report_filtered_rows_v2(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_report_bundle(f.serial, p_from, p_to) b on f.serial is not null
  left join lateral chiqim_dispatch_calibre_breakdown(
    f.request_id, p_directions, p_from, p_to, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
  ) cdc on f.kind = 'chiqim_dispatch';
$function$;

-- ============================================================
-- CHANGE 3 -- report_filtered_rows_v2 direction short-circuit
-- ============================================================
create or replace function public.report_filtered_rows_v2(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_partiya_no integer default null
)
returns setof report_rows_v2
language sql
stable
as $function$
  -- kirim / moyka_send: short-circuited (2026-09-19) -- `gate` is zero rows
  -- when neither 'kirim' nor 'moyka_send' is requested, so the LATERAL
  -- (report_rows_v2's kirim + moyka_send arms) is never invoked at all.
  select r.*
  from (select 1 where p_directions is null or array_length(p_directions, 1) is null or p_directions && array['kirim', 'moyka_send']) gate
  cross join lateral (
    select r.*
    from report_rows_v2 r
    where r.kind in ('kirim', 'moyka_send')
      and (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
      and (
        (r.kind = 'kirim' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
        or (r.kind = 'moyka_send' and p_calibre_id is null and (p_barcode2 is null or p_barcode2 = '') and (p_wash_cycle is null or p_wash_cycle = '') and (p_lab_verdict is null or p_lab_verdict = '') and (p_status is null or p_status = ''))
      )
      and (r.date_basis is not null and r.date_basis between p_from and p_to)
      and (p_owner_id is null or r.owner_id = p_owner_id)
      and (p_type_id is null or r.type_id = p_type_id)
      and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%')
      and (p_plate is null or p_plate = '' or r.plate ilike '%' || p_plate || '%')
      and (p_driver is null or p_driver = '' or r.driver ilike '%' || p_driver || '%')
      and (p_partiya_no is null or r.partiya_no = p_partiya_no)
  ) r

  union all

  -- chiqim / chiqim_raw / chiqim_old_kn: UNCHANGED. Already pre-intersects
  -- p_directions before calling report_dispatch_rows_v2 -- this was the
  -- pattern branches 1 and 3 now mirror (in spirit; see the header comment
  -- on why the mechanism here is a stronger, verified LATERAL short-circuit
  -- rather than the same WHERE-after-the-call text).
  select *
  from report_dispatch_rows_v2(
    case
      when p_directions is null or array_length(p_directions, 1) is null then null
      else array(select unnest(p_directions) intersect select unnest(array['chiqim','chiqim_raw','chiqim_old_kn']))
    end,
    p_from, p_to, p_owner_id, p_type_id, p_calibre_id, p_serial, p_barcode2, p_plate, p_driver,
    p_wash_cycle, p_lab_verdict, p_status, p_partiya_no
  )
  where p_directions is null or array_length(p_directions, 1) is null
     or p_directions && array['chiqim', 'chiqim_raw', 'chiqim_old_kn']

  union all

  -- moyka_output: short-circuited (2026-09-19), same idiom as the kirim/
  -- moyka_send branch above.
  select r2.*
  from (select 1 where p_directions is null or array_length(p_directions, 1) is null or 'moyka_output' = any(p_directions)) gate2
  cross join lateral (
    select *
    from report_moyka_output_rows_by_serial(p_from, p_to, p_owner_id, p_type_id, p_serial, p_partiya_no, p_status, p_lab_verdict)
    where p_calibre_id is null
      and (p_barcode2 is null or p_barcode2 = '')
      and (p_wash_cycle is null or p_wash_cycle = '')
  ) r2;
$function$;

-- Benchmark summary (full before/after table in the session's report to the
-- user): report_totals and report_query_page EXPLAIN ANALYZE Planning +
-- Execution time were captured before this file, after CHANGE 2 alone
-- (bundle wired into report_totals/report_query_page, report_filtered_rows_v2
-- still the pre-existing 2026-09-15 definition), after CHANGE 3 applied on
-- top (this file's final state), and again after the CHANGE 4 index
-- migration. kirim_line_report_bundle's output was verified byte-identical
-- to the five original functions' combined output for all 34 distinct
-- serials in kirim_lines before CHANGE 2 was wired into report_totals/
-- report_query_page (ad hoc verification query, not persisted as schema).
