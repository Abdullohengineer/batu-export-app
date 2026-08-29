-- Fix: voided pallets double-counted across five read paths.
--
-- APPLIED LIVE as three supabase migration entries rather than one --
-- `exclude_voided_pallets_from_output_reads`, `..._part2` and
-- `..._part3_passport` -- purely because it went up in three MCP calls.
-- This single file is the canonical record; the three entries together
-- contain exactly the SQL below. Nothing else differs.
--
-- ROOT CAUSE. The 2026-08-28 correction pass used void-and-remint: the old
-- pallets were set to status='bekor_qilindi' and replacements were minted
-- alongside them. Both sets remain rows in finished_pallets. Every read
-- path that sums finished_pallets.weight_kg WITHOUT filtering status
-- therefore counts the same physical product twice -- once as the voided
-- original, once as its replacement.
--
-- Live blast radius at the time of writing: 8 serials, 41 voided pallets,
-- 24,460 kg of phantom weight. Two of the eight (050826-001, 290726-071)
-- were re-minted at identical weights, so they read exactly 2x.
--
-- THE RULE APPLIED HERE: `status <> 'bekor_qilindi'`, and only that.
-- Deliberately NOT `not in ('bekor_qilindi','storage_loss')`, which is the
-- shape kirim_line_state/kirim_line_calibre_output use. A voided pallet is
-- a bookkeeping reversal -- that product never existed, so it must never
-- appear in any sum. A storage_loss pallet DID exist and DID come back
-- from the wash; it is genuinely part of "what came out of moyka", and the
-- passport already accounts for it on its own separate storageLossKg line.
-- Folding it into the same exclusion would break the passport's own
-- reconciliation identity (returned = dispatched + storageLoss + consumed
-- + stillInStorage). The distinction is currently zero-impact -- there are
-- no storage_loss rows in the database at all -- so this is a statement of
-- intent for the next one, not a behaviour change today. Flagged rather
-- than silently unified with the kirim_line_* shape.
--
-- NOT CHANGED, deliberately: the voided ROWS stay visible in the Hisobot
-- listing (report_chiqim_rows / report_moyka_output_rows keep emitting
-- them, labelled 'bekor_qilingan'). That is an audit trail the UI renders
-- on purpose -- ChiqimRowDetail.tsx:28 prints "Bekor qilindi -- qayta
-- yuvilgan, sikl N", and the views carry a void_successor_barcodes column
-- for it. The bug there was never the rows; it was report_totals SUMMING
-- them. So the fix goes in the totals, not the row sources.

