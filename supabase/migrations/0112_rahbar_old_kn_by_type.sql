-- Rahbar dashboard: add oldKnByType to rahbar_stock_snapshot, so the Eski
-- drill-down (RahbarHome.tsx) can show a second graph for "Старый склад
-- Кондитерка" (old KN pool stock) split by Vid syrya, alongside the
-- existing byCalibre graph for "Эски (ювилган)" (old washed stock).
--
-- Old KN pool stock (old_kn_pools/old_kn_collections) has been excluded
-- from this dashboard entirely since 0106 (v1.43, 2026-08-30) -- a
-- deliberate choice, not a side effect (see DECISIONS.md "Rahbar dashboard
-- corrections": "81,915 kg of real client stock has no representation on
-- this screen at all"). That choice stands for the headline totals
-- (totalKg/grandTotal keep excluding oldKnKg, unchanged here) and for the
-- Yangi-scope view. Confirmed with the user (2026-09-08): old KN becomes
-- visible again, but ONLY inside the existing Eski scope toggle, as its
-- own drill-down graph -- never re-added to the Yangi/main dashboard.
--
-- No new balance arithmetic: old_kn_total (the existing single pooled sum)
-- already reads `scoped` filtered to bucket = 'old_kn', which stock_on_hand_
-- rows only ever populates with is_old_stock = true rows (old_kn_rows CTE,
-- 0076) -- so at p_scope = 'yangi' this new key is naturally empty/zero,
-- consistent with "old KN never shows for new stock" without a separate
-- scope check. This is a GROUP BY over the same `scoped` rows old_kn_total
-- already sums, split by type_id instead of collapsed -- byte-identical
-- source, new shape only. Additive key on the existing jsonb return, same
-- pattern as 0106's own byCalibre/byType addition -- no signature change,
-- no DROP FUNCTION.
create or replace function public.rahbar_stock_snapshot(p_scope text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
old_kn_by_type as (
  select s.type_id, pt.name as type_name, coalesce(sum(s.qty_kg), 0) as kg
  from scoped s
  join product_types pt on pt.id = s.type_id
  where s.bucket = 'old_kn'
  group by s.type_id, pt.name
),
moyka_lines as (
  select
    kl.serial,
    wc.closed_at,
    -- voided pallets excluded: they are not product that came back from
    -- the wash, and counting them made this subtraction clamp to zero.
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_kg,
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
),
by_calibre as (
  select s.type_id, s.calibre_id, c.is_numberless, coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null
  group by s.type_id, s.calibre_id, c.is_numberless
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
  'byCalibre', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'typeId', type_id, 'calibreId', calibre_id, 'isNumberless', is_numberless, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_calibre
  ),
  'oldKnByType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'typeName', type_name, 'kg', kg) order by kg desc), '[]'::jsonb)
    from old_kn_by_type
  ),
  'distinctTypeCount', (select count(*) from by_type)
);
$function$;
