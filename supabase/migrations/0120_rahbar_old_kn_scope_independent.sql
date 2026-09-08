-- Rahbar dashboard: old-KN total/by-type made scope-independent (2026-09-08).
--
-- Fix 2's own instruction: a new hero tile shows Старый склад Кондитерка's
-- live total on ALL Zaxira toggle states (Yangi/Eski/Hammasi), because it's
-- real client stock, always relevant -- not something that should read 0
-- just because the Yangi toggle is selected. Previously old_kn_total/
-- old_kn_by_type were computed from `scoped` (stock_on_hand_rows filtered by
-- p_scope), and old-KN rows are structurally always is_old_stock=true, so
-- they silently disappeared at p_scope='yangi' (0 kg) even though the real
-- figure (81,915 kg live) never changed.
--
-- Fix: both CTEs now read stock_on_hand_rows directly, unfiltered by scope.
-- Zero behaviour change at 'eski'/'hammasi' (old-KN rows were never actually
-- excluded by the scope filter at either of those -- confirmed live,
-- unchanged before/after) -- only 'yangi' changes, from 0 to the real total.
-- `totalKg` (an existing jsonb field, unused by the frontend -- confirmed via
-- grep, RahbarHome.tsx computes its own separate grandTotal) picks up the
-- same change incidentally; no visible effect.
create or replace function rahbar_stock_snapshot(p_scope text)
returns jsonb
language sql stable
as $$
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
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where bucket = 'old_kn'
),
old_kn_by_type as (
  select s.type_id, pt.name as type_name, coalesce(sum(s.qty_kg), 0) as kg
  from stock_on_hand_rows s
  join product_types pt on pt.id = s.type_id
  where s.bucket = 'old_kn'
  group by s.type_id, pt.name
),
moyka_lines as (
  select
    kl.serial,
    wc.closed_at,
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
$$;
