-- Client portal follow-up (user feedback, same week): totals strip parity
-- with the internal Hisobot, a per-row "Убыток" (loss) column, and a KN
-- calibre-breakdown duplicate fixed in the drill-down. See DECISIONS.md
-- "Client role: totals strip, Убыток column, KN dedupe" for the full
-- writeup and verification.

-- ============================================================
-- 1. client_serial_loss_kg -- extracted from client_serial_summary's own
--    inline lossKg expression so client_report_rows (new state_loss_kg
--    column, below) and client_serial_summary share ONE implementation
--    rather than two copies that could drift. Same basis as before:
--    null until wash_cycles.status = 'final' (SPEC.md's own yield_rows
--    precedent -- "still-active serials are WIP, not yield yet"); actual
--    uncapped moyka_sends total minus real output (calibre + KN).
-- ============================================================
create or replace function client_serial_loss_kg(p_serial text)
returns numeric
language sql
stable
as $function$
  with wc as (
    select status from wash_cycles where serial = p_serial
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as kg from moyka_sends where serial = p_serial
  ),
  split as (
    select * from client_calibre_split(p_serial)
  )
  select case when (select status from wc) = 'final'
    then greatest(0, (select kg from sent) - (select calibre_kg from split) - (select kn_kg from split))
    else null end;
$function$;

-- ============================================================
-- 2. client_serial_summary -- by_calibre was grouping ALL calibre_ids,
--    KN included, while the modal ALSO rendered a separate hardcoded
--    "Кондитерский (КН)" row from `knKg` -- KN appeared twice. Fixed by
--    excluding is_numberless calibres from by_calibre (mirrors
--    client_calibre_split's own calibre_kg/kn_kg split exactly -- the
--    dedicated knKg field stays the single source for KN). lossKg now
--    calls client_serial_loss_kg() instead of repeating the expression.
-- ============================================================
create or replace function client_serial_summary(p_serial text)
returns jsonb
language sql
stable
as $function$
  with owned as (
    select kl.serial, ko.owner_id, ko.order_date
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where kl.serial = p_serial and ko.owner_id = my_owner_id()
  ),
  wc as (
    select wc.status from wash_cycles wc join owned o on o.serial = wc.serial
  ),
  split as (
    select * from client_calibre_split((select serial from owned))
  ),
  by_calibre as (
    select fp.calibre_id, sum(fp.weight_kg) as kg
    from finished_pallets fp
    join owned o on o.serial = fp.serial
    join calibres c on c.id = fp.calibre_id
    where fp.status not in ('bekor_qilindi', 'storage_loss')
      and not c.is_numberless
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
    group by fp.calibre_id
  )
  select case when (select count(*) from owned) = 0 then null else jsonb_build_object(
    'serial', p_serial,
    'orderDate', (select order_date from owned),
    'washCycleStatus', (select status from wc),
    'byCalibre', (
      select coalesce(jsonb_agg(jsonb_build_object('calibreId', bc.calibre_id, 'weightKg', bc.kg) order by bc.calibre_id), '[]'::jsonb)
      from by_calibre bc
    ),
    'knKg', (select kn_kg from split),
    'lossKg', (select client_serial_loss_kg((select serial from owned)))
  ) end;
$function$;

