-- Applied 2026-07-20 (see docs/DECISIONS.md "Reporting engine: server-side
-- query"). Moves reporting filtering, pagination, and totals (SPEC.md
-- §3.2.1-3.2.4) from the client (src/lib/useReportQuery.ts, FETCH_CAP=500)
-- into Postgres. Replicates reportQuery.ts's exact filter/derivation
-- semantics -- see DECISIONS.md for the field-by-field mapping and the two
-- deliberate simplifications from the original TypeScript.
--
-- Shape: two per-kind views (report_kirim_rows/report_chiqim_rows) union
-- into report_rows; report_filtered_rows(...) is the SINGLE source of truth
-- for the WHERE-clause logic (called by both of the below, so the filter
-- rules can never drift between the two); report_query_page(...) orders and
-- paginates it; report_totals(...) aggregates it. Two calls per filter
-- change (totals once, page rows on every page turn) rather than one
-- combined call, so paging never re-runs the aggregate.

-- ============================================================
-- 1. report_kirim_rows -- one row per kirim_lines entry
-- ============================================================
create or replace view report_kirim_rows
with (security_invoker = true) as
with lines as (
  select
    kl.serial,
    kl.order_id,
    kl.type_id,
    kl.declared_qty,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
)
select
  'kirim'::text as kind,
  l.serial as row_key,
  l.serial as serial,
  null::text as barcode2,
  l.order_id as order_id,
  null::uuid as request_id,
  ko.owner_id as owner_id,
  l.type_id as type_id,
  null::uuid as calibre_id,
  ko.plate as plate,
  ko.driver as driver,
  coalesce((gw.stage1_completed_at at time zone 'utc')::date, ko.order_date) as date_basis,
  case when gw.stage1_completed_at is not null then 'gate_stage1' else 'order_date' end as date_basis_source,
  -- §2.16 deriveEffectiveQty, ported branch-for-branch (weightAuthority.ts)
  case
    when si.actual_qty is null then l.declared_qty
    when gw.completed_at is null then si.actual_qty
    when l.line_count > 1 then si.actual_qty
    else coalesce(gw.net_kg, si.actual_qty)
  end as qty_kg,
  case
    when si.actual_qty is null then false
    when gw.completed_at is null then true
    else false
  end as provisional,
  l.declared_qty as declared_qty,
  case when gw.completed_at is not null and gw.net_kg is not null and ko.declared_total is not null
       then gw.net_kg - ko.declared_total end as truck_variance_diff_kg,
  case when gw.completed_at is not null and gw.net_kg is not null and ko.declared_total is not null and ko.declared_total > 0
       then (gw.net_kg - ko.declared_total) / ko.declared_total * 100 end as truck_variance_diff_pct,
  -- §2.16.2 provisional-variance flag: single-line, gate stage 2 done, sent
  -- while still provisional, and the eventual gate-net figure differs
  -- materially (kam_chiqdi_pct, same threshold OmborIntakeTab reads) from
  -- what was provisional at send time.
  case
    when l.line_count = 1
     and gw.completed_at is not null
     and gw.net_kg is not null
     and si.actual_qty is not null
     and si.actual_qty <> 0
     and es.sent_date is not null
     and es.sent_date <= (gw.completed_at at time zone 'utc')::date
     and abs((gw.net_kg - si.actual_qty) / si.actual_qty * 100) > coalesce((select value from settings_limits where key = 'kam_chiqdi_pct'), 5)
    then true
    else false
  end as provisional_variance_flag,
  null::int as wash_cycle,
  null::text as pallet_status,
  null::text as lab_verdict,
  l.target_moisture_pct as target_moisture_pct,
  l.target_so2_mg_kg as target_so2_mg_kg,
  lr.moisture_pct as moisture_pct,
  lr.so2_mg_kg as so2_mg_kg,
  null::text[] as void_successor_barcodes
