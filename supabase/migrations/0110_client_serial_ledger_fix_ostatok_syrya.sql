-- Fix client_serial_ledger's Остаток сырья (ostatokSyryaKg): was
-- D − L − E − K (K = 0 when the serial isn't finalized yet), which only
-- equals the correct balance when finalized (K = G − L there, so the two
-- formulas collapse to the same thing algebraically). For an UNFINALIZED
-- serial, K reads as 0 while L is only partial output-so-far -- the
-- formula silently drops the "still in Moyka, not yet realized as either
-- output or loss" portion (G2) from the subtraction entirely, inflating
-- the reported raw remainder by exactly G2 kg. Verified against production:
-- P11 (190826-002), moykaKg=700, processed so far=0, not finalized -- old
-- formula reported ostatokSyryaKg=8112, correct value is 7412 (8112-700).
--
-- Correct balance identity, independent of finalization state: raw
-- material that arrived (D) either left as a return to the client (E),
-- left for processing (G), or is still sitting in raw storage/yard --
-- there is no fourth bucket, and once material is sent to Moyka it is no
-- longer "raw sitting in the yard" regardless of whether processing on it
-- has finished, is ongoing, or has produced a realized loss. So:
--   Остаток сырья = D − E − G, always, whether finalized or not.
-- L and K never belong in this formula at all -- they describe what
-- happened to the G portion after it left the yard, not how much is
-- still there. R (Остаток гот. продукции = L − ΣM) is unaffected; it
-- never referenced K/finalization state and needs no change.
create or replace function client_serial_ledger(p_from_date date, p_to_date date, p_product_type_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
with
me as (select my_owner_id() as owner_id),
scoped as (
  select rkr.*
  from report_kirim_rows_as_of(p_to_date) rkr, me
  where rkr.owner_id = me.owner_id
    and rkr.origin = 'delivery'
    and rkr.date_basis between p_from_date and p_to_date
    and not rkr.provisional
    and (p_product_type_id is null or rkr.type_id = p_product_type_id)
),
serial_base as (
  select
    s.serial, s.type_id, s.partiya_no, s.date_basis, s.declared_qty, s.qty_kg as netto_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl
       join chiqim_lines cl on cl.id = rdl.chiqim_line_id
       join chiqim_requests cr on cr.id = cl.request_id
     where rdl.serial = s.serial and cr.request_date <= p_to_date) as vozvrat_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms
     where ms.serial = s.serial and ms.sent_date <= p_to_date) as moyka_kg,
    exists (select 1 from wash_cycles wc where wc.serial = s.serial and wc.closed_at is not null) as is_final
  from scoped s
),
pallet_base as (
  select fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg
  from finished_pallets fp
  join serial_base sb on sb.serial = fp.serial
  where fp.received_date <= p_to_date
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to_date
    )
    and not (fp.status = 'bekor_qilindi' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to_date))
    and not (fp.status = 'storage_loss' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to_date))
),
output_by_calibre as (
  select pb.serial, pb.calibre_id, c.label, c.code, c.sort_order, c.is_numberless,
         sum(pb.weight_kg) as kg
  from pallet_base pb join calibres c on c.id = pb.calibre_id
  group by pb.serial, pb.calibre_id, c.label, c.code, c.sort_order, c.is_numberless
),
output_by_serial as (
  select serial,
         coalesce(sum(kg) filter (where not is_numberless), 0) as calibre_kg,
         coalesce(sum(kg) filter (where is_numberless), 0) as kn_kg
  from output_by_calibre group by serial
),
dispatch_events as (
  select fp.serial, cr.request_date, cr.plate, fp.calibre_id, c.label, c.code, c.sort_order,
         sum(cpc.qty_kg) as kg
  from chiqim_pallet_consumption cpc
  join chiqim_lines cl on cl.id = cpc.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = cpc.barcode2
  join serial_base sb on sb.serial = fp.serial
  join calibres c on c.id = fp.calibre_id
  where chiqim_departed_at(cr.id) is not null
    and (chiqim_departed_at(cr.id) at time zone 'utc')::date <= p_to_date
  group by fp.serial, cr.request_date, cr.plate, fp.calibre_id, c.label, c.code, c.sort_order
),
dispatch_by_serial as (
  select serial, coalesce(sum(kg), 0) as kg from dispatch_events group by serial
),
rows_built as (
  select
    sb.serial, sb.type_id, sb.partiya_no, sb.date_basis, sb.declared_qty, sb.netto_kg,
    sb.vozvrat_kg, sb.moyka_kg, sb.is_final,
    coalesce(os.calibre_kg, 0) as calibre_kg,
    coalesce(os.kn_kg, 0) as kn_kg,
    coalesce(os.calibre_kg, 0) + coalesce(os.kn_kg, 0) as processed_kg, -- L
    sb.moyka_kg - (coalesce(os.calibre_kg, 0) + coalesce(os.kn_kg, 0)) as gap_kg, -- G - L, signed: + = loss, - = surplus
    coalesce(db.kg, 0) as dispatched_kg -- ΣM
  from serial_base sb
  left join output_by_serial os on os.serial = sb.serial
  left join dispatch_by_serial db on db.serial = sb.serial
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from_date, 'to', p_to_date),
  'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'serial', r.serial,
      'typeId', r.type_id,
      'partiyaNo', r.partiya_no,
      'date', r.date_basis,
      'declaredQtyKg', r.declared_qty,
      'nettoKg', r.netto_kg,
      'vozvratKg', r.vozvrat_kg,
      'raznitsaKg', r.declared_qty - r.netto_kg,
      'moykaKg', r.moyka_kg,
      'vPererabotkeKg', case when r.is_final then null else r.gap_kg end,
      'poteryaKg', case when r.is_final then r.gap_kg else null end,
      'itogoPererabotkaKg', r.processed_kg,
      'otgruzkaKg', r.dispatched_kg,
      'ostatokSyryaKg', r.netto_kg - r.vozvrat_kg - r.moyka_kg, -- D - E - G, always
      'ostatokGotovoyKg', r.processed_kg - r.dispatched_kg,
      'calibres', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'calibreId', oc.calibre_id, 'label', oc.label, 'code', oc.code, 'kg', oc.kg, 'isNumberless', oc.is_numberless
        ) order by oc.sort_order), '[]'::jsonb)
        from output_by_calibre oc where oc.serial = r.serial
      ),
      'dispatches', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'date', de.request_date, 'plate', de.plate, 'calibreId', de.calibre_id,
          'label', de.label, 'code', de.code, 'kg', de.kg
        ) order by de.request_date, de.sort_order), '[]'::jsonb)
        from dispatch_events de where de.serial = r.serial
      )
    ) order by r.date_basis, r.serial), '[]'::jsonb)
    from rows_built r
  ),
  'totals', (
    select jsonb_build_object(
      'declaredQtyKg', coalesce(sum(r.declared_qty), 0),
      'nettoKg', coalesce(sum(r.netto_kg), 0),
      'vozvratKg', coalesce(sum(r.vozvrat_kg), 0),
      'raznitsaKg', coalesce(sum(r.netto_kg - r.declared_qty), 0),
      'moykaKg', coalesce(sum(r.moyka_kg), 0),
      'vPererabotkeKg', coalesce(sum(case when not r.is_final then r.gap_kg else 0 end), 0),
      'poteryaKg', coalesce(sum(case when r.is_final then r.gap_kg else 0 end), 0),
      'itogoPererabotkaKg', coalesce(sum(r.processed_kg), 0),
      'otgruzkaKg', coalesce(sum(r.dispatched_kg), 0),
      'ostatokSyryaKg', coalesce(sum(r.netto_kg - r.vozvrat_kg - r.moyka_kg), 0), -- D - E - G, always
      'ostatokGotovoyKg', coalesce(sum(r.processed_kg - r.dispatched_kg), 0),
      'serialCount', count(*)
    )
    from rows_built r
  )
);
$$;
