-- Partiya badge type-prefix (2026-08-29, Prompt 9, see DECISIONS.md
-- "Restore Ombor Tayyor Window 2 + type-prefix on Partiya badge"). Every
-- other serial-carrying read path already exposes type_id/typeId
-- (Prompt 5's own 16-object partiya_no thread), but this one RPC never
-- did: client_serial_summary's own `owned` CTE selects
-- `kl.serial, kl.partiya_no, ko.owner_id, ko.order_date` from an already-
-- joined kirim_lines without kl.type_id, so the Global Export client
-- portal's per-serial drill-down (ClientSerialSummaryModal.tsx) has no way
-- to resolve which letter its own PartiyaBadge should show -- the one gap
-- that would have made the badge format inconsistent between internal and
-- client-facing screens. Adds `typeId` to the same already-scanned join --
-- not a new read, not a new balance calculation, jsonb-returning so plain
-- CREATE OR REPLACE FUNCTION applies (no RETURNS TABLE signature-change
-- restriction here).
create or replace function public.client_serial_summary(p_serial text)
returns jsonb
language sql
stable
as $function$
  with owned as (
    select kl.serial, kl.partiya_no, kl.type_id, ko.owner_id, ko.order_date
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where kl.serial = p_serial and ko.owner_id = my_owner_id()
  ),
  split as (
    select * from client_calibre_split((select serial from owned))
  ),
  by_calibre as (
    select fp.calibre_id, sum(fp.weight_kg) as kg
    from finished_pallets fp
    join owned o on o.serial = fp.serial
    join calibres c on c.id = fp.calibre_id
    where fp.status not in ('bekor_qilindi', 'storage_loss')
      and not c.is_numberless
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
    group by fp.calibre_id
  )
  select case when (select count(*) from owned) = 0 then null else jsonb_build_object(
    'serial', p_serial,
    'orderDate', (select order_date from owned),
    'partiyaNo', (select partiya_no from owned),
    'typeId', (select type_id from owned),
    'byCalibre', (
      select coalesce(jsonb_agg(jsonb_build_object('calibreId', bc.calibre_id, 'weightKg', bc.kg) order by bc.calibre_id), '[]'::jsonb)
      from by_calibre bc
    ),
    'knKg', (select kn_kg from split),
    'lossKg', (select client_serial_loss_kg((select serial from owned)))
  ) end;
$function$;