from lines l
join kirim_orders ko on ko.order_id = l.order_id
left join storage_intake si on si.serial = l.serial
left join lateral (
  select gw2.net_kg, gw2.completed_at, gw2.stage1_completed_at
  from gate_weighings gw2
  where gw2.dir = 'kirim' and gw2.order_id = l.order_id
  order by gw2.stage1_completed_at desc nulls last
  limit 1
) gw on true
left join lateral (
  select min(ms.sent_date) as sent_date from moyka_sends ms where ms.serial = l.serial
) es on true
left join lateral (
  select lr2.moisture_pct, lr2.so2_mg_kg
  from lab_results lr2
  where lr2.scope = 'kirim' and lr2.parent_serial = l.serial
  order by lr2.created_at desc
  limit 1
) lr on true
where ko.plate not like 'TEST-%';

-- ============================================================
-- 2. report_chiqim_rows -- one row per finished_pallets entry
-- ============================================================
create or replace view report_chiqim_rows
with (security_invoker = true) as
select
  'chiqim'::text as kind,
  fp.barcode2 as row_key,
  fp.serial as serial,
  fp.barcode2 as barcode2,
  kl.order_id as order_id,
  dm.request_id as request_id,
  ko.owner_id as owner_id,
  fp.type_id as type_id,
  fp.calibre_id as calibre_id,
  coalesce(cr.plate, '') as plate,
  coalesce(cr.driver, '') as driver,
  (cgw.completed_at at time zone 'utc')::date as date_basis,
  null::text as date_basis_source,
  fp.weight_kg as qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  fp.wash_cycle as wash_cycle,
  -- §3.2.2 derivePalletStatus, ported branch-for-branch (reportQuery.ts) --
  -- finished_pallets.status='dispatched' is confirmed dead (nothing writes
  -- it), so "jo'natilgan" is derived from claimed + completed dispatch gate.
  case
    when fp.status = 'bekor_qilindi' then 'bekor_qilingan'
    when dm.request_id is not null then
      case when cgw.completed_at is not null then 'jonatilgan' else 'band_qilingan' end
    else 'omborda'
  end as pallet_status,
  lr.verdict as lab_verdict,
  kl.target_moisture_pct as target_moisture_pct,
  kl.target_so2_mg_kg as target_so2_mg_kg,
  lr.moisture_pct as moisture_pct,
  lr.so2_mg_kg as so2_mg_kg,
  -- §3.2.2 "a voided Barcode #2 must remain findable" -- successor cycle is
  -- always wash_cycle+1 (only the active cycle can be re-washed).
  case when fp.status = 'bekor_qilindi' then (
    select array_agg(fp2.barcode2 order by fp2.barcode2)
    from finished_pallets fp2
    where fp2.serial = fp.serial and fp2.wash_cycle = fp.wash_cycle + 1
  ) end as void_successor_barcodes
from finished_pallets fp
join kirim_lines kl on kl.serial = fp.serial
join kirim_orders ko on ko.order_id = kl.order_id
left join lateral (
  select dm2.request_id
  from dispatch_manifest dm2
  where dm2.barcode2 = fp.barcode2
  limit 1
) dm on true
left join chiqim_requests cr on cr.id = dm.request_id
left join lateral (
  select cgw2.completed_at
  from gate_weighings cgw2
  where cgw2.dir = 'chiqim' and cgw2.request_id = dm.request_id
  order by cgw2.completed_at desc nulls last
  limit 1
) cgw on true
left join lateral (
  select wc2.id
  from wash_cycles wc2
  where wc2.serial = fp.serial and wc2.cycle_no = fp.wash_cycle
  limit 1
) wc on true
left join lateral (
  select lr3.verdict, lr3.moisture_pct, lr3.so2_mg_kg
  from lab_results lr3
  where lr3.scope = 'chiqim' and lr3.wash_cycle_id = wc.id
  order by lr3.created_at desc
  limit 1
) lr on true
-- isTestPlate(): excluded if EITHER the claiming request's plate OR the
-- pallet's own originating KIRIM plate is TEST--prefixed (De Morgan's of
-- reportQuery.ts's `isTestPlate(request?.plate) || isTestPlate(originatingPlate)`).
where ko.plate not like 'TEST-%'
  and coalesce(cr.plate, '') not like 'TEST-%';

-- ============================================================
-- 3. report_rows -- the unified shape both RPCs query
-- ============================================================
create or replace view report_rows
with (security_invoker = true) as
select * from report_kirim_rows
union all
select * from report_chiqim_rows;

