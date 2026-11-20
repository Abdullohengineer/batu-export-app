-- Rahbar dashboard (2026-11-20, docs/decisions/0247): per-product-type lines
-- under the "Jami yuvilgan va yuvilmagan", "Xom · yuvilmagan" and "Moykada"
-- hero tiles. Adds three keys to rahbar_stock_snapshot_core's output; every
-- existing key and figure is unchanged (the new subqueries reuse the
-- function's own CTEs, so they partition exactly the same rows the
-- headline numbers sum):
--   rawByType      -- rawKg split by type      (scoped raw_not_washed, non-Rezka)
--   moykadaByType  -- moykadaKg split by type  (same active_cycle/sends/outs math)
--   finishedByType -- finishedCalibredKg + konditirskiyKg split by type
--                     (in-stock pallets, excluding Rezka Standard output)
-- "Jami" per type = rawByType + moykadaByType + finishedByType, the same
-- composition as the headline (rawKg + moykadaKg + finishedCalibredKg +
-- konditirskiyKg); summed in the frontend.
--
-- Inserted by asserted text replacement before 'distinctTypeCount' so the
-- rest of the live body stays byte-identical.

do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.rahbar_stock_snapshot_core(text)'::regprocedure) into v_def;
  v_new := replace(v_def, $old$  'distinctTypeCount', (select count(*) from by_type)$old$, $new$  'rawByType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from (
      select type_id, sum(qty_kg) as kg from scoped
      where bucket = 'raw_not_washed' and serial not in (select serial from rezka_serials)
      group by type_id having sum(qty_kg) <> 0
    ) x
  ),
  'moykadaByType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from (
      select kl.type_id, sum(
        case when a.closed_at is not null and (a.closed_at at time zone 'utc')::date <= current_date then 0
             else greatest(0, coalesce(s.kg, 0) - coalesce(o.kg, 0)) end) as kg
      from active_cycle a
      join kirim_lines kl on kl.serial = a.serial
      left join sends_since s on s.serial = a.serial
      left join outs_since o on o.serial = a.serial
      group by kl.type_id
      having sum(
        case when a.closed_at is not null and (a.closed_at at time zone 'utc')::date <= current_date then 0
             else greatest(0, coalesce(s.kg, 0) - coalesce(o.kg, 0)) end) <> 0
    ) x
  ),
  'finishedByType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from (
      select s.type_id, sum(s.qty_kg) as kg
      from scoped s join calibres c on c.id = s.calibre_id
      where s.barcode2 is not null and not c.is_rezka_output
      group by s.type_id having sum(s.qty_kg) <> 0
    ) x
  ),
  'distinctTypeCount', (select count(*) from by_type)$new$);
  if v_new = v_def then raise exception '0163: distinctTypeCount anchor not found in rahbar_stock_snapshot_core'; end if;
  execute v_new;
end
$mig$;
