-- client_production_ledger (client Производство/Proizvodstvo report,
-- 0114): scoped_pallets excluded status='consumed' alongside the real
-- exclusions (bekor_qilindi, storage_loss). 'consumed' means the pallet
-- physically came out of Moyka and was later fully reused (mostly minted
-- into Rezka output) -- it WAS production that happened in the period, not
-- a void and not a write-off. Excluding it understated Global Export's
-- September 2026 total by 18,080 kg (93,810 reported vs 111,890 real,
-- confirmed live against the 20 consumed, non-mint-sourced pallets this
-- owner has in that window).
--
-- Fix: drop 'consumed' from the exclusion list. bekor_qilindi (voided) and
-- storage_loss stay excluded -- a void must never be counted as
-- production (it would double-count once the replacement pallet from a
-- re-wash is also counted), and storage_loss is a write-off, not output.
-- Same three-way distinction rahbar_dashboard_ledger's pallet_base
-- (0106_rahbar_dashboard_corrections.sql) already draws for the identical
-- reason, applied here for the first time.
--
-- Scope: this is the ONLY status filter in client_production_ledger, and
-- client_production_ledger is read by nothing else in this codebase
-- (confirmed via grep -- its only caller is ClientProizvodstvoTab.tsx).
-- Current-stock views (stock_on_hand_rows / Ombor qoldig'i, rahbar_stock_
-- snapshot's tiles) read finished_pallets through entirely separate
-- queries and are untouched by this migration -- they correctly keep
-- excluding 'consumed' pallets, which are no longer physically available
-- stock.
--
-- Reproduced verbatim from the live 0114/0154 body apart from this one
-- line (scoped_pallets' status predicate).

create or replace function public.client_production_ledger(p_from_date date, p_to_date date, p_product_type_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    and fp.status not in ('bekor_qilindi', 'storage_loss')
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
    'poteryaKg', coalesce((select sum(loss_kg) from serial_extra where loss_kg is not null), 0),
    'byCalibre', (
      select coalesce(jsonb_agg(jsonb_build_object('calibreId', calibre_id, 'label', label, 'code', code, 'kg', kg) order by sort_order), '[]'::jsonb)
      from totals_by_calibre
    )
  )
);
$function$;
