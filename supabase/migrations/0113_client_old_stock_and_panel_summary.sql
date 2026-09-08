-- Client portal Part B.1 (Панель): two new self-scoped RPCs.
--
-- client_old_stock_breakdown() -- same shape OldStockDrilldown.tsx (Part A)
-- already renders: oldWashed (old washed finished stock, by calibre) +
-- oldKn (old KN pool, by Vid syrya). Reuses stock_on_hand_rows (the same
-- view Ombor qoldig'i / rahbar_stock_snapshot read) rather than
-- re-deriving the old-KN remaining-balance arithmetic a third time --
-- "reuse, don't rebuild" (CLAUDE.md). Explicitly filters
-- owner_id = my_owner_id() itself rather than relying on the view's own
-- RLS alone, per this project's established client-RPC convention (see
-- 0083's RLS-bypass-via-view-ownership finding, and every client_* RPC
-- since -- belt-and-suspenders, never a caller-supplied owner id).
--
-- client_panel_summary() -- current stock broken down by state (raw / in
-- Moyka / finished / old stock) + lifetime dispatched total, for the
-- Панель tab's headline tiles. "Old stock" reuses
-- client_old_stock_breakdown() verbatim rather than re-summing it.
-- rawKg/finishedKg read stock_on_hand_rows unfiltered by origin (CLAUDE.md
-- "Balance/stock views -- usually unfiltered; opening stock is real
-- stock"); the in-Moyka live balance is NOT in stock_on_hand_rows (that
-- view has no Moyka-in-process bucket) so it's computed the same way
-- rahbar_stock_snapshot's own moyka_lines/moykada_total CTE does, scoped
-- to this owner instead of a Zaxira toggle. dispatchedKg excludes TEST-%
-- plates, matching client_chiqim_ledger's own convention (0109).
--
-- Known, deliberate simplification (flagged, not solved here): a raw
-- serial sourced from opening stock but not yet sent to Moyka
-- ("old_raw", 0065's old_stock_closeouts.kind) is counted under rawKg,
-- not oldStockKg -- the Эski drill-down (Part A/B.1) only ever had two
-- graphs (ювилган + Старый склад Кондитерка), never a third for old raw,
-- so folding it into the plain "raw" bucket keeps the four Панель buckets
-- summing to the true total without inventing a fifth bucket the task
-- never asked for.
create or replace function client_old_stock_breakdown()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with me as (select my_owner_id() as owner_id),
old_washed as (
  select s.calibre_id, c.label, c.code, c.sort_order, coalesce(sum(s.qty_kg), 0) as kg
  from stock_on_hand_rows s
  join calibres c on c.id = s.calibre_id, me
  where s.owner_id = me.owner_id and s.barcode2 is not null and s.is_old_stock
  group by s.calibre_id, c.label, c.code, c.sort_order
),
old_kn as (
  select s.type_id, pt.name as type_name, coalesce(sum(s.qty_kg), 0) as kg
  from stock_on_hand_rows s
  join product_types pt on pt.id = s.type_id, me
  where s.owner_id = me.owner_id and s.bucket = 'old_kn'
  group by s.type_id, pt.name
)
select jsonb_build_object(
  'oldWashed', jsonb_build_object(
    'totalKg', coalesce((select sum(kg) from old_washed), 0),
    'byCalibre', coalesce(
      (select jsonb_agg(jsonb_build_object('calibreId', calibre_id, 'label', label, 'code', code, 'kg', kg) order by sort_order) from old_washed),
      '[]'::jsonb
    )
  ),
  'oldKn', jsonb_build_object(
    'totalKg', coalesce((select sum(kg) from old_kn), 0),
    'byType', coalesce(
      (select jsonb_agg(jsonb_build_object('typeId', type_id, 'typeName', type_name, 'kg', kg) order by kg desc) from old_kn),
      '[]'::jsonb
    )
  )
);
$$;

create or replace function client_panel_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid := my_owner_id();
  v_raw_kg numeric := 0;
  v_finished_kg numeric := 0;
  v_moyka_kg numeric := 0;
  v_old jsonb;
  v_dispatched_kg numeric := 0;
begin
  if v_owner is null then
    return jsonb_build_object(
      'stock', jsonb_build_object('rawKg', 0, 'moykaKg', 0, 'finishedKg', 0, 'oldStockKg', 0),
      'dispatchedKg', 0
    );
  end if;

  select coalesce(sum(qty_kg), 0) into v_raw_kg
  from stock_on_hand_rows
  where owner_id = v_owner and bucket = 'raw_not_washed';

  select coalesce(sum(qty_kg), 0) into v_finished_kg
  from stock_on_hand_rows
  where owner_id = v_owner and barcode2 is not null and not is_old_stock;

  select coalesce(sum(greatest(sent_kg - output_kg, 0)), 0) into v_moyka_kg
  from (
    select
      kl.serial,
      wc.closed_at,
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_kg,
      (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp
        where fp.serial = kl.serial and fp.status <> 'bekor_qilindi') as output_kg
    from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    left join wash_cycles wc on wc.serial = kl.serial
    where ko.owner_id = v_owner
      and ko.plate not like 'TEST-%'
      and exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
  ) moyka_lines
  where closed_at is null;

  v_old := client_old_stock_breakdown();

  select coalesce(sum(cl.qty_kg), 0) into v_dispatched_kg
  from chiqim_lines cl
  join chiqim_requests cr on cr.id = cl.request_id
  where cr.owner_id = v_owner
    and cr.plate not like 'TEST-%'
    and chiqim_departed_at(cr.id) is not null;

  return jsonb_build_object(
    'stock', jsonb_build_object(
      'rawKg', v_raw_kg,
      'moykaKg', v_moyka_kg,
      'finishedKg', v_finished_kg,
      'oldStockKg', coalesce((v_old -> 'oldWashed' ->> 'totalKg')::numeric, 0) + coalesce((v_old -> 'oldKn' ->> 'totalKg')::numeric, 0)
    ),
    'dispatchedKg', v_dispatched_kg
  );
end;
$$;
