-- ============================================================
-- Client Hisobot rebuild: per-serial (Приход) + per-dispatch-event
-- (Расход) ledger RPCs for the Global Export client portal
-- (src/pages/client/*), replacing client_report_rows/client_report_totals/
-- client_serial_summary/client_calibre_split wholesale (those RPCs are
-- left in place, unused, rather than dropped here -- dropping functions is
-- separate schema surgery, not bundled into a feature migration).
--
-- Naming: bare client_* (no get_ prefix), matching every existing
-- client-portal RPC -- get_client_report is a DIFFERENT, unrelated,
-- staff-facing system (src/pages/reports/ClientReportTab.tsx) and is not
-- touched by this migration.
--
-- Security: BOTH functions self-scope via my_owner_id() (0083's own
-- pattern -- "select owner_id from profiles where id = auth.uid() and
-- active"), never via a caller-supplied owner/client id. A client-role
-- user must never be able to pass another client's id and read their
-- data; RLS alone is not trusted here, matching every existing
-- client_report_rows/client_serial_summary/client_calibre_split
-- precedent in 0083/0085/0094/0099/0101.
--
-- Formulas are reused verbatim from existing production SQL, not
-- invented:
--   - Приход per-serial fields: report_kirim_rows_as_of(p_to) (declared_qty,
--     qty_kg = effective_qty, date_basis, provisional, origin, partiya_no)
--     and get_client_report's own subqueries for vozvrat (dispatched_as_of_to_kg)
--     and moyka-sent (sent_actual_kg).
--   - H/I/J (Готовый продукт/Кондерка) use rahbar_dashboard_ledger's
--     pallet_base (Ledger C) exclusion set verbatim: excludes bekor_qilindi,
--     storage_loss and re-minted (serial_mint_sources) pallets, but does
--     NOT exclude 'consumed' -- a dispatched pallet's production still
--     counts as output, matching migration 0106's own documented reasoning
--     (excluding consumed there caused a double-count bug that had to be
--     reverted). Column R subtracts dispatched kg separately (via ΣM), so
--     excluding consumed here would double-subtract it.
--   - Finalization predicate for K (Потеря) vs G2 (В переработке) is
--     wash_cycles.closed_at IS NOT NULL, NOT status='final' -- closed_at is
--     what get_client_report, yield_rows and rahbar_dashboard_ledger all
--     actually gate on; status is a separate lifecycle field that can lag
--     behind it (a serial can have status='final' with closed_at still
--     null, e.g. mid-correction), which get_client_report/yield_rows never
--     use for this decision.
--   - Q (Остаток сырья) = D − L − E − coalesce(K, 0), NOT the naive D − E − G:
--     D − E − G double-counts material that's already become finished
--     output (L) as if it were still raw stock. Verified against a real
--     client balance this exact way in a prior manual reconciliation.
--   - "Gate weigh-2 completed" (no provisional rows) = report_kirim_rows_as_of's
--     own `provisional` flag, false only once gate net_kg and total tara are
--     both known.
--   - Расход event grouping (one row per request × kind × product type,
--     calibre detail flattened into a string) matches the shape already
--     validated for this exact client in a prior manual CHIQIM export.
--   - "Хом" vs "Возврат": chiqim_lines.line_kind='raw' carries no field
--     distinguishing a raw-material sale from a return to the client, this
--     was re-verified directly against chiqim_lines/raw_dispatch_lines
--     columns before writing this migration. All line_kind IN ('raw','old_raw')
--     rows show as Возврат; Хом therefore has zero rows until a schema
--     change adds a real distinguishing field.
-- ============================================================

create or replace function client_serial_ledger(p_from_date date, p_to_date date, p_product_type_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
with
me as (select my_owner_id() as owner_id),
scoped as (
  select rkr.*
  from report_kirim_rows_as_of(p_to_date) rkr, me
  where rkr.owner_id = me.owner_id
    and rkr.origin = 'delivery'  -- arrival aggregate: allowlist, per CLAUDE.md origin-filtering rule; internal_reprocess/opening_stock are not real deliveries
    and rkr.date_basis between p_from_date and p_to_date
    and not rkr.provisional      -- "row appears only after gate weigh-2 completes"
    and (p_product_type_id is null or rkr.type_id = p_product_type_id)
),
serial_base as (
  select
    s.serial, s.type_id, s.partiya_no, s.date_basis, s.declared_qty, s.qty_kg as netto_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl
       join chiqim_lines cl on cl.id = rdl.chiqim_line_id
       join chiqim_requests cr on cr.id = cl.request_id
     where rdl.serial = s.serial and cr.request_date <= p_to_date) as vozvrat_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
     where ms.serial = s.serial and ms.sent_date <= p_to_date) as moyka_kg,
    exists (select 1 from wash_cycles wc where wc.serial = s.serial and wc.closed_at is not null) as is_final
  from scoped s
),
pallet_base as (
  -- Ledger C (rahbar_dashboard_ledger's own pallet_base), self-scoped and
  -- restricted to this period's serials, verbatim exclusion set.
  select fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg
  from finished_pallets fp
  join serial_base sb on sb.serial = fp.serial
  where fp.received_date <= p_to_date
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to_date
    )
    and not (fp.status = 'bekor_qilindi' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to_date))
    and not (fp.status = 'storage_loss' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to_date))
),
output_by_calibre as (
  select pb.serial, pb.calibre_id, c.label, c.code, c.sort_order, c.is_numberless,
         sum(pb.weight_kg) as kg
  from pallet_base pb join calibres c on c.id = pb.calibre_id
  group by pb.serial, pb.calibre_id, c.label, c.code, c.sort_order, c.is_numberless
),
output_by_serial as (
  select serial,
         coalesce(sum(kg) filter (where not is_numberless), 0) as calibre_kg,
         coalesce(sum(kg) filter (where is_numberless), 0) as kn_kg
  from output_by_calibre group by serial
),
dispatch_events as (
  -- gate-completed finished-goods dispatch, grouped by (serial, request_date, calibre)
  select fp.serial, cr.request_date, cr.plate, fp.calibre_id, c.label, c.code, c.sort_order,
         sum(cpc.qty_kg) as kg
  from chiqim_pallet_consumption cpc
  join chiqim_lines cl on cl.id = cpc.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = cpc.barcode2
  join serial_base sb on sb.serial = fp.serial
  join calibres c on c.id = fp.calibre_id
  where chiqim_departed_at(cr.id) is not null
    and (chiqim_departed_at(cr.id) at time zone 'utc')::date <= p_to_date
  group by fp.serial, cr.request_date, cr.plate, fp.calibre_id, c.label, c.code, c.sort_order
),
dispatch_by_serial as (
  select serial, coalesce(sum(kg), 0) as kg from dispatch_events group by serial
),
rows_built as (
  select
    sb.serial, sb.type_id, sb.partiya_no, sb.date_basis, sb.declared_qty, sb.netto_kg,
    sb.vozvrat_kg, sb.moyka_kg, sb.is_final,
    coalesce(os.calibre_kg, 0) as calibre_kg,
    coalesce(os.kn_kg, 0) as kn_kg,
    coalesce(os.calibre_kg, 0) + coalesce(os.kn_kg, 0) as processed_kg, -- L
    sb.moyka_kg - (coalesce(os.calibre_kg, 0) + coalesce(os.kn_kg, 0)) as gap_kg, -- G - L, signed: + = loss, - = surplus
    coalesce(db.kg, 0) as dispatched_kg -- ΣM
  from serial_base sb
  left join output_by_serial os on os.serial = sb.serial
  left join dispatch_by_serial db on db.serial = sb.serial
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'serial', r.serial,
      'typeId', r.type_id,
      'partiyaNo', r.partiya_no,
      'date', r.date_basis,
      'declaredQtyKg', r.declared_qty,
      'nettoKg', r.netto_kg,
      'vozvratKg', r.vozvrat_kg,
      'raznitsaKg', r.declared_qty - r.netto_kg,
      'moykaKg', r.moyka_kg,
      'vPererabotkeKg', case when r.is_final then null else r.gap_kg end,
      'poteryaKg', case when r.is_final then r.gap_kg else null end,
      'itogoPererabotkaKg', r.processed_kg,
      'otgruzkaKg', r.dispatched_kg,
      'ostatokSyryaKg', r.netto_kg - r.processed_kg - r.vozvrat_kg - (case when r.is_final then r.gap_kg else 0 end),
      'ostatokGotovoyKg', r.processed_kg - r.dispatched_kg,
      'calibres', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'calibreId', oc.calibre_id, 'label', oc.label, 'code', oc.code, 'kg', oc.kg, 'isNumberless', oc.is_numberless
        ) order by oc.sort_order), '[]'::jsonb)
        from output_by_calibre oc where oc.serial = r.serial
      ),
      'dispatches', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'date', de.request_date, 'plate', de.plate, 'calibreId', de.calibre_id,
          'label', de.label, 'code', de.code, 'kg', de.kg
        ) order by de.request_date, de.sort_order), '[]'::jsonb)
        from dispatch_events de where de.serial = r.serial
      )
    ) order by r.date_basis, r.serial), '[]'::jsonb)
    from rows_built r
  ),
  'totals', (
    select jsonb_build_object(
      'declaredQtyKg', coalesce(sum(r.declared_qty), 0),
      'nettoKg', coalesce(sum(r.netto_kg), 0),
      'vozvratKg', coalesce(sum(r.vozvrat_kg), 0),
      'raznitsaKg', coalesce(sum(r.netto_kg - r.declared_qty), 0),
      'moykaKg', coalesce(sum(r.moyka_kg), 0),
      'vPererabotkeKg', coalesce(sum(case when not r.is_final then r.gap_kg else 0 end), 0),
      'poteryaKg', coalesce(sum(case when r.is_final then r.gap_kg else 0 end), 0),
      'itogoPererabotkaKg', coalesce(sum(r.processed_kg), 0),
      'otgruzkaKg', coalesce(sum(r.dispatched_kg), 0),
      'ostatokSyryaKg', coalesce(sum(r.netto_kg - r.processed_kg - r.vozvrat_kg - (case when r.is_final then r.gap_kg else 0 end)), 0),
      'ostatokGotovoyKg', coalesce(sum(r.processed_kg - r.dispatched_kg), 0),
      'serialCount', count(*)
    )
    from rows_built r
  )
);
$$;

create or replace function client_chiqim_ledger(p_from_date date, p_to_date date, p_kinds text[])
returns jsonb
language sql stable security definer
set search_path = public
as $$
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
    'vozvrat'::text as kind, -- line_kind IN ('raw','old_raw') -- no schema field distinguishes a return from a sale, see migration header
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
  select * from finished_events
  union all select * from raw_events
  union all select * from old_kn_events
),
filtered as (
  select * from all_events where p_kinds is null or kind = any(p_kinds)
),
grouped as (
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
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'requestId', g.request_id, 'date', g.request_date, 'plate', g.plate, 'driver', g.driver,
      'kind', g.kind, 'typeId', g.type_id, 'serials', nullif(g.serials, ''), 'kg', g.kg,
      'calibres', case when g.kind in ('tayyor', 'eski_yuvilgan') then (
        select coalesce(jsonb_agg(jsonb_build_object('calibreId', cd.calibre_id, 'label', cd.label, 'code', cd.code, 'kg', cd.kg) order by cd.sort_order), '[]'::jsonb)
        from calibre_detail cd where cd.request_id = g.request_id and cd.kind = g.kind and cd.type_id = g.type_id
      ) else null end
    ) order by g.request_date, g.plate, g.kind), '[]'::jsonb)
    from grouped g
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
$$;
