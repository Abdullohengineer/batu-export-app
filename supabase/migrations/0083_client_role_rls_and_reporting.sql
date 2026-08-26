-- Global Export client portal — schema + RLS + reporting SQL.
-- See docs/DECISIONS.md "Client role: RLS scoping, view-ownership RLS-
-- bypass finding" for the full design writeup. Summary:
--
-- 1. profiles.owner_id links a 'client'-role login to one `owners` row.
-- 2. Every existing `read_all using (auth.uid() is not null)` policy on an
--    operational table currently means "any signed-in user, any role, sees
--    every owner's data" — correct today (5 internal-staff roles, all
--    meant to see everything) but NOT correct once a customer-facing
--    'client' role exists. Tightened here via `alter policy ... using
--    (... and my_role() <> 'client')`, with a new owner-scoped policy
--    added alongside for 'client' wherever it legitimately needs read
--    access. Existing roles are unaffected (my_role() <> 'client' is
--    always true for them).
-- 3. IMPORTANT finding made while designing this: report_kirim_rows,
--    report_chiqim_rows, report_rows_v2, stock_on_hand_rows, and every
--    function built on them (report_query_page, get_serial_passport,
--    get_client_report, kirim_line_state, ...) are VIEWS/FUNCTIONS OWNED
--    BY `postgres`, which has rolbypassrls = true (confirmed live:
--    `select rolbypassrls from pg_roles where rolname = 'postgres'` ->
--    true). Postgres views default to security_invoker = false, meaning
--    row security on the views' own underlying tables is evaluated AS THE
--    VIEW OWNER — and since that owner bypasses RLS entirely, querying
--    THROUGH any of these views returns every row regardless of the
--    caller's own RLS scoping. Harmless today only because base-table RLS
--    is already wide open to every role; it would silently defeat the
--    client-scoping in step 2 the moment anything client-facing routed
--    through them. Resolution: the client-facing SQL below (
--    client_calibre_split / client_report_rows / client_serial_summary)
--    queries base TABLES directly, never the shared report_*_rows views,
--    and self-scopes explicitly via my_owner_id() rather than relying on
--    RLS alone (belt-and-suspenders — correct even if a future view gets
--    layered in front of these functions). kirim_line_state() and
--    kirim_line_effective_qty() were individually verified (via
--    pg_get_functiondef) to touch base tables ONLY, no view in their call
--    graph, so both are safely reused as-is.
-- 4. Existing report_*_rows views/functions are NOT touched by this
--    migration — zero behaviour change for menejer/rahbar/ombor/qorovul/
--    laborator, and zero risk to the already-shipped Hisobot/passport/
--    client-report screens.

-- ============================================================
-- 1. profiles.owner_id + my_owner_id()
-- ============================================================
alter table profiles add column owner_id uuid references owners(id);

create or replace function my_owner_id() returns uuid
language sql stable security definer
set search_path = public
as $$
  select owner_id from profiles where id = auth.uid() and active
$$;

-- ============================================================
-- 2. Tighten existing read_all policies to exclude 'client', add
--    owner-scoped (or, where there's no legitimate client use, no
--    replacement at all — a bare exclusion denies outright) policies.
-- ============================================================

-- profiles / owners: client reads only its own rows (staff phone numbers
-- and other owners' identity are not this account's business).
alter policy read_all on profiles using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_profile on profiles for select
  using (my_role() = 'client' and id = auth.uid());

alter policy read_all on owners using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_owner on owners for select
  using (my_role() = 'client' and id = my_owner_id());

-- kirim_orders / kirim_lines
alter policy read_all on kirim_orders using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_kirim_orders on kirim_orders for select
  using (my_role() = 'client' and owner_id = my_owner_id());

alter policy read_all on kirim_lines using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_kirim_lines on kirim_lines for select
  using (
    my_role() = 'client'
    and exists (select 1 from kirim_orders ko where ko.order_id = kirim_lines.order_id and ko.owner_id = my_owner_id())
  );

-- chiqim_requests / chiqim_lines
alter policy read_all on chiqim_requests using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_chiqim_requests on chiqim_requests for select
  using (my_role() = 'client' and owner_id = my_owner_id());

alter policy read_all on chiqim_lines using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_chiqim_lines on chiqim_lines for select
  using (
    my_role() = 'client'
    and exists (select 1 from chiqim_requests cr where cr.id = chiqim_lines.request_id and cr.owner_id = my_owner_id())
  );

-- gate_weighings: kirim-dir rows scope via order_id, chiqim-dir via request_id.
alter policy read_all on gate_weighings using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_gate_weighings on gate_weighings for select
  using (
    my_role() = 'client'
    and (
      exists (select 1 from kirim_orders ko where ko.order_id = gate_weighings.order_id and ko.owner_id = my_owner_id())
      or exists (select 1 from chiqim_requests cr where cr.id = gate_weighings.request_id and cr.owner_id = my_owner_id())
    )
  );

