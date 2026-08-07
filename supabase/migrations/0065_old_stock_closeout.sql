-- Old-stock reconciliation (2026-08-05): Menejer's "Eski zaxira hisob-kitobi"
-- screen. Opening stock was seeded with approximate weights and has lost
-- mass to dehydration over a year -- when a type is fully collected, the
-- system still shows a remaining book balance that physically doesn't
-- exist. This lets Menejer close a type out and book the shortfall as
-- storage loss, kept isolated from processing loss.
--
-- Design (confirmed): three genuinely different underlying shapes get three
-- different close-out mechanisms rather than one forced-uniform one --
-- old_washed flips finished_pallets.status (every consumer already filters
-- on it), old_kn gets a closed_at lifecycle flag on the pool (every
-- consumer already reads through stock_on_hand_rows), old_raw has no
-- single entity to flag and needs a genuine two-sided fix (this migration's
-- stock_on_hand_rows change plus a separate useMoykaSerials.ts patch,
-- since that hook computes raw balance independently and does not read
-- stock_on_hand_rows at all -- traced, not assumed).
--
-- The ledger (old_stock_closeouts) is read by nothing on the processing
-- side -- isolation from yield_rows/loss percentages is structural (no
-- query exists to union it in), not a filter someone has to remember.

-- old_kn_pools: a lifecycle timestamp on the entity itself, same pattern as
-- wash_cycles.finalized_at / chiqim_requests.voided_at.
alter table old_kn_pools add column closed_at timestamptz;

-- The cross-kind storage-loss ledger.
-- unique(kind, owner_id, type_id): close-out is final and total, per scope
-- ("close-out only for now, no partial recounts, no re-open").
create table old_stock_closeouts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('old_washed', 'old_kn', 'old_raw')),
  owner_id uuid not null references owners(id),
  type_id uuid not null references product_types(id),
  book_remaining_kg numeric not null check (book_remaining_kg >= 0),
  closed_at timestamptz not null default now(),
  closed_by uuid references profiles(id),
  unique (kind, owner_id, type_id)
);

alter table old_stock_closeouts enable row level security;
create policy read_all on old_stock_closeouts for select using (auth.uid() is not null);
-- No direct write policy: written exclusively by close_out_old_stock()
-- below, which is SECURITY DEFINER and bypasses RLS -- same precedent as
-- serial_mint_sources (written only by mint_serial_from_sources()).

