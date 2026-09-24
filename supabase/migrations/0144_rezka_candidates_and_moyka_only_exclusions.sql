-- Rezka build, Prompt 2 of 4 (2026-09-24): one shared Konditerka-candidate
-- predicate for the Ichki draw, the read RPC the Ombor "Ichkaridan olish"
-- tile shows, and the Moyka-only read exclusions HANDOFF.md listed after
-- Prompt 1. Decision: docs/decisions/0224-*.
--
-- 1. rezka_kn_candidate_pallets(owner, type) -- THE single definition of
--    "which Konditerka pallets an Ichki draw may take, and how many kg each
--    still has": Konditerka calibre (is_numberless, not is_rezka_output),
--    in_stock, not voided, not old stock, parent serial process='moyka',
--    latest chiqim verdict 'o_tdi' on the serial's LATEST wash cycle,
--    remaining = weight - sum(CHIQIM consumption) - sum(Rezka draws) > 0.
--    Both send_kn_to_rezka (the draw) and rezka_kn_available (the tile's
--    figure) read it, so the tile can never show kg the draw can't take.
--    Balance/stock read -> no origin filter (old stock excluded by
--    is_old_stock); deliberately no TEST- plate filter (the draw has none).
--    Security invoker: staff read everything via read_all; a client caller
--    would see only their own pallets via RLS.
-- 2. send_kn_to_rezka rewritten onto it: locks the candidate pallets first,
--    then allocates FIFO from the function's (post-lock) figures. Signature
--    and behaviour otherwise identical to 0142.
-- 3. rezka_kn_available() -- per owner+type sum of the same candidates.
-- 4. Moyka-only reads exclude process='rezka' explicitly (CLAUDE.md: an
--    exclusion that works only because data happens not to overlap is not
--    acceptable): yield_rows (processing aggregate, Moyka yield),
--    wip_rows (raw_not_sent + the three Moyka/lab buckets),
--    lab_turnaround_avg (processing aggregate), and
--    classify_kirim_line_sulfur rejects a Rezka serial (Rezka has no lab).

-- ------------------------------------------------------------------
-- 1. Shared candidate predicate
-- ------------------------------------------------------------------
create or replace function public.rezka_kn_candidate_pallets(p_owner_id uuid default null, p_type_id uuid default null)
returns table(barcode2 text, serial text, owner_id uuid, type_id uuid, received_date date, created_at timestamptz, available_kg numeric)
language sql
stable
set search_path to 'public'
as $$
  select fp.barcode2, fp.serial, ko.owner_id, fp.type_id, fp.received_date, fp.created_at,
         fp.weight_kg - coalesce(c.kg, 0) - coalesce(d.kg, 0) as available_kg
  from finished_pallets fp
  join calibres cal    on cal.id = fp.calibre_id
  join kirim_lines kl  on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (
    select wc.id from wash_cycles wc where wc.serial = fp.serial
    order by wc.cycle_no desc limit 1
  ) wc on true
  left join lateral (
    select lr.verdict from lab_results lr
    where lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id
    order by lr.created_at desc limit 1
  ) lr on true
  left join lateral (
    select sum(x.qty_kg) as kg from chiqim_pallet_consumption x where x.barcode2 = fp.barcode2
  ) c on true
  left join lateral (
    select sum(x.qty_kg) as kg from rezka_kn_draws x where x.barcode2 = fp.barcode2
  ) d on true
  where (p_owner_id is null or ko.owner_id = p_owner_id)
    and (p_type_id is null or fp.type_id = p_type_id)
    and cal.is_numberless and not cal.is_rezka_output
    and fp.status = 'in_stock'
    and fp.voided_at is null
    and not fp.is_old_stock
    and kl.process = 'moyka'
    and lr.verdict = 'o_tdi'
    and fp.weight_kg - coalesce(c.kg, 0) - coalesce(d.kg, 0) > 0
$$;