-- ============================================================
-- 1. yield_rows -- Unumdorlik tab
-- ============================================================
-- output_kg / loss_kg / calibre_mix all doubled: the `output` CTE's
-- LEFT JOIN and `calibre_breakdown`'s JOIN both took every pallet row.
-- 290726-068 read output 4,730 kg against 2,320 kg consumed -> loss_pct
-- -103.8 (a negative loss at ~-100% was the visible symptom on every one
-- of the eight serials).
--
-- The status test goes in the aggregate FILTER clauses, NOT in the join or
-- a WHERE, for two separate reasons:
--   a) the join is a LEFT JOIN -- moving the predicate into WHERE would
--      turn it into an inner join and silently drop any serial that has no
--      pallets yet (finished_serials rows mid-wash);
--   b) `min(fp.received_date) as completed_date` must keep seeing every
--      pallet. Filtering the join would re-date each corrected serial to
--      its 2026-08-28 remint date instead of its true completion date
--      (290726-068: 2026-08-25 -> would have become 2026-08-28), silently
--      moving rows between reporting periods. Weights are corrected;
--      the completion date is left exactly as it was.
--
-- REBASED, do not drop these two lines: `serial_base.closed_at` and the
-- `AND serial_base.closed_at IS NOT NULL` gate in finished_serials come
-- from migration `20260829090543_yakunlash_realized_loss_split`, which was
-- applied to the live project by another session WHILE this fix was being
-- written and is not present in this repo's migrations folder. This
-- rewrite carries that change forward verbatim rather than reverting it.
-- One consequence worth knowing: no wash_cycle currently has closed_at
-- set (0 of 19), so yield_rows returns ZERO rows on live right now and the
-- double count below is masked rather than visible. It is still a real bug
-- in the view and reappears the moment the first cycle is closed.
create or replace view public.yield_rows as
 WITH serial_base AS (
         SELECT kl.serial,
            kl.type_id,
            kl.partiya_no,
            ko.owner_id,
            ko.plate,
            ko.driver,
            rkr.qty_kg AS effective_qty,
            ( SELECT COALESCE(sum(ms.qty_kg), 0::numeric) AS "coalesce"
                   FROM moyka_sends ms
                  WHERE ms.serial = kl.serial) AS raw_consumed_kg,
            wc.id AS wash_cycle_id,
            wc.status AS wash_cycle_status,
            wc.closed_at
           FROM kirim_lines kl
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             JOIN report_kirim_rows rkr ON rkr.serial = kl.serial
             LEFT JOIN wash_cycles wc ON wc.serial = kl.serial
          WHERE ko.plate !~~ 'TEST-%'::text AND ko.origin <> 'opening_stock'::text
        ), finished_serials AS (
         SELECT serial_base.serial,
            serial_base.type_id,
            serial_base.partiya_no,
            serial_base.owner_id,
            serial_base.plate,
            serial_base.driver,
            serial_base.effective_qty,
            serial_base.raw_consumed_kg,
            serial_base.wash_cycle_id,
            serial_base.wash_cycle_status
           FROM serial_base
          WHERE serial_base.raw_consumed_kg > 0::numeric AND serial_base.closed_at IS NOT NULL
        ), output AS (
         SELECT fs_1.serial,
            COALESCE(sum(fp.weight_kg) FILTER (WHERE NOT c.is_numberless AND fp.status <> 'bekor_qilindi'::pallet_status), 0::numeric) AS calibre_kg,
            COALESCE(sum(fp.weight_kg) FILTER (WHERE c.is_numberless AND fp.status <> 'bekor_qilindi'::pallet_status), 0::numeric) AS konditirskiy_kg,
            min(fp.received_date) AS completed_date
           FROM finished_serials fs_1
             LEFT JOIN finished_pallets fp ON fp.serial = fs_1.serial
             LEFT JOIN calibres c ON c.id = fp.calibre_id
          GROUP BY fs_1.serial
        ), rewash_flag AS (
         SELECT fs_1.serial,
            (EXISTS ( SELECT 1
                   FROM lab_results lr
                  WHERE lr.wash_cycle_id = fs_1.wash_cycle_id AND lr.scope = 'chiqim'::direction AND lr.verdict = 'qayta_yuvish'::text)) AS rewashed
           FROM finished_serials fs_1
        ), calibre_breakdown AS (
         SELECT fs_1.serial,
            fp.calibre_id,
            sum(fp.weight_kg) AS kg
           FROM finished_serials fs_1
             JOIN finished_pallets fp ON fp.serial = fs_1.serial
          WHERE fp.status <> 'bekor_qilindi'::pallet_status
          GROUP BY fs_1.serial, fp.calibre_id
        ), lab_readings AS (
         SELECT fs_1.serial,
            ( SELECT lr.moisture_pct
                   FROM lab_results lr
                  WHERE lr.scope = 'kirim'::direction AND lr.parent_serial = fs_1.serial
                  ORDER BY lr.created_at DESC
                 LIMIT 1) AS intake_moisture_pct,
            ( SELECT lr.moisture_pct
                   FROM lab_results lr
                  WHERE lr.scope = 'chiqim'::direction AND lr.wash_cycle_id = fs_1.wash_cycle_id
                  ORDER BY lr.created_at DESC
                 LIMIT 1) AS delivered_moisture_pct
           FROM finished_serials fs_1
        )
 SELECT fs.serial,
    fs.type_id,
    fs.owner_id,
    fs.plate,
    fs.driver,
    fs.effective_qty AS raw_received_kg,
    fs.raw_consumed_kg,
    fs.raw_consumed_kg - fs.effective_qty AS raw_overage_kg,
    o.completed_date,
    1 AS max_cycle_no,
    rf.rewashed,
    o.calibre_kg AS live_calibre_kg,
    o.konditirskiy_kg AS live_konditirskiy_kg,
    o.calibre_kg + o.konditirskiy_kg AS output_kg,
    fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg AS loss_kg,
        CASE
            WHEN fs.raw_consumed_kg > 0::numeric THEN round((fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1)
            ELSE 0::numeric
        END AS loss_pct,
        CASE
            WHEN fs.raw_consumed_kg > 0::numeric THEN round((o.calibre_kg + o.konditirskiy_kg) / fs.raw_consumed_kg * 100::numeric, 1)
            ELSE 0::numeric
        END AS gross_yield_pct,
    lab.intake_moisture_pct,
    lab.delivered_moisture_pct,
    lab.intake_moisture_pct IS NOT NULL AND lab.delivered_moisture_pct IS NOT NULL AS dry_matter_available,
        CASE
            WHEN lab.intake_moisture_pct IS NOT NULL THEN round(fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric), 1)
            ELSE NULL::numeric
        END AS dry_matter_in_kg,
        CASE
            WHEN lab.delivered_moisture_pct IS NOT NULL THEN round((o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric), 1)
            ELSE NULL::numeric
        END AS dry_matter_out_kg,
        CASE
            WHEN lab.intake_moisture_pct IS NOT NULL AND lab.delivered_moisture_pct IS NOT NULL AND (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) > 0::numeric THEN round((fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric) - (o.calibre_kg + o.konditirskiy_kg) * (1::numeric - lab.delivered_moisture_pct / 100::numeric)) / (fs.raw_consumed_kg * (1::numeric - lab.intake_moisture_pct / 100::numeric)) * 100::numeric, 1)
            ELSE NULL::numeric
        END AS true_loss_pct,
    ( SELECT COALESCE(jsonb_agg(jsonb_build_object('calibreId', cb.calibre_id, 'kg', cb.kg, 'pct',
                CASE
                    WHEN (o.calibre_kg + o.konditirskiy_kg) > 0::numeric THEN round(cb.kg / (o.calibre_kg + o.konditirskiy_kg) * 100::numeric, 1)
                    ELSE 0::numeric
                END) ORDER BY cb.kg DESC), '[]'::jsonb) AS "coalesce"
           FROM calibre_breakdown cb
          WHERE cb.serial = fs.serial) AS calibre_mix,
    fs.partiya_no
   FROM finished_serials fs
     JOIN output o ON o.serial = fs.serial
     JOIN rewash_flag rf ON rf.serial = fs.serial
     JOIN lab_readings lab ON lab.serial = fs.serial;

