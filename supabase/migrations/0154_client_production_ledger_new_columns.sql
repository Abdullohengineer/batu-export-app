-- Client portal Производство: 8 new per-serial columns (Партия, Дата
-- прихода, По накладной, Приход нетто, Отправлено на мойку, В мойке,
-- Остаток сырья, Потеря). See docs/decisions/0237 for the full task and
-- schema notes.
--
-- Row-selection is UNCHANGED -- still one row per serial with output > 0 in
-- [p_from_date, p_to_date], via the exact same scoped_pallets/by_serial
-- shape as before (migration 0114). These are pure additions joined onto
-- the existing rows, never a new filter -- a serial with zero output in the
-- period still never appears, regardless of its В мойке value.
--
-- Schema corrections against the task brief (CLAUDE.md "inspect live/
-- migration schema before assuming table/column shape" -- confirmed against
-- the live schema before writing, not assumed): kirim_lines has no
-- `partiya` column (it's `partiya_no`, already the column every other
-- report/ledger in this codebase reads, e.g. report_rows_v2); kirim_orders
-- has no `arrival_date` column (it's `order_date`). Both used below in
-- place of the brief's names.
--
-- Reuses the shared scalar helpers named in the task, per CLAUDE.md "Reuse,
-- don't rebuild" -- no math duplicated:
--   - kirim_line_effective_qty(serial)        -> Приход нетто
--   - kirim_line_moyka_asof(serial, p_to_date) -> В мойке (end-of-period)
--   - kirim_line_loss_range(serial, from, to)  -> Потеря (period-recognition:
--     null unless a cycle closed inside [p_from_date, p_to_date], same
--     semantics as Hisobot's own state_yoqotish column)
-- Остаток сырья reuses the exact D-E-G convention already established by
-- client_serial_ledger's own ostatokSyryaKg (migration 0119, still live):
-- netto - vozvrat(as-of p_to_date) - moyka_sent(as-of p_to_date). vozvrat has
-- no shared scalar helper of its own (unlike effective_qty/moyka_asof/
-- loss_range), so its subquery is inlined here, copied from that same
-- precedent rather than invented fresh. Note this as-of moyka_sent figure is
-- DELIBERATELY different from the period-only Σ used for the displayed
-- Отправлено на мойку column -- same split the rest of the reporting engine
-- already makes between a period figure and its "_lifetime"/as-of twin.
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
),
-- One row per serial already in by_serial -- kirim_lines.serial/
-- kirim_orders.order_id are both 1:1 per line, so these joins never fan out.
serial_extra as (
  select
    bs.serial,
    kl.partiya_no,
    kl.declared_qty as nakladnoy_kg,
    ko.order_date as kirim_date,
    kirim_line_effective_qty(kl.serial) as netto_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
       where ms.serial = kl.serial and ms.sent_date between p_from_date and p_to_date) as moykaga_yuborilgan_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
       where ms.serial = kl.serial and ms.sent_date <= p_to_date) as moyka_sent_asof_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl
       join chiqim_lines cl on cl.id = rdl.chiqim_line_id
       join chiqim_requests cr on cr.id = cl.request_id
     where rdl.serial = kl.serial and cr.request_date <= p_to_date) as vozvrat_asof_kg,
    kirim_line_moyka_asof(kl.serial, p_to_date) as moykada_kg,
    kirim_line_loss_range(kl.serial, p_from_date, p_to_date) as loss_kg
  from by_serial bs
  join kirim_lines kl on kl.serial = bs.serial
  join kirim_orders ko on ko.order_id = kl.order_id
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'serial', bs.serial,
      'typeId', bs.type_id,
      'partiyaNo', se.partiya_no,
      'kirimDate', se.kirim_date,
      'nakladnoyKg', se.nakladnoy_kg,
      'nettoKg', se.netto_kg,
      'moykagaYuborilganKg', se.moykaga_yuborilgan_kg,
      'moykadaKg', se.moykada_kg,
      'ostatokSyryaKg', se.netto_kg - se.vozvrat_asof_kg - se.moyka_sent_asof_kg,
      'totalKg', bs.total_kg,
      'calibres', (
        select coalesce(jsonb_agg(jsonb_build_object('calibreId', bc.calibre_id, 'label', c.label, 'code', c.code, 'kg', bc.kg) order by c.sort_order), '[]'::jsonb)
        from by_calibre bc join calibres c on c.id = bc.calibre_id
        where bc.serial = bs.serial
      ),
      'poteryaKg', se.loss_kg
    ) order by bs.serial), '[]'::jsonb)
    from by_serial bs
    join serial_extra se on se.serial = bs.serial
  ),
  'totals', jsonb_build_object(
    'totalKg', coalesce((select sum(total_kg) from by_serial), 0),
    'nettoKg', coalesce((select sum(netto_kg) from serial_extra), 0),
    'moykagaYuborilganKg', coalesce((select sum(moykaga_yuborilgan_kg) from serial_extra), 0),
    'moykadaKg', coalesce((select sum(moykada_kg) from serial_extra), 0),
    'ostatokSyryaKg', coalesce((select sum(netto_kg - vozvrat_asof_kg - moyka_sent_asof_kg) from serial_extra), 0),
    -- "sum only non-null loss values" -- an in-progress serial (loss_kg is
    -- null, still В мойке) contributes nothing to this total rather than
    -- being coerced to 0, same as every other realized-loss aggregate in
    -- this codebase (report_totals' own state_yoqotish).
    'poteryaKg', coalesce((select sum(loss_kg) from serial_extra where loss_kg is not null), 0),
    'byCalibre', (
      select coalesce(jsonb_agg(jsonb_build_object('calibreId', calibre_id, 'label', label, 'code', code, 'kg', kg) order by sort_order), '[]'::jsonb)
      from totals_by_calibre
    )
  )
);
$$;
