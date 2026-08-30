-- Prompt 12: CHIQIM truck type (Odatiy / Fura). A fura is too big for the
-- factory's gate scale, so it is never weighed there -- the gate stage is
-- skipped entirely and Ombor's own loading figures are the whole record of
-- the trip. CHIQIM only; KIRIM is untouched (explicitly out of scope).
--
-- ============================================================
-- What the pre-coding investigation actually found (CLAUDE.md: inspect the
-- live schema, do not assume). Three findings changed the design:
--
-- 1. THERE IS NO `chiqim_lines.loaded_kg`. The task described Fura's
--    accounting weight as `sum(chiqim_lines.loaded_kg)`; that column does
--    not exist and never has. Ombor's actual loaded kg is not stored on the
--    line at all -- it is the ledger rows the finish click writes, and it
--    lands in THREE different tables depending on line_kind (confirmed
--    against OmborChiqimTab.tsx's own handleFinish and each table's live
--    schema):
--      finished / old_washed -> chiqim_pallet_consumption.qty_kg
--                               (FIFO-attributed by attribute_chiqim_line_fifo)
--      raw / old_raw         -> raw_dispatch_lines.net_kg
--      old_kn                -> old_kn_collections.collected_kg
--    `chiqim_request_loaded_kg()` below is the single place that sum is
--    expressed, so no surface re-derives it (CLAUDE.md "one derived truth,
--    all consumers"). Nothing is stored -- same discipline as effective_qty.
--
-- 2. NO CHIQIM READ PATH HAS EVER USED `gate_weighings.net_kg` AS A VALUE.
--    The task asked whether reports' CHIQIM "accounting weight" is the gate
--    net, and whether Fura needs a replacement for it. It is not, and it
--    does not. Every CHIQIM quantity in every report already comes from the
--    per-pallet/per-draw ledgers above (verified by reading all 14 live view
--    and function definitions that reference gate_weighings). CHIQIM's gate
--    net is exactly what SPEC 5.4 says it is -- an informational
--    reconciliation check, never a value source. So Fura needs no weight
--    substitute anywhere: its weights are already right, unchanged.
--
--    What the gate DOES supply, and what Fura therefore breaks, is the
--    DEPARTURE EVENT: `gate_weighings.completed_at` is read as both "has
--    this load left?" and "on what date?" in ten separate places. With no
--    gate row a Fura dispatch would, silently and permanently: leave its
--    pallets stuck in `band_qilingan` (reserved, never departed) in
--    stock_on_hand_rows/report_chiqim_rows, count 0 against
--    kirim_line_state.olib_ketilgan, never appear in the client report or
--    the Rahbar ledger, never satisfy an old-stock close-out, and sit in
--    Diqqat talab as "Jo'natish kechikdi" forever. That -- not the weight --
--    is the whole substance of this migration's read-path half.
--
--    `chiqim_departed_at(request_id)` is the one canonical answer:
--    gate stage 2's completed_at for a regular truck, ombor_finished_at for
--    a fura. All ten call sites now go through it. None of them re-derives
--    the branch, and no read path anywhere still asks gate_weighings
--    directly whether a CHIQIM load departed. The passport's own
--    dispatch_gate CTE is the deliberate exception: it renders the physical
--    gate record itself (weights, photos, who weighed) and must keep
--    showing exactly that -- null throughout for a fura, which is the
--    truthful answer, and which the new truckType field lets the UI label.
--
-- 3. THE APP DOES NOT CALL `finalize_chiqim_dispatch`. That RPC exists and
--    would have been the natural place to hang the Fura completion, but
--    OmborChiqimTab.tsx calls attribute_chiqim_line_fifo per line and then
--    UPDATEs chiqim_requests.ombor_finished_at directly (via the open
--    `ombor_updates` policy). Flagged, not fixed -- the dead RPC is left
--    exactly as it is (out of scope). The consequence for this migration is
--    that the completion hook MUST sit on chiqim_requests itself, not
--    inside that RPC, or it would never fire.
-- ============================================================
--
-- DECISIONS SURFACED (each was called out as a pick in the task):
--
-- * Fura's completing event = Ombor's finish click (ombor_finished_at), not
--   a new "Yuborildi" button. No new operator action exists or is needed.
--   Implemented as a BEFORE UPDATE trigger on chiqim_requests that sets
--   status = 'olib_ketildi' in the same statement. This deliberately
--   differs in shape from complete_chiqim_stage2 (AFTER UPDATE + a separate
--   UPDATE) for one concrete reason: that trigger writes to a DIFFERENT
--   table than the one it fires on, while this one writes the same row, and
--   a BEFORE trigger assigning NEW avoids both the second UPDATE and the
--   re-entrancy that comes with it.
--
-- * Fura's accounting weight = summed on read, never stored. See
--   chiqim_request_loaded_kg. No new column, no new balance arithmetic --
--   it is a per-request total of ledger rows that already exist.
--
-- * Qorovul's CHIQIM gate queue: a fura NEVER enters Window 1 (Faol). A
--   row a guard can see but can never action would sit in his work queue
--   forever -- worse than not showing it. It appears in Window 2
--   (Yakunlangan) as a read-only courtesy record once Ombor finishes,
--   marked "Fura - o'lchovsiz", showing the loaded total in place of a gate
--   net. That placement is free: Window 2's existing membership test is
--   `status <> 'kutilmoqda'`, which the completion trigger above satisfies
--   the moment the load is finished. Frontend, QorovulChiqimTab.tsx.
--
-- * UNDO WINDOW -- documented explicitly, as required, because it is a
--   consequence rather than a separate mechanism. Ombor's undo of a
--   consumption row is gated by the `ombor_deletes` RLS policy on
--   chiqim_pallet_consumption, whose predicate is
--   `chiqim_requests.status IN ('kutilmoqda','qabul_qilindi')`. For a
--   regular truck that window closes when gate stage 2 flips the status --
--   unchanged by this migration. For a fura, the same policy, untouched,
--   closes it at Ombor's finish click, because that is when the status
--   flips. So "undo closes at Ombor's finish click for Fura" needs no new
--   policy and no new code: it falls out of reusing the same status. This
--   migration adds nothing to the undo path and removes nothing from it.
--
--   Flagged, NOT silently reconciled (CLAUDE.md scope discipline): the
--   task's own test list asks to "verify consumption rows reversed" after
--   finishing and immediately voiding a fura. That cannot hold alongside
--   the requirement above -- the undo window and the void window both close
--   at the same click (Menejer's `menejer_updates` policy already requires
--   `ombor_finished_at IS NULL`, so a finished request cannot be voided
--   either, fura or not). The requirement was implemented as written and
--   the e2e test asserts the real behaviour: after a fura finish, the undo
--   is refused. Widening it would be a one-line policy change, deliberately
--   not made here.
--
-- * truck_type is immutable once written (own trigger, defense in depth
--   alongside the fact that Menejer's ChiqimForm has no edit path for it --
--   FinishedChiqimList's Tahrirlash touches only date/plate/driver). Same
--   shape as the partiya_no immutability precedent.
--
-- Origin filtering (CLAUDE.md): nothing here reads a KIRIM material
-- timestamp or lists inbound work -- every touched object is CHIQIM-side or
-- keeps its existing kirim_orders.origin handling byte-for-byte. The four
-- objects that do carry an origin filter (report_chiqim_rows,
-- report_moyka_output_rows, stock_on_hand_rows, wip_rows) are reproduced
-- verbatim apart from the departure lookup, so their filters are unchanged.
--
-- Every object below was extracted verbatim from the migration that last
-- defined it (0091/0094/0101/0102) and mechanically patched at the
-- departure lookup only, so nothing else can have drifted in transcription.

-- ============================================================
-- 1. chiqim_requests.truck_type + its immutability guard.
-- ============================================================
alter table public.chiqim_requests
  add column truck_type text not null default 'regular'
  check (truck_type in ('regular', 'fura'));

create or replace function public.enforce_chiqim_truck_type_immutable()
returns trigger
language plpgsql
as $function$
begin
  if new.truck_type is distinct from old.truck_type then
    raise exception 'Transport turini keyinchalik o''zgartirib bo''lmaydi'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger chiqim_requests_truck_type_immutable
  before update on public.chiqim_requests
  for each row execute function public.enforce_chiqim_truck_type_immutable();

-- ============================================================
-- 2. Fura completion. Ombor's finish click IS the departure for a truck
--    the gate never weighs, so the status flip Qorovul's stage 2 performs
--    for a regular truck happens here instead. BEFORE UPDATE on the same
--    row (see the header note on why this differs from
--    complete_chiqim_stage2's shape).
--
--    Guarded on the ombor_finished_at transition, not merely on its
--    value, so re-saving an already-finished request can never re-flip a
--    status that has since moved on. A regular truck is untouched by this
--    trigger entirely -- its path through complete_chiqim_stage2 is
--    unchanged, which is the "no change to the Regular gate flow"
--    requirement enforced structurally rather than by convention.
-- ============================================================
create or replace function public.complete_chiqim_fura()
returns trigger
language plpgsql
as $function$
begin
  if new.truck_type = 'fura'
     and new.ombor_finished_at is not null
     and old.ombor_finished_at is null
     and old.status = 'kutilmoqda' then
    new.status := 'olib_ketildi';
  end if;
  return new;
end;
$function$;

create trigger chiqim_requests_complete_fura
  before update on public.chiqim_requests
  for each row execute function public.complete_chiqim_fura();

-- ============================================================
-- 3. chiqim_departed_at -- the canonical "has this CHIQIM load left, and
--    when" answer, and the only place the regular/fura branch is written.
--    Returns null while the load is still here, under either truck type.
--
--    `stable` + plain sql so Postgres can inline it into the ten call
--    sites below rather than treating it as an opaque per-row call.
-- ============================================================
create or replace function public.chiqim_departed_at(p_request_id uuid)
returns timestamptz
language sql
stable
as $function$
  select case
    when cr.truck_type = 'fura' then cr.ombor_finished_at
    else (
      select gw.completed_at
      from public.gate_weighings gw
      where gw.dir = 'chiqim' and gw.request_id = cr.id
      order by gw.completed_at desc nulls last
      limit 1
    )
  end
  from public.chiqim_requests cr
  where cr.id = p_request_id;
$function$;

-- ============================================================
-- 4. chiqim_request_loaded_kg -- what Ombor actually loaded on this trip,
--    summed on read from the three ledgers that already record it (see
--    header finding 1). This is the figure a fura shows where a regular
--    truck shows its gate net; it is equally correct for a regular truck
--    (that is what the gate reconciles AGAINST), so nothing branches on
--    truck_type here.
--
--    Not a new balance: every term is an existing ledger already summed
--    this way elsewhere. Deliberately unfiltered by pallet status -- these
--    are dispatch events, and a consumption row's existence is the event.
-- ============================================================
create or replace function public.chiqim_request_loaded_kg(p_request_id uuid)
returns numeric
language sql
stable
as $function$
  select
    coalesce((
      select sum(c.qty_kg) from public.chiqim_pallet_consumption c
      join public.chiqim_lines cl on cl.id = c.chiqim_line_id
      where cl.request_id = p_request_id
    ), 0)
  + coalesce((
      select sum(r.net_kg) from public.raw_dispatch_lines r
      join public.chiqim_lines cl on cl.id = r.chiqim_line_id
      where cl.request_id = p_request_id
    ), 0)
  + coalesce((
      select sum(k.collected_kg) from public.old_kn_collections k
      join public.chiqim_lines cl on cl.id = k.chiqim_line_id
      where cl.request_id = p_request_id
    ), 0);
$function$;

-- ============================================================
-- 4b. chiqim_request_totals -- the two derived per-request facts above,
--     exposed to PostgREST as one selectable row per request so a client
--     screen can read them in ONE round trip instead of an rpc() call per
--     visible row. No logic of its own: it is a projection of the two
--     functions, so Qorovul's Yakunlangan card, Hisobot's Fura badge and
--     the SQL read paths can never disagree about either figure.
--
--     security_invoker = true, per 0084's finding: a view defaults to
--     evaluating RLS as its OWNER (postgres, rolbypassrls), which would
--     hand every request's totals to a 'client' caller regardless of
--     owner scoping. Every view in this file's read-path half already
--     carries this; a new one must not be the exception.
-- ============================================================
create or replace view public.chiqim_request_totals as
  select
    cr.id as request_id,
    cr.truck_type,
    chiqim_request_loaded_kg(cr.id) as loaded_kg,
    chiqim_departed_at(cr.id) as departed_at
  from public.chiqim_requests cr;

alter view public.chiqim_request_totals set (security_invoker = true);

-- ============================================================
-- 5. kirim_line_state -- FOUNDATIONAL, same as 0101: `olib_ketilgan` is the
--    figure that means "actually departed". Hisobot's own state_olib_ketilgan
--    and the client report's state columns both join this function, so both
--    inherit the fura fix for free and are not touched separately.
-- ============================================================
create or replace function public.kirim_line_state(p_serial text)
 returns table(qabul_qilingan numeric, omborda_qoldi numeric, moykaga_yuborilgan numeric, moykada numeric, moykadan_chiqgan numeric, xom_jonatilgan numeric, olib_ketilgan numeric)
 language sql
 stable
as $function$
  with eq as (
    select kirim_line_effective_qty(p_serial) as v
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as v from moyka_sends where serial = p_serial
  ),
  rezka_sent as (
    select coalesce(sum(qty_kg), 0) as v from rezka_sends where serial = p_serial
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
  closed as (
    select wc.closed_at is not null as v from wash_cycles wc where wc.serial = p_serial
  ),
  departed as (
    select coalesce(sum(c.qty_kg), 0) as v
    from chiqim_pallet_consumption c
    join base_pallets bp on bp.barcode2 = c.barcode2
    join chiqim_lines cl on cl.id = c.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where chiqim_departed_at(cr.id) is not null
  )
  select
    eq.v as qabul_qilingan,
    greatest(0, eq.v - sent.v - rezka_sent.v - raw_disp.v) as omborda_qoldi,
    sent.v as moykaga_yuborilgan,
    case when coalesce((select v from closed), false) then 0 else greatest(0, sent.v - moyka_out.v) end as moykada,
    moyka_out.v as moykadan_chiqgan,
    raw_disp.v as xom_jonatilgan,
    departed.v as olib_ketilgan
  from eq, sent, rezka_sent, raw_disp, moyka_out, departed;
$function$;

-- ============================================================
-- 6. report_chiqim_rows -- Hisobot's CHIQIM rows. Drives the
--    jonatilgan / band_qilingan distinction. qty_kg is fp.weight_kg and was
--    never gate-sourced (header finding 2), so no quantity changes here.
-- ============================================================
create or replace view public.report_chiqim_rows as
select 'chiqim'::text as kind,
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    kl.order_id,
    latest.request_id,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    coalesce(cr.plate, ''::text) as plate,
    coalesce(cr.driver, ''::text) as driver,
    cr.request_date as date_basis,
    null::text as date_basis_source,
    fp.weight_kg as qty_kg,
    false as provisional,
    null::numeric as declared_qty,
    null::numeric as truck_variance_diff_kg,
    null::numeric as truck_variance_diff_pct,
    false as provisional_variance_flag,
    null::integer as wash_cycle,
    case
        when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
        when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
        when fp.status = 'storage_loss'::pallet_status then 'saqlashda_yoqolgan'::text
        when coalesce(consumed.departed_kg, 0) >= fp.weight_kg then 'jonatilgan'::text
        when coalesce(consumed.departed_kg, 0) > 0 or coalesce(consumed.pending_kg, 0) > 0 then 'band_qilingan'::text
        else 'omborda'::text
    end as pallet_status,
    lr.verdict as lab_verdict,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    lr.moisture_pct,
    lr.so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    kl.partiya_no
   from finished_pallets fp
     join kirim_lines kl on kl.serial = fp.serial
     join kirim_orders ko on ko.order_id = kl.order_id
     left join lateral (
       select
         sum(c.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
         sum(c.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
       from chiqim_pallet_consumption c
       join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
       join chiqim_requests cr2 on cr2.id = cl2.request_id
       left join lateral (
         -- Fura (0104): a fura request has no gate row at all, so the
         -- canonical departure timestamp comes from chiqim_departed_at,
         -- never a direct gate lookup.
         select chiqim_departed_at(cr2.id) as completed_at
       ) cgwx on true
       where c.barcode2 = fp.barcode2
     ) consumed on true
     left join lateral (
       select cl3.request_id
       from chiqim_pallet_consumption c3
       join chiqim_lines cl3 on cl3.id = c3.chiqim_line_id
       where c3.barcode2 = fp.barcode2
       order by c3.created_at desc limit 1
     ) latest on true
     left join chiqim_requests cr on cr.id = latest.request_id
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial
         limit 1) wc on true
     left join lateral ( select lr3.verdict,
            lr3.moisture_pct,
            lr3.so2_mg_kg
           from lab_results lr3
          where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
          order by lr3.created_at desc
         limit 1) lr on true
  where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;

-- ============================================================
-- 7. report_moyka_output_rows -- identical departure lookup, identical edit.
-- ============================================================
create or replace view public.report_moyka_output_rows as
 select 'moyka_output'::text as kind,
    'moyka-output-'::text || fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    kl.order_id,
    latest.request_id,
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
            when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
            when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
            when fp.status = 'storage_loss'::pallet_status then 'saqlashda_yoqolgan'::text
            when coalesce(consumed.departed_kg, 0) >= fp.weight_kg then 'jonatilgan'::text
            when coalesce(consumed.departed_kg, 0) > 0 or coalesce(consumed.pending_kg, 0) > 0 then 'band_qilingan'::text
            else 'omborda'::text
        end as pallet_status,
    lr.verdict as lab_verdict,
    kl.target_moisture_pct,
    kl.target_so2_mg_kg,
    lr.moisture_pct,
    lr.so2_mg_kg,
    null::text[] as void_successor_barcodes,
    null::numeric as box_mass_kg,
    kl.partiya_no
   from finished_pallets fp
     join kirim_lines kl on kl.serial = fp.serial
     join kirim_orders ko on ko.order_id = kl.order_id
     left join lateral (
       select
         sum(c.qty_kg) filter (where cgwx.completed_at is not null) as departed_kg,
         sum(c.qty_kg) filter (where cgwx.completed_at is null) as pending_kg
       from chiqim_pallet_consumption c
       join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
       join chiqim_requests cr2 on cr2.id = cl2.request_id
       left join lateral (
         -- Fura (0104): a fura request has no gate row at all, so the
         -- canonical departure timestamp comes from chiqim_departed_at,
         -- never a direct gate lookup.
         select chiqim_departed_at(cr2.id) as completed_at
       ) cgwx on true
       where c.barcode2 = fp.barcode2
     ) consumed on true
     left join lateral (
       select cl3.request_id
       from chiqim_pallet_consumption c3
       join chiqim_lines cl3 on cl3.id = c3.chiqim_line_id
       where c3.barcode2 = fp.barcode2
       order by c3.created_at desc limit 1
     ) latest on true
     left join lateral ( select wc2.id
           from wash_cycles wc2
          where wc2.serial = fp.serial
         limit 1) wc on true
     left join lateral ( select lr2.verdict,
            lr2.moisture_pct,
            lr2.so2_mg_kg
           from lab_results lr2
          where lr2.scope = 'chiqim'::direction and lr2.wash_cycle_id = wc.id
          order by lr2.created_at desc
         limit 1) lr on true
  where ko.plate !~~ 'TEST-%'::text;

-- ============================================================
-- 8. stock_on_hand_rows -- departed vs. reserved (band_qilingan). Without
--    this a fura's pallets would stay reserved-but-never-gone forever.
-- ============================================================
create or replace view public.stock_on_hand_rows as
 WITH pallet_base AS (
         SELECT fp.barcode2,
            fp.serial,
            ko.owner_id,
            fp.type_id,
            kl.partiya_no,
            fp.calibre_id,
            fp.received_date,
            fp.is_old_stock,
            fp.weight_is_estimate,
            lr.verdict,
            lr.moisture_pct AS lab_moisture_pct,
            wc.id AS wash_cycle_id
           FROM finished_pallets fp
             JOIN kirim_lines kl ON kl.serial = fp.serial
             JOIN kirim_orders ko ON ko.order_id = kl.order_id
             LEFT JOIN LATERAL ( SELECT wc2.id
                   FROM wash_cycles wc2
                  WHERE wc2.serial = fp.serial
                 LIMIT 1) wc ON true
             LEFT JOIN LATERAL ( SELECT lr3.verdict,
                    lr3.moisture_pct
                   FROM lab_results lr3
                  WHERE lr3.scope = 'chiqim'::direction AND lr3.wash_cycle_id = wc.id
                  ORDER BY lr3.created_at DESC
                 LIMIT 1) lr ON true
          WHERE fp.status = 'in_stock'::pallet_status AND ko.plate !~~ 'TEST-%'::text
        ), lab_bucketed AS (
         SELECT
                CASE
                    WHEN pallet_base.verdict = 'qayta_yuvish'::text THEN 'qayta_yuvish'::text
                    WHEN pallet_base.verdict IS NULL THEN 'awaiting_lab'::text
                    ELSE NULL::text
                END AS forced_bucket,
            pallet_base.barcode2,
            pallet_base.serial,
            pallet_base.owner_id,
            pallet_base.type_id,
            pallet_base.partiya_no,
            pallet_base.calibre_id,
            pallet_base.received_date,
            pallet_base.is_old_stock,
            pallet_base.weight_is_estimate,
            pallet_base.lab_moisture_pct
           FROM pallet_base
        ), consumed_by_pallet AS (
         SELECT c.barcode2,
            sum(c.qty_kg) FILTER (WHERE cgw.completed_at IS NOT NULL) AS departed_kg,
            sum(c.qty_kg) FILTER (WHERE cgw.completed_at IS NULL) AS pending_kg
           FROM chiqim_pallet_consumption c
             JOIN chiqim_lines cl ON cl.id = c.chiqim_line_id
             JOIN chiqim_requests cr ON cr.id = cl.request_id
             -- Fura (0104): departure comes via chiqim_departed_at, which
             -- falls back to ombor_finished_at when no gate row exists.
             LEFT JOIN LATERAL ( SELECT chiqim_departed_at(cr.id) AS completed_at) cgw ON true
          WHERE cr.plate !~~ 'TEST-%'::text
          GROUP BY c.barcode2
        ), pallet_qty AS (
         SELECT fp.barcode2,
            fp.weight_kg,
            COALESCE(cbp.departed_kg, 0::numeric) AS departed_kg,
            COALESCE(cbp.pending_kg, 0::numeric) AS pending_kg
           FROM finished_pallets fp
             LEFT JOIN consumed_by_pallet cbp ON cbp.barcode2 = fp.barcode2
        ), pallet_rows AS (
         SELECT COALESCE(lb.forced_bucket, 'available'::text) AS bucket,
            lb.barcode2 AS row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            GREATEST(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg) AS qty_kg,
            lb.received_date AS anchor_date,
            lb.lab_moisture_pct AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no
           FROM lab_bucketed lb
             JOIN pallet_qty pq ON pq.barcode2 = lb.barcode2
          WHERE GREATEST(0::numeric, pq.weight_kg - pq.departed_kg - pq.pending_kg) > 0::numeric OR lb.forced_bucket IS NOT NULL
        UNION ALL
         SELECT 'band_qilingan'::text AS bucket,
            lb.barcode2 || ':band'::text AS row_key,
            lb.serial,
            lb.barcode2,
            lb.owner_id,
            lb.type_id,
            lb.calibre_id,
            pq.pending_kg AS qty_kg,
            lb.received_date AS anchor_date,
            lb.lab_moisture_pct AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            lb.is_old_stock,
            lb.weight_is_estimate,
            lb.partiya_no
           FROM lab_bucketed lb
             JOIN pallet_qty pq ON pq.barcode2 = lb.barcode2
          WHERE lb.forced_bucket IS NULL AND pq.pending_kg > 0::numeric
        ), raw_rows AS (
         SELECT 'raw_not_washed'::text AS bucket,
            r.row_key,
            r.serial,
            NULL::text AS barcode2,
            r.owner_id,
            r.type_id,
            NULL::uuid AS calibre_id,
            r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric) AS qty_kg,
            r.date_basis AS anchor_date,
            kirim_lr.moisture_pct,
            r.box_mass_kg,
            r.origin = 'opening_stock'::text AS is_old_stock,
            false AS weight_is_estimate,
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
             LEFT JOIN LATERAL ( SELECT lr4.moisture_pct
                   FROM lab_results lr4
                  WHERE lr4.scope = 'kirim'::direction AND lr4.parent_serial = r.serial
                  ORDER BY lr4.created_at DESC
                 LIMIT 1) kirim_lr ON true
          WHERE (r.qty_kg - COALESCE(sent.total_sent, 0::numeric) - COALESCE(rezka.total_rezka_sent, 0::numeric) - COALESCE(raw.total_raw, 0::numeric)) > 0::numeric AND NOT (EXISTS ( SELECT 1
                   FROM old_stock_closeouts osc
                  WHERE osc.kind = 'old_raw'::text AND osc.owner_id = r.owner_id AND osc.type_id = r.type_id))
        ), old_kn_rows AS (
         SELECT 'old_kn'::text AS bucket,
            p.id::text AS row_key,
            NULL::text AS serial,
            NULL::text AS barcode2,
            p.owner_id,
            p.type_id,
            NULL::uuid AS calibre_id,
            p.opening_kg - COALESCE(c.collected, 0::numeric) - COALESCE(m.minted, 0::numeric) AS qty_kg,
            NULL::date AS anchor_date,
            NULL::numeric AS moisture_pct,
            NULL::numeric AS box_mass_kg,
            true AS is_old_stock,
            NULL::boolean AS weight_is_estimate,
            NULL::int AS partiya_no
           FROM old_kn_pools p
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(oc.collected_kg), 0::numeric) AS collected
                   FROM old_kn_collections oc
                  WHERE oc.pool_id = p.id) c ON true
             LEFT JOIN LATERAL ( SELECT COALESCE(sum(sms.weight_kg), 0::numeric) AS minted
                   FROM serial_mint_sources sms
                  WHERE sms.source_kind = 'weight_pool'::text AND sms.source_pool_id = p.id) m ON true
          WHERE (p.opening_kg - COALESCE(c.collected, 0::numeric) - COALESCE(m.minted, 0::numeric)) > 0::numeric AND p.closed_at IS NULL
        )
 SELECT pallet_rows.bucket,
    pallet_rows.row_key,
    pallet_rows.serial,
    pallet_rows.barcode2,
    pallet_rows.owner_id,
    pallet_rows.type_id,
    pallet_rows.calibre_id,
    pallet_rows.qty_kg,
    pallet_rows.anchor_date,
    CURRENT_DATE - pallet_rows.anchor_date AS days_held,
    (CURRENT_DATE - pallet_rows.anchor_date) > 90 AS aged_90,
    pallet_rows.moisture_pct,
    pallet_rows.box_mass_kg,
    pallet_rows.is_old_stock,
    pallet_rows.weight_is_estimate,
    pallet_rows.partiya_no
   FROM pallet_rows
UNION ALL
 SELECT raw_rows.bucket,
    raw_rows.row_key,
    raw_rows.serial,
    raw_rows.barcode2,
    raw_rows.owner_id,
    raw_rows.type_id,
    raw_rows.calibre_id,
    raw_rows.qty_kg,
    raw_rows.anchor_date,
    CURRENT_DATE - raw_rows.anchor_date AS days_held,
    (CURRENT_DATE - raw_rows.anchor_date) > 90 AS aged_90,
    raw_rows.moisture_pct,
    raw_rows.box_mass_kg,
    raw_rows.is_old_stock,
    raw_rows.weight_is_estimate,
    raw_rows.partiya_no
   FROM raw_rows
UNION ALL
 SELECT old_kn_rows.bucket,
    old_kn_rows.row_key,
    old_kn_rows.serial,
    old_kn_rows.barcode2,
    old_kn_rows.owner_id,
    old_kn_rows.type_id,
    old_kn_rows.calibre_id,
    old_kn_rows.qty_kg,
    old_kn_rows.anchor_date,
    NULL::integer AS days_held,
    false AS aged_90,
    old_kn_rows.moisture_pct,
    old_kn_rows.box_mass_kg,
    old_kn_rows.is_old_stock,
    old_kn_rows.weight_is_estimate,
    old_kn_rows.partiya_no
   FROM old_kn_rows;

-- ============================================================
-- 9. wip_rows -- chiqim_open ("Jo'natish kechikdi"). A finished fura must
--    drop out of Diqqat talab; on the old test it never could.
-- ============================================================
create or replace view public.wip_rows as
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
        ), chiqim_open AS (
         SELECT 'chiqim_open'::text AS wip_kind,
            cr.id::text AS row_key,
            NULL::text AS serial,
            cr.id AS request_id,
            cr.owner_id,
            NULL::uuid AS type_id,
            CURRENT_DATE - (cr.created_at AT TIME ZONE 'utc'::text)::date AS days_waiting,
            l.chiqim_idle_days::integer AS threshold_days,
            NULL::int AS partiya_no
           FROM chiqim_requests cr
             -- Fura (0104): departure comes via chiqim_departed_at, which
             -- falls back to ombor_finished_at when no gate row exists.
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

-- ============================================================
-- 10. old_stock_closeout_lines -- old-stock collected/remaining split.
-- ============================================================
create or replace view public.old_stock_closeout_lines as
 with old_washed_lines as (
         select 'old_washed'::text as kind,
            ko.owner_id,
            fp.type_id,
            sum(fp.weight_kg) as opening_kg,
            sum(fp.weight_kg) filter (where not (fp.status = 'in_stock'::pallet_status and coalesce(dep.departed_kg, 0) = 0)) as collected_kg,
            sum(fp.weight_kg) filter (where fp.status = 'in_stock'::pallet_status and coalesce(dep.departed_kg, 0) = 0) as remaining_kg
           from finished_pallets fp
             join kirim_lines kl on kl.serial = fp.serial
             join kirim_orders ko on ko.order_id = kl.order_id
             left join lateral (
               select sum(c.qty_kg) as departed_kg
               from chiqim_pallet_consumption c
               join chiqim_lines cl on cl.id = c.chiqim_line_id
               join chiqim_requests cr on cr.id = cl.request_id
               where c.barcode2 = fp.barcode2
                 and chiqim_departed_at(cr.id) is not null
             ) dep on true
          where fp.is_old_stock
          group by ko.owner_id, fp.type_id
        ), old_kn_lines as (
         select 'old_kn'::text as kind,
            p.owner_id,
            p.type_id,
            p.opening_kg,
            coalesce(( select sum(oc.collected_kg) as sum
                   from old_kn_collections oc
                  where oc.pool_id = p.id), 0::numeric) as collected_kg,
            greatest(0::numeric, p.opening_kg - coalesce(( select sum(oc.collected_kg) as sum
                   from old_kn_collections oc
                  where oc.pool_id = p.id), 0::numeric) - coalesce(( select sum(s.weight_kg) as sum
                   from serial_mint_sources s
                  where s.source_kind = 'weight_pool'::text and s.source_pool_id = p.id), 0::numeric)) as remaining_kg
           from old_kn_pools p
        ), old_raw_lines as (
         select 'old_raw'::text as kind,
            r.owner_id,
            r.type_id,
            sum(r.qty_kg) as opening_kg,
            sum(coalesce(sent.total_sent, 0::numeric) + coalesce(rezka.total_rezka_sent, 0::numeric) + coalesce(raw.total_raw, 0::numeric)) as collected_kg,
            sum(greatest(0::numeric, r.qty_kg - coalesce(sent.total_sent, 0::numeric) - coalesce(rezka.total_rezka_sent, 0::numeric) - coalesce(raw.total_raw, 0::numeric))) as remaining_kg
           from report_kirim_rows r
             join storage_intake si on si.serial = r.serial
             join kirim_orders rko on rko.order_id = r.order_id
             left join lateral ( select coalesce(sum(ms.qty_kg), 0::numeric) as total_sent
                   from moyka_sends ms
                  where ms.serial = r.serial) sent on true
             left join lateral ( select coalesce(sum(rs.qty_kg), 0::numeric) as total_rezka_sent
                   from rezka_sends rs
                  where rs.serial = r.serial) rezka on true
             left join lateral ( select coalesce(sum(rdl.net_kg), 0::numeric) as total_raw
                   from raw_dispatch_lines rdl
                  where rdl.serial = r.serial) raw on true
          where rko.origin = 'opening_stock'::text
          group by r.owner_id, r.type_id
        ), all_lines as (
         select old_washed_lines.kind,
            old_washed_lines.owner_id,
            old_washed_lines.type_id,
            old_washed_lines.opening_kg,
            old_washed_lines.collected_kg,
            old_washed_lines.remaining_kg
           from old_washed_lines
        union all
         select old_kn_lines.kind,
            old_kn_lines.owner_id,
            old_kn_lines.type_id,
            old_kn_lines.opening_kg,
            old_kn_lines.collected_kg,
            old_kn_lines.remaining_kg
           from old_kn_lines
        union all
         select old_raw_lines.kind,
            old_raw_lines.owner_id,
            old_raw_lines.type_id,
            old_raw_lines.opening_kg,
            old_raw_lines.collected_kg,
            old_raw_lines.remaining_kg
           from old_raw_lines
        )
 select al.kind,
    al.owner_id,
    al.type_id,
    al.opening_kg,
    al.collected_kg,
    al.remaining_kg,
    osc.closed_at,
    osc.book_remaining_kg as closed_book_remaining_kg,
    osc.closed_by
   from all_lines al
     left join old_stock_closeouts osc on osc.kind = al.kind and osc.owner_id = al.owner_id and osc.type_id = al.type_id;

-- ============================================================
-- 11. close_out_old_stock -- the write-off's own "already departed" test.
-- ============================================================
create or replace function public.close_out_old_stock(p_kind text, p_owner_id uuid, p_type_id uuid)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_remaining numeric;
begin
  if my_role() is distinct from 'menejer' then
    raise exception 'Faqat Menejer eski zaxirani yakunlay oladi' using errcode = '42501';
  end if;
  if p_kind not in ('old_washed', 'old_kn', 'old_raw') then
    raise exception 'Notoʻgʻri tur' using errcode = '22023';
  end if;
  if exists (select 1 from old_stock_closeouts where kind = p_kind and owner_id = p_owner_id and type_id = p_type_id) then
    raise exception 'Bu qator allaqachon yakunlangan' using errcode = '23505';
  end if;
  if p_kind = 'old_washed' then
    perform 1 from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
     order by fp.barcode2 for update of fp;
    select coalesce(sum(fp.weight_kg), 0) into v_remaining
      from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
       and not exists (
         select 1 from chiqim_pallet_consumption cpc3
         join chiqim_lines cl3 on cl3.id = cpc3.chiqim_line_id
         join chiqim_requests cr3 on cr3.id = cl3.request_id
         where cpc3.barcode2 = fp.barcode2
           and chiqim_departed_at(cr3.id) is not null
       );
    update finished_pallets fp set status = 'storage_loss', voided_at = now()
      from kirim_lines kl, kirim_orders ko
     where fp.serial = kl.serial and kl.order_id = ko.order_id
       and fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id;
  elsif p_kind = 'old_kn' then
    select p.opening_kg
         - coalesce((select sum(oc.collected_kg) from old_kn_collections oc where oc.pool_id = p.id), 0)
         - coalesce((select sum(s.weight_kg) from serial_mint_sources s where s.source_kind = 'weight_pool' and s.source_pool_id = p.id), 0)
      into v_remaining
      from old_kn_pools p
     where p.owner_id = p_owner_id and p.type_id = p_type_id and p.closed_at is null
     for update;
    if v_remaining is null then
      raise exception 'Havza topilmadi yoki allaqachon yakunlangan' using errcode = '23503';
    end if;
    update old_kn_pools set closed_at = now() where owner_id = p_owner_id and type_id = p_type_id;
  else -- old_raw
    select coalesce(sum(greatest(0, r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(rezka.total_rezka_sent, 0) - coalesce(raw.total_raw, 0))), 0)
      into v_remaining
      from report_kirim_rows r
      join storage_intake si on si.serial = r.serial
      join kirim_orders rko on rko.order_id = r.order_id
      left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
      left join lateral (select coalesce(sum(rs.qty_kg), 0) as total_rezka_sent from rezka_sends rs where rs.serial = r.serial) rezka on true
      left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
     where rko.owner_id = p_owner_id and r.type_id = p_type_id and rko.origin = 'opening_stock';
  end if;
  v_remaining := greatest(0, coalesce(v_remaining, 0));
  insert into old_stock_closeouts (kind, owner_id, type_id, book_remaining_kg, closed_by)
  values (p_kind, p_owner_id, p_type_id, v_remaining, v_actor);
  return v_remaining;
end;
$function$;

-- ============================================================
-- 12. get_serial_passport -- two departure gates, plus truckType/loadedKg/
--    departedAt on each dispatch so the passport can label a fura and show
--    its loaded total where a regular truck shows a gate net. dispatch_gate
--    itself is deliberately unchanged (header finding 2).
-- ============================================================
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
    and chiqim_departed_at(cr.id) is not null
),
finished_dispatched_by_calibre as (
  select cl.calibre_id, coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and chiqim_departed_at(cr.id) is not null
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
        'truckType', cr.truck_type,
        'loadedKg', chiqim_request_loaded_kg(cr.id),
        'departedAt', chiqim_departed_at(cr.id),
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

-- ============================================================
-- 13. get_client_report -- three departure lookups, plus truckType/loadedKg
--    on each dispatch entry.
-- ============================================================
create or replace function public.get_client_report(p_owner_id uuid, p_from date, p_to date)
 returns jsonb
 language sql
 stable
as $function$
with
client_lines as (
  select
    kl.serial, kl.type_id, kl.partiya_no, ko.plate, ko.driver, kl.target_moisture_pct, kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date, rkr.provisional, rkr.origin,
    (si.serial is not null) as has_intake,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_actual_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date between p_from and p_to) as sent_during_period_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date < p_from) as rezka_sent_before_from_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date <= p_to) as rezka_sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
    wc.id as wash_cycle_id,
    wc.closed_at,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date < p_from
    ) as closed_before_from,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date <= p_to
    ) as closed_as_of_to
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  left join storage_intake si
    on si.serial = kl.serial
   and si.confirmed_at is not null
   and (si.confirmed_at at time zone 'utc')::date <= p_to
  where ko.owner_id = p_owner_id
),
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake and not closed_before_from
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to and origin = 'delivery'
),
raw_sent_to_moyka_period_total as (
  select coalesce(sum(sent_during_period_kg), 0) as kg from client_lines
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
moykada_total as (
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg) end
  ), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
