-- Расход per-truck rewrite (CLAUDE.md task "Rebuild the client portal...",
-- Fix 2): client_chiqim_ledger(date,date,text[],uuid) regrained from one
-- row per SERIAL (0115/0117) to one row per TRUCK/dispatch event
-- (chiqim_requests.id) -- no backwards-compat needed, the old per-serial
-- frontend (ClientRashodTab.tsx) is deleted alongside this migration.
--
-- Same taxonomy, same filters (p_kinds/p_type_id), same `filtered` CTE
-- shape as 0115/0117 -- only the outer grouping key changes from
-- coalesce(serial, 'OLDKN-'||type_id) to request_id, and `serial` itself is
-- dropped from every CTE (no per-serial breakdown anywhere in the new
-- design, so it's genuinely unused now, not just hidden).
--
-- New row shape: requestId/date/plate/driver/kinds/totalKg, plus two
-- expand-only breakdowns computed server-side (never re-derived
-- client-side, same rule as every other client_* ledger):
--   - typeBreakdown: this truck's cargo summed by product type (a truck can
--     carry more than one Вид сырья; the old per-serial grain never needed
--     this since a serial is single-type by construction, CLAUDE.md).
--   - calibreBreakdown: only from 'tayyor'/'eski_yuvilgan' lines (the two
--     kinds with a meaningful multi-calibre split) -- konditerka/rezka_kn
--     are structurally a single always-KN bucket (redundant with
--     typeBreakdown), and vozvrat/eski_kn have no calibre_id at all.
--
-- The `client_chiqim_ledger(date,date,text[])` 3-arg overload (no
-- p_type_id) is a pre-existing orphan from before 0117 added the 4-arg
-- version -- confirmed no frontend caller uses it (fetchClientChiqimLedger
-- always sends p_type_id). Left untouched: out of scope for this task, and
-- this session's own earlier production incident (0119) was specifically
-- about dropping an RPC before confirming nothing still depends on it.
--
-- `totals` (totalKg/byKind/tayyorByCalibre) is unchanged -- it was already
-- computed from `grouped`/`calibre_detail`, both independent of row grain.
create or replace function public.client_chiqim_ledger(p_from_date date, p_to_date date, p_kinds text[], p_type_id uuid default null::uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with
me as (select my_owner_id() as owner_id),
req as (
  select cr.*
  from chiqim_requests cr, me
  where cr.owner_id = me.owner_id
    and coalesce(cr.plate, '') not like 'TEST-%'
    and cr.request_date between p_from_date and p_to_date
    and chiqim_departed_at(cr.id) is not null
),
finished_events as (
  select
    r.id as request_id, r.request_date, r.plate, r.driver,
    case
      when c.is_rezka_output then 'rezka_kn'
      when c.is_numberless then 'konditerka'
      when cl.line_kind = 'old_washed' then 'eski_yuvilgan'
      else 'tayyor'
    end as kind,
    fp.type_id, c.id as calibre_id, c.label, c.code, c.sort_order,
    cpc.qty_kg
  from req r
  join chiqim_lines cl on cl.request_id = r.id
  join chiqim_pallet_consumption cpc on cpc.chiqim_line_id = cl.id
  join finished_pallets fp on fp.barcode2 = cpc.barcode2
  join calibres c on c.id = fp.calibre_id
),
raw_events as (
  select
    r.id as request_id, r.request_date, r.plate, r.driver,
    'vozvrat'::text as kind, -- line_kind IN ('raw','old_raw') -- no schema field distinguishes a return from a sale, see 0109's header
    cl.type_id,
    null::uuid as calibre_id, null::text as label, null::text as code, null::int as sort_order,
    rdl.net_kg as qty_kg
  from req r
  join chiqim_lines cl on cl.request_id = r.id
  join raw_dispatch_lines rdl on rdl.chiqim_line_id = cl.id
),
old_kn_events as (
  select
    r.id as request_id, r.request_date, r.plate, r.driver,
    'eski_kn'::text as kind,
    okp.type_id,
    null::uuid as calibre_id, null::text as label, null::text as code, null::int as sort_order,
    okc.collected_kg as qty_kg
  from req r
  join chiqim_lines cl on cl.request_id = r.id
  join old_kn_collections okc on okc.chiqim_line_id = cl.id
  join old_kn_pools okp on okp.id = okc.pool_id
),
all_events as (
  select * from finished_events
  union all
  select * from raw_events
  union all
  select * from old_kn_events
),
filtered as (
  select * from all_events
  where (p_kinds is null or kind = any(p_kinds))
    and (p_type_id is null or type_id = p_type_id)
),
grouped as (
  select request_id, request_date, plate, driver, kind, type_id, sum(qty_kg) as kg
  from filtered
  group by request_id, request_date, plate, driver, kind, type_id
),
calibre_detail as (
  select request_id, kind, type_id, calibre_id, label, code, sort_order, sum(qty_kg) as kg
  from filtered
  where calibre_id is not null
  group by request_id, kind, type_id, calibre_id, label, code, sort_order
),
truck_base as (
  select
    request_id, request_date, plate, driver,
    string_agg(distinct kind, ', ' order by kind) as kinds,
    sum(qty_kg) as total_kg
  from filtered
  group by request_id, request_date, plate, driver
),
truck_type_breakdown as (
  select request_id, type_id, sum(qty_kg) as kg
  from filtered
  group by request_id, type_id
),
truck_calibre_breakdown as (
  -- Only the two kinds with a meaningful multi-calibre split -- see this
  -- migration's header for why konditerka/rezka_kn/vozvrat/eski_kn are
  -- excluded here even though konditerka/rezka_kn do carry a calibre_id.
  select request_id, calibre_id, label, code, sort_order, sum(qty_kg) as kg
  from filtered
  where calibre_id is not null and kind in ('tayyor', 'eski_yuvilgan')
  group by request_id, calibre_id, label, code, sort_order
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'requestId', tb.request_id,
      'date', tb.request_date,
      'plate', tb.plate,
      'driver', tb.driver,
      'kinds', tb.kinds,
      'totalKg', tb.total_kg,
      'typeBreakdown', (
        select coalesce(jsonb_agg(jsonb_build_object('typeId', ttb.type_id, 'kg', ttb.kg) order by ttb.kg desc), '[]'::jsonb)
        from truck_type_breakdown ttb where ttb.request_id = tb.request_id
      ),
      'calibreBreakdown', (
        select coalesce(jsonb_agg(jsonb_build_object('calibreId', tcb.calibre_id, 'label', tcb.label, 'code', tcb.code, 'kg', tcb.kg) order by tcb.sort_order), '[]'::jsonb)
        from truck_calibre_breakdown tcb where tcb.request_id = tb.request_id
      )
    ) order by tb.request_date desc, tb.plate), '[]'::jsonb)
    from truck_base tb
  ),
  'totals', jsonb_build_object(
    'totalKg', (select coalesce(sum(kg), 0) from grouped),
    'byKind', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'kg', k.kg) order by k.kind), '[]'::jsonb)
      from (select kind, coalesce(sum(kg), 0) as kg from grouped group by kind) k
    ),
    'tayyorByCalibre', (
      select coalesce(jsonb_agg(jsonb_build_object('calibreId', t.calibre_id, 'label', t.label, 'code', t.code, 'kg', t.kg) order by t.sort_order), '[]'::jsonb)
      from (
        select calibre_id, label, code, sort_order, sum(kg) as kg
        from calibre_detail where kind = 'tayyor'
        group by calibre_id, label, code, sort_order
      ) t
    )
  )
);
$function$;