-- ============================================================
-- 2. rahbar_stock_snapshot -- Rahbar dashboard "Moykada"
-- ============================================================
-- The only surface where the double count UNDER-states rather than
-- over-states. output_kg summed every pallet, so `greatest(0, sent_kg -
-- output_kg)` clamped to 0 for each corrected serial and the in-wash
-- balance vanished: 23,082 kg reported against a true 23,927 kg (-845).
-- moykadaKg also feeds totalKg, so the dashboard headline was short by the
-- same amount.
create or replace function public.rahbar_stock_snapshot(p_scope text)
 returns jsonb
 language sql
 stable
as $function$
with scoped as (
  select *
  from stock_on_hand_rows
  where (p_scope = 'hammasi'
      or (p_scope = 'yangi' and not is_old_stock)
      or (p_scope = 'eski' and is_old_stock))
),
raw_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'raw_not_washed'
),
finished_calibred_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and not c.is_numberless
),
finished_konditirskiy_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and c.is_numberless
),
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'old_kn'
),
moyka_lines as (
  select
    kl.serial,
    wc.closed_at,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_kg,
    -- voided pallets excluded: they are not product that came back from
    -- the wash, and counting them made this subtraction clamp to zero.
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp
      where fp.serial = kl.serial and fp.status <> 'bekor_qilindi') as output_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  left join wash_cycles wc on wc.serial = kl.serial
  where exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
moykada_total as (
  select coalesce(sum(case when closed_at is not null then 0 else greatest(0, sent_kg - output_kg) end), 0) as kg
  from moyka_lines
),
by_type as (
  select type_id, coalesce(sum(qty_kg), 0) as kg
  from scoped
  group by type_id
)
select jsonb_build_object(
  'rawKg', (select kg from raw_total),
  'finishedCalibredKg', (select kg from finished_calibred_total),
  'konditirskiyKg', (select kg from finished_konditirskiy_total),
  'oldKnKg', (select kg from old_kn_total),
  'moykadaKg', (select kg from moykada_total),
  'oldKnNote', 'pool stock -- not backed by finished_pallets, structurally outside Ledger C''s coverage; shown separately, never reconciled against it',
  'totalKg', (select kg from raw_total) + (select kg from finished_calibred_total)
             + (select kg from finished_konditirskiy_total) + (select kg from old_kn_total)
             + (select kg from moykada_total),
  'byType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_type
  ),
  'distinctTypeCount', (select count(*) from by_type)
);
$function$;

-- ============================================================
-- 3. client_filtered_report_rows -- Global Export client portal
-- ============================================================
-- The client-facing one, and the reason this migration is not "internal
-- reporting cosmetics": the 'moyka_output' branch ("Переработано") took
-- every pallet regardless of status, so the portal showed a client 24,460
-- kg of production that had been voided -- and all eight affected serials
-- belong to Global Export Company, the owner with portal access. It also
-- fed client_report_totals.total_netto_kg, so the "Нетто" total was
-- inflated by the same amount.
--
-- Unlike the internal Hisobot, voided pallets are dropped from the client
-- ROWS entirely, not just the totals: a client document has no audit-trail
-- role for a bookkeeping reversal, and get_client_report -- the other
-- client-facing read -- already excludes them outright. This makes the two
-- client surfaces agree.
--
-- The 'chiqim' branch needs no change: it joins through
-- chiqim_pallet_consumption, so it only ever sees genuinely dispatched
-- pallets.
create or replace function public.client_filtered_report_rows(p_directions text[], p_from date, p_to date, p_type_id uuid, p_serial text)
 returns table(kind text, row_key text, serial text, type_id uuid, partiya_no integer, plate text, driver text, date_basis date, qty_kg numeric, declared_qty numeric)
 language sql
 stable