raw_processed_total as (
  select coalesce(sum(sent_capped_kg), 0) as kg from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to
),
raw_processed_actual_total as (
  select coalesce(sum(sent_actual_kg), 0) as kg from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to
),
capped_serials as (
  select serial, sent_actual_kg as actual_sent_kg, effective_qty as effective_qty_kg, sent_actual_kg - sent_capped_kg as overage_kg
  from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to and sent_actual_kg > sent_capped_kg
),
raw_types as (select distinct type_id from client_lines),
raw_opening_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake and not closed_before_from group by type_id
),
raw_received_by_type as (
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date between p_from and p_to and origin = 'delivery' group by type_id
),
raw_sent_to_moyka_by_type as (
  select type_id, coalesce(sum(sent_during_period_kg), 0) as kg from client_lines group by type_id
),
raw_closing_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to group by type_id
),
moykada_by_type as (
  select type_id, coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg) end
  ), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake group by type_id
),
raw_processed_by_type as (
  select type_id, coalesce(sum(sent_capped_kg), 0) as kg from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to group by type_id
),
raw_dispatch_events as (
  select rdl.id, rdl.serial, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, cl.type_id,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where cr.owner_id = p_owner_id
),
raw_dispatch_total as (
  select coalesce(sum(net_kg), 0) as kg from raw_dispatch_events where request_date between p_from and p_to
),
raw_dispatch_by_type as (
  select type_id, coalesce(sum(net_kg), 0) as kg from raw_dispatch_events
  where request_date between p_from and p_to group by type_id
),
old_kn_events as (
  select okc.id, okc.collected_kg, cl.type_id,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from old_kn_collections okc
  join old_kn_pools okp on okp.id = okc.pool_id
  join chiqim_lines cl on cl.id = okc.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where okp.owner_id = p_owner_id
),
old_kn_collected_total as (
  select coalesce(sum(collected_kg), 0) as kg from old_kn_events where request_date between p_from and p_to
),
storage_loss_events as (
  select osc.kind, osc.type_id, osc.book_remaining_kg, osc.closed_at
  from old_stock_closeouts osc
  where osc.owner_id = p_owner_id
),
storage_loss_total as (
  select coalesce(sum(book_remaining_kg), 0) as kg from storage_loss_events
  where (closed_at at time zone 'utc')::date between p_from and p_to
),
cumulative_storage_loss_total as (
  select coalesce(sum(book_remaining_kg), 0) as kg from old_stock_closeouts
  where kind = 'old_raw' and owner_id = p_owner_id and (closed_at at time zone 'utc')::date <= p_to
),
loss_totals as (
  select cl.serial, cl.sent_actual_kg
  from client_lines cl
  where cl.closed_at is not null and (cl.closed_at at time zone 'utc')::date between p_from and p_to
    and cl.origin != 'opening_stock'
),
loss_output as (
  select
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg
  from loss_totals lt
  join finished_pallets fp on fp.serial = lt.serial
  join calibres c on c.id = fp.calibre_id
  where fp.received_date <= p_to
),
loss_main as (
  select
    (select coalesce(sum(sent_actual_kg), 0) from loss_totals) as sent_kg,
    (select coalesce(calibre_kg, 0) from loss_output) as calibre_kg,
    (select coalesce(konditirskiy_kg, 0) from loss_output) as konditirskiy_kg
),
cumulative_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_output_total as (
  select coalesce(sum(output_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_loss_total as (
  select coalesce(sum(sent_as_of_to_kg - output_as_of_to_kg), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
cumulative_raw_dispatched_total as (
  select coalesce(sum(dispatched_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
client_pallet_base as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg, fp.received_date, ko.origin
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where ko.owner_id = p_owner_id
    and fp.received_date <= p_to
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2
        and (sms.created_at at time zone 'utc')::date <= p_to
    )
    and not (
      fp.status = 'bekor_qilindi'
      and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to)
    )
    and not (
      fp.status = 'storage_loss'
      and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to)
    )
),
client_pallet_departures as (
  -- One row per consumption portion whose OWN request's gate has completed
  -- by p_to -- a claimed-but-not-yet-gate-completed portion stays invisible
  -- here, matching the old dispatch_manifest-membership-alone-does-nothing
  -- behavior exactly.
  select
    c.barcode2,
    (cgw.completed_at at time zone 'utc')::date as departure_date,
    c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join client_pallet_base cpb on cpb.barcode2 = c.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
  where cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
),
client_pallet_departed_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from client_pallet_departures
  group by barcode2
),
client_pallets as (
  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    greatest(0, cpb.weight_kg - coalesce(cpdt.kg, 0)) as weight_kg,
    cpb.received_date, cpb.origin,
    null::date as departure_date
  from client_pallet_base cpb
  left join client_pallet_departed_total cpdt on cpdt.barcode2 = cpb.barcode2

  union all

  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    cpd.weight_kg,
    cpb.received_date, cpb.origin,
    cpd.departure_date
  from client_pallet_departures cpd
  join client_pallet_base cpb on cpb.barcode2 = cpd.barcode2
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where (received_date < p_from or origin = 'opening_stock')
    and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where received_date between p_from and p_to and origin != 'opening_stock'
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets where departure_date between p_from and p_to
),
finished_calibres as (select distinct calibre_id from client_pallets),
finished_opening_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where (received_date < p_from or origin = 'opening_stock')
    and (departure_date is null or departure_date >= p_from) group by calibre_id
),
finished_produced_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where received_date between p_from and p_to and origin != 'opening_stock' group by calibre_id
),
finished_dispatched_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets where departure_date between p_from and p_to group by calibre_id
),
quality_record as (
  select
    cl.serial, cl.type_id, cl.partiya_no, cl.plate, cl.driver, cl.arrival_date, cl.target_moisture_pct, cl.target_so2_mg_kg,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = cl.serial
      order by lr.created_at desc limit 1
    ) as intake_lab,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'verdict', lr.verdict, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = cl.wash_cycle_id
      order by lr.created_at desc limit 1
    ) as delivered_lab
  from client_lines cl
  where cl.origin != 'opening_stock'
    and (
      cl.arrival_date between p_from and p_to
      or cl.completed_date between p_from and p_to
      or exists (select 1 from client_pallets cp where cp.serial = cl.serial and cp.departure_date between p_from and p_to)
    )
),
period_dispatch_ids as (
  select distinct cr.id as request_id
  from chiqim_requests cr
  cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
  where cr.owner_id = p_owner_id
    and cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
    and cr.request_date between p_from and p_to
)
select jsonb_build_object(
  'owner', (select jsonb_build_object('id', id, 'name', name) from owners where id = p_owner_id),
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'raw', jsonb_build_object(
    'openingKg', (select kg from raw_opening_total),
    'receivedKg', (select kg from raw_received_total),
    'sentToMoykaKg', (select kg from raw_sent_to_moyka_period_total),
    'processedKg', (select kg from raw_processed_total),
    'processedActualSentKg', (select kg from raw_processed_actual_total),
    'processedOverageKg', (select kg from raw_processed_actual_total) - (select kg from raw_processed_total),
    'rawDispatchedKg', (select kg from raw_dispatch_total),
    'moykadaKg', (select kg from moykada_total),
    'cappedSerials', (
      select coalesce(jsonb_agg(
        jsonb_build_object('serial', cs.serial, 'actualSentKg', cs.actual_sent_kg, 'effectiveQtyKg', cs.effective_qty_kg, 'overageKg', cs.overage_kg)
        order by cs.serial
      ), '[]'::jsonb)
      from capped_serials cs
    ),
    'closingKg', (select kg from raw_closing_total),
    'processedBreakdown', jsonb_build_object(
      'calibreKg', (select calibre_kg from loss_main),
      'konditirskiyKg', (select konditirskiy_kg from loss_main),
      'lossKg', (select sent_kg - calibre_kg - konditirskiy_kg from loss_main),
      'lossPct', case when (select sent_kg from loss_main) > 0
                 then round((select sent_kg - calibre_kg - konditirskiy_kg from loss_main) / (select sent_kg from loss_main) * 100, 1)
                 else 0 end
    ),
    'byType', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'typeId', rt.type_id,
          'openingKg', coalesce(rot.kg, 0), 'receivedKg', coalesce(rrt.kg, 0),
          'sentToMoykaKg', coalesce(rsmt.kg, 0),
          'processedKg', coalesce(rpt.kg, 0),
          'rawDispatchedKg', coalesce(rdt.kg, 0),
          'moykadaKg', coalesce(mbt.kg, 0),
          'closingKg', coalesce(rct.kg, 0)
        )
      ), '[]'::jsonb)
      from raw_types rt
      left join raw_opening_by_type rot on rot.type_id = rt.type_id
      left join raw_received_by_type rrt on rrt.type_id = rt.type_id
      left join raw_sent_to_moyka_by_type rsmt on rsmt.type_id = rt.type_id
      left join raw_processed_by_type rpt on rpt.type_id = rt.type_id
      left join raw_dispatch_by_type rdt on rdt.type_id = rt.type_id
      left join moykada_by_type mbt on mbt.type_id = rt.type_id
      left join raw_closing_by_type rct on rct.type_id = rt.type_id
    ),
    'dispatches', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'requestId', rde.request_id, 'requestDate', rde.request_date, 'plate', rde.plate, 'driver', rde.driver,
          'serial', rde.serial, 'weightKg', rde.weight_kg, 'boxMassKg', rde.box_mass_kg, 'netKg', rde.net_kg
        ) order by rde.request_date desc
      ), '[]'::jsonb)
      from raw_dispatch_events rde
      where rde.request_date between p_from and p_to
    ),
    'reconciliation', jsonb_build_object(
      'totalReceivedKg', (select kg from cumulative_received_total),
      'xomKg', (select kg from raw_closing_total),
      'moykadaKg', (select kg from moykada_total),
      'cumulativeOutputKg', (select kg from cumulative_output_total),
      'cumulativeLossKg', (select kg from cumulative_loss_total),
      'cumulativeRawDispatchedKg', (select kg from cumulative_raw_dispatched_total),
      'cumulativeStorageLossKg', (select kg from cumulative_storage_loss_total),
      'balancesKg', (select kg from cumulative_received_total)
        - (select kg from raw_closing_total)
        - (select kg from cumulative_output_total) - (select kg from cumulative_loss_total)
        - (select kg from cumulative_raw_dispatched_total) - (select kg from cumulative_storage_loss_total)
    )
  ),
  'oldKn', jsonb_build_object(
    'collectedKg', (select kg from old_kn_collected_total),
    'collections', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'requestId', oke.request_id, 'requestDate', oke.request_date, 'plate', oke.plate, 'driver', oke.driver,
          'typeId', oke.type_id, 'collectedKg', oke.collected_kg
        ) order by oke.request_date desc
      ), '[]'::jsonb)
      from old_kn_events oke where oke.request_date between p_from and p_to
    )
  ),
  'storageLoss', jsonb_build_object(
    'totalKg', (select kg from storage_loss_total),
    'lines', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', sle.kind, 'typeId', sle.type_id,
          'closedDate', (sle.closed_at at time zone 'utc')::date, 'bookRemainingKg', sle.book_remaining_kg
        ) order by sle.closed_at desc
      ), '[]'::jsonb)
      from storage_loss_events sle
      where (sle.closed_at at time zone 'utc')::date between p_from and p_to
    )
  ),
  'finished', jsonb_build_object(
    'openingKg', (select kg from finished_opening_total),
    'producedKg', (select kg from finished_produced_total),
    'dispatchedKg', (select kg from finished_dispatched_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total) - (select kg from finished_dispatched_total),
    'byCalibre', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'calibreId', fc.calibre_id,
          'openingKg', coalesce(fo.kg, 0), 'producedKg', coalesce(fp2.kg, 0), 'dispatchedKg', coalesce(fd.kg, 0),
          'closingKg', coalesce(fo.kg, 0) + coalesce(fp2.kg, 0) - coalesce(fd.kg, 0)
        )
      ), '[]'::jsonb)
      from finished_calibres fc
      left join finished_opening_by_calibre fo on fo.calibre_id = fc.calibre_id
      left join finished_produced_by_calibre fp2 on fp2.calibre_id = fc.calibre_id
      left join finished_dispatched_by_calibre fd on fd.calibre_id = fc.calibre_id
    )
  ),
  'qualityRecord', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'serial', qr.serial, 'typeId', qr.type_id, 'partiyaNo', qr.partiya_no, 'plate', qr.plate, 'driver', qr.driver,
        'arrivalDate', qr.arrival_date, 'targetMoisturePct', qr.target_moisture_pct, 'targetSo2MgKg', qr.target_so2_mg_kg,
        'intakeLab', qr.intake_lab, 'deliveredLab', qr.delivered_lab
      ) order by qr.arrival_date
    ), '[]'::jsonb)
    from quality_record qr
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'departedAt', cgw.completed_at,
        'truckType', cr.truck_type,
        'loadedKg', chiqim_request_loaded_kg(cr.id),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', c.barcode2, 'serial', fp.serial, 'calibreId', fp.calibre_id, 'weightKg', c.qty_kg)
            order by c.barcode2
          ), '[]'::jsonb)
          from chiqim_pallet_consumption c
          join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
          join finished_pallets fp on fp.barcode2 = c.barcode2
          where cl2.request_id = cr.id
        )
      ) order by cgw.completed_at desc
    ), '[]'::jsonb)
    from period_dispatch_ids pdi
    join chiqim_requests cr on cr.id = pdi.request_id
    cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
  )
);
$function$;

