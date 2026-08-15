-- Hisobot: Moyka movements as report rows, multi-select direction filter,
-- serial-state volume columns (2026-08-15). See DECISIONS.md "Hisobot:
-- Moyka rows, direction split, serial-state columns" for the full sourcing
-- map, the four confirmed design answers, the reconciliation check
-- kirim_line_state() is verified against, and the corrections made across
-- two review rounds: (a) additive-only function signatures, no DROP, to
-- avoid a production breakage window between migration and frontend
-- deploy; (b) report_rows ITSELF is left completely untouched (not just
-- the functions) -- a separate report_rows_v2 view carries the two new
-- branches, read only by the new text[] functions, so the deployed
-- frontend's read path is genuinely unchanged, not just signature-safe;
-- (c) report_moyka_output_rows deliberately NOT exclusion-filtered the
-- same way kirim_line_state is -- documented below, not a bug, and the
-- two same-named figures get distinct on-screen labels (frontend), not
-- just a documentation note; (d) the true semantics of "CHIQIM (tayyor)"
-- (includes band_qilingan, not just departed) confirmed and recorded.
--
-- Shape of the change:
--  1. kirim_line_state(serial) -- ONE new per-serial function computing all
--     7 state figures together.
--  2. report_moyka_send_rows / report_moyka_output_rows -- two new row
--     sources, same 28-column shape every existing report_*_rows view has.
--  3. report_rows_v2 -- a NEW view (report_rows itself is NOT touched),
--     all 6 branches (the original 4 plus the 2 new ones). Only the new
--     text[]-parameter functions read from it -- the deployed frontend's
--     entire read path (report_rows -> report_filtered_rows(text,...) ->
--     ...) never touches this view at all, so it cannot receive kind
--     values its mapper doesn't know about, full stop, not just "the
--     filter happens to exclude them."
--  4. report_filtered_rows / report_query_page / report_totals -- NEW
--     text[]-parameter OVERLOADS added alongside the existing
--     text-parameter versions, which are left completely untouched. Not a
--     DROP+CREATE: the deployed frontend calls the old signatures on
--     every Hisobot load, and dropping them would 404 every user between
--     this migration landing and the new frontend deploying.
--     Postgres resolves function overloads by parameter TYPE; PostgREST
--     resolves an RPC call by matching the JSON keys the client sends to a
--     function's declared parameter NAMES -- old client sends
--     `p_direction` (text), new client will send `p_directions` (text[]),
--     genuinely different names, so there is no ambiguity either way.
--     FOLLOW-UP (not this migration): once the new frontend is confirmed
--     deployed and nothing calls the old text-parameter versions anymore,
--     drop report_filtered_rows/report_query_page/report_totals(text, ...)
--     in a cleanup migration, and consider renaming report_rows_v2 ->
--     report_rows (dropping the old 4-branch one) at the same time.
--     Left as a recorded task, not done here.

