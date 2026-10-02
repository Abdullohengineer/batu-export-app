-- KIRIM truck type (Odatiy / Fura) -- mirrors chiqim_requests.truck_type
-- (0104/0105), applied to KIRIM's own "request" table, kirim_orders. A
-- KIRIM fura is never weighed at the gate AT ALL (no loaded weigh, no
-- empty weigh, no tarozi photos -- stricter than CHIQIM fura, which still
-- gets Qorovul's kirdi/chiqdi photos; KIRIM fura gets the identical photo
-- treatment, just no weight fields alongside it either, since KIRIM never
-- had a "loaded total" ledger analogous to chiqim_pallet_consumption to
-- fall back on -- its accounting figure is simply storage_intake.actual_qty).
--
-- DESIGN DECISIONS (confirmed before writing this):
--
-- 1. Photo mechanism: a NEW, separately-scoped table/bucket
--    (kirim_fura_photos / kirim-fura-photos), not a generalisation of
--    chiqim_fura_photos. chiqim_fura_photos is request_id-scoped to
--    chiqim_requests; KIRIM's equivalent envelope is kirim_orders, a
--    different table/id. Generalising the existing CHIQIM table into a
--    dual-nullable-FK shape (mirroring gate_weighings' own order_id/
--    request_id split) would touch the existing CHIQIM table name, bucket
--    name, chiqim_fura_photo_paths(), and every CHIQIM call site that
--    reads them -- a change to shipped, tested CHIQIM objects for zero
--    CHIQIM behaviour change. Decided against; this migration touches
--    NO existing CHIQIM object. The new table/bucket/function below are a
--    mechanical copy of chiqim_fura_photos' own shape (same append-only
--    design, same RLS pattern, same "latest per kind by seq, not
--    uploaded_at" correctness fix) -- same MECHANISM, new table.
--
-- 2. Multi-line fura completion: a fura KIRIM order completes (status ->
--    'qabul_qilindi') only once EVERY non-voided line on the order has a
--    storage_intake row -- mirrors report_kirim_rows' own box_mass CTE
--    (bool_and across kirim_lines before treating a truck-level figure as
--    known). A half-accepted multi-line fura truck must not read as
--    "registered."
--
-- 3. Fura's accounting weight = storage_intake.actual_qty, never summed
--    or derived further -- unlike CHIQIM fura (whose loaded kg is spread
--    across three ledger tables and genuinely needs summing on read),
--    KIRIM already has exactly one place material lands: the line's own
--    intake row. Box mass is NOT required for a fura line (no box count
--    ever happens against a truck that's never weighed), so
--    storage_intake.box_mass_kg becomes nullable -- NOT NULL only for a
--    normal-truck line, enforced by a CHECK naming the box mass column
--    together with the owning order's truck_type (see below).
--
-- Origin filtering (CLAUDE.md): every object touched here already carries
-- its existing origin handling (report_kirim_rows/_as_of's `where
-- ko.plate !~~ 'TEST-%'` and the implicit "no origin filter, raw lines are
-- never seeded as fura" -- opening_stock/internal_reprocess orders have no
-- Menejer-chosen truck_type path and stay 'regular' by default, unaffected
-- by this migration). No new material-timestamp read path is introduced.
--
-- Normal-truck KIRIM must be byte-for-byte unchanged: every new CASE
-- branch below is gated on `ko.truck_type = 'fura'` / `new.truck_type =
-- 'fura'`, so a 'regular' row (the column's own default) falls through to
-- exactly the pre-existing logic, reproduced verbatim from its last
-- defining migration (kirim_line_effective_qty: 0073; report_kirim_rows /
-- report_kirim_rows_as_of: 0094; get_serial_passport_rls: 0105, renamed by
-- 0147).

-- ============================================================
-- 1. kirim_orders.truck_type + immutability guard.
-- ============================================================
alter table public.kirim_orders
  add column truck_type text not null default 'regular'
  check (truck_type in ('regular', 'fura'));

create or replace function public.enforce_kirim_truck_type_immutable()
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

create trigger kirim_orders_truck_type_immutable
  before update on public.kirim_orders
  for each row execute function public.enforce_kirim_truck_type_immutable();

-- ============================================================
-- 2. storage_intake.box_mass_kg becomes nullable. A fura line is never
--    boxed-and-weighed against a truck that doesn't get weighed, so Ombor
--    has nothing to enter there; a normal-truck line keeps entering it
--    exactly as before (IntakeAcceptForm.tsx keeps requiring it for a
--    normal line; this migration only widens what the COLUMN accepts).
--    The existing `check (box_mass_kg >= 0)` already permits NULL
--    (a CHECK is satisfied whenever it evaluates to NULL, not just TRUE),
--    so nothing else here needs to change.
-- ============================================================
alter table public.storage_intake
  alter column box_mass_kg drop not null;

-- ============================================================
-- 3. kirim_fura_photos -- mechanical copy of chiqim_fura_photos' shape
--    (0105), scoped to kirim_orders(order_id) instead of
--    chiqim_requests(id). Append-only; "latest per kind" by monotonic
--    `seq`, not `uploaded_at` (same reason 0105 documents: two rows
--    written in one transaction share `now()`).
-- ============================================================
create table public.kirim_fura_photos (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.kirim_orders(order_id),
  kind        text not null check (kind in ('kirdi', 'chiqdi')),
  photo_url   text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id),
  seq         bigint generated always as identity
);

create index kirim_fura_photos_order_kind_idx
  on public.kirim_fura_photos (order_id, kind, seq desc);

alter table public.kirim_fura_photos enable row level security;

create policy read_all on public.kirim_fura_photos for select
  using (auth.uid() is not null and my_role() <> 'client');

create policy qorovul_writes on public.kirim_fura_photos for insert
  with check (my_role() = 'qorovul');

-- No UPDATE and no DELETE policy, deliberately: append-only.

create or replace function public.kirim_fura_photo_paths(p_order_id uuid)
returns table (kirdi_photo text, chiqdi_photo text)
language sql
stable
as $function$
  select
    (select p.photo_url from public.kirim_fura_photos p
      where p.order_id = p_order_id and p.kind = 'kirdi'
      order by p.seq desc limit 1),
    (select p.photo_url from public.kirim_fura_photos p
      where p.order_id = p_order_id and p.kind = 'chiqdi'
      order by p.seq desc limit 1);
$function$;

-- Storage bucket, same read_all + <role>_insert shape as every bucket in
-- this schema (CLAUDE.md), with the same client-excluding read predicate
-- chiqim-fura-photos uses (0105) -- a nakladnoy-equivalent capture, same
-- reasoning, same exclusion.
insert into storage.buckets (id, name, public)
values ('kirim-fura-photos', 'kirim-fura-photos', false)
on conflict (id) do nothing;

create policy kirim_fura_photos_read on storage.objects for select
  using (
    bucket_id = 'kirim-fura-photos'
    and auth.uid() is not null
    and my_role() <> 'client'
  );

create policy kirim_fura_photos_insert on storage.objects for insert
  with check (
    bucket_id = 'kirim-fura-photos'
    and my_role() = 'qorovul'
  );

-- ============================================================
-- 4. complete_kirim_fura() -- the KIRIM fura completion event. Fires on
--    EVERY storage_intake insert (every KIRIM line, fura or not); for a
--    normal-truck line the WHERE/IF guards below are false and nothing
--    happens, so a normal truck's only status-flip path (gate stage 2's
--    complete_kirim_stage2, 0013) is completely untouched.
--
--    AFTER INSERT (not BEFORE UPDATE, unlike complete_chiqim_fura/0104):
--    storage_intake's own confirmed_at is set once, at INSERT, never
--    updated later (Ombor's own accept flow is a single insert, see
--    OmborIntakeTab.tsx handleAccept) -- there is no "transition" to guard
--    on an UPDATE here the way CHIQIM's ombor_finished_at transition
--    needed. SECURITY DEFINER: qorovul/ombor has no UPDATE policy on
--    kirim_orders at all (only menejer_edits, 0038), matching the same
--    "a writing role isn't permitted to flip this directly" pattern
--    CLAUDE.md names for complete_kirim_stage2/complete_chiqim_fura.
--
--    All-lines semantics (decision 2 above): flips status only once every
--    non-voided line on NEW's order has its own storage_intake row. Guards
--    on current status = 'kutilmoqda' so a re-run (e.g. a defensive
--    re-insert that can't actually happen, since storage_intake's PK is
--    serial) can never re-flip a status that has since moved on.
-- ============================================================
create or replace function public.complete_kirim_fura()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order_id uuid;
  v_truck_type text;
begin
  select kl.order_id into v_order_id from kirim_lines kl where kl.serial = new.serial;
  if v_order_id is null then
    return new;
  end if;

  select truck_type into v_truck_type from kirim_orders where order_id = v_order_id;
  if v_truck_type is distinct from 'fura' then
    return new;
  end if;

  if not exists (
    select 1 from kirim_lines kl
    where kl.order_id = v_order_id
      and kl.voided_at is null
      and not exists (select 1 from storage_intake si where si.serial = kl.serial)
  ) then
    update kirim_orders
       set status = 'qabul_qilindi'
     where order_id = v_order_id
       and status = 'kutilmoqda';
  end if;

  return new;
end;
$function$;

create trigger storage_intake_complete_kirim_fura
  after insert on public.storage_intake
  for each row execute function public.complete_kirim_fura();

-- ============================================================
-- 5. kirim_line_effective_qty -- THE single balance helper (CLAUDE.md
--    hard rule: extend this, never add a second calculation). Reproduced
--    verbatim from 0073 with one new branch prepended, gated on the
--    line's own order's truck_type. A fura never has a gate row and box
--    mass is never required for one, so its branch skips both entirely:
--    pre-intake still shows declared_qty (unchanged "two independent
--    pending inputs" story doesn't apply -- a fura has no gate input at
--    all), and once accepted it is simply actual_qty, final, forever --
--    never provisional, never waiting on a weigh that will never happen.
-- ============================================================
create or replace function kirim_line_effective_qty(p_serial text)
returns numeric
language sql
stable
as $function$
  with target as (
    select kl.serial, kl.order_id, kl.declared_qty
    from kirim_lines kl where kl.serial = p_serial
  ),
  box_mass as (
    select kl.order_id,
      case when bool_and(si2.serial is not null) then sum(si2.box_mass_kg) else null end as total_box_mass_kg
    from kirim_lines kl
    left join storage_intake si2 on si2.serial = kl.serial
    where kl.order_id = (select order_id from target)
    group by kl.order_id
  ),
  line_count as (
    select count(*) as n from kirim_lines where order_id = (select order_id from target)
  )
  select
    case
      when ko.truck_type = 'fura' then
        coalesce(si.actual_qty, t.declared_qty)
      when si.actual_qty is null then t.declared_qty
      when gw.completed_at is null or bm.total_box_mass_kg is null then si.actual_qty
      when lc.n > 1 then si.actual_qty
      else coalesce(gw.net_kg - bm.total_box_mass_kg, si.actual_qty)
    end
  from target t
  join kirim_orders ko on ko.order_id = t.order_id
  left join storage_intake si on si.serial = t.serial
  left join box_mass bm on bm.order_id = t.order_id
  cross join line_count lc
  left join lateral (
    select gw2.net_kg, gw2.completed_at
    from gate_weighings gw2
    where gw2.dir = 'kirim' and gw2.order_id = t.order_id
    order by gw2.stage1_completed_at desc nulls last
    limit 1
  ) gw on true;
$function$;

-- ============================================================
-- 6. report_kirim_rows -- Hisobot/client-report/Rahbar's own base KIRIM
--    row source. THIS IS A SEPARATE, INDEPENDENT COPY of the same ladder
--    (confirmed: it does not call kirim_line_effective_qty -- see 0073's
--    own header comment, never changed since). Extended in parallel,
--    identical branch, identical gating, so it can never disagree with
--    #5. Reproduced verbatim from 0094 apart from the new branch and the
--    added `ko.truck_type` / `kl.order_id`-via-`l` join (already present).
--    provisional is FALSE for an accepted fura line -- this is what
--    removes "tarozi kutilmoqda" / "quti massasi kutilmoqda" from every
--    screen that reads this view, with no screen-side special case.
-- ============================================================
create or replace view public.report_kirim_rows as
with lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
),
box_mass as (
  select kl.order_id,
    case when bool_and(si_1.serial is not null) then sum(si_1.box_mass_kg) else null end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si_1 on si_1.serial = kl.serial
  group by kl.order_id
)
select
  'kirim'::text as kind, l.serial as row_key, l.serial, null::text as barcode2, l.order_id,
  null::uuid as request_id, ko.owner_id, l.type_id, null::uuid as calibre_id, ko.plate, ko.driver,
  ko.order_date as date_basis, 'order_date'::text as date_basis_source,
  case
    when ko.truck_type = 'fura' then coalesce(si.actual_qty, l.declared_qty)
    when si.actual_qty is null then l.declared_qty
    when gw.completed_at is null or bm.total_box_mass_kg is null then si.actual_qty
    when l.line_count > 1 then si.actual_qty
    else coalesce(gw.net_kg - bm.total_box_mass_kg, si.actual_qty)
  end as qty_kg,
  case
    when ko.truck_type = 'fura' then false
    when si.actual_qty is null then false
    when gw.completed_at is null or bm.total_box_mass_kg is null then true
    else false
  end as provisional,
  l.declared_qty,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null
       then gw.net_kg - bm.total_box_mass_kg - ko.declared_total else null end as truck_variance_diff_kg,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null and ko.declared_total > 0
       then (gw.net_kg - bm.total_box_mass_kg - ko.declared_total) / ko.declared_total * 100 else null end as truck_variance_diff_pct,
  case when l.line_count = 1 and gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null
            and si.actual_qty is not null and si.actual_qty <> 0
            and es.sent_date is not null and es.sent_date <= (gw.completed_at at time zone 'utc')::date
            and abs((gw.net_kg - bm.total_box_mass_kg - si.actual_qty) / si.actual_qty * 100) > coalesce((select value from settings_limits where key = 'kam_chiqdi_pct'), 5)
       then true else false end as provisional_variance_flag,
  null::integer as wash_cycle, null::text as pallet_status, null::text as lab_verdict,
  l.target_moisture_pct, l.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
  null::text[] as void_successor_barcodes, si.box_mass_kg, ko.origin, l.partiya_no
from lines l
join kirim_orders ko on ko.order_id = l.order_id
left join storage_intake si on si.serial = l.serial
left join box_mass bm on bm.order_id = l.order_id
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
  order by lr2.created_at desc limit 1
) lr on true
where ko.plate !~~ 'TEST-%';

-- ============================================================
-- 7. report_kirim_rows_as_of -- as-of variant (get_client_report's own raw
--    figures), same branch, same gating, applied to the DROP+CREATE
--    shape 0094 already established (RETURNS TABLE forbids a plain
--    CREATE OR REPLACE here -- see that migration's own header).
-- ============================================================
drop function if exists public.report_kirim_rows_as_of(date);

create function public.report_kirim_rows_as_of(p_to date)
 returns TABLE(kind text, row_key text, serial text, barcode2 text, order_id uuid, request_id uuid, owner_id uuid, type_id uuid, partiya_no integer, calibre_id uuid, plate text, driver text, date_basis date, date_basis_source text, qty_kg numeric, provisional boolean, declared_qty numeric, truck_variance_diff_kg numeric, truck_variance_diff_pct numeric, provisional_variance_flag boolean, wash_cycle integer, pallet_status text, lab_verdict text, target_moisture_pct numeric, target_so2_mg_kg numeric, moisture_pct numeric, so2_mg_kg numeric, void_successor_barcodes text[], box_mass_kg numeric, origin text)
 language sql
 stable
as $function$
with
lines as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
),
box_mass as (
  select kl.order_id,
    case when bool_and(si_1.serial is not null) then sum(si_1.box_mass_kg) else null end as total_box_mass_kg
  from kirim_lines kl
  left join storage_intake si_1
    on si_1.serial = kl.serial
   and si_1.confirmed_at is not null
   and (si_1.confirmed_at at time zone 'utc')::date <= p_to
  group by kl.order_id
)
select
  'kirim'::text as kind, l.serial as row_key, l.serial, null::text as barcode2, l.order_id,
  null::uuid as request_id, ko.owner_id, l.type_id, l.partiya_no, null::uuid as calibre_id, ko.plate, ko.driver,
  ko.order_date as date_basis, 'order_date'::text as date_basis_source,
  case
    when ko.truck_type = 'fura' then coalesce(si.actual_qty, l.declared_qty)
    when si.actual_qty is null then l.declared_qty
    when gw.completed_at is null or bm.total_box_mass_kg is null then si.actual_qty
    when l.line_count > 1 then si.actual_qty
    else coalesce(gw.net_kg - bm.total_box_mass_kg, si.actual_qty)
  end as qty_kg,
  case
    when ko.truck_type = 'fura' then false
    when si.actual_qty is null then false
    when gw.completed_at is null or bm.total_box_mass_kg is null then true
    else false
  end as provisional,
  l.declared_qty,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null
       then gw.net_kg - bm.total_box_mass_kg - ko.declared_total else null end as truck_variance_diff_kg,
  case when gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null and ko.declared_total is not null and ko.declared_total > 0
       then (gw.net_kg - bm.total_box_mass_kg - ko.declared_total) / ko.declared_total * 100 else null end as truck_variance_diff_pct,
  case when l.line_count = 1 and gw.completed_at is not null and gw.net_kg is not null and bm.total_box_mass_kg is not null
            and si.actual_qty is not null and si.actual_qty <> 0
            and es.sent_date is not null and es.sent_date <= (gw.completed_at at time zone 'utc')::date
            and abs((gw.net_kg - bm.total_box_mass_kg - si.actual_qty) / si.actual_qty * 100) > coalesce((select value from settings_limits where key = 'kam_chiqdi_pct'), 5)
       then true else false end as provisional_variance_flag,
  null::integer as wash_cycle, null::text as pallet_status, null::text as lab_verdict,
  l.target_moisture_pct, l.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
  null::text[] as void_successor_barcodes, si.box_mass_kg, ko.origin
from lines l
join kirim_orders ko on ko.order_id = l.order_id
left join storage_intake si
  on si.serial = l.serial
 and si.confirmed_at is not null
 and (si.confirmed_at at time zone 'utc')::date <= p_to
left join box_mass bm on bm.order_id = l.order_id
left join lateral (
  select gw2.net_kg,
         case when gw2.completed_at is not null and (gw2.completed_at at time zone 'utc')::date <= p_to
              then gw2.completed_at else null end as completed_at,
         gw2.stage1_completed_at
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
  order by lr2.created_at desc limit 1
) lr on true
where ko.plate !~~ 'TEST-%';
$function$;