-- storage_intake / moyka_sends / finished_pallets / wash_cycles: keyed by serial.
alter policy read_all on storage_intake using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_storage_intake on storage_intake for select
  using (
    my_role() = 'client'
    and exists (
      select 1 from kirim_lines kl join kirim_orders ko on ko.order_id = kl.order_id
      where kl.serial = storage_intake.serial and ko.owner_id = my_owner_id()
    )
  );

alter policy read_all on moyka_sends using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_moyka_sends on moyka_sends for select
  using (
    my_role() = 'client'
    and exists (
      select 1 from kirim_lines kl join kirim_orders ko on ko.order_id = kl.order_id
      where kl.serial = moyka_sends.serial and ko.owner_id = my_owner_id()
    )
  );

alter policy read_all on finished_pallets using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_finished_pallets on finished_pallets for select
  using (
    my_role() = 'client'
    and exists (
      select 1 from kirim_lines kl join kirim_orders ko on ko.order_id = kl.order_id
      where kl.serial = finished_pallets.serial and ko.owner_id = my_owner_id()
    )
  );

alter policy read_all on wash_cycles using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_wash_cycles on wash_cycles for select
  using (
    my_role() = 'client'
    and exists (
      select 1 from kirim_lines kl join kirim_orders ko on ko.order_id = kl.order_id
      where kl.serial = wash_cycles.serial and ko.owner_id = my_owner_id()
    )
  );

-- dispatch_manifest: keyed by request_id.
alter policy read_all on dispatch_manifest using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_dispatch_manifest on dispatch_manifest for select
  using (
    my_role() = 'client'
    and exists (select 1 from chiqim_requests cr where cr.id = dispatch_manifest.request_id and cr.owner_id = my_owner_id())
  );

-- lab_results: scope='kirim' rows carry parent_serial; scope='chiqim' rows
-- carry wash_cycle_id instead (confirmed via get_serial_passport's own
-- cycle_lab CTE, which joins via wash_cycle_id, not parent_serial).
alter policy read_all on lab_results using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_lab_results on lab_results for select
  using (
    my_role() = 'client'
    and (
      exists (
        select 1 from kirim_lines kl join kirim_orders ko on ko.order_id = kl.order_id
        where kl.serial = lab_results.parent_serial and ko.owner_id = my_owner_id()
      )
      or exists (
        select 1 from wash_cycles wc
        join kirim_lines kl2 on kl2.serial = wc.serial
        join kirim_orders ko2 on ko2.order_id = kl2.order_id
        where wc.id = lab_results.wash_cycle_id and ko2.owner_id = my_owner_id()
      )
    )
  );