-- ============================================================
-- 1. kirim_line_state(p_serial) -- the 7 serial-state figures
-- ============================================================
-- Reuses kirim_line_effective_qty (0072) for "Qabul qilingan" rather than
-- re-deriving it a third time. "Moykadan chiqgan" / "Moykada" / "Olib
-- ketilgan" all read from ONE base_pallets CTE using the exact exclusion
-- set rahbar_dashboard_ledger's own `pallets` CTE uses (confirmed, not
-- re-picked): drop pallets consumed into a re-wash (serial_mint_sources --
-- consumed material produces its own separate output; counting it here
-- would double-count), voided (bekor_qilindi), and storage-loss pallets.
-- Unlike the ledger's own CTE, there is no p_to/p_from date gate anywhere
-- in this function -- serial-state columns are explicitly as-of-now,
-- never clipped to the report's filter window (clipping would break the
-- Qabul qilingan = Omborda qoldi + Moykaga yuborilgan + Xom holda
-- jo'natilgan identity, verified on all 12 real accepted KIRIM serials,
-- and again across every direction-filter combination tested, before
-- writing this).
--
-- 🔒 SCALING NOTE, recorded per explicit instruction, not a blocker today:
-- this function runs once per DISTINCT serial inside report_totals, and
-- once per RETURNED ROW (bounded by p_limit, not the full filtered set)
-- inside report_query_page. Each call does ~5 subqueries plus a nested
-- call to kirim_line_effective_qty (2-3 more). Fine at today's data volume
-- (17 kirim_lines total, 11-12 with intake). Will need real attention --
-- batching into a single set-returning query keyed by an array of
-- serials, or a materialized/cached state table -- once a year of data
-- means report_totals is calling this dozens to hundreds of times per
-- request. Not fixed now; flagged so it isn't rediscovered as a surprise.
--
-- "Yo'qotish" deliberately not included -- no canonical per-serial loss-
-- in-kg figure exists yet (see DECISIONS.md); shipping 7, not 8.
create or replace function kirim_line_state(p_serial text)
returns table (
  qabul_qilingan     numeric,
  omborda_qoldi      numeric,
  moykaga_yuborilgan numeric,
  moykada            numeric,
  moykadan_chiqgan   numeric,
  xom_jonatilgan     numeric,
  olib_ketilgan      numeric
)
language sql
stable
as $function$
  with eq as (
    select kirim_line_effective_qty(p_serial) as v
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as v from moyka_sends where serial = p_serial
  ),
  raw_disp as (
    select coalesce(sum(net_kg), 0) as v from raw_dispatch_lines where serial = p_serial
  ),
  base_pallets as (
    select fp.weight_kg, fp.barcode2
    from finished_pallets fp
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  ),
  moyka_out as (
    select coalesce(sum(weight_kg), 0) as v from base_pallets
  ),
  departed as (
    select coalesce(sum(bp.weight_kg), 0) as v
    from base_pallets bp
    where exists (
      select 1 from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      where dm.barcode2 = bp.barcode2 and cgw.completed_at is not null
    )
  )
  select
    eq.v as qabul_qilingan,
    greatest(0, eq.v - sent.v - raw_disp.v) as omborda_qoldi,
    sent.v as moykaga_yuborilgan,
    greatest(0, sent.v - moyka_out.v) as moykada,
    moyka_out.v as moykadan_chiqgan,
    raw_disp.v as xom_jonatilgan,
    departed.v as olib_ketilgan
  from eq, sent, raw_disp, moyka_out, departed;
$function$;

-- ============================================================
-- 2. Two new row sources -- internal movements, no waybill/gate
-- ============================================================
-- MOYKAGA: dated by moyka_sends.sent_date. No plate/driver/request --
-- confirmed schema-level: moyka_sends is just
-- (id, serial, sent_date, qty_kg, created_by), no waybill of any kind.
create or replace view report_moyka_send_rows as
select
  'moyka_send'::text as kind,
  ms.id::text as row_key,
  ms.serial,
  null::text as barcode2,
  kl.order_id,
  null::uuid as request_id,
  ko.owner_id,
  kl.type_id,
  null::uuid as calibre_id,
  null::text as plate,
  null::text as driver,
  ms.sent_date as date_basis,
  'sent_date'::text as date_basis_source,
  ms.qty_kg as qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  null::integer as wash_cycle,
  null::text as pallet_status,
  null::text as lab_verdict,
  null::numeric as target_moisture_pct,
  null::numeric as target_so2_mg_kg,
  null::numeric as moisture_pct,
  null::numeric as so2_mg_kg,
  null::text[] as void_successor_barcodes,
  null::numeric as box_mass_kg
from moyka_sends ms
join kirim_lines kl on kl.serial = ms.serial
join kirim_orders ko on ko.order_id = kl.order_id
where ko.plate !~~ 'TEST-%';

