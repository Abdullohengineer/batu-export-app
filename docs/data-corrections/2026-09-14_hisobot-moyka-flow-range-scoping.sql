-- Hisobot moyka flow columns range-scoped: Moykaga yuborilgan / Moykadan
-- chiqgan / K1-K8/KN table cells and "(joriy)"/"(davrda)" chips were
-- lifetime-scoped (kirim_line_state/kirim_line_calibre_output take no date
-- args) when they should be range-scoped, same as the already-correct
-- movement-group "(davrda)" chips. docs/decisions/0184.
--
-- This is a SHARED-RPC fix: report_query_page/report_totals are called
-- directly (not a parallel copy) by both Rahbar/Menejer's Hisobot
-- (HisobotTab.tsx) and the client portal's Приход screen
-- (ClientPrihodTab.tsx) -- confirmed via a caller audit before applying.
-- Приход renders these exact columns/chips (moykaga_yuborilgan,
-- moykadan_chiqgan, k1-kn are all in its hardcoded CLIENT_PRIHOD_COLUMN_KEYS,
-- and its bespoke ClientTotalsStrip reads the same report_totals fields
-- under Russian labels "(за период)"/"(сейчас)"). Accepted deliberately,
-- per explicit instruction, rather than forking the RPC to preserve wrong
-- numbers on one surface -- Приход gets the same fix. All 5 known
-- cross-month serials belong to one client (Global Export Company), who
-- will see real number changes on their own screen as a result.
--
-- Two new range-scoped sibling functions (mirror existing patterns exactly,
-- per instruction -- don't invent a new one):
--   - kirim_line_moyka_range: mirrors report_moyka_output_rows_by_serial's
--     own exclusion basis (same view, same predicate; exact-match serial
--     instead of ilike substring, since this is a per-row lateral join).
--   - kirim_line_calibre_output_range: byte-identical to
--     kirim_line_calibre_output plus one added date predicate.
--
-- report_query_page/report_totals: state_moykaga_yuborilgan/
-- state_moykadan_chiqgan/state_k1..kn now source from these two range
-- functions instead of kirim_line_state/kirim_line_calibre_output (same
-- column NAMES, so the frontend's existing field mappings needed no
-- renaming). kirim_line_state stays joined, unchanged, for the 5 genuinely
-- as-of-now balance columns (qabul_qilingan/omborda_qoldi/moyka/
-- xom_jonatilgan/olib_ketilgan) AND as the source for two NEW lifetime
-- twin columns (state_moykaga_yuborilgan_lifetime/
-- state_moykadan_chiqgan_lifetime) -- these back the new "(jami)" columns/
-- chips used to check the Qabul qilingan identity (Qabul qilingan =
-- Omborda qoldi + Moykaga yuborilgan + Xom jo'natilgan) and the
-- Moyka-internal identity (Moykaga yuborilgan = Moykadan chiqgan + Moykada
-- + Yo'qotish), both of which depended on these two columns staying
-- lifetime. No per-kalibr lifetime twins (K1-K8/KN) -- not needed, per
-- explicit instruction; the Moykadan chiqgan (jami) twin already covers
-- the aggregate check across all kalibrs combined.
--
-- report_query_page/report_totals both change RETURN TABLE shape (2 new
-- trailing columns), so DROP FUNCTION before CREATE (CREATE OR REPLACE
-- cannot add OUT columns to an existing RETURNS TABLE).
--
-- Yo'qotish stays lifetime-only, no range-scoped twin -- explicitly out of
-- scope for this task (a later one). yield_rows' first-output-month
-- attribution is a separate, known issue, logged but not touched here.
--
-- Dry-run (BEGIN...ROLLBACK, including the DROP+CREATE) executed and shown
-- to the user before applying for real. Verified after applying:
--   - Additivity holds for all 11 range-scoped metrics (Moykaga yuborilgan,
--     Moykadan chiqgan, K1-K8, KN), month-by-month vs full-year, across the
--     ENTIRE dataset (26 distinct serials, not just the 5 known cross-month
--     ones): every sum matches exactly.
--   - The 5 balance columns are byte-identical to an independently
--     recomputed sum via raw kirim_line_state, full year, all 26 serials.
--   - The Qabul qilingan identity holds exactly (diff = 0) using the new
--     Moykaga yuborilgan (jami) twin.
--   - The Moyka-internal identity does NOT balance (diff = -17,830) --
--     confirmed pre-existing, not a regression: both sides route through
--     functions untouched by this change (kirim_line_state's own moyka
--     fields, client_serial_loss_kg), and migration 0101's own header
--     already flags this exact 3-basis divergence as a known, out-of-scope
--     nuance between Yakunlash's loss figure and Hisobot/Yield's basis.

create or replace function public.kirim_line_moyka_range(p_serial text, p_from date, p_to date)
returns table(to_moyka_kg numeric, from_moyka_kg numeric)
language sql
stable
as $function$
  select
    coalesce((select sum(ms.qty_kg) from moyka_sends ms
                where ms.serial = p_serial and ms.sent_date between p_from and p_to), 0) as to_moyka_kg,
    coalesce((select sum(r.qty_kg) from report_moyka_output_rows r
                where r.serial = p_serial
                  and r.date_basis between p_from and p_to
                  and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
                  and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
             ), 0) as from_moyka_kg;
$function$;

create or replace function public.kirim_line_calibre_output_range(p_serial text, p_from date, p_to date)
returns table(k1 numeric, k2 numeric, k3 numeric, k4 numeric, k5 numeric, k6 numeric, k7 numeric, k8 numeric, kn numeric)
language sql
stable
as $function$
  with base_pallets as (
    select fp.weight_kg, c.code
    from finished_pallets fp
    join calibres c on c.id = fp.calibre_id
    where fp.serial = p_serial
      and fp.received_date between p_from and p_to
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  )
  select
    coalesce(sum(weight_kg) filter (where code = '01'), 0) as k1,
    coalesce(sum(weight_kg) filter (where code = '02'), 0) as k2,
    coalesce(sum(weight_kg) filter (where code = '03'), 0) as k3,
    coalesce(sum(weight_kg) filter (where code = '04'), 0) as k4,
    coalesce(sum(weight_kg) filter (where code = '05'), 0) as k5,
    coalesce(sum(weight_kg) filter (where code = '06'), 0) as k6,
    coalesce(sum(weight_kg) filter (where code = '07'), 0) as k7,
    coalesce(sum(weight_kg) filter (where code = '08'), 0) as k8,
    coalesce(sum(weight_kg) filter (where code = 'KN'), 0) as kn
  from base_pallets;
$function$;

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