-- ============================================================
-- 4. report_filtered_rows -- SINGLE source of truth for the WHERE clause.
--    Both report_query_page and report_totals call this, so the filter
--    rules can never drift between the paginated view and the aggregate.
-- ============================================================
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
  where (p_direction = 'both' or r.kind = p_direction)
    -- fetchKirimReportRows' own early-return: ANY of these five active
    -- means KIRIM rows structurally can't match (they have no calibre,
    -- Barcode #2, wash cycle, lab verdict, or pallet status).
    and (
      r.kind = 'chiqim'
      or (
        p_calibre_id is null
        and (p_barcode2 is null or p_barcode2 = '')
        and (p_wash_cycle is null or p_wash_cycle = '')
        and (p_lab_verdict is null or p_lab_verdict = '')
        and (p_status is null or p_status = '')
      )
    )
    -- passesDateOrStatusOverride: dated rows filter by range; undated rows
    -- (no governing dispatch event) only pass if the status filter names
    -- their own exact status. KIRIM rows always have a date, so this
    -- degrades to a plain range filter for them.
    and (
      (r.date_basis is not null and r.date_basis between p_from and p_to)
      or (r.date_basis is null and p_status is not null and p_status <> '' and r.pallet_status = p_status)
    )
    -- the separate, explicit status filter on top (needed so e.g.
    -- selecting "bekor_qilingan" doesn't also admit a dispatched row whose
    -- date happens to fall in range).
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

-- ============================================================
-- 5. report_query_page -- one page of rows, newest-first (missing dates
--    sort last, matching sortByDateDesc's own documented rule).
-- ============================================================
create or replace function report_query_page(
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
  p_status text,
  p_limit int default 100,
  p_offset int default 0
)
returns setof report_rows
language sql
stable
security invoker
as $$
  select *
  from report_filtered_rows(
    p_direction, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
  )
  order by date_basis desc nulls last, row_key desc
  limit p_limit offset p_offset;
$$;

-- ============================================================
-- 6. report_totals -- aggregated over the FULL filtered set, always
--    exactly one row (COALESCE to 0 rather than NULL on an empty set) --
--    called once per filter change, never on page turns.
-- ============================================================
create or replace function report_totals(
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
returns table (total_count bigint, total_kg_in numeric, total_kg_out numeric)
language sql
stable
security invoker
as $$
  select
    count(*),
    coalesce(sum(case when kind = 'kirim' then qty_kg else 0 end), 0),
    coalesce(sum(case when kind = 'chiqim' then qty_kg else 0 end), 0)
  from report_filtered_rows(
    p_direction, p_from, p_to, p_owner_id, p_type_id, p_calibre_id,
    p_serial, p_barcode2, p_plate, p_driver, p_wash_cycle, p_lab_verdict, p_status
  );
$$;

-- ============================================================
-- 7. Grants -- authenticated (menejer/rahbar, per this app's existing role
--    model) needs SELECT on the views and EXECUTE on the functions; RLS on
--    the underlying tables still applies (security_invoker = true), so
--    this grants access to the QUERY shape only, not new row visibility.
-- ============================================================
grant select on report_kirim_rows, report_chiqim_rows, report_rows to authenticated;
grant execute on function report_filtered_rows(text,date,date,uuid,uuid,uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function report_query_page(text,date,date,uuid,uuid,uuid,text,text,text,text,text,text,text,int,int) to authenticated;
grant execute on function report_totals(text,date,date,uuid,uuid,uuid,text,text,text,text,text,text,text) to authenticated;

-- ============================================================
-- 8. Recommended supporting indexes (performance, not correctness --
--    dataset is small today, but the whole point of this task is to
--    survive months of real growth; these are the columns this query
--    shape filters/joins on that have no index yet).
-- ============================================================
create index if not exists idx_kirim_orders_plate on kirim_orders (plate);
create index if not exists idx_gate_weighings_order_dir on gate_weighings (order_id, dir);
create index if not exists idx_gate_weighings_request_dir on gate_weighings (request_id, dir);
create index if not exists idx_finished_pallets_serial on finished_pallets (serial);
create index if not exists idx_moyka_sends_serial on moyka_sends (serial);
create index if not exists idx_lab_results_parent_serial on lab_results (parent_serial) where scope = 'kirim';
create index if not exists idx_lab_results_wash_cycle_id on lab_results (wash_cycle_id) where scope = 'chiqim';
