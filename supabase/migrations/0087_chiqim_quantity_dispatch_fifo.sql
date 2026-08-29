-- Quantity-based CHIQIM dispatch with FIFO cascade (see DECISIONS.md
-- "CHIQIM quantity-based dispatch: FIFO cascade, consumption table").
--
-- Reverses TWO prior decisions, confirmed with the user before writing this
-- migration:
-- 1. The 2026-08-20 "per-calibre Barcode #2 batch" data-correction implied
--    an app-side receive-form change that was explicitly deferred and never
--    built (confirmed: FinishedReceiptForm.tsx still mints one
--    finished_pallets row per save). This migration does not depend on that
--    shape existing -- every finished_pallets row, batch or single pallet,
--    is independently, partially consumable via the new table below.
-- 2. "CHIQIM Option B" (2026-07-27, chiqim_line_pallets pallet-level
--    reservation + Ombor scan-to-load) is removed wholesale, not just the
--    2026-08-18/20 batch decision -- confirmed with the user. Reverts to
--    Option A's quantity-only line shape (calibre + net kg, no pallet
--    picker), but replaces Option A's scan-time matching with a FIFO
--    consumption ledger instead, closing the double-claim race Option B
--    was built to solve via the same hard-fail-if-insufficient transaction
--    every other quantity-based flow in this app already uses.
--
-- Live data checked before writing this: chiqim_line_pallets (0 rows),
-- dispatch_manifest (0 rows), chiqim_lines with line_kind in
-- ('finished','old_washed') (0 rows) -- finished-goods CHIQIM has never
-- actually been dispatched through Option B in production. No backfill
-- needed for chiqim_pallet_consumption; chiqim_line_pallets is dropped
-- outright (empty, no FK/view/function dependents -- checked directly).
-- dispatch_manifest's TABLE is kept (schema unchanged) as a historical
-- artifact -- nothing ever wrote to it, so there is nothing to reconcile,
-- but dropping a table another migration created felt like more churn than
-- value for zero rows; the app simply never writes to it again, same
-- "keep the table, stop writing" precedent as wash_cycles (0086).
--
-- FIFO key: finished_pallets had no created_at at all (only received_date,
-- a DATE -- day granularity, frequently tied across several pallets).
-- Added below, backfilled deterministically for existing rows (received_date
-- midnight + a per-day barcode2-order offset, so historical ties get a
-- stable, if arbitrary, order) so real insert-order FIFO applies from here
-- on for every row, historical and future.

-- ============================================================
-- 1. finished_pallets.created_at -- FIFO ordering key.
-- ============================================================
alter table public.finished_pallets add column created_at timestamptz;

with ordered as (
  select barcode2, received_date,
    row_number() over (partition by received_date order by barcode2) as rn
  from public.finished_pallets
)
update public.finished_pallets fp
set created_at = (o.received_date::timestamp at time zone 'utc') + (o.rn * interval '1 second')
from ordered o
where o.barcode2 = fp.barcode2;

alter table public.finished_pallets alter column created_at set not null;
alter table public.finished_pallets alter column created_at set default now();

-- ============================================================
-- 2. chiqim_lines.declared_tara_kg -- Menejer's declared tare for a
--    finished/old_washed line (additive; qty_kg already serves as the
--    declared net kg for these line kinds, unchanged). NULL for raw/
--    old_raw/old_kn lines, same "not every kind uses every column"
--    convention chiqim_lines already has (calibre_id, qty_kg).
-- ============================================================
alter table public.chiqim_lines add column declared_tara_kg numeric;