as $function$
  with rows_unfiltered as (
    select 'kirim'::text as kind, kl.serial as row_key, kl.serial, kl.type_id, kl.partiya_no,
           ko.plate, ko.driver, ko.order_date as date_basis,
           kirim_line_effective_qty(kl.serial) as qty_kg, kl.declared_qty
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.origin = 'delivery'
      and ko.plate !~~ 'TEST-%'

    union all

    select 'chiqim'::text, c.id::text, fp.serial, fp.type_id, kl.partiya_no,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           c.qty_kg, null::numeric
    from chiqim_pallet_consumption c
    join finished_pallets fp on fp.barcode2 = c.barcode2
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    join chiqim_lines cl on cl.id = c.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'chiqim_raw'::text, rdl.id::text, rdl.serial, cl.type_id, kl.partiya_no,
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

    select 'chiqim_old_kn'::text, okc.id::text, null::text, okp.type_id, null::int,
           coalesce(cr.plate, ''), coalesce(cr.driver, ''), cr.request_date,
           okc.collected_kg, null::numeric
    from old_kn_collections okc
    join old_kn_pools okp on okp.id = okc.pool_id
    join chiqim_lines cl on cl.id = okc.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where okp.owner_id = my_owner_id()
      and coalesce(cr.plate, '') !~~ 'TEST-%'

    union all

    select 'moyka_output'::text, 'moyka-output-' || fp.barcode2, fp.serial, fp.type_id, kl.partiya_no,
           ko.plate, ko.driver, fp.received_date,
           fp.weight_kg, null::numeric
    from finished_pallets fp
    join kirim_lines kl on kl.serial = fp.serial
    join kirim_orders ko on ko.order_id = kl.order_id
    where ko.owner_id = my_owner_id()
      and ko.plate !~~ 'TEST-%'
      and ko.origin != 'opening_stock'
      and fp.status <> 'bekor_qilindi'
  )
  select * from rows_unfiltered r
  where (p_directions is null or array_length(p_directions, 1) is null or r.kind = any(p_directions))
    and r.date_basis is not null and r.date_basis between p_from and p_to
    and (p_type_id is null or r.type_id = p_type_id)
    and (p_serial is null or p_serial = '' or r.serial ilike '%' || p_serial || '%');
$function$;

-- ============================================================
-- 4. report_totals -- Hisobot "Moykadan chiqgan (davrda)"
-- ============================================================
-- total_kg_from_moyka summed every moyka_output row, voided included:
-- 109,530 kg against a true 85,070 (+24,460). Sat directly beside
-- "Moykadan chiqgan (joriy)" (84,030, from kirim_line_state, which has
-- always filtered correctly) in TotalsStrip.tsx -- the two are allowed to
-- diverge by design (movement vs state, see 0074's header), but not by a
-- phantom 24 tonnes.
--
-- Only this ONE sum changes. Deliberately NOT touched:
--   * total_kg_out -- it sums kinds ('chiqim','chiqim_raw','chiqim_old_kn').
--     report_rows_v2 does feed report_chiqim_rows in unfiltered, but every
--     chiqim row carries date_basis = the dispatch date, and
--     report_filtered_rows drops rows whose date_basis is null. A voided
--     pallet has no chiqim_pallet_consumption row and so can never acquire
--     a dispatch date -- it is structurally unreachable in this sum, now
--     and after any future dispatch. Verified: all 41 voided rows have
--     date_basis null.
--   * total_count -- a count of rows displayed, and the voided rows ARE
--     displayed on purpose. Filtering it would make the count disagree
--     with the list the user is looking at.
--   * every state_* column -- they route through kirim_line_state /
--     kirim_line_calibre_output, both of which already exclude voided.
--
-- Only the text[] overload is rewritten. The legacy report_totals(
-- p_direction text, ...) overload is not called by the app
-- (useReportQuery.ts:45 sends p_directions + p_partiya_no, which resolves
-- to this one) and has no total_kg_from_moyka column at all.
create or replace function public.report_totals(p_directions text[], p_from date, p_to date, p_owner_id uuid, p_type_id uuid, p_calibre_id uuid, p_serial text, p_barcode2 text, p_plate text, p_driver text, p_wash_cycle text, p_lab_verdict text, p_status text, p_partiya_no integer DEFAULT NULL::integer)
 returns table(total_count bigint, total_kg_in numeric, total_kg_out numeric, total_kg_tara_in numeric, total_kg_tara_out numeric, total_declared numeric, total_hisobiy numeric, total_kg_to_moyka numeric, total_kg_from_moyka numeric, state_serial_count bigint, state_qabul_qilingan numeric, state_omborda_qoldi numeric, state_moykaga_yuborilgan numeric, state_moykada numeric, state_moykadan_chiqgan numeric, state_xom_jonatilgan numeric, state_olib_ketilgan numeric, state_k1 numeric, state_k2 numeric, state_k3 numeric, state_k4 numeric, state_k5 numeric, state_k6 numeric, state_k7 numeric, state_k8 numeric, state_kn numeric)
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
      -- voided pallets excluded: a reversed pallet never came out of moyka.
      -- The row itself stays in the listing; only this sum skips it.
      coalesce(sum(case when kind = 'moyka_output'
                         and coalesce(pallet_status, '') <> 'bekor_qilingan'
                        then qty_kg else 0 end), 0) as total_kg_from_moyka
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
  ),
  calibre_output as (
    select
      coalesce(sum(co.k1), 0) as state_k1,
      coalesce(sum(co.k2), 0) as state_k2,
      coalesce(sum(co.k3), 0) as state_k3,
      coalesce(sum(co.k4), 0) as state_k4,
      coalesce(sum(co.k5), 0) as state_k5,
      coalesce(sum(co.k6), 0) as state_k6,
      coalesce(sum(co.k7), 0) as state_k7,
      coalesce(sum(co.k8), 0) as state_k8,
      coalesce(sum(co.kn), 0) as state_kn
    from distinct_serials ds
    cross join lateral kirim_line_calibre_output(ds.serial) co
  )
  select
    movement.total_count, movement.total_kg_in, movement.total_kg_out, movement.total_kg_tara_in,
    movement.total_kg_tara_out, movement.total_declared, movement.total_hisobiy,
    movement.total_kg_to_moyka, movement.total_kg_from_moyka,
    state.state_serial_count, state.state_qabul_qilingan, state.state_omborda_qoldi,
    state.state_moykaga_yuborilgan, state.state_moykada, state.state_moykadan_chiqgan,
    state.state_xom_jonatilgan, state.state_olib_ketilgan,
    calibre_output.state_k1, calibre_output.state_k2, calibre_output.state_k3, calibre_output.state_k4,
    calibre_output.state_k5, calibre_output.state_k6, calibre_output.state_k7, calibre_output.state_k8,
    calibre_output.state_kn
  from movement, state, calibre_output;