-- ------------------------------------------------------------------
-- 2. send_kn_to_rezka -- now reads the shared predicate
-- ------------------------------------------------------------------
create or replace function public.send_kn_to_rezka(p_owner_id uuid, p_type_id uuid, p_kg numeric)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor     uuid := auth.uid();
  v_order_id  uuid;
  v_serial    text;
  v_remaining numeric := p_kg;
  v_take      numeric;
  v_pallets   int := 0;
  r           record;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor Rezkaga yubora oladi' using errcode = '42501';
  end if;
  if p_kg is null or p_kg <= 0 then
    raise exception 'Og''irlik kiritilmagan' using errcode = '22023';
  end if;

  -- Lock this owner+type's candidate pallets first; the allocation below
  -- then reads remaining kg in a fresh statement, after the lock, so a
  -- concurrent draw or CHIQIM load already committed is accounted for.
  perform 1 from finished_pallets fp
   where fp.barcode2 in (select c.barcode2 from rezka_kn_candidate_pallets(p_owner_id, p_type_id) c)
   order by fp.barcode2
   for update;

  -- Mint first so the ledger rows can reference the serial. Same order row
  -- shape mint_serial_from_sources writes; no storage_intake, so no
  -- Barcode #1 and no gate/intake queue.
  insert into kirim_orders (order_date, plate, driver, owner_id, declared_total, origin, status, created_by)
  values ((now() at time zone 'Asia/Tashkent')::date, 'QAYTA-ISHLASH', 'Ichki qayta ishlash',
          p_owner_id, null, 'internal_reprocess', 'qabul_qilindi', v_actor)
  returning order_id into v_order_id;

  insert into kirim_lines (order_id, type_id, declared_qty, process)
  values (v_order_id, p_type_id, p_kg, 'rezka')
  returning serial into v_serial;

  for r in
    select c.barcode2, c.available_kg
    from rezka_kn_candidate_pallets(p_owner_id, p_type_id) c
    order by c.received_date, c.created_at, c.barcode2
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, r.available_kg);
    if v_take <= 0 then continue; end if;
    insert into rezka_kn_draws (minted_serial, barcode2, qty_kg, drawn_by)
    values (v_serial, r.barcode2, v_take, v_actor);
    v_remaining := v_remaining - v_take;
    v_pallets := v_pallets + 1;
  end loop;

  if v_remaining > 0 then
    raise exception 'Konditerka yetarli emas: % kg yetishmayapti', round(v_remaining, 1)
      using errcode = '23514';
  end if;

  insert into rezka_cycles (serial, cycle_no, status) values (v_serial, 1, 'active');
  insert into rezka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_kg, v_actor);
  insert into notes (entity_type, entity_id, author, body)
  values ('rezka', v_serial, v_actor,
    format('Ichki Konditerkadan Rezkaga: %s kg, %s ta palletdan (FIFO).', p_kg, v_pallets));

  return v_serial;
end
$$;

-- ------------------------------------------------------------------
-- 3. Tile figure
-- ------------------------------------------------------------------
create or replace function public.rezka_kn_available()
returns table(owner_id uuid, type_id uuid, available_kg numeric)
language sql
stable
set search_path to 'public'
as $$
  select c.owner_id, c.type_id, sum(c.available_kg)
  from rezka_kn_candidate_pallets(null, null) c
  group by c.owner_id, c.type_id
$$;

-- ------------------------------------------------------------------
-- 4a. lab_turnaround_avg
-- ------------------------------------------------------------------
create or replace function public.lab_turnaround_avg()
returns numeric
language sql
stable
as $$
  select avg(lr.sample_date - ms_first.sent_date)
  from lab_results lr
  join wash_cycles wc on wc.id = lr.wash_cycle_id
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select min(ms2.sent_date) as sent_date from moyka_sends ms2
    where ms2.serial = wc.serial and ms2.sent_date >= (wc.opened_at at time zone 'utc')::date
  ) ms_first on true
  where lr.scope = 'chiqim'
    and ko.plate not like 'TEST-%'
    and ko.origin != 'opening_stock'
    and kl.process <> 'rezka';
$$;

