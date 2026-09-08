-- Client portal Part B.3 (Расход): pivot client_chiqim_ledger's `rows` from
-- flat per-dispatch-event to one row per serial, each carrying a nested
-- `dispatches` array (per-request detail, shown on expand). `totals`
-- (totalKg/byKind/tayyorByCalibre) is BYTE-IDENTICAL to 0109's own --
-- still exactly what the top-of-page totals block needs, no reason to
-- touch it.
--
-- The three source CTEs (finished_events/raw_events/old_kn_events) and
-- their kind derivation are untouched, copied verbatim from 0109 -- this
-- migration only changes how `filtered` rows are grouped for the `rows`
-- output.
--
-- Old KN (eski_kn) draws have no serial at all (a weight-pool, not a
-- pallet -- see 0048/0109 headers). Per the confirmed decision (2026-09-08,
-- see DECISIONS.md), these get a SYNTHETIC per-type row_key
-- ('OLDKN-'||type_id) rather than a separate summary block, so all 5 Тип
-- values stay in one table; `isPool` on each row marks it as such for the
-- frontend to render "— (склад KN)" instead of a real serial.
--
-- A real serial can legitimately carry more than one `kind` in the period
-- (e.g. most of its output dispatched as tayyor, a KN-calibre portion as
-- konditerka) -- `kinds` is every distinct kind that fired for this row,
-- comma-joined, matching the task's own "rare edge case, comma-joined"
-- instruction. `typeId` is grouped (not aggregated) since it's safe to:
-- a real serial is single-type by construction (CLAUDE.md), and a
-- synthetic OLDKN- row_key already encodes exactly one type_id in its own
-- key -- uuid has no min()/max() aggregate to collapse it with instead.
create or replace function public.client_chiqim_ledger(p_from_date date, p_to_date date, p_kinds text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    fp.type_id,
    fp.serial, c.id as calibre_id, c.label, c.code, c.sort_order,
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
    cl.type_id, rdl.serial,
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
    okp.type_id, null::text as serial,
    null::uuid as calibre_id, null::text as label, null::text as code, null::int as sort_order,
    okc.collected_kg as qty_kg
  from req r
  join chiqim_lines cl on cl.request_id = r.id
  join old_kn_collections okc on okc.chiqim_line_id = cl.id
  join old_kn_pools okp on okp.id = okc.pool_id
),
all_events as (
  select coalesce(serial, 'OLDKN-' || type_id::text) as row_key, serial is null as is_pool, * from finished_events
  union all
  select coalesce(serial, 'OLDKN-' || type_id::text) as row_key, serial is null as is_pool, * from raw_events
  union all
  select coalesce(serial, 'OLDKN-' || type_id::text) as row_key, serial is null as is_pool, * from old_kn_events
),
filtered as (
  select * from all_events where p_kinds is null or kind = any(p_kinds)
),
grouped as (
  -- pre-existing flat grouping, unchanged: still feeds totals.byKind/
  -- tayyorByCalibre exactly as before, and now also feeds the per-row
  -- kinds/type_id/total_kg rollup below.
  select request_id, request_date, plate, driver, kind, type_id,
         string_agg(distinct serial, ', ' order by serial) as serials,
         sum(qty_kg) as kg
  from filtered
  group by request_id, request_date, plate, driver, kind, type_id
),
calibre_detail as (
  select request_id, kind, type_id, calibre_id, label, code, sort_order, sum(qty_kg) as kg
  from filtered
  where calibre_id is not null
  group by request_id, kind, type_id, calibre_id, label, code, sort_order
),
row_base as (
  -- type_id is grouped, not aggregated: functionally dependent on row_key
  -- (a real serial is single-type by construction, CLAUDE.md; a synthetic
  -- OLDKN- row_key already encodes exactly one type_id), and uuid has no
  -- min()/max() aggregate to collapse it with otherwise.
  select
    row_key, type_id, bool_or(is_pool) as is_pool, min(serial) as serial,
    string_agg(distinct kind, ', ' order by kind) as kinds,
    sum(qty_kg) as total_kg,
    count(distinct request_id) as dispatch_count
  from filtered
  group by row_key, type_id
),
row_calibre_totals as (
  select row_key, calibre_id, label, code, sort_order, sum(qty_kg) as kg
  from filtered
  where calibre_id is not null
  group by row_key, calibre_id, label, code, sort_order
),
row_dispatches as (
  select row_key, request_id, request_date, plate, driver, sum(qty_kg) as kg
  from filtered
  group by row_key, request_id, request_date, plate, driver
),
row_dispatch_calibres as (
  select row_key, request_id, calibre_id, label, code, sort_order, sum(qty_kg) as kg
  from filtered
  where calibre_id is not null
  group by row_key, request_id, calibre_id, label, code, sort_order
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'serial', rb.serial,
      'isPool', rb.is_pool,
      'typeId', rb.type_id,
      'kinds', rb.kinds,
      'totalKg', rb.total_kg,
      'dispatchCount', rb.dispatch_count,
      'calibres', (
        select coalesce(jsonb_agg(jsonb_build_object('calibreId', rct.calibre_id, 'label', rct.label, 'code', rct.code, 'kg', rct.kg) order by rct.sort_order), '[]'::jsonb)
        from row_calibre_totals rct where rct.row_key = rb.row_key
      ),
      'dispatches', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'requestId', rd.request_id, 'date', rd.request_date, 'plate', rd.plate, 'driver', rd.driver, 'kg', rd.kg,
          'calibres', (
            select coalesce(jsonb_agg(jsonb_build_object('calibreId', rdc.calibre_id, 'label', rdc.label, 'code', rdc.code, 'kg', rdc.kg) order by rdc.sort_order), '[]'::jsonb)
            from row_dispatch_calibres rdc where rdc.row_key = rd.row_key and rdc.request_id = rd.request_id
          )
        ) order by rd.request_date, rd.plate), '[]'::jsonb)
        from row_dispatches rd where rd.row_key = rb.row_key
      )
    ) order by rb.serial nulls last, rb.row_key), '[]'::jsonb)
    from row_base rb
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
