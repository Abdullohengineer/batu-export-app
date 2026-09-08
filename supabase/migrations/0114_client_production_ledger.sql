-- Client portal Part B.4 (Производство): per-serial pack-output ledger.
--
-- One row per serial with any output in [p_from_date, p_to_date], totals
-- of that period's finished_pallets only (not lifetime output) -- source
-- is finished_pallets.received_date, the closest thing this schema has to
-- a "produced at" date (there is no produced_at column; received_date is
-- the day of receipt into finished stock, day granularity, set at pack
-- time -- confirmed against the live schema before writing this, per
-- CLAUDE.md "inspect live/migration schema before assuming column
-- shape"). Excludes bekor_qilindi/consumed/storage_loss pallets, per the
-- task's own exclusion list -- consumed specifically so a re-minted
-- pallet's weight isn't counted as production twice (once under the
-- original serial, again under whatever serial it was minted into).
-- Self-scoped via my_owner_id(), TEST-% excluded (matches every other
-- client_* RPC's convention).
create or replace function client_production_ledger(p_from_date date, p_to_date date, p_product_type_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
me as (select my_owner_id() as owner_id),
scoped_pallets as (
  select fp.serial, fp.calibre_id, fp.weight_kg, kl.type_id
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  cross join me
  where ko.owner_id = me.owner_id
    and ko.plate not like 'TEST-%'
    and fp.status not in ('bekor_qilindi', 'consumed', 'storage_loss')
    and fp.received_date between p_from_date and p_to_date
    and (p_product_type_id is null or kl.type_id = p_product_type_id)
),
by_calibre as (
  select serial, calibre_id, sum(weight_kg) as kg
  from scoped_pallets
  group by serial, calibre_id
),
by_serial as (
  select serial, type_id, sum(weight_kg) as total_kg
  from scoped_pallets
  group by serial, type_id
),
totals_by_calibre as (
  select bc.calibre_id, c.label, c.code, c.sort_order, sum(bc.kg) as kg
  from by_calibre bc
  join calibres c on c.id = bc.calibre_id
  group by bc.calibre_id, c.label, c.code, c.sort_order
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'serial', bs.serial,
      'typeId', bs.type_id,
      'totalKg', bs.total_kg,
      'calibres', (
        select coalesce(jsonb_agg(jsonb_build_object('calibreId', bc.calibre_id, 'label', c.label, 'code', c.code, 'kg', bc.kg) order by c.sort_order), '[]'::jsonb)
        from by_calibre bc join calibres c on c.id = bc.calibre_id
        where bc.serial = bs.serial
      )
    ) order by bs.serial), '[]'::jsonb)
    from by_serial bs
  ),
  'totals', jsonb_build_object(
    'totalKg', coalesce((select sum(total_kg) from by_serial), 0),
    'byCalibre', (
      select coalesce(jsonb_agg(jsonb_build_object('calibreId', calibre_id, 'label', label, 'code', code, 'kg', kg) order by sort_order), '[]'::jsonb)
      from totals_by_calibre
    )
  )
);
$$;