-- ------------------------------------------------------------------
-- 4b. classify_kirim_line_sulfur -- Rezka serials have no lab
-- ------------------------------------------------------------------
create or replace function public.classify_kirim_line_sulfur(p_serial text, p_is_sulfured boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor   uuid := auth.uid();
  v_before  boolean;
  v_process text;
begin
  if my_role() is distinct from 'laborator' then
    raise exception 'Faqat Laborator mahsulot turini belgilay oladi' using errcode = '42501';
  end if;
  if p_is_sulfured is null then
    raise exception 'Mahsulot turi ko''rsatilmagan' using errcode = '22023';
  end if;

  select is_sulfured, process into v_before, v_process from kirim_lines where serial = p_serial for update;
  if not found then
    raise exception 'Seriya topilmadi: %', p_serial using errcode = 'P0002';
  end if;
  if v_process = 'rezka' then
    raise exception 'Rezka seriyasi laboratoriyadan o''tmaydi: %', p_serial using errcode = '22023';
  end if;

  -- No-op if unchanged -- avoids audit noise when the lab saves a form
  -- (e.g. correcting an unrelated field) without actually touching the
  -- classification.
  if v_before is not distinct from p_is_sulfured then
    return;
  end if;

  update kirim_lines set is_sulfured = p_is_sulfured where serial = p_serial;

  insert into audit_log (table_name, row_id, actor, action, before, after)
  values (
    'kirim_lines', p_serial, v_actor, 'is_sulfured',
    jsonb_build_object('is_sulfured', v_before),
    jsonb_build_object('is_sulfured', p_is_sulfured)
  );
end
$function$;

-- ------------------------------------------------------------------
-- 4c. yield_rows -- live body; only change: serial_base excludes Rezka
-- ------------------------------------------------------------------
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
            AND kl.process <> 'rezka'::text
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

-- ------------------------------------------------------------------
-- 4d. wip_rows -- live body; only change: the four serial buckets
--     exclude Rezka (raw_not_sent via NOT EXISTS; the other three via
--     their existing kirim_lines join). chiqim_open / provisional_weight
--     are not Moyka-only and are unchanged.
-- ------------------------------------------------------------------
create or replace view public.wip_rows with (security_invoker = true) as
 WITH limits AS (
         SELECT ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'raw_idle_days'::text) AS raw_idle_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'moyka_idle_days'::text) AS moyka_idle_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'tahlil_kechikdi_days'::text) AS tahlil_kechikdi_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'sulfur_overdue_days'::text) AS sulfur_overdue_days,
            ( SELECT settings_limits.value
                   FROM settings_limits
                  WHERE settings_limits.key = 'chiqim_idle_days'::text) AS chiqim_idle_days
        ), raw_not_sent AS (
         SELECT 'raw_not_sent'::text AS wip_kind,
            r.row_key,
            r.serial,
            NULL::uuid AS request_id,
            r.owner_id,
            r.type_id,
            CURRENT_DATE - (si.confirmed_at AT TIME ZONE 'utc'::text)::date AS days_waiting,
            l.raw_idle_days::integer AS threshold_days,
            r.partiya_no
           FROM report_kirim_rows r
             JOIN storage_intake si ON si.serial = r.serial
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(ms.qty_kg), 0::numeric) AS total_sent
                   FROM moyka_sends ms
                  WHERE ms.serial = r.serial) sent ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rs.qty_kg), 0::numeric) AS total_rezka_sent
                   FROM rezka_sends rs
                  WHERE rs.serial = r.serial) rezka ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(rdl.net_kg), 0::numeric) AS total_raw
                   FROM raw_dispatch_lines rdl
                  WHERE rdl.serial = r.serial) raw ON true
             CROSS JOIN limits l
          WHERE (r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric)) > 0::numeric AND r.origin <> 'opening_stock'::text AND (CURRENT_DATE - (si.confirmed_at AT TIME ZONE 'utc'::text)::date)::numeric > l.raw_idle_days
            AND NOT (EXISTS ( SELECT 1
                   FROM kirim_lines klp
                  WHERE klp.serial = r.serial AND klp.process = 'rezka'::text))
        ), moyka_not_returned AS (
         SELECT 'moyka_not_returned'::text AS wip_kind,
            ms_first.serial AS row_key,
            ms_first.serial,
            NULL::uuid AS request_id,
            ko.owner_id,
            kl.type_id,
            CURRENT_DATE - ms_first.first_sent_date AS days_waiting,
            l.moyka_idle_days::integer AS threshold_days,
            kl.partiya_no
           FROM ( SELECT moyka_sends.serial,
                    min(moyka_sends.sent_date) AS first_sent_date
                   FROM moyka_sends
                  GROUP BY moyka_sends.serial) ms_first
             JOIN kirim_lines kl ON kl.serial = ms_first.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             CROSS JOIN LATERAL kirim_line_state(ms_first.serial) kls(qabul_qilingan, omborda_qoldi, moykaga_yuborilgan, moykada, moykadan_chiqgan, xom_jonatilgan, olib_ketilgan)
             CROSS JOIN limits l
          WHERE kls.moykada > 0::numeric AND ko.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - ms_first.first_sent_date)::numeric > l.moyka_idle_days
            AND kl.process <> 'rezka'::text
        ), awaiting_lab AS (
         SELECT 'awaiting_lab'::text AS wip_kind,
            wc.serial AS row_key,
            wc.serial,
            NULL::uuid AS request_id,
            ko.owner_id,
            kl.type_id,
            CURRENT_DATE - ms_first.sent_date AS days_waiting,
            l.tahlil_kechikdi_days::integer AS threshold_days,
            kl.partiya_no
           FROM wash_cycles wc
             JOIN kirim_lines kl ON kl.serial = wc.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             JOIN LATERAL ( SELECT min(ms2.sent_date) AS sent_date
                   FROM moyka_sends ms2
                  WHERE ms2.serial = wc.serial) ms_first ON true
             CROSS JOIN limits l
          WHERE NOT (EXISTS ( SELECT 1
                   FROM lab_results lr
                  WHERE lr.scope = 'chiqim'::direction AND lr.wash_cycle_id = wc.id)) AND ko.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - ms_first.sent_date)::numeric > l.tahlil_kechikdi_days
            AND kl.process <> 'rezka'::text
        ), so2_pending AS (
         SELECT 'so2_pending'::text AS wip_kind,
            wc.serial AS row_key,
            wc.serial,
            NULL::uuid AS request_id,
            ko.owner_id,
            kl.type_id,
            CURRENT_DATE - lr.sample_date AS days_waiting,
            l.sulfur_overdue_days::integer AS threshold_days,
            kl.partiya_no
           FROM wash_cycles wc
             JOIN kirim_lines kl ON kl.serial = wc.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             JOIN LATERAL ( SELECT lr2.sample_date,
                    lr2.status
                   FROM lab_results lr2
                  WHERE lr2.scope = 'chiqim'::direction AND lr2.wash_cycle_id = wc.id
                  ORDER BY lr2.created_at DESC
                 LIMIT 1) lr ON true
             CROSS JOIN limits l
          WHERE lr.status = 'moisture_in'::text AND kl.is_sulfured IS DISTINCT FROM false AND ko.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - lr.sample_date)::numeric > l.sulfur_overdue_days
            AND kl.process <> 'rezka'::text
        ), chiqim_open AS (
         SELECT 'chiqim_open'::text AS wip_kind,
            cr.id::text AS row_key,
            NULL::text AS serial,
            cr.id AS request_id,
            cr.owner_id,
            NULL::uuid AS type_id,
            CURRENT_DATE - (cr.created_at AT TIME ZONE 'utc'::text)::date AS days_waiting,
            l.chiqim_idle_days::integer AS threshold_days,
            NULL::integer AS partiya_no
           FROM chiqim_requests cr
             LEFT JOIN LATERAL ( SELECT chiqim_departed_at(cr.id) AS completed_at) cgw ON true
             CROSS JOIN limits l
          WHERE NOT (cr.ombor_finished_at IS NOT NULL AND cgw.completed_at IS NOT NULL) AND cr.plate !~~ 'TEST-%'::text AND (CURRENT_DATE - (cr.created_at AT TIME ZONE 'utc'::text)::date)::numeric > l.chiqim_idle_days
        ), provisional_weight AS (
         SELECT 'provisional_weight'::text AS wip_kind,
            r.row_key,
            r.serial,
            NULL::uuid AS request_id,
            r.owner_id,
            r.type_id,
            NULL::integer AS days_waiting,
            NULL::integer AS threshold_days,
            r.partiya_no
           FROM report_kirim_rows r
          WHERE r.provisional
        )
 SELECT raw_not_sent.wip_kind,
    raw_not_sent.row_key,
    raw_not_sent.serial,
    raw_not_sent.request_id,
    raw_not_sent.owner_id,
    raw_not_sent.type_id,
    raw_not_sent.days_waiting,
    raw_not_sent.threshold_days,
    raw_not_sent.partiya_no
   FROM raw_not_sent
