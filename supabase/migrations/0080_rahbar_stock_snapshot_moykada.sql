-- Rahbar "Bosh sahifa" (Window 1, Zaxira tarkibi) is missing a category:
-- material already sent to Moyka but not yet returned as finished output.
-- stock_on_hand_rows' raw_rows CTE already deducts moyka_sends from the raw
-- balance the moment material is sent (so it correctly disappears from
-- "Xom"), and finished_pallets only appears once Moyka actually returns
-- output (so it correctly doesn't appear in "Tayyor" early either) -- the
-- gap between those two events was real material with no category of its
-- own in this snapshot. Same figure rahbar_dashboard_ledger already
-- computes as moykadaSnapshot.closingKg (point-in-time, "Hozir"), just not
-- surfaced in the point-in-time snapshot RPC Window 1's hero tiles/Silo
-- actually read.
--
-- moyka_lines/moykada_total below mirror rahbar_dashboard_ledger's own
-- moyka_in_process CTE exactly (same final-cycle exclusion: a 'final'
-- cycle's own sent-vs-output gap is yield loss, not material still
-- physically in Moyka), minus the p_to parameter -- this RPC has no date
-- range, it's always "right now," matching every other figure in it.
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
-- Old KN pool stock -- restored as its own figure (2026-08-13). See header
-- comment above for why this is kept separate from Konditirskiy rather
-- than folded in or dropped.
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'old_kn'
),
moyka_lines as (
  select
    kl.serial,
    wc.status as wash_cycle_status,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial) as output_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  left join wash_cycles wc on wc.serial = kl.serial
  where exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
moykada_total as (
  select coalesce(sum(
    case when wash_cycle_status = 'final' then 0
         else greatest(0, sent_kg - output_kg)
    end
  ), 0) as kg
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
