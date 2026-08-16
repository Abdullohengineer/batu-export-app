-- Ombor KIRIM tara-only correction (2026-08-15) -- allow-with-impact, no
-- expiry, matching classify_kirim_line_sulfur's own security-definer
-- pattern (see DECISIONS.md "Move natural/sulphured classification..."):
-- role check inside the body, updates only box_mass_kg, audit_log row in
-- the same transaction, actor from auth.uid(). No table-level UPDATE
-- policy backs this write -- see the DROP POLICY below.
--
-- Tara lives on storage_intake.box_mass_kg, not kirim_lines (kirim_lines
-- has no tara column at all) -- confirmed before writing this.
--
-- kirim_line_effective_qty(serial): the balance formula report_kirim_rows.
-- qty_kg already computes (declared -> intake-provisional -> gate-net-
-- minus-box-mass, gated by line count and whether gate stage 2 + box mass
-- are both known), extracted into ONE function instead of hand-copied a
-- second time -- this RPC needs it twice (before/after the write), and a
-- straight copy-paste would have made three (soon four, with
-- report_kirim_rows_as_of) unsynced copies of the same balance
-- calculation, which is exactly the hazard CLAUDE.md's own standing rule
-- against duplicated derivations exists to prevent -- doubly so on a
-- feature whose entire job is editing one of that formula's own inputs.
-- Not called from report_kirim_rows itself in this pass (the view stays
-- as-is, not touched) -- see DECISIONS.md for why and the note that the
-- view is a candidate to adopt this helper later.
--
-- Verified byte-for-byte before writing this migration: ran this exact
-- formula against every one of the 17 real kirim_lines rows live today
-- and compared to report_kirim_rows.qty_kg directly -- 0 mismatches,
-- covering both branches those rows currently exercise (single-line
-- gate-finalized, multi-line finalized). The other two branches (pre-
-- intake, intake-provisional) are plain pass-throughs of declared_qty/
-- actual_qty with no box-mass or gate arithmetic, confirmed identical by
-- direct text comparison -- no live data in those states to empirically
-- check today, but also nothing in them that could drift.
create or replace function kirim_line_effective_qty(p_serial text)
returns numeric
language sql
stable
as $function$
  with target as (
    select kl.serial, kl.order_id, kl.declared_qty
    from kirim_lines kl where kl.serial = p_serial
  ),
  box_mass as (
    select kl.order_id,
      case when bool_and(si2.serial is not null) then sum(si2.box_mass_kg) else null end as total_box_mass_kg
    from kirim_lines kl
    left join storage_intake si2 on si2.serial = kl.serial
    where kl.order_id = (select order_id from target)
    group by kl.order_id
  ),
  line_count as (
    select count(*) as n from kirim_lines where order_id = (select order_id from target)
  )
  select
    case
      when si.actual_qty is null then t.declared_qty
      when gw.completed_at is null or bm.total_box_mass_kg is null then si.actual_qty
      when lc.n > 1 then si.actual_qty
      else coalesce(gw.net_kg - bm.total_box_mass_kg, si.actual_qty)
    end
  from target t
  left join storage_intake si on si.serial = t.serial
  left join box_mass bm on bm.order_id = t.order_id
  cross join line_count lc
  left join lateral (
    select gw2.net_kg, gw2.completed_at
    from gate_weighings gw2
    where gw2.dir = 'kirim' and gw2.order_id = t.order_id
    order by gw2.stage1_completed_at desc nulls last
    limit 1
  ) gw on true;
$function$;

create or replace function correct_kirim_line_tara(
  p_serial      text,
  p_box_mass_kg numeric
)
returns table (
  before_box_mass_kg   numeric,
  after_box_mass_kg    numeric,
  before_effective_qty numeric,
  after_effective_qty  numeric,
  sent_kg               numeric,
  raw_dispatched_kg     numeric,
  new_available_kg      numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor      uuid := auth.uid();
  v_before     numeric;
  v_before_eq  numeric;
  v_after_eq   numeric;
  v_sent       numeric;
  v_raw        numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor tara qiymatini tuzata oladi' using errcode = '42501';
  end if;
  if p_box_mass_kg is null or p_box_mass_kg < 0 then
    raise exception 'Tara qiymati noto''g''ri' using errcode = '22023';
  end if;

  select box_mass_kg into v_before from storage_intake where serial = p_serial for update;
  if not found then
    raise exception 'Seriya topilmadi: %', p_serial using errcode = 'P0002';
  end if;

  v_before_eq := kirim_line_effective_qty(p_serial);

  if v_before is distinct from p_box_mass_kg then
    update storage_intake set box_mass_kg = p_box_mass_kg where serial = p_serial;

    insert into audit_log (table_name, row_id, actor, action, before, after)
    values (
      'storage_intake', p_serial, v_actor, 'box_mass_kg',
      jsonb_build_object('box_mass_kg', v_before),
      jsonb_build_object('box_mass_kg', p_box_mass_kg)
    );
  end if;

  -- Same helper, called again post-update (same transaction, so it sees
  -- the write above) -- no algebraic re-derivation of the delta needed.
  v_after_eq := kirim_line_effective_qty(p_serial);

  select coalesce(sum(qty_kg), 0) into v_sent from moyka_sends where serial = p_serial;
  select coalesce(sum(net_kg), 0) into v_raw from raw_dispatch_lines where serial = p_serial;

  return query select
    v_before, p_box_mass_kg, v_before_eq, v_after_eq, v_sent, v_raw,
    greatest(0, v_after_eq - v_sent - v_raw);
end
$function$;

revoke all on function correct_kirim_line_tara(text, numeric) from public;
grant execute on function correct_kirim_line_tara(text, numeric) to authenticated;

-- storage_intake already had a row-level UPDATE policy (ombor_updates,
-- unrestricted by column) predating this task -- broader than "tara only"
-- and, confirmed directly, unused: zero client call sites update OR
-- upsert storage_intake (searched both -- the codebase's only 2 upserts
-- both target wash_cycles). Of the 6 functions whose source references
-- storage_intake, 2 are SECURITY DEFINER (bypass RLS entirely, structurally
-- unaffected by any policy change) and the other 4 (get_client_report,
-- get_serial_passport, rahbar_dashboard_ledger, report_kirim_rows_as_of)
-- only SELECT it, covered by the separate read_all policy, untouched here.
-- Dropping this closes the same gap classify_kirim_line_sulfur closed for
-- kirim_lines: without it, the only path to writing box_mass_kg after
-- intake is this RPC, restricted to that one column.
drop policy ombor_updates on storage_intake;