UNION ALL
 SELECT moyka_not_returned.wip_kind,
    moyka_not_returned.row_key,
    moyka_not_returned.serial,
    moyka_not_returned.request_id,
    moyka_not_returned.owner_id,
    moyka_not_returned.type_id,
    moyka_not_returned.days_waiting,
    moyka_not_returned.threshold_days,
    moyka_not_returned.partiya_no
   FROM moyka_not_returned
UNION ALL
 SELECT awaiting_lab.wip_kind,
    awaiting_lab.row_key,
    awaiting_lab.serial,
    awaiting_lab.request_id,
    awaiting_lab.owner_id,
    awaiting_lab.type_id,
    awaiting_lab.days_waiting,
    awaiting_lab.threshold_days,
    awaiting_lab.partiya_no
   FROM awaiting_lab
UNION ALL
 SELECT so2_pending.wip_kind,
    so2_pending.row_key,
    so2_pending.serial,
    so2_pending.request_id,
    so2_pending.owner_id,
    so2_pending.type_id,
    so2_pending.days_waiting,
    so2_pending.threshold_days,
    so2_pending.partiya_no
   FROM so2_pending
UNION ALL
 SELECT chiqim_open.wip_kind,
    chiqim_open.row_key,
    chiqim_open.serial,
    chiqim_open.request_id,
    chiqim_open.owner_id,
    chiqim_open.type_id,
    chiqim_open.days_waiting,
    chiqim_open.threshold_days,
    chiqim_open.partiya_no
   FROM chiqim_open
UNION ALL
 SELECT provisional_weight.wip_kind,
    provisional_weight.row_key,
    provisional_weight.serial,
    provisional_weight.request_id,
    provisional_weight.owner_id,
    provisional_weight.type_id,
    provisional_weight.days_waiting,
    provisional_weight.threshold_days,
    provisional_weight.partiya_no
   FROM provisional_weight;