-- MOYKADAN: dated by finished_pallets.received_date. row_key is prefixed
-- ('moyka-output-' || barcode2), NOT bare barcode2 -- report_chiqim_rows
-- already uses bare fp.barcode2 as ITS row_key (confirmed via
-- pg_get_viewdef), and the same pallet can legitimately appear as both a
-- moyka_output row (produced) and a chiqim row (requested/departed) in
-- the same "Hammasi" result set with a wide enough date range -- an
-- unprefixed key would collide (React list key + pagination ORDER BY).
--
-- 🔒 Deliberately UNFILTERED by status -- includes bekor_qilindi/consumed/
-- storage_loss pallets, unlike kirim_line_state's base_pallets CTE. This
-- is intentional, not an oversight: matches report_chiqim_rows' own
-- philosophy exactly (confirmed via pg_get_viewdef -- that view has zero
-- status filter beyond the TEST-plate exclusion; a voided/consumed pallet
-- still gets a row there, with its real status visible via pallet_status,
-- rather than silently disappearing). This view is a ROW/EVENT log --
-- "this pallet was produced on this date" is a historical fact that stays
-- true even if the pallet is later voided or consumed into a re-wash.
-- kirim_line_state's exclusion set answers a different question --
-- "how much of this serial's Moyka output is real, standing output right
-- now" -- so total_kg_from_moyka (this view's own row sum, an activity
-- total) and state_moykadan_chiqgan (kirim_line_state's filtered sum, a
-- standing-balance total) are EXPECTED to diverge once a real
-- voided/consumed/storage-loss pallet exists, the same way a KIRIM
-- serial's Netto-on-arrival doesn't shrink just because material later
-- left storage. Both read 0 today (no real Moyka output yet in this
-- data), so this divergence is currently untested by definition, not
-- silently hidden -- flagged here and in DECISIONS.md/SPEC.md so it's
-- understood, not rediscovered as a bug, the first time it's nonzero.
create or replace view report_moyka_output_rows as
select
  'moyka_output'::text as kind,
  'moyka-output-' || fp.barcode2 as row_key,
  fp.serial,
  fp.barcode2,
  kl.order_id,
  dm.request_id,
  ko.owner_id,
  fp.type_id,
  fp.calibre_id,
  null::text as plate,
  null::text as driver,
  fp.received_date as date_basis,
  'received_date'::text as date_basis_source,
  fp.weight_kg as qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  null::integer as wash_cycle,
  case
    when fp.status = 'bekor_qilindi' then 'bekor_qilingan'
    when fp.status = 'consumed' then 'ishlatilgan'
    when fp.status = 'storage_loss' then 'saqlashda_yoqolgan'
    when dm.request_id is not null then
      case when cgw.completed_at is not null then 'jonatilgan' else 'band_qilingan' end
    else 'omborda'
  end as pallet_status,
  lr.verdict as lab_verdict,
  kl.target_moisture_pct,
  kl.target_so2_mg_kg,
  lr.moisture_pct,
  lr.so2_mg_kg,
  null::text[] as void_successor_barcodes,
  null::numeric as box_mass_kg
from finished_pallets fp
join kirim_lines kl on kl.serial = fp.serial
join kirim_orders ko on ko.order_id = kl.order_id
left join lateral (
  select dm2.request_id
  from dispatch_manifest dm2
  where dm2.barcode2 = fp.barcode2
  limit 1
) dm on true
left join lateral (
  select cgw2.completed_at
  from gate_weighings cgw2
  where cgw2.dir = 'chiqim' and cgw2.request_id = dm.request_id
  order by cgw2.completed_at desc nulls last
  limit 1
) cgw on true
left join lateral (
  select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
) wc on true
left join lateral (
  select lr2.verdict, lr2.moisture_pct, lr2.so2_mg_kg
  from lab_results lr2
  where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
  order by lr2.created_at desc
  limit 1
) lr on true
where ko.plate !~~ 'TEST-%';