create or replace function close_out_old_stock(p_kind text, p_owner_id uuid, p_type_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  v_remaining numeric;
begin
  -- SECURITY DEFINER bypasses RLS, so the role gate is explicit and
  -- mandatory -- Menejer has no direct write access to finished_pallets or
  -- old_kn_pools (that's Ombor's domain); this function is the only way
  -- Menejer may flip either, per CLAUDE.md's status-flip rule.
  if my_role() is distinct from 'menejer' then
    raise exception 'Faqat Menejer eski zaxirani yakunlay oladi' using errcode = '42501';
  end if;
  if p_kind not in ('old_washed', 'old_kn', 'old_raw') then
    raise exception 'Notoʻgʻri tur' using errcode = '22023';
  end if;
  if exists (select 1 from old_stock_closeouts where kind = p_kind and owner_id = p_owner_id and type_id = p_type_id) then
    raise exception 'Bu qator allaqachon yakunlangan' using errcode = '23505';
  end if;

  if p_kind = 'old_washed' then
    -- Lock every remaining pallet first (deterministic order, same
    -- deadlock-avoidance reasoning as mint_serial_from_sources' pallet lock).
    perform 1 from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
     order by fp.barcode2 for update of fp;

    select coalesce(sum(fp.weight_kg), 0) into v_remaining
      from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id;

    update finished_pallets fp set status = 'storage_loss', voided_at = now()
      from kirim_lines kl, kirim_orders ko
     where fp.serial = kl.serial and kl.order_id = ko.order_id
       and fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id;

  elsif p_kind = 'old_kn' then
    -- Identical formula to stock_on_hand_rows' old_kn_rows CTE and
    -- mint_serial_from_sources' own pool-balance check -- one derived
    -- truth, not a fourth reimplementation.
    select p.opening_kg
         - coalesce((select sum(oc.collected_kg) from old_kn_collections oc where oc.pool_id = p.id), 0)
         - coalesce((select sum(s.weight_kg) from serial_mint_sources s where s.source_kind = 'weight_pool' and s.source_pool_id = p.id), 0)
      into v_remaining
      from old_kn_pools p
     where p.owner_id = p_owner_id and p.type_id = p_type_id and p.closed_at is null
     for update;

    if v_remaining is null then
      raise exception 'Havza topilmadi yoki allaqachon yakunlangan' using errcode = '23503';
    end if;

    update old_kn_pools set closed_at = now() where owner_id = p_owner_id and type_id = p_type_id;

  else -- old_raw
    -- Same formula as stock_on_hand_rows' raw_rows CTE, summed across every
    -- old-raw serial for this owner+type (there can be more than one).
    -- Not row-locked across the full multi-table derivation -- a genuine
    -- concurrent-send-during-closeout race is theoretically possible but
    -- accepted here: this is a rare, deliberate Menejer action, not a
    -- hot path, and perfect concurrency control would need to block new
    -- moyka_sends/raw_dispatch_lines inserts for the duration, which is
    -- out of proportion to the risk. Noted, not silently skipped.
    select coalesce(sum(greatest(0, r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0))), 0)
      into v_remaining
      from report_kirim_rows r
      join storage_intake si on si.serial = r.serial
      join kirim_orders rko on rko.order_id = r.order_id
      left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
      left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
     where rko.owner_id = p_owner_id and r.type_id = p_type_id and rko.origin = 'opening_stock';
  end if;

  v_remaining := greatest(0, coalesce(v_remaining, 0));

  insert into old_stock_closeouts (kind, owner_id, type_id, book_remaining_kg, closed_by)
  values (p_kind, p_owner_id, p_type_id, v_remaining, v_actor);

  return v_remaining;
end;
$function$;

-- The screen's data source -- every old-stock line, open or closed, so a
-- closed line renders as a badge rather than vanishing from the screen.
create or replace view old_stock_closeout_lines as
with old_washed_lines as (
  select 'old_washed'::text as kind, ko.owner_id, fp.type_id,
    sum(fp.weight_kg) as opening_kg,
    sum(fp.weight_kg) filter (where fp.status not in ('in_stock', 'storage_loss')) as collected_kg,
    sum(fp.weight_kg) filter (where fp.status = 'in_stock') as remaining_kg
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where fp.is_old_stock
  group by ko.owner_id, fp.type_id
),
old_kn_lines as (
  select 'old_kn'::text as kind, p.owner_id, p.type_id,
    p.opening_kg,
    coalesce((select sum(oc.collected_kg) from old_kn_collections oc where oc.pool_id = p.id), 0) as collected_kg,
    greatest(0, p.opening_kg
      - coalesce((select sum(oc.collected_kg) from old_kn_collections oc where oc.pool_id = p.id), 0)
      - coalesce((select sum(s.weight_kg) from serial_mint_sources s where s.source_kind = 'weight_pool' and s.source_pool_id = p.id), 0)
    ) as remaining_kg
  from old_kn_pools p
),
old_raw_lines as (
  select 'old_raw'::text as kind, r.owner_id, r.type_id,
    sum(r.qty_kg) as opening_kg,
    sum(coalesce(sent.total_sent, 0) + coalesce(raw.total_raw, 0)) as collected_kg,
    sum(greatest(0, r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0))) as remaining_kg
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  join kirim_orders rko on rko.order_id = r.order_id
  left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
  left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
  where rko.origin = 'opening_stock'
  group by r.owner_id, r.type_id
),
all_lines as (
  select * from old_washed_lines
  union all select * from old_kn_lines
  union all select * from old_raw_lines
)
select al.kind, al.owner_id, al.type_id, al.opening_kg, al.collected_kg, al.remaining_kg,
  osc.closed_at, osc.book_remaining_kg as closed_book_remaining_kg, osc.closed_by
from all_lines al
left join old_stock_closeouts osc on osc.kind = al.kind and osc.owner_id = al.owner_id and osc.type_id = al.type_id;

