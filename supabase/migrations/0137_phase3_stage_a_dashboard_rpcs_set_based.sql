-- Phase 3 Stage A: remove the per-row recomputation inside the two dashboard
-- RPCs. Neither has ANY database dependant (verified via a full pg_proc /
-- pg_views source scan), so this is contained to the two dashboards --
-- unlike stock_on_hand_rows, which has 5 callers and is deliberately NOT
-- touched here (Stage B, only if Stage A's measurement says it's needed).
--
-- Both signatures and names are unchanged, so no call site anywhere changes.
--
-- WHY (measured, docs/decisions/0213): over 24h of real traffic
-- rahbar_dashboard_ledger ran mean 4,656ms / max 19,236ms and
-- rahbar_stock_snapshot mean 4,255ms / max 17,213ms, and between them they
-- accounted for 100% of the 106 statement timeouts. Isolated, the same
-- functions return in a few hundred ms -- they inflate 5-13x under
-- concurrency, exactly as report_query_page did before 0135 fixed it.
--
-- VERIFIED BYTE-IDENTICAL BEFORE THIS MIGRATION WAS WRITTEN, in rolled-back
-- transactions against the live functions:
--   rahbar_stock_snapshot   3 scopes x 2 roles (rahbar + client)  = 6/6 identical
--   rahbar_dashboard_ledger 4 periods x 3 scopes as rahbar        = 12/12 identical
--                           + client role, hammasi/full           = identical
-- Periods covered full history, current month, a window containing a wash
-- cycle close, and an empty window. Comparison is on the whole jsonb text,
-- so every key is covered -- which also settles the SPEC ledger identities
-- (residualKg and friends are computed *inside* the returned document, so
-- byte-identical output is strictly stronger than identity-equality).