-- raw_dispatch_lines: scoped via the KIRIM side (the raw material's owner),
-- matching report_raw_dispatch_rows' own choice (ko.owner_id via kl), not
-- the chiqim_requests owner_id (same owner in practice, but this matches
-- the existing view's precedent exactly).
alter policy read_all on raw_dispatch_lines using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_raw_dispatch_lines on raw_dispatch_lines for select
  using (
    my_role() = 'client'
    and exists (
      select 1 from kirim_lines kl join kirim_orders ko on ko.order_id = kl.order_id
      where kl.serial = raw_dispatch_lines.serial and ko.owner_id = my_owner_id()
    )
  );

-- chiqim_line_pallets / chiqim_line_raw_serials: keyed by line_id -> chiqim_lines -> request_id.
alter policy read_all on chiqim_line_pallets using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_chiqim_line_pallets on chiqim_line_pallets for select
  using (
    my_role() = 'client'
    and exists (
      select 1 from chiqim_lines cl join chiqim_requests cr on cr.id = cl.request_id
      where cl.id = chiqim_line_pallets.line_id and cr.owner_id = my_owner_id()
    )
  );

alter policy read_all on chiqim_line_raw_serials using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_chiqim_line_raw_serials on chiqim_line_raw_serials for select
  using (
    my_role() = 'client'
    and exists (
      select 1 from chiqim_lines cl join chiqim_requests cr on cr.id = cl.request_id
      where cl.id = chiqim_line_raw_serials.line_id and cr.owner_id = my_owner_id()
    )
  );

-- serial_mint_sources: needed for kirim_line_state's/client_calibre_split's
-- own "not exists" exclusion to stay correct (not just safe) for a client
-- caller -- scoped via either the source pallet's or the minted serial's owner.
alter policy read_all on serial_mint_sources using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_serial_mint_sources on serial_mint_sources for select
  using (
    my_role() = 'client'
    and (
      exists (
        select 1 from finished_pallets fp
        join kirim_lines kl on kl.serial = fp.serial
        join kirim_orders ko on ko.order_id = kl.order_id
        where fp.barcode2 = serial_mint_sources.source_barcode2 and ko.owner_id = my_owner_id()
      )
      or exists (
        select 1 from kirim_lines kl2 join kirim_orders ko2 on ko2.order_id = kl2.order_id
        where kl2.serial = serial_mint_sources.minted_serial and ko2.owner_id = my_owner_id()
      )
    )
  );

-- old_kn_pools / old_kn_collections
alter policy read_all on old_kn_pools using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_old_kn_pools on old_kn_pools for select
  using (my_role() = 'client' and owner_id = my_owner_id());

alter policy read_all on old_kn_collections using (auth.uid() is not null and my_role() <> 'client');
create policy client_read_own_old_kn_collections on old_kn_collections for select
  using (
    my_role() = 'client'
    and exists (select 1 from old_kn_pools p where p.id = old_kn_collections.pool_id and p.owner_id = my_owner_id())
  );

-- notes / settings_limits / audit_log / old_stock_closeouts / rezka_sends /
-- rezka_cycles: no legitimate client use in this feature -- excluded
-- outright, no replacement policy (client gets zero rows).
alter policy notes_read on notes using (auth.uid() is not null and my_role() <> 'client');
alter policy read_all on settings_limits using (auth.uid() is not null and my_role() <> 'client');
alter policy read_all on old_stock_closeouts using (auth.uid() is not null and my_role() <> 'client');
alter policy read_all on rezka_sends using (auth.uid() is not null and my_role() <> 'client');
alter policy read_all on rezka_cycles using (auth.uid() is not null and my_role() <> 'client');

-- product_categories / product_types / calibres: left untouched -- pure
-- reference data (no owner concept, no per-client sensitivity), and the
-- client screen needs Tur/Kalibr labels the same way every other screen does.

-- ============================================================
-- 3. client_calibre_split(serial) -- Moyka output split into calibre-
--    graded ("gotoviy produkt") vs KN ("Konditirskiy"), by calibres.
--    is_numberless (the same flag loss_output/get_client_report already
--    uses for this exact distinction -- reused, not reinvented). Mirrors
--    kirim_line_state()'s own base_pallets exclusion set exactly (drop
--    re-wash-consumed / voided / storage-loss pallets) so this stays
--    consistent with the existing "Moykadan chiqgan" state figure:
--    calibre_kg + kn_kg here always equals kirim_line_state(serial).
--    moykadan_chiqgan for the same serial.
--    Note: is_numberless is also true for 'RKN' (Rezka KN) -- there are 0
--    Rezka rows live today (SPEC.md: Rezka is a separate, not-yet-used
--    processing path) so this is untested in practice; flagged here and
--    in DECISIONS.md rather than silently assumed correct.
-- ============================================================
create or replace function client_calibre_split(p_serial text)
returns table (calibre_kg numeric, kn_kg numeric)
language sql
stable
as $function$
  with base_pallets as (
    select fp.weight_kg, c.is_numberless
    from finished_pallets fp
    join calibres c on c.id = fp.calibre_id
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  )
  select
    coalesce(sum(weight_kg) filter (where not is_numberless), 0) as calibre_kg,
    coalesce(sum(weight_kg) filter (where is_numberless), 0) as kn_kg
  from base_pallets;
$function$;

-- ============================================================
-- 4. client_report_rows -- the client's Hisobot-equivalent table. Deliberately
--    NOT built on report_rows_v2/report_kirim_rows/report_chiqim_rows (see
--    finding #3 above) -- queries base tables directly, mirrors their row-
--    building logic (verified via pg_get_viewdef against the live
--    definitions) but only the 5 kinds the client-facing filter exposes:
--    kirim, chiqim (tayyor), chiqim_raw (xom), chiqim_old_kn (eski KN),
--    moyka_output (pererabotano). moyka_send (internal "sent to washing"
--    movement) is deliberately excluded -- not one of the filters the task
--    asked for. No p_owner_id parameter -- always my_owner_id(), so a
--    caller can never pass another owner's id.
--    KIRIM rows are origin='delivery' only (CLAUDE.md's own origin-
--    filtering rule for "lists inbound work" -- opening stock/internal
--    reprocess are not real deliveries and must not appear on a client's
--    own arrivals table).
-- ============================================================
create or replace function client_report_rows(
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
  state_xom_jonatilgan numeric
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

    -- "Pererabotano" is a PROCESSING row (CLAUDE.md origin-filtering rule:
    -- "Processing aggregates → origin != 'opening_stock' — a re-wash is
    -- real processing and must count; seeded opening stock must not").
    -- Global Export is specifically the client whose stock was opening-
    -- stock-seeded (79 pallets / 52,210 kg, see DECISIONS.md) -- without
    -- this filter their own client screen would show that seed as a real
    -- production event, the exact "phantom output" leak class CLAUDE.md
    -- names. internal_reprocess (a genuine re-mint) is real processing and
    -- correctly stays included.
    select 'moyka_output'::text, 'moyka-output-' || fp.barcode2, fp.serial, fp.type_id,
           ko.plate, ko.driver, fp.received_date,
           fp.weight_kg, null::numeric
    from finished_pallets fp
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and ko.origin != 'opening_stock'
  ),
  filtered as (
    -- §3.2.3's own rule, matched here: a row with no governing date (an
    -- unclaimed finished pallet, no dispatch request yet) is left OUT of
    -- the date-ranged view -- "the default stays a clean history of things
    -- that actually happened." The internal engine (report_filtered_rows)
    -- reaches these via an explicit status override; this client screen
    -- has no Holat filter at all (deliberately excluded per the task), so
    -- there is no override path here -- these rows are simply excluded,
    -- never shown.
    select * from rows_unfiltered r
    where (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
      and r.date_basis is not null and r.date_basis between p_from and p_to
      and (p_type_id is null or r.type_id = p_type_id)
      and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%')
  )
  select
    f.kind, f.row_key, f.serial, f.type_id, f.plate, f.driver, f.date_basis, f.qty_kg, f.declared_qty,
    s.omborda_qoldi, cs.calibre_kg, cs.kn_kg, s.olib_ketilgan, s.xom_jonatilgan
  from filtered f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral client_calibre_split(f.serial) cs on f.serial is not null
  order by f.date_basis desc nulls last, f.row_key desc
  limit p_limit offset p_offset;
$function$;

-- ============================================================
-- 5. client_serial_summary -- the client's drill-down (NOT the internal
--    serial passport -- deliberately a curated subset, per the task:
--    "a view section like hisobot, but without passport"). Self-scoped:
--    every CTE below filters through kirim_orders.owner_id = my_owner_id(),
--    so a client passing a serial they don't own gets an all-empty/null
--    result, never another owner's data.
--    Loss is shown only once the wash is actually finished (wash_cycles.
--    status = 'final') -- mid-process, sent-minus-output-so-far is not a
--    real loss figure yet (SPEC.md's own yield_rows precedent: "still-
--    active serials are WIP, not yield yet"). Loss basis mirrors
--    yield_rows: actual (uncapped) moyka_sends total minus real output --
--    "per serial, judging the process, not a period balance sheet".
-- ============================================================
create or replace function client_serial_summary(p_serial text)
returns jsonb
language sql
stable
as $function$
  with owned as (
    select kl.serial, ko.owner_id, ko.doc_photo, ko.order_date, ko.plate as kirim_plate
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where kl.serial = p_serial and ko.owner_id = my_owner_id()
  ),
  wc as (
    select wc.status from wash_cycles wc join owned o on o.serial = wc.serial
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as kg from moyka_sends ms join owned o on o.serial = ms.serial
  ),
  split as (
    select * from client_calibre_split((select serial from owned))
  ),
  by_calibre as (
    select fp.calibre_id, sum(fp.weight_kg) as kg
    from finished_pallets fp
    join owned o on o.serial = fp.serial
    where fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
    group by fp.calibre_id
  ),
  chiqim_request_ids as (
    select distinct dm.request_id
    from dispatch_manifest dm
    join finished_pallets fp on fp.barcode2 = dm.barcode2
    join owned o on o.serial = fp.serial
    union
    select distinct cl.request_id
    from raw_dispatch_lines rdl
    join chiqim_lines cl on cl.id = rdl.chiqim_line_id
    join owned o on o.serial = rdl.serial
  ),
  chiqim_nakladnoys as (
    select cr.id as request_id, cr.request_date, cr.plate, gw.departure_doc_photo
    from chiqim_request_ids cri
    join chiqim_requests cr on cr.id = cri.request_id
    left join lateral (
      select gw2.departure_doc_photo
      from gate_weighings gw2
      where gw2.dir = 'chiqim' and gw2.request_id = cr.id
      order by gw2.completed_at desc nulls last
      limit 1
    ) gw on true
    where gw.departure_doc_photo is not null
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
    'lossKg', case when (select status from wc) = 'final'
      then greatest(0, (select kg from sent) - (select calibre_kg from split) - (select kn_kg from split))
      else null end,
    'kirimNakladnoy', case when (select doc_photo from owned) is not null
      then jsonb_build_object('photoUrl', (select doc_photo from owned), 'date', (select order_date from owned), 'plate', (select kirim_plate from owned))
      else null end,
    'chiqimNakladnoys', (
      select coalesce(jsonb_agg(
        jsonb_build_object('requestId', cn.request_id, 'date', cn.request_date, 'plate', cn.plate, 'photoUrl', cn.departure_doc_photo)
        order by cn.request_date desc
      ), '[]'::jsonb)
      from chiqim_nakladnoys cn
    )
  ) end;
$function$;