-- stock_on_hand_rows: old_kn respects the new closed_at flag; raw_not_washed
-- excludes any old-raw line that's been closed out (all-or-nothing, matching
-- close-out-only scope, so a full exclusion is correct, not a partial
-- subtraction).
create or replace view stock_on_hand_rows as
with pallet_rows as (
  select
    case
      when lr.verdict = 'qayta_yuvish' then 'qayta_yuvish'
      when lr.verdict is null then 'awaiting_lab'
      when dm.request_id is not null then 'band_qilingan'
      else 'available'
    end as bucket,
    fp.barcode2 as row_key, fp.serial, fp.barcode2, ko.owner_id, fp.type_id, fp.calibre_id,
    fp.weight_kg as qty_kg, fp.received_date as anchor_date, lr.moisture_pct,
    null::numeric as box_mass_kg, fp.is_old_stock, fp.weight_is_estimate
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1) dm on true
  left join chiqim_requests cr on cr.id = dm.request_id
  left join lateral (
    select cgw2.completed_at from gate_weighings cgw2
    where cgw2.dir = 'chiqim' and cgw2.request_id = dm.request_id
    order by cgw2.completed_at desc nulls last limit 1
  ) cgw on true
  left join lateral (select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1) wc on true
  left join lateral (
    select lr3.verdict, lr3.moisture_pct from lab_results lr3
    where lr3.scope = 'chiqim' and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc limit 1
  ) lr on true
  where fp.status = 'in_stock' and not (dm.request_id is not null and cgw.completed_at is not null)
    and ko.plate !~~ 'TEST-%' and coalesce(cr.plate, '') !~~ 'TEST-%'
),
raw_rows as (
  select 'raw_not_washed' as bucket, r.row_key, r.serial, null::text as barcode2, r.owner_id, r.type_id,
    null::uuid as calibre_id,
    r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0) as qty_kg,
    r.date_basis as anchor_date, kirim_lr.moisture_pct, r.box_mass_kg,
    r.origin = 'opening_stock' as is_old_stock, false as weight_is_estimate
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
  left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
  left join lateral (
    select lr4.moisture_pct from lab_results lr4
    where lr4.scope = 'kirim' and lr4.parent_serial = r.serial
    order by lr4.created_at desc limit 1
  ) kirim_lr on true
  where (r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0)) > 0
    and not exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = r.owner_id and osc.type_id = r.type_id
    )
),
old_kn_rows as (
  select 'old_kn' as bucket, p.id::text as row_key, null::text as serial, null::text as barcode2,
    p.owner_id, p.type_id, null::uuid as calibre_id,
    p.opening_kg - coalesce(c.collected, 0) - coalesce(m.minted, 0) as qty_kg,
    null::date as anchor_date, null::numeric as moisture_pct, null::numeric as box_mass_kg,
    true as is_old_stock, null::boolean as weight_is_estimate
  from old_kn_pools p
  left join lateral (select coalesce(sum(oc.collected_kg), 0) as collected from old_kn_collections oc where oc.pool_id = p.id) c on true
  left join lateral (
    select coalesce(sum(sms.weight_kg), 0) as minted from serial_mint_sources sms
    where sms.source_kind = 'weight_pool' and sms.source_pool_id = p.id
  ) m on true
  where (p.opening_kg - coalesce(c.collected, 0) - coalesce(m.minted, 0)) > 0
    and p.closed_at is null
)
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
  current_date - anchor_date as days_held, (current_date - anchor_date) > 90 as aged_90,
  moisture_pct, box_mass_kg, is_old_stock, weight_is_estimate
from pallet_rows
union all
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
  current_date - anchor_date as days_held, (current_date - anchor_date) > 90 as aged_90,
  moisture_pct, box_mass_kg, is_old_stock, weight_is_estimate
from raw_rows
union all
select bucket, row_key, serial, barcode2, owner_id, type_id, calibre_id, qty_kg, anchor_date,
  null::integer as days_held, false as aged_90,
  moisture_pct, box_mass_kg, is_old_stock, weight_is_estimate
from old_kn_rows;