-- ============================================================
-- 3. report_rows_v2 -- a NEW view, NOT a replacement of report_rows.
--    report_rows itself is not touched anywhere in this migration -- the
--    deployed frontend's entire read path (report_rows ->
--    report_filtered_rows(text,...) -> report_query_page/report_totals
--    (text,...)) keeps reading the original 4-branch view, verbatim,
--    forever, until the follow-up cleanup migration explicitly changes
--    it. Only the new text[]-parameter functions below read this view.
-- ============================================================
create or replace view report_rows_v2 as
  select
    kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id,
    plate, driver, date_basis, date_basis_source, qty_kg, provisional, declared_qty,
    truck_variance_diff_kg, truck_variance_diff_pct, provisional_variance_flag, wash_cycle,
    pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg,
    void_successor_barcodes, box_mass_kg
  from report_kirim_rows
  where origin = 'delivery'
  union all
  select
    kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id,
    plate, driver, date_basis, date_basis_source, qty_kg, provisional, declared_qty,
    truck_variance_diff_kg, truck_variance_diff_pct, provisional_variance_flag, wash_cycle,
    pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg,
    void_successor_barcodes, box_mass_kg
  from report_chiqim_rows
  union all
  select
    kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id,
    plate, driver, date_basis, date_basis_source, qty_kg, provisional, declared_qty,
    truck_variance_diff_kg, truck_variance_diff_pct, provisional_variance_flag, wash_cycle,
    pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg,
    void_successor_barcodes, box_mass_kg
  from report_raw_dispatch_rows
  union all
  select
    kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id,
    plate, driver, date_basis, date_basis_source, qty_kg, provisional, declared_qty,
    truck_variance_diff_kg, truck_variance_diff_pct, provisional_variance_flag, wash_cycle,
    pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg,
    void_successor_barcodes, box_mass_kg
  from report_old_kn_rows
  union all
  select
    kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id,
    plate, driver, date_basis, date_basis_source, qty_kg, provisional, declared_qty,
    truck_variance_diff_kg, truck_variance_diff_pct, provisional_variance_flag, wash_cycle,
    pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg,
    void_successor_barcodes, box_mass_kg
  from report_moyka_send_rows
  union all
  select
    kind, row_key, serial, barcode2, order_id, request_id, owner_id, type_id, calibre_id,
    plate, driver, date_basis, date_basis_source, qty_kg, provisional, declared_qty,
    truck_variance_diff_kg, truck_variance_diff_pct, provisional_variance_flag, wash_cycle,
    pallet_status, lab_verdict, target_moisture_pct, target_so2_mg_kg, moisture_pct, so2_mg_kg,
    void_successor_barcodes, box_mass_kg
  from report_moyka_output_rows;

-- ============================================================
-- 4. report_filtered_rows -- NEW text[] overload, ADDED alongside the
--    existing text-parameter version (untouched, no DROP). NULL or empty
--    array = no restriction. Only reachable via the new frontend, since
--    it's a different parameter name (p_directions vs p_direction) as
--    well as a different type.
-- ============================================================
create function report_filtered_rows(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text
)
returns setof report_rows_v2
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
$function$;

-- ============================================================
-- 5. report_query_page -- NEW text[] overload, ADDED alongside the
--    existing text-parameter version (untouched, no DROP). Also gains the
--    7 state columns, joined on per returned row (LIMIT-bounded).
-- ============================================================
create function report_query_page(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text,
  p_limit integer default 100, p_offset integer default 0
)
returns table (
  kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid,
  type_id uuid, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text,
  qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric,
  truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer,
  pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric,
  moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric,
  state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric,
  state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric
)
language sql
stable
as $function$
  select f.*, s.qabul_qilingan, s.omborda_qoldi, s.moykaga_yuborilgan, s.moykada,
         s.moykadan_chiqgan, s.xom_jonatilgan, s.olib_ketilgan
  from (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
    )
    order by date_basis desc nulls last, row_key desc
    limit p_limit offset p_offset
  ) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null;
$function$;

-- ============================================================
-- 6. report_totals -- NEW text[] overload, ADDED alongside the existing
--    text-parameter version (untouched, no DROP). Movement totals (row
--    sums, extended with 2 new kinds) + state totals (distinct-serial
--    sums -- the trap). `filtered` is materialized explicitly so
--    report_filtered_rows runs once, not once per CTE reference.
-- ============================================================
create function report_totals(
  p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid,
  p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text
)
returns table(
  total_count bigint,
  total_kg_in numeric,
  total_kg_out numeric,
  total_kg_tara_in numeric,
  total_kg_tara_out numeric,
  total_declared numeric,
  total_hisobiy numeric,
  total_kg_to_moyka numeric,
  total_kg_from_moyka numeric,
  state_serial_count bigint,
  state_qabul_qilingan numeric,
  state_omborda_qoldi numeric,
  state_moykaga_yuborilgan numeric,
  state_moykada numeric,
  state_moykadan_chiqgan numeric,
  state_xom_jonatilgan numeric,
  state_olib_ketilgan numeric
)
language sql
stable
as $function$
  with filtered as materialized (
    select *
    from report_filtered_rows(
      p_directions, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
      p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
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
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    state.state_serial_count, state.state_qabul_qilingan, state.state_omborda_qoldi,
    state.state_moykaga_yuborilgan, state.state_moykada, state.state_moykadan_chiqgan,
    state.state_xom_jonatilgan, state.state_olib_ketilgan
  from movement, state;
$function$;