-- ============================================================
-- 14. rahbar_dashboard_ledger -- pallet_departures.
-- ============================================================
create or replace function public.rahbar_dashboard_ledger(p_from date, p_to date, p_scope text)
 returns jsonb
 language sql
 stable
as $function$
with lines as (
  select
    kl.serial, kl.type_id, ko.origin,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date,
    (si.serial is not null) as has_intake,
    wc.closed_at,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date < p_from) as rezka_sent_before_from_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date <= p_to) as rezka_sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date < p_from
    ) as closed_before_from,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date <= p_to
    ) as closed_as_of_to,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date < p_from) as output_before_from_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from lines where arrival_date < p_from and has_intake and not closed_before_from
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from lines where arrival_date between p_from and p_to and has_intake
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
raw_storage_loss_period as (
  select coalesce(sum(osc.book_remaining_kg), 0) as kg
  from old_stock_closeouts osc
  where osc.kind = 'old_raw'
    and (osc.closed_at at time zone 'utc')::date between p_from and p_to
    and (p_scope = 'hammasi' or p_scope = 'eski')
),
moyka_in_process as (
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg) end
  ), 0) as kg
  from lines where arrival_date <= p_to and has_intake
),
moyka_opening_total as (
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date < p_from then 0
         else greatest(0, sent_before_from_kg - output_before_from_kg) end
  ), 0) as kg
  from lines where arrival_date < p_from and has_intake
),
moyka_send_events as (
  select ms.id, ms.serial, ms.sent_date, ms.qty_kg
  from moyka_sends ms
  join kirim_lines kl on kl.serial = ms.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
raw_dispatch_events as (
  select rdl.id, rdl.serial, cr.request_date, rdl.net_kg
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join kirim_lines kl on kl.serial = rdl.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
moyka_sent_period_total as (
  select coalesce(sum(qty_kg), 0) as kg from moyka_send_events where sent_date between p_from and p_to
),
raw_dispatch_period_total as (
  select coalesce(sum(net_kg), 0) as kg from raw_dispatch_events where request_date between p_from and p_to
),
processed_lines as (
  select
    kl.serial, kl.type_id,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  where wc.closed_at is not null and (wc.closed_at at time zone 'utc')::date between p_from and p_to
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
processed_output as (
  select
    pl.type_id, fp.calibre_id,
    coalesce(sum(fp.weight_kg), 0) as output_kg
  from processed_lines pl
  join finished_pallets fp on fp.serial = pl.serial
  group by pl.type_id, fp.calibre_id
),
processed_total as (
  select coalesce(sum(sent_capped_kg), 0) as kg from processed_lines
),
processed_calibre_total as (
  select coalesce(sum(po.output_kg), 0) as kg from processed_output po join calibres c on c.id = po.calibre_id where not c.is_numberless
),
processed_konditirskiy_total as (
  select coalesce(sum(po.output_kg), 0) as kg from processed_output po join calibres c on c.id = po.calibre_id where c.is_numberless
),
processed_loss_total as (
  select
    (select kg from processed_total)
    - (select kg from processed_calibre_total)
    - (select kg from processed_konditirskiy_total) as kg
),
pallet_base as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, kl.type_id, fp.weight_kg, fp.received_date, ko.origin
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where fp.received_date <= p_to
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to
    )
    and not (fp.status = 'bekor_qilindi' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
    and not (fp.status = 'storage_loss' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
),
pallet_departures as (
  select
    c.barcode2,
    (cgw.completed_at at time zone 'utc')::date as departure_date,
    c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join pallet_base pb on pb.barcode2 = c.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  cross join lateral (select chiqim_departed_at(cr.id) as completed_at) cgw
  where cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
),
pallet_departed_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from pallet_departures
  group by barcode2
),
pallets as (
  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    greatest(0, pb.weight_kg - coalesce(pdt.kg, 0)) as weight_kg,
    pb.received_date, pb.origin,
    null::date as departure_date
  from pallet_base pb
  left join pallet_departed_total pdt on pdt.barcode2 = pb.barcode2

  union all

  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    pd.weight_kg,
    pb.received_date, pb.origin,
    pd.departure_date
  from pallet_departures pd
  join pallet_base pb on pb.barcode2 = pd.barcode2
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where (received_date < p_from or origin = 'opening_stock') and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where received_date between p_from and p_to and origin != 'opening_stock'
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets where departure_date between p_from and p_to
),
finished_dispatched_by_calibre_type as (
  select type_id, calibre_id, coalesce(sum(weight_kg), 0) as kg
  from pallets where departure_date between p_from and p_to
  group by type_id, calibre_id
),
bucket_size as (
  select case when (p_to - p_from) <= 31 then 1 else 7 end as days
),
buckets as (
  select gs::date as bucket_start
  from bucket_size bs, generate_series(p_from, p_to, (bs.days || ' days')::interval) gs
),
chart_kirdi as (
  select b.bucket_start, coalesce(sum(l.effective_qty), 0) as kg
  from buckets b
  left join lines l on l.arrival_date >= b.bucket_start and l.arrival_date < b.bucket_start + (select days from bucket_size)
    and l.arrival_date between p_from and p_to and l.has_intake
  group by b.bucket_start
),
chart_chiqgan as (
  select b.bucket_start, coalesce(sum(mse.qty_kg), 0) as kg
  from buckets b
  left join moyka_send_events mse on mse.sent_date >= b.bucket_start and mse.sent_date < b.bucket_start + (select days from bucket_size)
    and mse.sent_date between p_from and p_to
  group by b.bucket_start
),
chart_vozvrat as (
  select b.bucket_start, coalesce(sum(rde.net_kg), 0) as kg
  from buckets b
  left join raw_dispatch_events rde on rde.request_date >= b.bucket_start and rde.request_date < b.bucket_start + (select days from bucket_size)
    and rde.request_date between p_from and p_to
  group by b.bucket_start
),
raw_identity_residual as (
  select (select kg from raw_opening_total) + (select kg from raw_received_total)
       - (select kg from raw_dispatch_period_total) - (select kg from moyka_sent_period_total)
       - (select kg from raw_storage_loss_period) - (select kg from raw_closing_total) as kg
),
moyka_identity_residual as (
  select (select kg from moyka_opening_total) + (select kg from moyka_sent_period_total)
       - (select kg from processed_total) - (select kg from moyka_in_process) as kg
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to, 'scope', p_scope, 'bucketDays', (select days from bucket_size)),
  'raw', jsonb_build_object(
    'openingKg', (select kg from raw_opening_total),
    'receivedKg', (select kg from raw_received_total),
    'dispatchedKg', (select kg from raw_dispatch_period_total),
    'sentToMoykaKg', (select kg from moyka_sent_period_total),
    'storageLossKg', (select kg from raw_storage_loss_period),
    'closingKg', (select kg from raw_closing_total),
    'residualKg', (select kg from raw_identity_residual),
    'residualNote', 'diagnostic only, formulas unchanged -- opening+received-dispatched-sentToMoyka-storageLoss-closing; nonzero only when a line was sent/dispatched for more than its own effective raw qty (raw_closing_total''s floor absorbs the excess). Render only when nonzero.'
  ),
  'moykadaSnapshot', jsonb_build_object(
    'openingKg', (select kg from moyka_opening_total),
    'closingKg', (select kg from moyka_in_process),
    'asOfDate', p_to,
    'residualKg', (select kg from moyka_identity_residual),
    'note', 'point-in-time balances (opening as of p_from, closing as of p_to), not period flows -- not part of either ledger''s own closing identity. Together with raw.sentToMoykaKg and moyka.processedKg they form Ledger B''s own identity: openingKg + sentToMoykaKg - processedKg = closingKg. residualKg is that identity''s diagnostic slack, exact except in the same over-send edge case as raw.residualKg -- see migration header "Known edge case". Render only when nonzero.'
  ),
  'moyka', jsonb_build_object(
    'processedKg', (select kg from processed_total),
    'calibreKg', (select kg from processed_calibre_total),
    'konditirskiyKg', (select kg from processed_konditirskiy_total),
    'lossKg', (select kg from processed_loss_total),
    'lossPct', case when (select kg from processed_total) > 0
      then round((select kg from processed_loss_total) / (select kg from processed_total) * 100, 1)
      else 0 end
  ),
  'finished', jsonb_build_object(
    'openingKg', (select kg from finished_opening_total),
    'producedKg', (select kg from finished_produced_total),
    'dispatchedKg', (select kg from finished_dispatched_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total) - (select kg from finished_dispatched_total)
  ),
  'byCalibreType', jsonb_build_object(
    'processed', (
      select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', output_kg)), '[]'::jsonb)
      from processed_output
    ),
    'dispatched', (
      select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', kg)), '[]'::jsonb)
      from finished_dispatched_by_calibre_type
    )
  ),
  'chart', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'bucketStart', k.bucket_start,
        'kirdiKg', k.kg,
        'chiqganKg', c.kg,
        'vozvratKg', v.kg
      ) order by k.bucket_start
    ), '[]'::jsonb)
    from chart_kirdi k
    join chart_chiqgan c on c.bucket_start = k.bucket_start
    join chart_vozvrat v on v.bucket_start = k.bucket_start
  )
);
$function$;