-- report_chiqim_rows: one new WHEN arm -- without it a closed-out pallet
-- would silently fall through to 'omborda', implying it's still in the
-- warehouse.
create or replace view report_chiqim_rows as
select
  'chiqim'::text as kind, fp.barcode2 as row_key, fp.serial, fp.barcode2, kl.order_id, dm.request_id,
  ko.owner_id, fp.type_id, fp.calibre_id, coalesce(cr.plate, '') as plate, coalesce(cr.driver, '') as driver,
  cr.request_date as date_basis, null::text as date_basis_source, fp.weight_kg as qty_kg, false as provisional,
  null::numeric as declared_qty, null::numeric as truck_variance_diff_kg, null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag, null::integer as wash_cycle,
  case
    when fp.status = 'bekor_qilindi' then 'bekor_qilingan'
    when fp.status = 'consumed' then 'ishlatilgan'
    when fp.status = 'storage_loss' then 'saqlashda_yoqolgan'
    when dm.request_id is not null then
      case when cgw.completed_at is not null then 'jonatilgan' else 'band_qilingan' end
    else 'omborda'
  end as pallet_status,
  lr.verdict as lab_verdict, kl.target_moisture_pct, kl.target_so2_mg_kg, lr.moisture_pct, lr.so2_mg_kg,
  null::text[] as void_successor_barcodes, null::numeric as box_mass_kg
from finished_pallets fp
join kirim_lines kl on kl.serial = fp.serial
join kirim_orders ko on ko.order_id = kl.order_id
left join lateral (select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1) dm on true
left join chiqim_requests cr on cr.id = dm.request_id
left join lateral (
  select cgw2.completed_at from gate_weighings cgw2
  where cgw2.dir = 'chiqim' and cgw2.request_id = dm.request_id
  order by cgw2.completed_at desc nulls last limit 1
) cgw on true
left join lateral (select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1) wc on true
left join lateral (
  select lr3.verdict, lr3.moisture_pct, lr3.so2_mg_kg from lab_results lr3
  where lr3.scope = 'chiqim' and lr3.wash_cycle_id = wc.id
  order by lr3.created_at desc limit 1
) lr on true
where ko.plate !~~ 'TEST-%' and coalesce(cr.plate, '') !~~ 'TEST-%';

-- get_client_report: new 'storageLoss' top-level section (sibling to 'raw'/
-- 'oldKn'/'finished'). client_lines gains two as-of-gated closure flags
-- (opening vs closing need different date gates -- a closure landing
-- mid-period must still show the pre-closure balance at period start,
-- same shape as dispatched_before_from_kg/dispatched_as_of_to_kg).
-- raw_opening_total/raw_closing_total (and by-type) exclude closed old-raw
-- lines; a new cumulativeStorageLossKg reconciliation term keeps
-- balancesKg at 0. client_pallets excludes storage-loss pallets the same
-- way it already excludes bekor_qilindi. Everything else is byte-identical
-- to the pre-migration version.
create or replace function public.get_client_report(p_owner_id uuid, p_from date, p_to date)
 returns jsonb
 language sql
 stable
as $function$
with
client_lines as (
  select
    kl.serial, kl.type_id, ko.plate, ko.driver, kl.target_moisture_pct, kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date, rkr.provisional, rkr.origin,
    (si.serial is not null) as has_intake,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_actual_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date between p_from and p_to) as sent_during_period_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
    wc.id as wash_cycle_id, wc.status as wash_cycle_status, wc.finalized_at,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date < p_from
    ) as closed_before_from,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date <= p_to
    ) as closed_as_of_to
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  left join storage_intake si
    on si.serial = kl.serial
   and si.confirmed_at is not null
   and (si.confirmed_at at time zone 'utc')::date <= p_to
  where ko.owner_id = p_owner_id
),
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake and not closed_before_from
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to and origin = 'delivery'
),
raw_sent_to_moyka_period_total as (
  select coalesce(sum(sent_during_period_kg), 0) as kg from client_lines
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
moykada_total as (
  select coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg)
    end
  ), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
