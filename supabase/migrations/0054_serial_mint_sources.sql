-- Opening stock, Stage 3 (2026-08-02): the generic mint-lineage table.
-- Deliberately generic from day one -- Rezka source 2 ("consume finished
-- pallets, mint a new serial") is structurally the same operation as
-- re-washing old stock, and old KN may later feed Rezka as a weight draw.
-- Both shapes exist here now; only the pallet path has a caller in Stage 3.
--
-- source_pool_id (not source_pool_type_id, as originally sketched):
-- old_kn_pools is unique per (owner_id, type_id), so matching a draw on
-- type alone would over-subtract from every owner holding that type once a
-- second client has KN. Pointing at the pool row directly is unambiguous
-- and mirrors old_kn_collections.pool_id exactly.
create table serial_mint_sources (
  id              uuid primary key default gen_random_uuid(),
  minted_serial   text not null references kirim_lines(serial),
  source_kind     text not null check (source_kind in ('pallet','weight_pool')),
  source_barcode2 text references finished_pallets(barcode2),
  source_pool_id  uuid references old_kn_pools(id),
  weight_kg       numeric check (weight_kg is null or weight_kg > 0),
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id),
  constraint serial_mint_sources_shape check (
    (source_kind = 'pallet'      and source_barcode2 is not null
                                 and source_pool_id is null and weight_kg is null)
    or
    (source_kind = 'weight_pool' and source_barcode2 is null
                                 and source_pool_id is not null and weight_kg is not null)
  )
);

-- A pallet can be consumed into exactly one mint, ever. This index -- not
-- the RPC's own pre-check -- is the real guarantee against two concurrent
-- mints consuming the same pallet.
create unique index serial_mint_sources_pallet_once
  on serial_mint_sources (source_barcode2) where source_kind = 'pallet';
create index serial_mint_sources_minted_serial_idx on serial_mint_sources (minted_serial);
create index serial_mint_sources_pool_idx on serial_mint_sources (source_pool_id) where source_kind = 'weight_pool';

alter table serial_mint_sources enable row level security;
create policy read_all on serial_mint_sources for select using (auth.uid() is not null);
-- Deliberately NO insert/update/delete policy: written only by the
-- security-definer mint RPC (0055), which bypasses RLS. Nothing else may
-- forge or rewrite a lineage record.