-- ============================================================
-- 3. chiqim_pallet_consumption -- append-only FIFO ledger. Never mutates
--    finished_pallets; a row's live remaining balance is always
--    weight_kg - sum(qty_kg) here. Undo (pre-gate-stage-2, matching
--    dispatch_manifest's own ombor_deletes window) DELETEs rows here --
--    the one exception to append-only, same shape dispatch_manifest's own
--    ombor_deletes policy already established for "Ombor's own
--    in-progress work, not yet a finalized record."
-- ============================================================
create table public.chiqim_pallet_consumption (
  id uuid primary key default gen_random_uuid(),
  chiqim_line_id uuid not null references public.chiqim_lines(id),
  barcode2 text not null references public.finished_pallets(barcode2),
  qty_kg numeric not null check (qty_kg > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index chiqim_pallet_consumption_line_idx on public.chiqim_pallet_consumption(chiqim_line_id);
create index chiqim_pallet_consumption_barcode_idx on public.chiqim_pallet_consumption(barcode2);

-- Trigger backstop (a CHECK constraint can't validate a cross-row sum):
-- sum(qty_kg) per barcode2 must never exceed finished_pallets.weight_kg.
-- Defense in depth, same shape as every other RLS/DB-constraint backstop
-- in this app -- the real race guard is attribute_chiqim_line_fifo's own
-- `for update` row lock (below), which serializes concurrent finalizations
-- touching the same pallets before this trigger would ever need to fire.
create or replace function public.check_chiqim_pallet_consumption_not_overdrawn()
returns trigger
language plpgsql
as $$
declare
  v_weight numeric;
  v_consumed numeric;
begin
  select weight_kg into v_weight from public.finished_pallets where barcode2 = new.barcode2;
  select coalesce(sum(qty_kg), 0) into v_consumed from public.chiqim_pallet_consumption where barcode2 = new.barcode2;
  if v_consumed > v_weight then
    raise exception 'chiqim_pallet_consumption overdraws finished_pallets % (consumed % kg, pallet is % kg)', new.barcode2, v_consumed, v_weight;
  end if;
  return new;
end;
$$;

create trigger chiqim_pallet_consumption_not_overdrawn
  after insert on public.chiqim_pallet_consumption
  for each row execute function public.check_chiqim_pallet_consumption_not_overdrawn();

alter table public.chiqim_pallet_consumption enable row level security;

create policy read_all on public.chiqim_pallet_consumption
  for select using (auth.uid() is not null and my_role() <> 'client');

-- Client sees only consumption against their own owner's serials --
-- matches finished_pallets' own client_read_own_finished_pallets policy
-- shape exactly (same serial -> kirim_lines -> kirim_orders -> owner_id
-- chain), needed for the passport's dispatched-by-calibre figure.
create policy client_read_own_chiqim_pallet_consumption on public.chiqim_pallet_consumption
  for select using (
    my_role() = 'client'
    and exists (
      select 1 from public.finished_pallets fp
      join public.kirim_lines kl on kl.serial = fp.serial
      join public.kirim_orders ko on ko.order_id = kl.order_id
      where fp.barcode2 = chiqim_pallet_consumption.barcode2
        and ko.owner_id = my_owner_id()
    )
  );

-- Writes happen only inside attribute_chiqim_line_fifo (security definer,
-- below) so this INSERT policy is effectively unreachable from client code
-- directly -- kept anyway, matching finished_pallets'/raw_dispatch_lines'
-- own ombor_writes shape, in case a future direct-insert path needs it.
create policy ombor_writes on public.chiqim_pallet_consumption
  for insert with check (my_role() = 'ombor');

-- Undo window: deletable only before Qorovul's gate stage 2 (chiqim
-- per-role finalization, SPEC.md §5 intro) -- identical status set to
-- dispatch_manifest's own ombor_deletes policy.
create policy ombor_deletes on public.chiqim_pallet_consumption
  for delete using (
    my_role() = 'ombor'
    and exists (
      select 1 from public.chiqim_lines cl
      join public.chiqim_requests r on r.id = cl.request_id
      where cl.id = chiqim_pallet_consumption.chiqim_line_id
        and r.status in ('kutilmoqda', 'qabul_qilindi')
    )
  );

-- ============================================================
-- 4. Canonical availability -- the ONE read every consumer switches to.
--    Per-pallet live remaining balance, then the two aggregate levels the
--    brief asks for (total-by-calibre, per-parent-serial-by-calibre).
--    Floored at 0 for display, defensively -- the trigger above guarantees
--    it's never actually negative.
-- ============================================================
create or replace view public.finished_pallet_availability as
select
  fp.barcode2,
  fp.serial,
  fp.type_id,
  fp.calibre_id,
  fp.is_old_stock,
  fp.created_at,
  greatest(0, fp.weight_kg - coalesce(c.consumed_kg, 0)) as available_kg
from public.finished_pallets fp
left join (
  select barcode2, sum(qty_kg) as consumed_kg
  from public.chiqim_pallet_consumption
  group by barcode2
) c on c.barcode2 = fp.barcode2
where fp.status = 'in_stock';

create or replace view public.finished_calibre_availability as
select type_id, calibre_id, is_old_stock, sum(available_kg) as available_kg
from public.finished_pallet_availability
group by type_id, calibre_id, is_old_stock;

create or replace view public.finished_serial_calibre_availability as
select serial, type_id, calibre_id, is_old_stock, sum(available_kg) as available_kg
from public.finished_pallet_availability
group by serial, type_id, calibre_id, is_old_stock;

-- ============================================================
-- 5. FIFO attribution -- security definer (writes chiqim_pallet_consumption
--    directly; ombor_writes policy above stays as the defense-in-depth
--    layer). `for update` locks the candidate finished_pallets rows for
--    the duration of the call, serializing concurrent finalizations that
--    would otherwise race the same pallets -- the real guard behind the
--    trigger backstop. Raises (aborting the whole calling transaction,
--    per "no partial dispatch") if the line's declared kg can't be fully
--    covered by what's available at that moment.
-- ============================================================
create or replace function public.attribute_chiqim_line_fifo(p_line_id uuid, p_loaded_kg numeric, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_id uuid;
  v_calibre_id uuid;
  v_is_old boolean;
  v_remaining numeric := p_loaded_kg;
  v_take numeric;
  r record;
begin
  if p_loaded_kg <= 0 then
    raise exception 'attribute_chiqim_line_fifo: loaded kg must be positive (got %)', p_loaded_kg;
  end if;

  select cl.type_id, cl.calibre_id, cl.line_kind = 'old_washed'
    into v_type_id, v_calibre_id, v_is_old
  from public.chiqim_lines cl
  where cl.id = p_line_id;

  if v_calibre_id is null then
    raise exception 'chiqim_line % has no calibre_id -- FIFO attribution only applies to finished/old_washed lines', p_line_id;
  end if;

  for r in
    select fp.barcode2, fp.weight_kg
    from public.finished_pallets fp
    where fp.type_id = v_type_id
      and fp.calibre_id = v_calibre_id
      and fp.is_old_stock = v_is_old
      and fp.status = 'in_stock'
    order by fp.created_at
    for update of fp
  loop
    exit when v_remaining <= 0;
    v_take := least(
      v_remaining,
      r.weight_kg - coalesce((select sum(qty_kg) from public.chiqim_pallet_consumption where barcode2 = r.barcode2), 0)
    );
    if v_take <= 0 then continue; end if;
    insert into public.chiqim_pallet_consumption (chiqim_line_id, barcode2, qty_kg, created_by)
    values (p_line_id, r.barcode2, v_take, p_actor);
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Yetarli mahsulot yo''q: % kg yetishmayapti.', round(v_remaining, 1);
  end if;
end;
$$;

-- ============================================================
-- 6. finalize_chiqim_dispatch -- one transaction per request: attributes
--    every finished/old_washed line's Ombor-entered loaded kg, then sets
--    ombor_finished_at/by. p_lines: [{"line_id": uuid, "loaded_kg": numeric}, ...].
--    An exception from any line aborts the whole call -- Postgres function
--    bodies run atomically within the caller's transaction, so nothing
--    from an earlier line in this same call is left committed either.
-- ============================================================
create or replace function public.finalize_chiqim_dispatch(p_request_id uuid, p_lines jsonb, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
begin
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    perform public.attribute_chiqim_line_fifo(
      (v_line->>'line_id')::uuid,
      (v_line->>'loaded_kg')::numeric,
      p_actor
    );
  end loop;

  update public.chiqim_requests
  set ombor_finished_at = now(), ombor_finished_by = p_actor
  where id = p_request_id;
end;
$$;

-- ============================================================
-- 7. Drop chiqim_line_pallets (Option B reservation table) -- empty, no
--    FK/view/function dependents (checked directly against live schema
--    before writing this). useReservedPalletBarcodes.ts, chiqimScan.ts,
--    and the Menejer/Ombor pallet-picker UI are deleted in this same
--    change (application code, not this migration).
-- ============================================================
drop table public.chiqim_line_pallets;