$function$;

-- ============================================================
-- 5. get_serial_passport -- SerialPassportModal "Joriy holat"
-- ============================================================
-- The one the manager reported. finished_returned_total summed
-- finished_pallets with no status test at all, so:
--   * joriyHolat.finished.returnedKg ("Moykadan qaytdi") included the
--     voided kg, which the very next line then printed AGAIN on its own
--     "Bekor qilindi" row (SerialPassportModal.tsx:274,283). 290726-068
--     read 4,730 = 2,270 live + 2,460 voided, with 2,460 shown beneath it.
--   * cycles[].inMoykaKg = greatest(0, sent - returned) silently clamped
--     to 0, hiding the real in-wash balance.
--   * cycles[].lossKg = sent - returned would go negative; latent only
--     because every affected serial currently has closed_at null.
--
-- Excludes 'bekor_qilindi' ONLY, per this migration's header: returnedKg
-- is the total of what came back from the wash, and the block's other
-- members (dispatchedKg, storageLossKg, consumedKg, stillInStorageKg) are
-- its components. Dropping storage_loss here would break that identity.
-- Verified on 290726-068: 2,270 returned = 0 dispatched + 0 storage loss
-- + 0 consumed + 2,270 still in storage.
--
-- The `pallets` array is unchanged and still lists voided pallets tagged
-- palletStatus='bekor_qilingan' -- it reads report_chiqim_rows and is the
-- per-pallet audit trail the modal renders on purpose.
create or replace function public.get_serial_passport(p_serial text)
 returns jsonb
 language sql
 stable