-- stock_on_hand_rows: old_kn_rows' balance generalized to the full formula
-- (opening - collections - weight-pool mints). The third term is always
-- zero until Rezka calls the weight-draw path, but it has to be right NOW
-- or Rezka's first draw would silently not reduce the pool. Every other
-- CTE is byte-identical to the live 0050 definition (confirmed via
-- pg_get_viewdef before editing) -- only old_kn_rows changes.
create or replace view stock_on_hand_rows as
with pallet_rows as (
  select
    case
      when lr.verdict = 'qayta_yuvish' then 'qayta_yuvish'
      when lr.verdict is null then 'awaiting_lab'
      when dm.request_id is not null then 'band_qilingan'
      else 'available'
    end as bucket,
    fp.barcode2 as row_key,
    fp.serial,
    fp.barcode2,
    ko.owner_id,
    fp.type_id,
    fp.calibre_id,
    fp.weight_kg as qty_kg,
    fp.received_date as anchor_date,
    lr.moisture_pct,
    null::numeric as box_mass_kg,
    fp.is_old_stock,
    fp.weight_is_estimate
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (
    select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1
  ) dm on true
  left join chiqim_requests cr on cr.id = dm.request_id
  left join lateral (
    select cgw2.completed_at from gate_weighings cgw2
    where cgw2.dir = 'chiqim' and cgw2.request_id = dm.request_id
    order by cgw2.completed_at desc nulls last limit 1
  ) cgw on true
  left join lateral (
    select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
  ) wc on true
  left join lateral (
    select lr3.verdict, lr3.moisture_pct from lab_results lr3
    where lr3.scope = 'chiqim' and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc limit 1
  ) lr on true
  where fp.status = 'in_stock'
    and not (dm.request_id is not null and cgw.completed_at is not null)
    and ko.plate not like 'TEST-%'
    and coalesce(cr.plate, '') not like 'TEST-%'
), raw_rows as (
  select 'raw_not_washed' as bucket,
    r.row_key, r.serial, null::text as barcode2, r.owner_id, r.type_id, null::uuid as calibre_id,
    r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0) as qty_kg,
    r.date_basis as anchor_date, kirim_lr.moisture_pct, r.box_mass_kg,
    r.origin = 'opening_stock' as is_old_stock, false as weight_is_estimate
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (
    select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial
  ) sent on true
  left join lateral (
    select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial
  ) raw on true
  left join lateral (
    select lr4.moisture_pct from lab_results lr4
    where lr4.scope = 'kirim' and lr4.parent_serial = r.serial
    order by lr4.created_at desc limit 1
  ) kirim_lr on true
  where (r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(raw.total_raw, 0)) > 0
), old_kn_rows as (
  select 'old_kn' as bucket,
    p.id::text as row_key, null::text as serial, null::text as barcode2,
    p.owner_id, p.type_id, null::uuid as calibre_id,
    p.opening_kg - coalesce(c.collected, 0) - coalesce(m.minted, 0) as qty_kg,
    null::date as anchor_date, null::numeric as moisture_pct, null::numeric as box_mass_kg,
    true as is_old_stock, null::boolean as weight_is_estimate
  from old_kn_pools p
  left join lateral (
    select coalesce(sum(oc.collected_kg), 0) as collected from old_kn_collections oc where oc.pool_id = p.id
  ) c on true
  left join lateral (
    select coalesce(sum(sms.weight_kg), 0) as minted from serial_mint_sources sms
     where sms.source_kind = 'weight_pool' and sms.source_pool_id = p.id
  ) m on true
  where p.opening_kg - coalesce(c.collected, 0) - coalesce(m.minted, 0) > 0
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

-- report_chiqim_rows: BUG FIX for the new enum value. Without the new
-- branch a 'consumed' pallet falls through the CASE to 'omborda' and reads
-- as still-in-warehouse in Hisobot and in the passport's Joriy holat
-- (which derives from this view's pallet_status). 'omborda' is a
-- CURRENT-LOCATION claim and it would be false.
--
-- Note the deliberate asymmetry with yield_rows and useMoykaOutput, which
-- both keep counting consumed pallets: those answer "what did this serial
-- PRODUCE" (history, must not move), this one answers "where is this
-- pallet NOW" (location, must be current). See the DECISIONS entry.
--
-- Everything else in this view is byte-identical to the live definition.
create or replace view report_chiqim_rows as
select 'chiqim'::text as kind,
  fp.barcode2 as row_key,
  fp.serial,
  fp.barcode2,
  kl.order_id,
  dm.request_id,
  ko.owner_id,
  fp.type_id,
  fp.calibre_id,
  coalesce(cr.plate, ''::text) as plate,
  coalesce(cr.driver, ''::text) as driver,
  cr.request_date as date_basis,
  null::text as date_basis_source,
  fp.weight_kg as qty_kg,
  false as provisional,
  null::numeric as declared_qty,
  null::numeric as truck_variance_diff_kg,
  null::numeric as truck_variance_diff_pct,
  false as provisional_variance_flag,
  null::integer as wash_cycle,
  case
    when fp.status = 'bekor_qilindi'::pallet_status then 'bekor_qilingan'::text
    when fp.status = 'consumed'::pallet_status then 'ishlatilgan'::text
    when dm.request_id is not null then
      case when cgw.completed_at is not null then 'jonatilgan'::text else 'band_qilingan'::text end
    else 'omborda'::text
  end as pallet_status,
  lr.verdict as lab_verdict,
  kl.target_moisture_pct,
  kl.target_so2_mg_kg,
  lr.moisture_pct,
  lr.so2_mg_kg,
  null::text[] as void_successor_barcodes,
  null::numeric as box_mass_kg
from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  left join lateral (
    select dm2.request_id from dispatch_manifest dm2 where dm2.barcode2 = fp.barcode2 limit 1
  ) dm on true
  left join chiqim_requests cr on cr.id = dm.request_id
  left join lateral (
    select cgw2.completed_at from gate_weighings cgw2
    where cgw2.dir = 'chiqim'::direction and cgw2.request_id = dm.request_id
    order by cgw2.completed_at desc nulls last limit 1
  ) cgw on true
  left join lateral (
    select wc2.id from wash_cycles wc2 where wc2.serial = fp.serial limit 1
  ) wc on true
  left join lateral (
    select lr3.verdict, lr3.moisture_pct, lr3.so2_mg_kg from lab_results lr3
    where lr3.scope = 'chiqim'::direction and lr3.wash_cycle_id = wc.id
    order by lr3.created_at desc limit 1
  ) lr on true
where ko.plate !~~ 'TEST-%'::text and coalesce(cr.plate, ''::text) !~~ 'TEST-%'::text;