-- ---------------------------------------------------------------------------
-- 1. rahbar_stock_snapshot
-- ---------------------------------------------------------------------------
-- Two changes, both pure restructuring:
--   a) stock_on_hand_rows was read THREE times (scoped, old_kn_total,
--      old_kn_by_type -- the last two deliberately unscoped, per 0120). It is
--      now read once into a materialized CTE and filtered from there. The
--      unscoped reads stay unscoped by reading all_rows, preserving 0120's
--      "old-KN total is scope-independent" behaviour exactly.
--   b) kirim_line_moyka_asof(serial, current_date) was called once per
--      kirim_line with a moyka_sends row (~29 calls, each re-deriving the
--      active wash cycle and re-scanning moyka_sends / report_moyka_output_rows).
--      Replaced with one set-based pass: active cycle per serial via
--      DISTINCT ON, then grouped sums joined back. Same arithmetic, same
--      cycle-window semantics, including the "closed on or before today -> 0"
--      branch.
create or replace function public.rahbar_stock_snapshot(p_scope text)
returns jsonb
language sql
stable
as $function$
with all_rows as materialized (
  select * from stock_on_hand_rows
),
scoped as (
  select * from all_rows
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
  select coalesce(sum(qty_kg), 0) as kg from all_rows where bucket = 'old_kn'
),
old_kn_by_type as (
  select s.type_id, pt.name as type_name, coalesce(sum(s.qty_kg), 0) as kg
  from all_rows s
  join product_types pt on pt.id = s.type_id
  where s.bucket = 'old_kn'
  group by s.type_id, pt.name
),
moyka_serials as (
  select kl.serial
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  where exists (select 1 from moyka_sends ms2 where ms2.serial = kl.serial)
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
active_cycle as (
  select distinct on (wc.serial) wc.serial, wc.opened_at, wc.closed_at
  from wash_cycles wc
  where wc.serial in (select serial from moyka_serials)
    and (wc.opened_at at time zone 'utc')::date <= current_date
  order by wc.serial, wc.opened_at desc
),
sends_since as (
  select a.serial, coalesce(sum(ms.qty_kg), 0) kg
  from active_cycle a
  left join moyka_sends ms
    on ms.serial = a.serial and ms.sent_date >= a.opened_at::date and ms.sent_date <= current_date
  group by a.serial
),
outs_since as (
  select a.serial, coalesce(sum(r.qty_kg), 0) kg
  from active_cycle a
  left join report_moyka_output_rows r
    on r.serial = a.serial and r.date_basis >= a.opened_at::date and r.date_basis <= current_date
   and r.pallet_status not in ('bekor_qilingan', 'saqlashda_yoqolgan')
   and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = r.barcode2)
  group by a.serial
),
moykada_total as (
  select coalesce(sum(
    case when a.closed_at is not null and (a.closed_at at time zone 'utc')::date <= current_date then 0
         else greatest(0, coalesce(s.kg, 0) - coalesce(o.kg, 0)) end), 0) as kg
  from active_cycle a
  left join sends_since s on s.serial = a.serial
  left join outs_since o on o.serial = a.serial
),
by_type as (
  select type_id, coalesce(sum(qty_kg), 0) as kg from scoped group by type_id
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

-- ---------------------------------------------------------------------------
-- 2. rahbar_dashboard_ledger
-- ---------------------------------------------------------------------------
-- Only the `lines` CTE changes. It carried TEN correlated subqueries evaluated
-- once per kirim_line (~330 subquery executions per call): sent/rezka/
-- dispatched/output each "before p_from" and "as of p_to", plus two
-- old_stock_closeouts EXISTS checks. Each becomes a pre-aggregated CTE joined
-- once. Everything downstream of `lines` is untouched.
--
-- The new body is produced by splicing the replacement `lines` CTE into the
-- CURRENT prosrc rather than by retyping ~150 lines of ledger math, which
-- eliminates transcription risk entirely. Two guards make that safe and
-- deterministic:
--   1. the regexp must actually match (a silent no-op replace is exactly the
--      failure mode that produced a false "no improvement" result during the
--      0131 work -- Postgres ARE uses \y, not \b, and a non-matching pattern
--      fails silently);
--   2. the spliced result must hash to the exact body that was verified
--      byte-identical above. If the live function is not what was tested
--      against, this migration aborts instead of installing something
--      unverified.
do $do$
declare src text; newsrc text; repl text;
begin
  select prosrc into src from pg_proc
   where proname = 'rahbar_dashboard_ledger'
     and pronamespace = 'public'::regnamespace;

  repl := $repl$
with ms_bf as (select serial, sum(qty_kg) kg from moyka_sends where sent_date < p_from group by serial),
ms_to as (select serial, sum(qty_kg) kg from moyka_sends where sent_date <= p_to group by serial),
rz_bf as (select serial, sum(qty_kg) kg from rezka_sends where sent_date < p_from group by serial),
rz_to as (select serial, sum(qty_kg) kg from rezka_sends where sent_date <= p_to group by serial),
rd_bf as (select rdl.serial, sum(rdl.net_kg) kg from raw_dispatch_lines rdl
  join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id
  join chiqim_requests cr3 on cr3.id = cl3.request_id
  where cr3.request_date < p_from group by rdl.serial),
rd_to as (select rdl.serial, sum(rdl.net_kg) kg from raw_dispatch_lines rdl
  join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id
  join chiqim_requests cr3 on cr3.id = cl3.request_id
  where cr3.request_date <= p_to group by rdl.serial),
fp_bf as (select serial, sum(weight_kg) kg from finished_pallets where received_date < p_from group by serial),
fp_to as (select serial, sum(weight_kg) kg from finished_pallets where received_date <= p_to group by serial),
co_bf as (select distinct owner_id, type_id from old_stock_closeouts
  where kind = 'old_raw' and (closed_at at time zone 'utc')::date < p_from),
co_to as (select distinct owner_id, type_id from old_stock_closeouts
  where kind = 'old_raw' and (closed_at at time zone 'utc')::date <= p_to),
lines as (
  select
    kl.serial, kl.type_id, ko.origin,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date,
    (si.serial is not null) as has_intake,
    lc.closed_at,
    coalesce(ms_bf.kg, 0) as sent_before_from_kg,
    coalesce(ms_to.kg, 0) as sent_as_of_to_kg,
    coalesce(rz_bf.kg, 0) as rezka_sent_before_from_kg,
    coalesce(rz_to.kg, 0) as rezka_sent_as_of_to_kg,
    coalesce(rd_bf.kg, 0) as dispatched_before_from_kg,
    coalesce(rd_to.kg, 0) as dispatched_as_of_to_kg,
    (co_bf.owner_id is not null) as closed_before_from,
    (co_to.owner_id is not null) as closed_as_of_to,
    coalesce(fp_bf.kg, 0) as output_before_from_kg,
    coalesce(fp_to.kg, 0) as output_as_of_to_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join lateral (
    select wc.closed_at from wash_cycles wc where wc.serial = kl.serial order by wc.cycle_no desc limit 1
  ) lc on true
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  left join ms_bf on ms_bf.serial = kl.serial
  left join ms_to on ms_to.serial = kl.serial
  left join rz_bf on rz_bf.serial = kl.serial
  left join rz_to on rz_to.serial = kl.serial
  left join rd_bf on rd_bf.serial = kl.serial
  left join rd_to on rd_to.serial = kl.serial
  left join fp_bf on fp_bf.serial = kl.serial
  left join fp_to on fp_to.serial = kl.serial
  left join co_bf on co_bf.owner_id = ko.owner_id and co_bf.type_id = kl.type_id
  left join co_to on co_to.owner_id = ko.owner_id and co_to.type_id = kl.type_id
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
cycles_all as ($repl$;

  newsrc := regexp_replace(src, 'with lines as \(.*?\),\ncycles_all as \(', repl, 's');

  if newsrc = src then
    raise exception 'Phase 3 Stage A: lines-CTE splice did not match rahbar_dashboard_ledger - aborting rather than installing an unverified body';
  end if;

  if md5(newsrc) <> '38e8c7f04c41dd11e64877d56b24e7b8' then
    raise exception 'Phase 3 Stage A: spliced body md5 % does not match the verified body - the live function differs from what was tested; aborting', md5(newsrc);
  end if;

  execute format(
    'create or replace function public.rahbar_dashboard_ledger(p_from date, p_to date, p_scope text) returns jsonb language sql stable as %L',
    newsrc);
end $do$;