-- ============================================================
-- 3. client_filtered_report_rows -- the 5-branch row-building + filter
--    logic extracted verbatim out of client_report_rows, so
--    client_report_totals (below) can share it rather than duplicate the
--    whole UNION ALL a second time. Behaviourally identical to what
--    client_report_rows's own CTEs did before this migration.
-- ============================================================
create or replace function client_filtered_report_rows(
  p_directions text[],
  p_from date,
  p_to date,
  p_type_id uuid,
  p_serial text
)
returns table (
  kind text,
  row_key text,
  serial text,
  type_id uuid,
  plate text,
  driver text,
  date_basis date,
  qty_kg numeric,
  declared_qty numeric
)
language sql
stable
as $function$
  with rows_unfiltered as (
    select 'kirim'::text as kind, kl.serial as row_key, kl.serial, kl.type_id,
           ko.plate, ko.driver, ko.order_date as date_basis,
           kirim_line_effective_qty(kl.serial) as qty_kg, kl.declared_qty
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.origin = 'delivery'
      and ko.plate !~~ 'TEST-%'

    union all

    select 'chiqim'::text, fp.barcode2, fp.serial, fp.type_id,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           fp.weight_kg, null::numeric
    from finished_pallets fp
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    left join lateral (select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1) dm on true
    left join chiqim_requests cr on cr.id = dm.request_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'chiqim_raw'::text, rdl.id::text, rdl.serial, cl.type_id,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           rdl.net_kg, null::numeric
    from raw_dispatch_lines rdl
    join chiqim_lines cl on cl.id = rdl.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    join kirim_lines kl on kl.serial = rdl.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'chiqim_old_kn'::text, okc.id::text, null::text, okp.type_id,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           okc.collected_kg, null::numeric
    from old_kn_collections okc
    join old_kn_pools okp on okp.id = okc.pool_id
    join chiqim_lines cl on cl.id = okc.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where okp.owner_id = my_owner_id()
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'moyka_output'::text, 'moyka-output-' || fp.barcode2, fp.serial, fp.type_id,
           ko.plate, ko.driver, fp.received_date,
           fp.weight_kg, null::numeric
    from finished_pallets fp
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and ko.origin != 'opening_stock'
  )
  select * from rows_unfiltered r
  where (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
    and r.date_basis is not null and r.date_basis between p_from and p_to
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%');
$function$;

-- ============================================================
-- 4. client_report_rows -- now a thin wrapper over
--    client_filtered_report_rows + the per-serial state joins (unchanged
--    logic), plus one new column: state_loss_kg. A new OUT column means
--    Postgres won't accept a plain CREATE OR REPLACE (return type change)
--    -- drop first.
-- ============================================================
drop function if exists client_report_rows(text[], date, date, uuid, text, integer, integer);

create function client_report_rows(
  p_directions text[],
  p_from date,
  p_to date,
  p_type_id uuid,
  p_serial text,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  kind text,
  row_key text,
  serial text,
  type_id uuid,
  plate text,
  driver text,
  date_basis date,
  qty_kg numeric,
  declared_qty numeric,
  state_omborda_qoldi numeric,
  state_calibre_kg numeric,
  state_kn_kg numeric,
  state_olib_ketilgan numeric,
  state_xom_jonatilgan numeric,
  state_loss_kg numeric
)
language sql
stable
as $function$
  select
    f.kind, f.row_key, f.serial, f.type_id, f.plate, f.driver, f.date_basis, f.qty_kg, f.declared_qty,
    s.omborda_qoldi, cs.calibre_kg, cs.kn_kg, s.olib_ketilgan, s.xom_jonatilgan, l.loss_kg
  from client_filtered_report_rows(p_directions, p_from, p_to, p_type_id, p_serial) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral client_calibre_split(f.serial) cs on f.serial is not null
  left join lateral (select client_serial_loss_kg(f.serial) as loss_kg) l on f.serial is not null
  order by f.date_basis desc nulls last, f.row_key desc
  limit p_limit offset p_offset;
$function$;

-- ============================================================
-- 5. client_report_totals -- NEW. Movement totals (Нетто/Накладная) are
--    row sums over the WHOLE filtered set (never just the current page --
--    client_report_rows is limit/offset-paginated, so summing only the
--    fetched rows client-side would under-count once a filter matches
--    more than p_limit rows). State totals (Готовый продукт/КН/Остаток
--    x2/Отгрузка x2/Убыток) sum once per DISTINCT serial in the filtered
--    set -- the same "never sum a repeating per-serial figure once per
--    row" rule the internal Hisobot's own TotalsStrip establishes
--    (SPEC.md §3.2.4 "the trap"). Убыток is summed only over serials
--    where it's actually known (wash finished) -- state_loss_serial_count
--    says how many of state_serial_count that is, so the client can tell
--    a genuinely-zero total from a not-yet-known one.
-- ============================================================
create or replace function client_report_totals(
  p_directions text[],
  p_from date,
  p_to date,
  p_type_id uuid,
  p_serial text
)
returns table (
  total_netto_kg numeric,
  total_nakladnaya_kg numeric,
  state_serial_count bigint,
  state_gotoviy_produkt_kg numeric,
  state_kn_kg numeric,
  state_ostatok_gotoviy_kg numeric,
  state_ostatok_syrye_kg numeric,
  state_otgruzka_gotoviy_kg numeric,
  state_otgruzka_syrye_kg numeric,
  state_ubytok_kg numeric,
  state_ubytok_serial_count bigint
)
language sql
stable
as $function$
  with filtered as materialized (
    select * from client_filtered_report_rows(p_directions, p_from, p_to, p_type_id, p_serial)
  ),
  movement as (
    select coalesce(sum(qty_kg), 0) as total_netto, coalesce(sum(declared_qty), 0) as total_nakladnaya
    from filtered
  ),
  distinct_serials as (
    select distinct serial from filtered where serial is not null
  ),
  per_serial as (
    select
      ds.serial,
      s.omborda_qoldi, s.olib_ketilgan, s.xom_jonatilgan,
      cs.calibre_kg, cs.kn_kg,
      client_serial_loss_kg(ds.serial) as loss_kg
    from distinct_serials ds
    cross join lateral kirim_line_state(ds.serial) s
    cross join lateral client_calibre_split(ds.serial) cs
  ),
  state as (
    select
      count(*) as serial_count,
      coalesce(sum(calibre_kg), 0) as gotoviy_produkt,
      coalesce(sum(kn_kg), 0) as kn,
      coalesce(sum(greatest(0, calibre_kg + kn_kg - olib_ketilgan)), 0) as ostatok_gotoviy,
      coalesce(sum(omborda_qoldi), 0) as ostatok_syrye,
      coalesce(sum(olib_ketilgan), 0) as otgruzka_gotoviy,
      coalesce(sum(xom_jonatilgan), 0) as otgruzka_syrye,
      coalesce(sum(loss_kg), 0) as ubytok,
      count(*) filter (where loss_kg is not null) as ubytok_serial_count
    from per_serial
  )
  select
    movement.total_netto, movement.total_nakladnaya,
    state.serial_count, state.gotoviy_produkt, state.kn, state.ostatok_gotoviy, state.ostatok_syrye,
    state.otgruzka_gotoviy, state.otgruzka_syrye, state.ubytok, state.ubytok_serial_count
  from movement, state;
$function$;