as $function$
with target_line as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
  where kl.serial = p_serial
),
gate_kirim as (
  select gw.*
  from gate_weighings gw, target_line tl
  where gw.dir = 'kirim' and gw.order_id = tl.order_id
  order by gw.stage1_completed_at desc nulls last
  limit 1
),
intake_row as (
  select * from storage_intake where serial = p_serial
),
kirim_lab as (
  select * from lab_results where scope = 'kirim' and parent_serial = p_serial
  order by created_at desc limit 1
),
wc as (
  select * from wash_cycles where serial = p_serial
),
sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from moyka_sends where serial = p_serial
),
rezka_sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from rezka_sends where serial = p_serial
),
cycle_lab as (
  select lr.verdict, lr.moisture_pct, lr.so2_mg_kg, lr.sample_date, lr.sample_photo, lr.note, lr.tested_by
  from wc
  left join lateral (
    select * from lab_results lr2
    where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
    order by lr2.created_at desc
    limit 1
  ) lr on true
),
pallets as (
  select rcr.* from report_chiqim_rows rcr where rcr.serial = p_serial
),
dispatch_ids as (
  select distinct cl.request_id
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
dispatch_gate as (
  select
    di.request_id,
    gw.gruzheny_kg, gw.pustoy_kg, gw.net_kg,
    gw.stage1_completed_at, gw.stage1_created_by, gw.stage1_plate_photo, gw.stage1_scale_photo,
    gw.completed_at, gw.stage2_created_by, gw.stage2_scale_photo, gw.departure_doc_photo
  from dispatch_ids di
  left join lateral (
    select * from gate_weighings gw2
    where gw2.dir = 'chiqim' and gw2.request_id = di.request_id
    order by gw2.completed_at desc nulls last
    limit 1
  ) gw on true
),
dispatch_pallets as (
  select cl.request_id, c.barcode2, c.created_at as loaded_at, fp.calibre_id, c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
raw_dispatches as (
  select rdl.id, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, rdl.loaded_at,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where rdl.serial = p_serial
),
mint_pallet_sources as (
  select sms.source_barcode2, fp.weight_kg as book_weight_kg, fp.calibre_id, fp.serial as source_serial
  from serial_mint_sources sms
  join finished_pallets fp on fp.barcode2 = sms.source_barcode2
  where sms.minted_serial = p_serial and sms.source_kind = 'pallet'
),
mint_pool_sources as (
  select sms.source_pool_id, sms.weight_kg, p.type_id
  from serial_mint_sources sms
  join old_kn_pools p on p.id = sms.source_pool_id
  where sms.minted_serial = p_serial and sms.source_kind = 'weight_pool'
),
raw_received as (
  select rkr.qty_kg as received_kg
  from report_kirim_rows rkr where rkr.serial = p_serial
),
raw_dispatched_total as (
  select coalesce(sum(rdl.net_kg), 0) as kg from raw_dispatch_lines rdl where rdl.serial = p_serial
),
raw_closeout as (
  select osc.closed_at
  from target_line tl2
  join kirim_orders ko2 on ko2.order_id = tl2.order_id
  join old_stock_closeouts osc on osc.kind = 'old_raw' and osc.owner_id = ko2.owner_id and osc.type_id = tl2.type_id
),
raw_still as (
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where serial = p_serial and bucket = 'raw_not_washed'
),
raw_storage_loss as (
  select
    (select closed_at from raw_closeout) as closed_at,
    case when (select closed_at from raw_closeout) is not null
      then greatest(0, coalesce((select received_kg from raw_received), 0) - (select sent_kg from sends_total) - (select sent_kg from rezka_sends_total) - (select kg from raw_dispatched_total))
      else 0
    end as kg
),
finished_returned_total as (
  -- voided pallets excluded (see this section's header): a reversed pallet
  -- never came back from the wash, and its kg is already reported on its
  -- own "Bekor qilindi" line below.
  select coalesce(sum(weight_kg), 0) as kg from finished_pallets
  where serial = p_serial and status <> 'bekor_qilindi'
),
finished_dispatched_total as (
  select coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and exists (
      select 1 from gate_weighings cgw3
      where cgw3.dir = 'chiqim' and cgw3.request_id = cr.id and cgw3.completed_at is not null
    )
),
finished_dispatched_by_calibre as (
  select cl.calibre_id, coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and exists (
      select 1 from gate_weighings cgw4
      where cgw4.dir = 'chiqim' and cgw4.request_id = cr.id and cgw4.completed_at is not null
    )
  group by cl.calibre_id
),
finished_storage_loss_pallets as (
  select fp.barcode2, fp.calibre_id, fp.weight_kg, fp.voided_at
  from finished_pallets fp
  where fp.serial = p_serial and fp.status = 'storage_loss'
),
finished_other_total as (
  select
    coalesce(sum(weight_kg) filter (where status = 'consumed'), 0) as consumed_kg,
    coalesce(sum(weight_kg) filter (where status = 'bekor_qilindi'), 0) as voided_kg
  from finished_pallets where serial = p_serial
),
finished_still as (
  select
    coalesce(sum(qty_kg), 0) as total_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'awaiting_lab'), 0) as awaiting_lab_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'qayta_yuvish'), 0) as needs_rewash_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
),
finished_still_by_calibre as (
  select calibre_id,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket in ('awaiting_lab', 'qayta_yuvish')), 0) as under_review_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
  group by calibre_id
),
storage_loss_events as (
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object('kind', 'old_washed', 'barcode2', slp.barcode2, 'calibreId', slp.calibre_id, 'weightKg', slp.weight_kg, 'voidedAt', slp.voided_at)
        order by slp.barcode2
      ) from finished_storage_loss_pallets slp
    ), '[]'::jsonb)
    ||
    case when (select closed_at from raw_storage_loss) is not null
      then jsonb_build_array(jsonb_build_object(
        'kind', 'old_raw', 'closedAt', (select closed_at from raw_storage_loss), 'weightKg', (select kg from raw_storage_loss),
        'note', 'Bu turdagi eski xom ashyo yakunlandi -- ko''rsatilgan miqdor shu seriyaning taxminiy ulushi'
      ))
      else '[]'::jsonb
    end as events
),
pending_raw as (
  select distinct cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from chiqim_line_raw_serials clrs
  join chiqim_lines cl on cl.id = clrs.line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where clrs.serial = p_serial
    and cr.voided_at is null
    and cr.ombor_finished_at is null
    and not exists (select 1 from raw_dispatch_lines rdl2 where rdl2.chiqim_line_id = clrs.line_id and rdl2.serial = p_serial)
),
pending_dispatches as (
  select
    (select coalesce(jsonb_agg(
      jsonb_build_object('kind', 'raw', 'requestId', pr.request_id, 'requestDate', pr.request_date, 'plate', pr.plate, 'driver', pr.driver)
      order by pr.request_date desc
    ), '[]'::jsonb) from pending_raw pr)
    as events
)
select jsonb_build_object(
  'serial', p_serial,
  'order', (
    select jsonb_build_object(
      'orderId', ko.order_id, 'ownerId', ko.owner_id, 'ownerName', o.name, 'plate', ko.plate, 'driver', ko.driver,
      'orderDate', ko.order_date, 'declaredQty', tl.declared_qty, 'declaredTotal', ko.declared_total,
      'isMultiLine', tl.line_count > 1, 'targetMoisturePct', tl.target_moisture_pct, 'targetSo2MgKg', tl.target_so2_mg_kg, 'typeId', tl.type_id,
      'partiyaNo', tl.partiya_no,
      'docPhoto', ko.doc_photo, 'isOldStock', ko.origin = 'opening_stock',
      'isMinted', ko.origin = 'internal_reprocess'
    )
    from target_line tl
    join kirim_orders ko on ko.order_id = tl.order_id
    left join owners o on o.id = ko.owner_id
  ),
  'effectiveQty', (
    select jsonb_build_object(
      'valueKg', rkr.qty_kg, 'provisional', rkr.provisional,
      'truckVarianceDiffKg', rkr.truck_variance_diff_kg, 'truckVarianceDiffPct', rkr.truck_variance_diff_pct
    )
    from report_kirim_rows rkr where rkr.serial = p_serial
  ),
  'gate', (
    select jsonb_build_object(
      'gruzhenyKg', gk.gruzheny_kg, 'pustoyKg', gk.pustoy_kg, 'netKg', gk.net_kg,
      'stage1CompletedAt', gk.stage1_completed_at, 'stage1CreatedByName', p1.full_name,
      'stage1PlatePhoto', gk.stage1_plate_photo, 'stage1ScalePhoto', gk.stage1_scale_photo,
      'stage2CompletedAt', gk.completed_at, 'stage2CreatedByName', p2.full_name,
      'stage2ScalePhoto', gk.stage2_scale_photo, 'departureDocPhoto', gk.departure_doc_photo
    )
    from gate_kirim gk
    left join profiles p1 on p1.id = gk.stage1_created_by
    left join profiles p2 on p2.id = gk.stage2_created_by
  ),
  'intake', (
    select jsonb_build_object(
      'actualQty', ir.actual_qty, 'confirmedAt', ir.confirmed_at, 'confirmedByName', p3.full_name,
      'barcode1', ir.barcode1, 'pilePhoto', ir.pile_photo, 'komment', ir.komment,
      'boxMassKg', ir.box_mass_kg
    )
    from intake_row ir
    left join profiles p3 on p3.id = ir.confirmed_by
  ),
  'kirimLab', (
    select jsonb_build_object(
      'sampleDate', kl.sample_date, 'moisturePct', kl.moisture_pct, 'so2MgKg', kl.so2_mg_kg,
      'testedByName', p4.full_name, 'samplePhoto', kl.sample_photo, 'note', kl.note
    )
    from kirim_lab kl
    left join profiles p4 on p4.id = kl.tested_by
  ),
  'cycles', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'cycleNo', 1,
        'inMoykaKg', case when wc.closed_at is not null then 0 else greatest(0, st.sent_kg - (select kg from finished_returned_total)) end,
        'lossKg', case when wc.closed_at is not null then st.sent_kg - (select kg from finished_returned_total) else null end,
        'isRealized', wc.closed_at is not null,
        'closedAt', wc.closed_at,
        'sentKg', st.sent_kg,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'barcode2', pl.barcode2, 'calibreId', pl.calibre_id, 'weightKg', pl.qty_kg,
              'palletStatus', pl.pallet_status, 'voidSuccessorBarcodes', pl.void_successor_barcodes
            ) order by pl.barcode2
          ), '[]'::jsonb)
          from pallets pl
        ),
        'lab', (
          select jsonb_build_object(
            'verdict', cl.verdict, 'moisturePct', cl.moisture_pct, 'so2MgKg', cl.so2_mg_kg,
            'sampleDate', cl.sample_date, 'testedByName', p5.full_name, 'samplePhoto', cl.sample_photo, 'note', cl.note
          )
          from cycle_lab cl
          left join profiles p5 on p5.id = cl.tested_by
          where cl.verdict is not null
        )
      )
    ), '[]'::jsonb)
    from wc cross join sends_total st
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'status', cr.status, 'omborFinishedAt', cr.ombor_finished_at, 'omborFinishedByName', p6.full_name,
        'gate', jsonb_build_object(
          'gruzhenyKg', dg.gruzheny_kg, 'pustoyKg', dg.pustoy_kg, 'netKg', dg.net_kg,
          'stage1CompletedAt', dg.stage1_completed_at, 'stage1CreatedByName', p7.full_name,
          'stage1PlatePhoto', dg.stage1_plate_photo, 'stage1ScalePhoto', dg.stage1_scale_photo,
          'stage2CompletedAt', dg.completed_at, 'stage2CreatedByName', p8.full_name,
          'stage2ScalePhoto', dg.stage2_scale_photo, 'departureDocPhoto', dg.departure_doc_photo
        ),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', dp.barcode2, 'calibreId', dp.calibre_id, 'weightKg', dp.weight_kg, 'loadedAt', dp.loaded_at)
            order by dp.loaded_at
          ), '[]'::jsonb)
          from dispatch_pallets dp where dp.request_id = cr.id
        )
      ) order by cr.request_date desc
    ), '[]'::jsonb)
    from dispatch_ids di
    join chiqim_requests cr on cr.id = di.request_id
    left join dispatch_gate dg on dg.request_id = di.request_id
    left join profiles p6 on p6.id = cr.ombor_finished_by
    left join profiles p7 on p7.id = dg.stage1_created_by
    left join profiles p8 on p8.id = dg.stage2_created_by
  ),
  'dispatchedByCalibre', (
    select coalesce(jsonb_agg(
      jsonb_build_object('calibreId', fdbc.calibre_id, 'kg', fdbc.kg)
      order by fdbc.calibre_id
    ), '[]'::jsonb)
    from finished_dispatched_by_calibre fdbc
  ),
  'rawDispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', rd.request_id, 'requestDate', rd.request_date, 'plate', rd.plate, 'driver', rd.driver,
        'weightKg', rd.weight_kg, 'boxMassKg', rd.box_mass_kg, 'netKg', rd.net_kg, 'loadedAt', rd.loaded_at
      ) order by rd.loaded_at desc
    ), '[]'::jsonb)
    from raw_dispatches rd
  ),
  'mintOrigin', (
    select case when (select count(*) from serial_mint_sources where minted_serial = p_serial) = 0
      then null
      else jsonb_build_object(
        'palletCount',  (select count(*) from mint_pallet_sources),
        'bookTotalKg',  (select coalesce(sum(book_weight_kg), 0) from mint_pallet_sources),
        'poolDrawKg',   (select coalesce(sum(weight_kg), 0) from mint_pool_sources),
        'sentWeighedKg',(select sent_kg from sends_total) + (select sent_kg from rezka_sends_total),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', mps.source_barcode2, 'bookWeightKg', mps.book_weight_kg,
                               'calibreId', mps.calibre_id, 'sourceSerial', mps.source_serial)
            order by mps.source_barcode2
          ), '[]'::jsonb) from mint_pallet_sources mps
        )
      )
    end
  ),
  'notes', (
    select coalesce(jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at, 'authorName', pr.full_name)
      order by n.created_at
    ), '[]'::jsonb)
    from notes n
    left join profiles pr on pr.id = n.author
    where n.entity_type = 'moyka' and n.entity_id = p_serial
  ),
  'joriyHolat', jsonb_build_object(
    'raw', jsonb_build_object(
      'receivedKg', coalesce((select received_kg from raw_received), 0),
      'sentToMoykaKg', (select sent_kg from sends_total),
      'collectedRawKg', (select kg from raw_dispatched_total),
      'storageLossKg', (select kg from raw_storage_loss),
      'storageLossClosedAt', (select closed_at from raw_storage_loss),
      'stillInStorageKg', (select kg from raw_still)
    ),
    'finished', jsonb_build_object(
      'returnedKg', (select kg from finished_returned_total),
      'dispatchedKg', (select kg from finished_dispatched_total),
      'storageLossKg', (select coalesce(sum(weight_kg), 0) from finished_storage_loss_pallets),
      'consumedKg', (select consumed_kg from finished_other_total),
      'voidedKg', (select voided_kg from finished_other_total),
      'stillInStorageKg', (select total_kg from finished_still),
      'stillInStorageBreakdown', jsonb_build_object(
        'availableKg', (select available_kg from finished_still),
        'reservedKg', (select reserved_kg from finished_still),
        'awaitingLabKg', (select awaiting_lab_kg from finished_still),
        'needsRewashKg', (select needs_rewash_kg from finished_still)
      ),
      'byCalibre', (
        select coalesce(jsonb_agg(
          jsonb_build_object('calibreId', fsc.calibre_id, 'availableKg', fsc.available_kg, 'reservedKg', fsc.reserved_kg, 'underReviewKg', fsc.under_review_kg)
          order by fsc.calibre_id
        ), '[]'::jsonb)
        from finished_still_by_calibre fsc
      )
    )
  ),
  'storageLossEvents', (select events from storage_loss_events),
  'pendingDispatches', (select events from pending_dispatches)
);
$function$;