raw_processed_total as (
  select coalesce(sum(sent_capped_kg), 0) as kg from client_lines where completed_date between p_from and p_to
),
raw_processed_actual_total as (
  select coalesce(sum(sent_actual_kg), 0) as kg from client_lines where completed_date between p_from and p_to
),
capped_serials as (
  select serial, sent_actual_kg as actual_sent_kg, effective_qty as effective_qty_kg, sent_actual_kg - sent_capped_kg as overage_kg
  from client_lines
  where completed_date between p_from and p_to and sent_actual_kg > sent_capped_kg
),
raw_types as (select distinct type_id from client_lines),
raw_opening_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake and not closed_before_from group by type_id
),
raw_received_by_type as (
  select type_id, coalesce(sum(effective_qty), 0) as kg from client_lines
  where arrival_date between p_from and p_to and origin = 'delivery' group by type_id
),
raw_sent_to_moyka_by_type as (
  select type_id, coalesce(sum(sent_during_period_kg), 0) as kg from client_lines group by type_id
),
raw_closing_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to group by type_id
),
moykada_by_type as (
  select type_id, coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg)
    end
  ), 0) as kg from client_lines where arrival_date <= p_to and has_intake group by type_id
),
raw_processed_by_type as (
  select type_id, coalesce(sum(sent_capped_kg), 0) as kg from client_lines
  where completed_date between p_from and p_to group by type_id
),
raw_dispatch_events as (
  select rdl.id, rdl.serial, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, cl.type_id,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where cr.owner_id = p_owner_id
),
raw_dispatch_total as (
  select coalesce(sum(net_kg), 0) as kg from raw_dispatch_events where request_date between p_from and p_to
),
raw_dispatch_by_type as (
  select type_id, coalesce(sum(net_kg), 0) as kg from raw_dispatch_events
  where request_date between p_from and p_to group by type_id
),
old_kn_events as (
  select okc.id, okc.collected_kg, cl.type_id,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from old_kn_collections okc
  join old_kn_pools okp on okp.id = okc.pool_id
  join chiqim_lines cl on cl.id = okc.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where okp.owner_id = p_owner_id
),
old_kn_collected_total as (
  select coalesce(sum(collected_kg), 0) as kg from old_kn_events where request_date between p_from and p_to
),
storage_loss_events as (
  select osc.kind, osc.type_id, osc.book_remaining_kg, osc.closed_at
  from old_stock_closeouts osc
  where osc.owner_id = p_owner_id
),
storage_loss_total as (
  select coalesce(sum(book_remaining_kg), 0) as kg from storage_loss_events
  where (closed_at at time zone 'utc')::date between p_from and p_to
),
cumulative_storage_loss_total as (
  select coalesce(sum(book_remaining_kg), 0) as kg from old_stock_closeouts
  where kind = 'old_raw' and owner_id = p_owner_id and (closed_at at time zone 'utc')::date <= p_to
),
loss_totals as (
  select cl.serial, cl.sent_actual_kg
  from client_lines cl
  where cl.wash_cycle_status = 'final'
    and cl.finalized_at is not null
    and (cl.finalized_at at time zone 'utc')::date <= p_to
    and cl.completed_date between p_from and p_to
    and cl.origin != 'opening_stock'
),
loss_output as (
  select
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg
  from loss_totals lt
  join finished_pallets fp on fp.serial = lt.serial
  join calibres c on c.id = fp.calibre_id
  where fp.received_date <= p_to
),
loss_main as (
  select
    (select coalesce(sum(sent_actual_kg), 0) from loss_totals) as sent_kg,
    (select coalesce(calibre_kg, 0) from loss_output) as calibre_kg,
    (select coalesce(konditirskiy_kg, 0) from loss_output) as konditirskiy_kg
),
cumulative_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_output_total as (
  select coalesce(sum(output_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_loss_total as (
  select coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to
         then greatest(0, sent_as_of_to_kg - output_as_of_to_kg) else 0 end
  ), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
cumulative_raw_dispatched_total as (
  select coalesce(sum(dispatched_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
client_pallets as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg, fp.received_date, ko.origin,
    (
      select cr.request_date
      from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      join chiqim_requests cr on cr.id = dm.request_id
      where dm.barcode2 = fp.barcode2
        and cgw.completed_at is not null
        and (cgw.completed_at at time zone 'utc')::date <= p_to
      order by cgw.completed_at desc nulls last
      limit 1
    ) as departure_date
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where ko.owner_id = p_owner_id
    and fp.received_date <= p_to
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2
        and (sms.created_at at time zone 'utc')::date <= p_to
    )
    and not (
      fp.status = 'bekor_qilindi'
      and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to)
    )
    and not (
      fp.status = 'storage_loss'
      and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to)
    )
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where (received_date < p_from or origin = 'opening_stock')
    and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets
  where received_date between p_from and p_to and origin != 'opening_stock'
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from client_pallets where departure_date between p_from and p_to
),
finished_calibres as (select distinct calibre_id from client_pallets),
finished_opening_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where (received_date < p_from or origin = 'opening_stock')
    and (departure_date is null or departure_date >= p_from) group by calibre_id
),
finished_produced_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets
  where received_date between p_from and p_to and origin != 'opening_stock' group by calibre_id
),
finished_dispatched_by_calibre as (
  select calibre_id, sum(weight_kg) as kg from client_pallets where departure_date between p_from and p_to group by calibre_id
),
quality_record as (
  select
    cl.serial, cl.type_id, cl.plate, cl.driver, cl.arrival_date, cl.target_moisture_pct, cl.target_so2_mg_kg,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = cl.serial
      order by lr.created_at desc limit 1
    ) as intake_lab,
    (
      select jsonb_build_object('moisturePct', lr.moisture_pct, 'so2MgKg', lr.so2_mg_kg, 'verdict', lr.verdict, 'sampleDate', lr.sample_date)
      from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = cl.wash_cycle_id
      order by lr.created_at desc limit 1
    ) as delivered_lab
  from client_lines cl
  where cl.origin != 'opening_stock'
    and (
      cl.arrival_date between p_from and p_to
      or cl.completed_date between p_from and p_to
      or exists (select 1 from client_pallets cp where cp.serial = cl.serial and cp.departure_date between p_from and p_to)
    )
),
period_dispatch_ids as (
  select distinct cr.id as request_id
  from chiqim_requests cr
  join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  where cr.owner_id = p_owner_id
    and cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
    and cr.request_date between p_from and p_to
)
select jsonb_build_object(
  'owner', (select jsonb_build_object('id', id, 'name', name) from owners where id = p_owner_id),
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'raw', jsonb_build_object(
    'openingKg', (select kg from raw_opening_total),
    'receivedKg', (select kg from raw_received_total),
    'sentToMoykaKg', (select kg from raw_sent_to_moyka_period_total),
    'processedKg', (select kg from raw_processed_total),
    'processedActualSentKg', (select kg from raw_processed_actual_total),
    'processedOverageKg', (select kg from raw_processed_actual_total) - (select kg from raw_processed_total),
    'rawDispatchedKg', (select kg from raw_dispatch_total),
    'moykadaKg', (select kg from moykada_total),
    'cappedSerials', (
      select coalesce(jsonb_agg(
        jsonb_build_object('serial', cs.serial, 'actualSentKg', cs.actual_sent_kg, 'effectiveQtyKg', cs.effective_qty_kg, 'overageKg', cs.overage_kg)
        order by cs.serial
      ), '[]'::jsonb)
      from capped_serials cs
    ),
    'closingKg', (select kg from raw_closing_total),
    'processedBreakdown', jsonb_build_object(
      'calibreKg', (select calibre_kg from loss_main),
      'konditirskiyKg', (select konditirskiy_kg from loss_main),
      'lossKg', (select sent_kg - calibre_kg - konditirskiy_kg from loss_main),
      'lossPct', case when (select sent_kg from loss_main) > 0
                 then round((select sent_kg - calibre_kg - konditirskiy_kg from loss_main) / (select sent_kg from loss_main) * 100, 1)
                 else 0 end
    ),
    'byType', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'typeId', rt.type_id,
          'openingKg', coalesce(rot.kg, 0), 'receivedKg', coalesce(rrt.kg, 0),
          'sentToMoykaKg', coalesce(rsmt.kg, 0),
          'processedKg', coalesce(rpt.kg, 0),
          'rawDispatchedKg', coalesce(rdt.kg, 0),
          'moykadaKg', coalesce(mbt.kg, 0),
          'closingKg', coalesce(rct.kg, 0)
        )
      ), '[]'::jsonb)
      from raw_types rt
      left join raw_opening_by_type rot on rot.type_id = rt.type_id
      left join raw_received_by_type rrt on rrt.type_id = rt.type_id
      left join raw_sent_to_moyka_by_type rsmt on rsmt.type_id = rt.type_id
      left join raw_processed_by_type rpt on rpt.type_id = rt.type_id
      left join raw_dispatch_by_type rdt on rdt.type_id = rt.type_id
      left join moykada_by_type mbt on mbt.type_id = rt.type_id
      left join raw_closing_by_type rct on rct.type_id = rt.type_id
    ),
    'dispatches', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'requestId', rde.request_id, 'requestDate', rde.request_date, 'plate', rde.plate, 'driver', rde.driver,
          'serial', rde.serial, 'weightKg', rde.weight_kg, 'boxMassKg', rde.box_mass_kg, 'netKg', rde.net_kg
        ) order by rde.request_date desc
      ), '[]'::jsonb)
      from raw_dispatch_events rde
      where rde.request_date between p_from and p_to
    ),
    'reconciliation', jsonb_build_object(
      'totalReceivedKg', (select kg from cumulative_received_total),
      'xomKg', (select kg from raw_closing_total),
      'moykadaKg', (select kg from moykada_total),
      'cumulativeOutputKg', (select kg from cumulative_output_total),
      'cumulativeLossKg', (select kg from cumulative_loss_total),
      'cumulativeRawDispatchedKg', (select kg from cumulative_raw_dispatched_total),
      'cumulativeStorageLossKg', (select kg from cumulative_storage_loss_total),
      'balancesKg', (select kg from cumulative_received_total)
        - (select kg from raw_closing_total) - (select kg from moykada_total)
        - (select kg from cumulative_output_total) - (select kg from cumulative_loss_total)
        - (select kg from cumulative_raw_dispatched_total) - (select kg from cumulative_storage_loss_total)
    )
  ),
  'oldKn', jsonb_build_object(
    'collectedKg', (select kg from old_kn_collected_total),
    'collections', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'requestId', oke.request_id, 'requestDate', oke.request_date, 'plate', oke.plate, 'driver', oke.driver,
          'typeId', oke.type_id, 'collectedKg', oke.collected_kg
        ) order by oke.request_date desc
      ), '[]'::jsonb)
      from old_kn_events oke where oke.request_date between p_from and p_to
    )
  ),
  'storageLoss', jsonb_build_object(
    'totalKg', (select kg from storage_loss_total),
    'lines', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'kind', sle.kind, 'typeId', sle.type_id,
          'closedDate', (sle.closed_at at time zone 'utc')::date, 'bookRemainingKg', sle.book_remaining_kg
        ) order by sle.closed_at desc
      ), '[]'::jsonb)
      from storage_loss_events sle
      where (sle.closed_at at time zone 'utc')::date between p_from and p_to
    )
  ),
  'finished', jsonb_build_object(
    'openingKg', (select kg from finished_opening_total),
    'producedKg', (select kg from finished_produced_total),
    'dispatchedKg', (select kg from finished_dispatched_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total) - (select kg from finished_dispatched_total),
    'byCalibre', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'calibreId', fc.calibre_id,
          'openingKg', coalesce(fo.kg, 0), 'producedKg', coalesce(fp2.kg, 0), 'dispatchedKg', coalesce(fd.kg, 0),
          'closingKg', coalesce(fo.kg, 0) + coalesce(fp2.kg, 0) - coalesce(fd.kg, 0)
        )
      ), '[]'::jsonb)
      from finished_calibres fc
      left join finished_opening_by_calibre fo on fo.calibre_id = fc.calibre_id
      left join finished_produced_by_calibre fp2 on fp2.calibre_id = fc.calibre_id
      left join finished_dispatched_by_calibre fd on fd.calibre_id = fc.calibre_id
    )
  ),
  'qualityRecord', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'serial', qr.serial, 'typeId', qr.type_id, 'plate', qr.plate, 'driver', qr.driver,
        'arrivalDate', qr.arrival_date, 'targetMoisturePct', qr.target_moisture_pct, 'targetSo2MgKg', qr.target_so2_mg_kg,
        'intakeLab', qr.intake_lab, 'deliveredLab', qr.delivered_lab
      ) order by qr.arrival_date
    ), '[]'::jsonb)
    from quality_record qr
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'departedAt', cgw.completed_at,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', dm.barcode2, 'serial', fp.serial, 'calibreId', fp.calibre_id, 'weightKg', fp.weight_kg)
            order by dm.barcode2
          ), '[]'::jsonb)
          from dispatch_manifest dm join finished_pallets fp on fp.barcode2 = dm.barcode2
          where dm.request_id = cr.id
        )
      ) order by cgw.completed_at desc
    ), '[]'::jsonb)
    from period_dispatch_ids pdi
    join chiqim_requests cr on cr.id = pdi.request_id
    join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  )
);
$function$;
