-- Fix caught before testing (2026-08-05): finished_pallets.status stays
-- 'in_stock' even after a genuine dispatch -- nothing in this codebase ever
-- writes status='dispatched' (see useAvailableFinishedStock.ts's own
-- comment); departure is tracked entirely via dispatch_manifest +
-- gate_weighings.completed_at. close_out_old_stock's old_washed branch and
-- old_stock_closeout_lines' old_washed_lines CTE both treated
-- status='in_stock' alone as "still remaining," which would have swept up
-- already-collected pallets into storage loss and corrupted their status.
-- Both now match stock_on_hand_rows' own pallet_rows definition of
-- "genuinely still on hand": in_stock AND not (dispatched).

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
    perform 1 from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
       and not exists (
         select 1 from dispatch_manifest dm3
         join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = dm3.request_id and cgw3.completed_at is not null
         where dm3.barcode2 = fp.barcode2
       )
     order by fp.barcode2 for update of fp;

    select coalesce(sum(fp.weight_kg), 0) into v_remaining
      from finished_pallets fp
      join kirim_lines kl on kl.serial = fp.serial
      join kirim_orders ko on ko.order_id = kl.order_id
     where fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
       and not exists (
         select 1 from dispatch_manifest dm3
         join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = dm3.request_id and cgw3.completed_at is not null
         where dm3.barcode2 = fp.barcode2
       );

    update finished_pallets fp set status = 'storage_loss', voided_at = now()
      from kirim_lines kl, kirim_orders ko
     where fp.serial = kl.serial and kl.order_id = ko.order_id
       and fp.status = 'in_stock' and fp.is_old_stock and fp.type_id = p_type_id and ko.owner_id = p_owner_id
       and not exists (
         select 1 from dispatch_manifest dm3
         join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = dm3.request_id and cgw3.completed_at is not null
         where dm3.barcode2 = fp.barcode2
       );

  elsif p_kind = 'old_kn' then
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

create or replace view old_stock_closeout_lines as
with old_washed_lines as (
  select 'old_washed'::text as kind, ko.owner_id, fp.type_id,
    sum(fp.weight_kg) as opening_kg,
    -- "Collected" here means "no longer sitting as available old-washed
    -- stock" -- genuinely dispatched pallets are the overwhelming case;
    -- a consumed (reprocessed) or voided pallet would also fall in this
    -- bucket, which is an acceptable simplification for this reconciliation
    -- screen (informational display only -- the close-out action itself
    -- only ever touches "remaining", computed precisely below).
    sum(fp.weight_kg) filter (where not (
      fp.status = 'in_stock' and not exists (
        select 1 from dispatch_manifest dm3
        join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = dm3.request_id and cgw3.completed_at is not null
        where dm3.barcode2 = fp.barcode2
      )
    )) as collected_kg,
    sum(fp.weight_kg) filter (where fp.status = 'in_stock' and not exists (
      select 1 from dispatch_manifest dm3
      join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = dm3.request_id and cgw3.completed_at is not null
      where dm3.barcode2 = fp.barcode2
    )) as remaining_kg
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
