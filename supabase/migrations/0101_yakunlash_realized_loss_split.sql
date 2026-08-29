-- Prompt 10: Serial close-out (Yakunlash) + realized-vs-unrealized loss
-- split + Window 2 reprint. See DECISIONS.md "Serial close-out (Yakunlash)
-- + realized-vs-unrealized loss" (2026-08-29) for the full writeup.
--
-- 0086 ("Moyka loss becomes live; remove Tugallash") removed every closure
-- event on the theory that loss should just be a live, unconditional
-- sent-minus-received gap, always. The flip side of that decision, which
-- 0086's own header never flagged: with no closure event, there was no way
-- to ever BOOK a residual as a real loss -- a serial that plateaus with
-- material genuinely stuck (spillage, a miscount, material that will never
-- come back) stays "still in Moyka" forever, no matter how old. This
-- shipped and immediately hit a real case: Isfara P3, 567 kg, stuck with
-- nowhere to go. This migration is a PARTIAL reversal, not a full one --
-- there is still no automatic/time-based close (CLAUDE.md scope
-- discipline: out of scope, explicitly), and the live sent-minus-received
-- computation itself is UNCHANGED -- what changes is that the SAME gap now
-- reads as one of two different things depending on whether the serial has
-- been closed: still-open (Moykada, unrealized) or closed (Yo'qotish,
-- realized, booked).
--
-- wash_cycles chosen for closed_at over kirim_lines: confirmed live via
-- direct schema inspection (CLAUDE.md) -- `unique (serial)` on wash_cycles,
-- genuinely 1:1 per serial today (the old `cycle_no` column is gone,
-- dropped when Laborator v2 collapsed the wash-cycle concept to one row per
-- serial, 2026-07-28). wash_cycles is already the audit-trail home for
-- closure-shaped columns (status/final_loss_pct/finalized_at, the
-- pre-cutover Tugallash record) -- closed_at is a direct sibling of that
-- same family, not a new concept bolted onto kirim_lines' much wider,
-- unrelated scope.
--
-- Every read path touched by 0086, re-audited (0086's original 8 items,
-- reproduced here, plus 4 more this pass found):
--   1. kirim_line_state -- FOUNDATIONAL. moykada gated by closed_at.
--      Hisobot's state_moykada and the new client_report_rows/totals
--      state_moykada_kg both already join this function, so both inherit
--      correctness for free once this one function is fixed -- not
--      touched separately.
--   2. isInMoyka (src/lib/stageMembership.ts, frontend) -- NOT in 0086's
--      list, found this pass: gates BOTH the §5.3 receive picker and
--      §5.2's own Window 2. Without this fix a closed serial with a
--      residual would stay receivable/visible-as-WIP forever. Frontend
--      commit, not this migration.
--   3. yield_rows -- reverts to closed_at IS NOT NULL only (see item 5
--      below). rahbar_exceptions' high_loss/high_rewash kinds read
--      yield_rows directly (confirmed: no wash_cycles reference of their
--      own) -- inherit the fix automatically, not touched separately. Also
--      closes a latent false-positive risk 0086 introduced: a barely-
--      started serial's temporarily-large gap could have tripped the
--      high-loss threshold purely from being mid-process.
--   4. get_client_report -- raw.moykadaKg (point-in-time, AS-OF gated,
--      same closed_before/closed_as_of_to idiom old_stock_closeouts
--      already uses) + raw.processedBreakdown.lossKg (period figure, date
--      basis switched from first-receipt to closed_at -- see item 6).
--      reconciliation.cumulativeLossKg/balancesKg UNTOUCHED: confirmed via
--      direct grep that neither is rendered anywhere in ClientReportTab.tsx
--      -- pure internal diagnostic algebra, stays exactly as today (signed,
--      unconditional, sole ledger term, per 0086's own identity note).
--   5. rahbar_dashboard_ledger -- moykadaSnapshot (AS-OF gated) + moyka's
--      period lossKg (closed_at basis, same treatment as #4).
--   6. rahbar_stock_snapshot -- moykadaKg gated (this one has no period
--      loss figure at all -- point-in-time only, per its own file header).
--   7. client_serial_loss_kg -- gated null (unrealized) / signed (realized).
--      Cascades automatically into client_report_rows/client_report_totals/
--      client_serial_summary -- all three already call this one function,
--      confirmed via direct read of each definition. Reuses the frontend's
--      existing null-handling in ClientHisobotTab.tsx (already renders
--      null as "--") -- no frontend change needed for that one column.
--   8. get_serial_passport -- cycles[].inMoykaKg/lossKg split, isRealized
--      added.
--   9. wip_rows' moyka_not_returned -- NOT touched directly: already reads
--      kirim_line_state(...).moykada, inherits item 1's fix verbatim
--      (confirmed via direct live pg_get_viewdef read before writing this).
--  10. client_report_rows / client_report_totals -- NEW this pass: gain
--      state_moykada_kg, sourced from the kirim_line_state join both
--      functions already have (zero new read) -- confirmed by the user as
--      in-scope (client portal previously showed loss only, no Moykada
--      figure at all).
--  11. client_serial_summary -- NEW this pass: gains moykadaKg via a new
--      sibling function, client_serial_moyka_kg -- deliberately reuses
--      client_calibre_split (same basis client_serial_loss_kg already
--      uses, confirmed identical to kirim_line_state's own base_pallets
--      exclusion set by direct comparison of both function bodies), not
--      kirim_line_state, so the two figures in this one JSON payload stay
--      internally consistent with each other.
--  12. useMoykaOutput.ts -- exposes closedAt; OmborTayyorTab.tsx/
--      OmborMoykaTab.tsx consume it via the new TS computeLossDisplay
--      helper (src/lib/formatLoss.ts) for the two screens that already
--      hold raw sent/received/closedAt client-side. Frontend commit.
--
-- Known, pre-existing, unresolved nuance (flagged per CLAUDE.md scope
-- discipline, not silently fixed): "received" for a serial is computed on
-- at least three slightly different bases across this codebase already --
-- useMoykaOutput.ts (frontend, only excludes bekor_qilindi), kirim_line_
-- state/client_calibre_split (SQL, also excludes storage_loss and
-- serial_mint_sources-consumed pallets). close_wash_cycle_serial below
-- deliberately matches the FIRST basis (useMoykaOutput's), since that is
-- what Ombor is actually looking at on screen when confirming Yakunlash --
-- the residual it quotes must match what was just shown. This means the
-- booked yoqotishKg a Yakunlash click produces can, in the rare case a
-- storage-loss-voided or re-wash-consumed pallet exists for that serial,
-- differ slightly from what Hisobot/Yield/passport compute afterward on
-- their own (pre-existing, more heavily-audited) basis. Not introduced by
-- this migration -- the three bases already disagreed before Yakunlash
-- existed; unifying them is a separate, larger task, out of scope here.

-- ============================================================
-- 0. wash_cycles.closed_at + drop its unused ombor_updates policy.
--    Confirmed unused before dropping (CLAUDE.md, same diligence as
--    correct_kirim_line_tara's storage_intake.ombor_updates precedent):
--    the only client write to wash_cycles today is OmborMoykaTab.tsx's
--    upsert with `ignoreDuplicates: true` -- insert-or-noop, never an
--    actual UPDATE. No other .from('wash_cycles') write call site exists
--    (grepped directly). Both new RPCs below are security definer and
--    bypass RLS entirely, so dropping this open, column-unrestricted
--    UPDATE policy costs nothing today and closes the same kind of gap
--    correct_kirim_line_tara closed on storage_intake -- closed_at now has
--    exactly one write path each (manual / natural), both role-gated
--    inside the function body, not by a table policy.
-- ============================================================
alter table public.wash_cycles add column closed_at timestamptz;

drop policy ombor_updates on wash_cycles;

-- ============================================================
-- 1. close_wash_cycle_serial -- manual Yakunlash. Ombor-only, requires a
--    positive residual (in_moyka > 0) and a passing lab verdict (closing a
--    serial that never passed makes no sense -- it never should have had
--    material packed against it in the first place, same gate finished_
--    pallets' own INSERT policy already enforces at pack time). Returns
--    the post-close state so the frontend can update in place without a
--    full refetch, same before/after-return pattern correct_kirim_line_
--    tara established.
-- ============================================================
create or replace function public.close_wash_cycle_serial(p_serial text)
returns table (
  moykada_kg numeric,
  yoqotish_kg numeric,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_wc_id      uuid;
  v_closed_at  timestamptz;
  v_lab_verdict text;
  v_sent       numeric;
  v_received   numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor seriyani yakunlashi mumkin' using errcode = '42501';
  end if;

  select wc.id, wc.closed_at into v_wc_id, v_closed_at
  from wash_cycles wc where wc.serial = p_serial
  for update;

  if not found then
    raise exception 'Seriya topilmadi: %', p_serial using errcode = 'P0002';
  end if;
  if v_closed_at is not null then
    raise exception 'Seriya allaqachon yakunlangan' using errcode = '22023';
  end if;

  select lr.verdict into v_lab_verdict
  from lab_results lr
  where lr.wash_cycle_id = v_wc_id and lr.scope = 'chiqim'
  order by lr.created_at desc limit 1;

  if v_lab_verdict is distinct from 'o_tdi' then
    raise exception 'Seriya laborant tomonidan tasdiqlanmagan -- avval tahlildan o''tishi kerak' using errcode = '22023';
  end if;

  -- Same basis useMoykaOutput.ts (frontend) already shows Ombor -- only
  -- bekor_qilindi excluded. See this migration's own header note on why
  -- this deliberately does NOT match kirim_line_state's stricter basis.
  select coalesce(sum(qty_kg), 0) into v_sent from moyka_sends where serial = p_serial;
  select coalesce(sum(weight_kg), 0) into v_received
  from finished_pallets where serial = p_serial and status <> 'bekor_qilindi';

  if v_sent - v_received <= 0 then
    raise exception 'Seriyada yopiladigan qoldiq yo''q' using errcode = '22023';
  end if;

  update wash_cycles set closed_at = now() where id = v_wc_id
  returning wash_cycles.closed_at into v_closed_at;

  return query select 0::numeric, v_sent - v_received, v_closed_at;
end
$function$;

revoke all on function close_wash_cycle_serial(text) from public;
grant execute on function close_wash_cycle_serial(text) to authenticated;

-- ============================================================
-- 2. close_wash_cycle_if_settled -- natural close. Called inline (not a
--    trigger) right after OmborTayyorTab.tsx's existing finished_pallets
--    insert succeeds -- see DECISIONS.md for why this is a small follow-up
--    RPC rather than either a trigger or wrapping the whole receive write
--    into one new RPC (the existing insert stays exactly as it is, RLS
--    lab-gate and all, so nothing here duplicates that check). Silent
--    no-op if the serial isn't actually settled (balance > 0) or is
--    already closed -- this is a "try to close" call, not an assertion;
--    every ordinary partial receive is expected to no-op here. The WHERE
--    clause's balance recomputation and the UPDATE are one statement, so
--    two concurrent calls for the same serial can't both flip closed_at --
--    ordinary Postgres row-level locking on the UPDATE serializes them.
-- ============================================================
create or replace function public.close_wash_cycle_if_settled(p_serial text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sent     numeric;
  v_received numeric;
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Ruxsat yo''q' using errcode = '42501';
  end if;

  select coalesce(sum(qty_kg), 0) into v_sent from moyka_sends where serial = p_serial;
  select coalesce(sum(weight_kg), 0) into v_received
  from finished_pallets where serial = p_serial and status <> 'bekor_qilindi';

  update wash_cycles
  set closed_at = now()
  where serial = p_serial and closed_at is null and v_sent - v_received <= 0;
end
$function$;

revoke all on function close_wash_cycle_if_settled(text) from public;
grant execute on function close_wash_cycle_if_settled(text) to authenticated;

-- ============================================================
-- 3. kirim_line_state -- FOUNDATIONAL fix (item 1 above). moykada gated by
--    closed_at; every other column unchanged. Signature unchanged (no new
--    OUT column), so a plain CREATE OR REPLACE applies -- no DROP needed.
-- ============================================================
create or replace function public.kirim_line_state(p_serial text)
 returns table(qabul_qilingan numeric, omborda_qoldi numeric, moykaga_yuborilgan numeric, moykada numeric, moykadan_chiqgan numeric, xom_jonatilgan numeric, olib_ketilgan numeric)
 language sql
 stable
as $function$
  with eq as (
    select kirim_line_effective_qty(p_serial) as v
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as v from moyka_sends where serial = p_serial
  ),
  rezka_sent as (
    select coalesce(sum(qty_kg), 0) as v from rezka_sends where serial = p_serial
  ),
  raw_disp as (
    select coalesce(sum(net_kg), 0) as v from raw_dispatch_lines where serial = p_serial
  ),
  base_pallets as (
    select fp.weight_kg, fp.barcode2
    from finished_pallets fp
    where fp.serial = p_serial
      and fp.status not in ('bekor_qilindi', 'storage_loss')
      and not exists (select 1 from serial_mint_sources sms where sms.source_barcode2 = fp.barcode2)
  ),
  moyka_out as (
    select coalesce(sum(weight_kg), 0) as v from base_pallets
  ),
  closed as (
    select wc.closed_at is not null as v from wash_cycles wc where wc.serial = p_serial
  ),
  departed as (
    select coalesce(sum(c.qty_kg), 0) as v
    from chiqim_pallet_consumption c
    join base_pallets bp on bp.barcode2 = c.barcode2
    join chiqim_lines cl on cl.id = c.chiqim_line_id
    join chiqim_requests cr on cr.id = cl.request_id
    where exists (
      select 1 from gate_weighings cgw
      where cgw.request_id = cr.id and cgw.dir = 'chiqim' and cgw.completed_at is not null
    )
  )
  select
    eq.v as qabul_qilingan,
    greatest(0, eq.v - sent.v - rezka_sent.v - raw_disp.v) as omborda_qoldi,
    sent.v as moykaga_yuborilgan,
    case when coalesce((select v from closed), false) then 0 else greatest(0, sent.v - moyka_out.v) end as moykada,
    moyka_out.v as moykadan_chiqgan,
    raw_disp.v as xom_jonatilgan,
    departed.v as olib_ketilgan
  from eq, sent, rezka_sent, raw_disp, moyka_out, departed;
$function$;

-- ============================================================
-- 4. client_serial_loss_kg -- gated null (unrealized, closedAt is null) /
--    signed (realized). Cascades into client_report_rows/totals/
--    client_serial_summary automatically -- all three already call this,
--    confirmed by direct read of each live definition before writing this.
-- ============================================================
create or replace function public.client_serial_loss_kg(p_serial text)
 returns numeric
 language sql
 stable
as $function$
  with wc as (
    select closed_at from wash_cycles where serial = p_serial
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as kg from moyka_sends where serial = p_serial
  ),
  split as (
    select * from client_calibre_split(p_serial)
  )
  select case when (select closed_at from wc) is null then null
    else (select kg from sent) - (select calibre_kg from split) - (select kn_kg from split)
  end;
$function$;

-- ============================================================
-- 5. client_serial_moyka_kg -- NEW, sibling to client_serial_loss_kg
--    (item 11 above): the client-portal Moykada figure, same
--    client_calibre_split basis as its loss counterpart so the pair stays
--    internally consistent within client_serial_summary's one JSON
--    payload. Floored, 0 once closed (matches kirim_line_state.moykada's
--    own display convention).
-- ============================================================
create or replace function public.client_serial_moyka_kg(p_serial text)
 returns numeric
 language sql
 stable
as $function$
  with wc as (
    select closed_at from wash_cycles where serial = p_serial
  ),
  sent as (
    select coalesce(sum(qty_kg), 0) as kg from moyka_sends where serial = p_serial
  ),
  split as (
    select * from client_calibre_split(p_serial)
  )
  select case when (select closed_at from wc) is not null then 0
    else greatest(0, (select kg from sent) - (select calibre_kg from split) - (select kn_kg from split))
  end;
$function$;

-- ============================================================
-- 6. yield_rows -- reverts to closed_at IS NOT NULL only (item 3 above).
--    "Yield" is a completed-batch metric; an in-process serial has no
--    stable yield% yet and drops back out, same as pre-0086 (when the
--    gate was wash_cycles.status = 'final'). loss_kg/loss_pct formulas
--    themselves are UNCHANGED -- every row reaching this view is now
--    always realized/closed by construction, so the plain signed gap is
--    already correct with no further gating needed inside the SELECT.
-- ============================================================
create or replace view public.yield_rows as
with serial_base as (
  select
    kl.serial,
    kl.type_id,
    kl.partiya_no,
    ko.owner_id,
    ko.plate,
    ko.driver,
    rkr.qty_kg as effective_qty,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as raw_consumed_kg,
    wc.id as wash_cycle_id,
    wc.status as wash_cycle_status,
    wc.closed_at
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  where ko.plate not like 'TEST-%' and ko.origin <> 'opening_stock'
),
finished_serials as (
  select
    serial_base.serial, serial_base.type_id, serial_base.partiya_no, serial_base.owner_id, serial_base.plate, serial_base.driver,
    serial_base.effective_qty, serial_base.raw_consumed_kg, serial_base.wash_cycle_id, serial_base.wash_cycle_status
  from serial_base
  where serial_base.raw_consumed_kg > 0 and serial_base.closed_at is not null
),
output as (
  select
    fs_1.serial,
    coalesce(sum(fp.weight_kg) filter (where not c.is_numberless), 0) as calibre_kg,
    coalesce(sum(fp.weight_kg) filter (where c.is_numberless), 0) as konditirskiy_kg,
    min(fp.received_date) as completed_date
  from finished_serials fs_1
  left join finished_pallets fp on fp.serial = fs_1.serial
  left join calibres c on c.id = fp.calibre_id
  group by fs_1.serial
),
rewash_flag as (
  select
    fs_1.serial,
    exists (
      select 1 from lab_results lr
      where lr.wash_cycle_id = fs_1.wash_cycle_id and lr.scope = 'chiqim' and lr.verdict = 'qayta_yuvish'
    ) as rewashed
  from finished_serials fs_1
),
calibre_breakdown as (
  select fs_1.serial, fp.calibre_id, sum(fp.weight_kg) as kg
  from finished_serials fs_1
  join finished_pallets fp on fp.serial = fs_1.serial
  group by fs_1.serial, fp.calibre_id
),
lab_readings as (
  select
    fs_1.serial,
    (select lr.moisture_pct from lab_results lr where lr.scope = 'kirim' and lr.parent_serial = fs_1.serial order by lr.created_at desc limit 1) as intake_moisture_pct,
    (select lr.moisture_pct from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = fs_1.wash_cycle_id order by lr.created_at desc limit 1) as delivered_moisture_pct
  from finished_serials fs_1
)
select
  fs.serial, fs.type_id, fs.owner_id, fs.plate, fs.driver,
  fs.effective_qty as raw_received_kg,
  fs.raw_consumed_kg,
  fs.raw_consumed_kg - fs.effective_qty as raw_overage_kg,
  o.completed_date,
  1 as max_cycle_no,
  rf.rewashed,
  o.calibre_kg as live_calibre_kg,
  o.konditirskiy_kg as live_konditirskiy_kg,
  o.calibre_kg + o.konditirskiy_kg as output_kg,
  fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg as loss_kg,
  case when fs.raw_consumed_kg > 0 then round((fs.raw_consumed_kg - o.calibre_kg - o.konditirskiy_kg) / fs.raw_consumed_kg * 100, 1) else 0 end as loss_pct,
  case when fs.raw_consumed_kg > 0 then round((o.calibre_kg + o.konditirskiy_kg) / fs.raw_consumed_kg * 100, 1) else 0 end as gross_yield_pct,
  lab.intake_moisture_pct,
  lab.delivered_moisture_pct,
  lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null as dry_matter_available,
  case when lab.intake_moisture_pct is not null then round(fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100), 1) else null end as dry_matter_in_kg,
  case when lab.delivered_moisture_pct is not null then round((o.calibre_kg + o.konditirskiy_kg) * (1 - lab.delivered_moisture_pct / 100), 1) else null end as dry_matter_out_kg,
  case
    when lab.intake_moisture_pct is not null and lab.delivered_moisture_pct is not null
      and (fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100)) > 0
    then round(
      (fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100) - (o.calibre_kg + o.konditirskiy_kg) * (1 - lab.delivered_moisture_pct / 100))
      / (fs.raw_consumed_kg * (1 - lab.intake_moisture_pct / 100)) * 100, 1)
    else null
  end as true_loss_pct,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'calibreId', cb.calibre_id, 'kg', cb.kg,
      'pct', case when (o.calibre_kg + o.konditirskiy_kg) > 0 then round(cb.kg / (o.calibre_kg + o.konditirskiy_kg) * 100, 1) else 0 end
    ) order by cb.kg desc), '[]'::jsonb)
    from calibre_breakdown cb where cb.serial = fs.serial
  ) as calibre_mix,
  fs.partiya_no
from finished_serials fs
join output o on o.serial = fs.serial
join rewash_flag rf on rf.serial = fs.serial
join lab_readings lab on lab.serial = fs.serial;

-- ============================================================
-- 7. get_client_report -- raw.moykadaKg/raw.byType[].moykadaKg (item 4
--    above): AS-OF gated, same closed_before_from/closed_as_of_to idiom
--    old_stock_closeouts already uses in this same function (a historical
--    point-in-time balance must ask "was this closed BY that date," never
--    "is it closed right now" -- otherwise re-running a past-dated report
--    today would retroactively zero out material that was genuinely still
--    open back then). raw.processedBreakdown.lossKg + the four CTEs that
--    define its "which serials processed this period" cohort (loss_totals,
--    raw_processed_total, raw_processed_actual_total, capped_serials,
--    raw_processed_by_type): date basis switched from completed_date
--    (first-receipt date, a "basically done" proxy 0086 needed because
--    there was no real closure event) to closed_at (the actual booking
--    event, now that one exists) -- so the cohort "how much did we process
--    this period" and "what did that processing lose" describe the exact
--    same set of serials. reconciliation.cumulativeLossKg/balancesKg
--    UNTOUCHED, per this migration's own header note (confirmed never
--    rendered; pure ledger-identity algebra, unaffected by the display
--    split). Everything else in this function is byte-identical to the
--    live version read directly before writing this.
-- ============================================================
create or replace function public.get_client_report(p_owner_id uuid, p_from date, p_to date)
 returns jsonb
 language sql
 stable
as $function$
with
client_lines as (
  select
    kl.serial, kl.type_id, kl.partiya_no, ko.plate, ko.driver, kl.target_moisture_pct, kl.target_so2_mg_kg,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date, rkr.provisional, rkr.origin,
    (si.serial is not null) as has_intake,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial) as sent_actual_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date between p_from and p_to) as sent_during_period_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date < p_from) as rezka_sent_before_from_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date <= p_to) as rezka_sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg,
    (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) as completed_date,
    wc.id as wash_cycle_id,
    wc.closed_at,
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
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from client_lines where arrival_date < p_from and has_intake and not closed_before_from
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from client_lines where arrival_date between p_from and p_to and origin = 'delivery'
),
raw_sent_to_moyka_period_total as (
  select coalesce(sum(sent_during_period_kg), 0) as kg from client_lines
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
moykada_total as (
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg) end
  ), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
raw_processed_total as (
  select coalesce(sum(sent_capped_kg), 0) as kg from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to
),
raw_processed_actual_total as (
  select coalesce(sum(sent_actual_kg), 0) as kg from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to
),
capped_serials as (
  select serial, sent_actual_kg as actual_sent_kg, effective_qty as effective_qty_kg, sent_actual_kg - sent_capped_kg as overage_kg
  from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to and sent_actual_kg > sent_capped_kg
),
raw_types as (select distinct type_id from client_lines),
raw_opening_by_type as (
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
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
  select type_id, coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake and not closed_as_of_to group by type_id
),
moykada_by_type as (
  select type_id, coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg) end
  ), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake group by type_id
),
raw_processed_by_type as (
  select type_id, coalesce(sum(sent_capped_kg), 0) as kg from client_lines
  where closed_at is not null and (closed_at at time zone 'utc')::date between p_from and p_to group by type_id
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
  where cl.closed_at is not null and (cl.closed_at at time zone 'utc')::date between p_from and p_to
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
  select coalesce(sum(sent_as_of_to_kg - output_as_of_to_kg), 0) as kg
  from client_lines where arrival_date <= p_to and has_intake
),
cumulative_raw_dispatched_total as (
  select coalesce(sum(dispatched_as_of_to_kg), 0) as kg from client_lines where arrival_date <= p_to and has_intake
),
client_pallet_base as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, fp.weight_kg, fp.received_date, ko.origin
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
client_pallet_departures as (
  -- One row per consumption portion whose OWN request's gate has completed
  -- by p_to -- a claimed-but-not-yet-gate-completed portion stays invisible
  -- here, matching the old dispatch_manifest-membership-alone-does-nothing
  -- behavior exactly.
  select
    c.barcode2,
    (cgw.completed_at at time zone 'utc')::date as departure_date,
    c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join client_pallet_base cpb on cpb.barcode2 = c.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  where cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
),
client_pallet_departed_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from client_pallet_departures
  group by barcode2
),
client_pallets as (
  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    greatest(0, cpb.weight_kg - coalesce(cpdt.kg, 0)) as weight_kg,
    cpb.received_date, cpb.origin,
    null::date as departure_date
  from client_pallet_base cpb
  left join client_pallet_departed_total cpdt on cpdt.barcode2 = cpb.barcode2

  union all

  select
    cpb.barcode2, cpb.serial, cpb.calibre_id,
    cpd.weight_kg,
    cpb.received_date, cpb.origin,
    cpd.departure_date
  from client_pallet_departures cpd
  join client_pallet_base cpb on cpb.barcode2 = cpd.barcode2
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
    cl.serial, cl.type_id, cl.partiya_no, cl.plate, cl.driver, cl.arrival_date, cl.target_moisture_pct, cl.target_so2_mg_kg,
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
        - (select kg from raw_closing_total)
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
        'serial', qr.serial, 'typeId', qr.type_id, 'partiyaNo', qr.partiya_no, 'plate', qr.plate, 'driver', qr.driver,
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
            jsonb_build_object('barcode2', c.barcode2, 'serial', fp.serial, 'calibreId', fp.calibre_id, 'weightKg', c.qty_kg)
            order by c.barcode2
          ), '[]'::jsonb)
          from chiqim_pallet_consumption c
          join chiqim_lines cl2 on cl2.id = c.chiqim_line_id
          join finished_pallets fp on fp.barcode2 = c.barcode2
          where cl2.request_id = cr.id
        )
      ) order by cgw.completed_at desc
    ), '[]'::jsonb)
    from period_dispatch_ids pdi
    join chiqim_requests cr on cr.id = pdi.request_id
    join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  )
);
$function$;

-- ============================================================
-- 8. rahbar_dashboard_ledger -- same treatment as item 7: moykadaSnapshot
--    (AS-OF gated) + moyka.lossKg's own "which serials processed this
--    period" cohort (processed_lines) switched from first-receipt date to
--    closed_at. `lines` and `processed_lines` didn't join wash_cycles at
--    all before this -- both gain that join here. Everything else in this
--    function is byte-identical to the live version read directly before
--    writing this.
-- ============================================================
create or replace function public.rahbar_dashboard_ledger(p_from date, p_to date, p_scope text)
 returns jsonb
 language sql
 stable
as $function$
with lines as (
  select
    kl.serial, kl.type_id, ko.origin,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date,
    (si.serial is not null) as has_intake,
    wc.closed_at,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date < p_from) as sent_before_from_kg,
    (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial and ms.sent_date <= p_to) as sent_as_of_to_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date < p_from) as rezka_sent_before_from_kg,
    (select coalesce(sum(rs.qty_kg), 0) from rezka_sends rs where rs.serial = kl.serial and rs.sent_date <= p_to) as rezka_sent_as_of_to_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date < p_from) as dispatched_before_from_kg,
    (select coalesce(sum(rdl.net_kg), 0) from raw_dispatch_lines rdl join chiqim_lines cl3 on cl3.id = rdl.chiqim_line_id join chiqim_requests cr3 on cr3.id = cl3.request_id where rdl.serial = kl.serial and cr3.request_date <= p_to) as dispatched_as_of_to_kg,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date < p_from
    ) as closed_before_from,
    exists (
      select 1 from old_stock_closeouts osc
      where osc.kind = 'old_raw' and osc.owner_id = ko.owner_id and osc.type_id = kl.type_id
        and (osc.closed_at at time zone 'utc')::date <= p_to
    ) as closed_as_of_to,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date < p_from) as output_before_from_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
raw_opening_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_before_from_kg - rezka_sent_before_from_kg - dispatched_before_from_kg)), 0) as kg
  from lines where arrival_date < p_from and has_intake and not closed_before_from
),
raw_received_total as (
  select coalesce(sum(effective_qty), 0) as kg from lines where arrival_date between p_from and p_to and has_intake
),
raw_closing_total as (
  select coalesce(sum(greatest(0, effective_qty - sent_as_of_to_kg - rezka_sent_as_of_to_kg - dispatched_as_of_to_kg)), 0) as kg
  from lines where arrival_date <= p_to and has_intake and not closed_as_of_to
),
raw_storage_loss_period as (
  select coalesce(sum(osc.book_remaining_kg), 0) as kg
  from old_stock_closeouts osc
  where osc.kind = 'old_raw'
    and (osc.closed_at at time zone 'utc')::date between p_from and p_to
    and (p_scope = 'hammasi' or p_scope = 'eski')
),
moyka_in_process as (
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg) end
  ), 0) as kg
  from lines where arrival_date <= p_to and has_intake
),
moyka_opening_total as (
  select coalesce(sum(
    case when closed_at is not null and (closed_at at time zone 'utc')::date < p_from then 0
         else greatest(0, sent_before_from_kg - output_before_from_kg) end
  ), 0) as kg
  from lines where arrival_date < p_from and has_intake
),
moyka_send_events as (
  select ms.id, ms.serial, ms.sent_date, ms.qty_kg
  from moyka_sends ms
  join kirim_lines kl on kl.serial = ms.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
raw_dispatch_events as (
  select rdl.id, rdl.serial, cr.request_date, rdl.net_kg
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join kirim_lines kl on kl.serial = rdl.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where p_scope = 'hammasi'
     or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
     or (p_scope = 'eski' and ko.origin = 'opening_stock')
),
moyka_sent_period_total as (
  select coalesce(sum(qty_kg), 0) as kg from moyka_send_events where sent_date between p_from and p_to
),
raw_dispatch_period_total as (
  select coalesce(sum(net_kg), 0) as kg from raw_dispatch_events where request_date between p_from and p_to
),
processed_lines as (
  select
    kl.serial, kl.type_id,
    least(
      (select coalesce(sum(ms.qty_kg), 0) from moyka_sends ms where ms.serial = kl.serial),
      rkr.qty_kg
    ) as sent_capped_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join wash_cycles wc on wc.serial = kl.serial
  where wc.closed_at is not null and (wc.closed_at at time zone 'utc')::date between p_from and p_to
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
),
processed_output as (
  select
    pl.type_id, fp.calibre_id,
    coalesce(sum(fp.weight_kg), 0) as output_kg
  from processed_lines pl
  join finished_pallets fp on fp.serial = pl.serial
  group by pl.type_id, fp.calibre_id
),
processed_total as (
  select coalesce(sum(sent_capped_kg), 0) as kg from processed_lines
),
processed_calibre_total as (
  select coalesce(sum(po.output_kg), 0) as kg from processed_output po join calibres c on c.id = po.calibre_id where not c.is_numberless
),
processed_konditirskiy_total as (
  select coalesce(sum(po.output_kg), 0) as kg from processed_output po join calibres c on c.id = po.calibre_id where c.is_numberless
),
processed_loss_total as (
  select
    (select kg from processed_total)
    - (select kg from processed_calibre_total)
    - (select kg from processed_konditirskiy_total) as kg
),
pallet_base as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, kl.type_id, fp.weight_kg, fp.received_date, ko.origin
  from finished_pallets fp
  join kirim_lines kl on kl.serial = fp.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  where fp.received_date <= p_to
    and (p_scope = 'hammasi'
      or (p_scope = 'yangi' and ko.origin in ('delivery', 'internal_reprocess'))
      or (p_scope = 'eski' and ko.origin = 'opening_stock'))
    and not exists (
      select 1 from serial_mint_sources sms
      where sms.source_barcode2 = fp.barcode2 and (sms.created_at at time zone 'utc')::date <= p_to
    )
    and not (fp.status = 'bekor_qilindi' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
    and not (fp.status = 'storage_loss' and (fp.voided_at is null or (fp.voided_at at time zone 'utc')::date <= p_to))
),
pallet_departures as (
  select
    c.barcode2,
    (cgw.completed_at at time zone 'utc')::date as departure_date,
    c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join pallet_base pb on pb.barcode2 = c.barcode2
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join gate_weighings cgw on cgw.request_id = cr.id and cgw.dir = 'chiqim'
  where cgw.completed_at is not null
    and (cgw.completed_at at time zone 'utc')::date <= p_to
),
pallet_departed_total as (
  select barcode2, coalesce(sum(weight_kg), 0) as kg
  from pallet_departures
  group by barcode2
),
pallets as (
  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    greatest(0, pb.weight_kg - coalesce(pdt.kg, 0)) as weight_kg,
    pb.received_date, pb.origin,
    null::date as departure_date
  from pallet_base pb
  left join pallet_departed_total pdt on pdt.barcode2 = pb.barcode2

  union all

  select
    pb.barcode2, pb.serial, pb.calibre_id, pb.type_id,
    pd.weight_kg,
    pb.received_date, pb.origin,
    pd.departure_date
  from pallet_departures pd
  join pallet_base pb on pb.barcode2 = pd.barcode2
),
finished_opening_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where (received_date < p_from or origin = 'opening_stock') and (departure_date is null or departure_date >= p_from)
),
finished_produced_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets
  where received_date between p_from and p_to and origin != 'opening_stock'
),
finished_dispatched_total as (
  select coalesce(sum(weight_kg), 0) as kg from pallets where departure_date between p_from and p_to
),
finished_dispatched_by_calibre_type as (
  select type_id, calibre_id, coalesce(sum(weight_kg), 0) as kg
  from pallets where departure_date between p_from and p_to
  group by type_id, calibre_id
),
bucket_size as (
  select case when (p_to - p_from) <= 31 then 1 else 7 end as days
),
buckets as (
  select gs::date as bucket_start
  from bucket_size bs, generate_series(p_from, p_to, (bs.days || ' days')::interval) gs
),
chart_kirdi as (
  select b.bucket_start, coalesce(sum(l.effective_qty), 0) as kg
  from buckets b
  left join lines l on l.arrival_date >= b.bucket_start and l.arrival_date < b.bucket_start + (select days from bucket_size)
    and l.arrival_date between p_from and p_to and l.has_intake
  group by b.bucket_start
),
chart_chiqgan as (
  select b.bucket_start, coalesce(sum(mse.qty_kg), 0) as kg
  from buckets b
  left join moyka_send_events mse on mse.sent_date >= b.bucket_start and mse.sent_date < b.bucket_start + (select days from bucket_size)
    and mse.sent_date between p_from and p_to
  group by b.bucket_start
),
chart_vozvrat as (
  select b.bucket_start, coalesce(sum(rde.net_kg), 0) as kg
  from buckets b
  left join raw_dispatch_events rde on rde.request_date >= b.bucket_start and rde.request_date < b.bucket_start + (select days from bucket_size)
    and rde.request_date between p_from and p_to
  group by b.bucket_start
),
raw_identity_residual as (
  select (select kg from raw_opening_total) + (select kg from raw_received_total)
       - (select kg from raw_dispatch_period_total) - (select kg from moyka_sent_period_total)
       - (select kg from raw_storage_loss_period) - (select kg from raw_closing_total) as kg
),
moyka_identity_residual as (
  select (select kg from moyka_opening_total) + (select kg from moyka_sent_period_total)
       - (select kg from processed_total) - (select kg from moyka_in_process) as kg
)
select jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to, 'scope', p_scope, 'bucketDays', (select days from bucket_size)),
  'raw', jsonb_build_object(
    'openingKg', (select kg from raw_opening_total),
    'receivedKg', (select kg from raw_received_total),
    'dispatchedKg', (select kg from raw_dispatch_period_total),
    'sentToMoykaKg', (select kg from moyka_sent_period_total),
    'storageLossKg', (select kg from raw_storage_loss_period),
    'closingKg', (select kg from raw_closing_total),
    'residualKg', (select kg from raw_identity_residual),
    'residualNote', 'diagnostic only, formulas unchanged -- opening+received-dispatched-sentToMoyka-storageLoss-closing; nonzero only when a line was sent/dispatched for more than its own effective raw qty (raw_closing_total''s floor absorbs the excess). Render only when nonzero.'
  ),
  'moykadaSnapshot', jsonb_build_object(
    'openingKg', (select kg from moyka_opening_total),
    'closingKg', (select kg from moyka_in_process),
    'asOfDate', p_to,
    'residualKg', (select kg from moyka_identity_residual),
    'note', 'point-in-time balances (opening as of p_from, closing as of p_to), not period flows -- not part of either ledger''s own closing identity. Together with raw.sentToMoykaKg and moyka.processedKg they form Ledger B''s own identity: openingKg + sentToMoykaKg - processedKg = closingKg. residualKg is that identity''s diagnostic slack, exact except in the same over-send edge case as raw.residualKg -- see migration header "Known edge case". Render only when nonzero.'
  ),
  'moyka', jsonb_build_object(
    'processedKg', (select kg from processed_total),
    'calibreKg', (select kg from processed_calibre_total),
    'konditirskiyKg', (select kg from processed_konditirskiy_total),
    'lossKg', (select kg from processed_loss_total),
    'lossPct', case when (select kg from processed_total) > 0
      then round((select kg from processed_loss_total) / (select kg from processed_total) * 100, 1)
      else 0 end
  ),
  'finished', jsonb_build_object(
    'openingKg', (select kg from finished_opening_total),
    'producedKg', (select kg from finished_produced_total),
    'dispatchedKg', (select kg from finished_dispatched_total),
    'closingKg', (select kg from finished_opening_total) + (select kg from finished_produced_total) - (select kg from finished_dispatched_total)
  ),
  'byCalibreType', jsonb_build_object(
    'processed', (
      select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', output_kg)), '[]'::jsonb)
      from processed_output
    ),
    'dispatched', (
      select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'calibreId', calibre_id, 'kg', kg)), '[]'::jsonb)
      from finished_dispatched_by_calibre_type
    )
  ),
  'chart', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'bucketStart', k.bucket_start,
        'kirdiKg', k.kg,
        'chiqganKg', c.kg,
        'vozvratKg', v.kg
      ) order by k.bucket_start
    ), '[]'::jsonb)
    from chart_kirdi k
    join chart_chiqgan c on c.bucket_start = k.bucket_start
    join chart_vozvrat v on v.bucket_start = k.bucket_start
  )
);
$function$;

-- ============================================================
-- 9. rahbar_stock_snapshot -- moykadaKg gated (item 6 above). This
--    function has no period loss figure at all -- point-in-time only, per
--    its own header comment -- so only moyka_lines/moykada_total change.
-- ============================================================
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
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'old_kn'
),
moyka_lines as (
  select
    kl.serial,
    wc.closed_at,
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
  select coalesce(sum(case when closed_at is not null then 0 else greatest(0, sent_kg - output_kg) end), 0) as kg
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

-- ============================================================
-- 10. get_serial_passport -- cycles[].inMoykaKg/lossKg split, isRealized +
--     closedAt added (item 8 above). `wc` is `select * from wash_cycles
--     where serial = p_serial` -- wc.closed_at is already available with
--     no CTE change, the column exists on the table now. Every other CTE
--     and jsonb key in this function is byte-identical to the live version
--     read directly before writing this.
-- ============================================================
create or replace function public.get_serial_passport(p_serial text)
 returns jsonb
 language sql
 stable
as $function$
with target_line as (
  select kl.serial, kl.order_id, kl.type_id, kl.partiya_no, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
         count(*) over (partition by kl.order_id) as line_count
  from kirim_lines kl
  where kl.serial = p_serial
),
gate_kirim as (
  select gw.*
  from gate_weighings gw, target_line tl
  where gw.dir = 'kirim' and gw.order_id = tl.order_id
  order by gw.stage1_completed_at desc nulls last
  limit 1
),
intake_row as (
  select * from storage_intake where serial = p_serial
),
kirim_lab as (
  select * from lab_results where scope = 'kirim' and parent_serial = p_serial
  order by created_at desc limit 1
),
wc as (
  select * from wash_cycles where serial = p_serial
),
sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from moyka_sends where serial = p_serial
),
rezka_sends_total as (
  select coalesce(sum(qty_kg), 0) as sent_kg from rezka_sends where serial = p_serial
),
cycle_lab as (
  select lr.verdict, lr.moisture_pct, lr.so2_mg_kg, lr.sample_date, lr.sample_photo, lr.note, lr.tested_by
  from wc
  left join lateral (
    select * from lab_results lr2
    where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
    order by lr2.created_at desc
    limit 1
  ) lr on true
),
pallets as (
  select rcr.* from report_chiqim_rows rcr where rcr.serial = p_serial
),
dispatch_ids as (
  select distinct cl.request_id
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
dispatch_gate as (
  select
    di.request_id,
    gw.gruzheny_kg, gw.pustoy_kg, gw.net_kg,
    gw.stage1_completed_at, gw.stage1_created_by, gw.stage1_plate_photo, gw.stage1_scale_photo,
    gw.completed_at, gw.stage2_created_by, gw.stage2_scale_photo, gw.departure_doc_photo
  from dispatch_ids di
  left join lateral (
    select * from gate_weighings gw2
    where gw2.dir = 'chiqim' and gw2.request_id = di.request_id
    order by gw2.completed_at desc nulls last
    limit 1
  ) gw on true
),
dispatch_pallets as (
  select cl.request_id, c.barcode2, c.created_at as loaded_at, fp.calibre_id, c.qty_kg as weight_kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
),
raw_dispatches as (
  select rdl.id, rdl.weight_kg, rdl.box_mass_kg, rdl.net_kg, rdl.loaded_at,
         cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from raw_dispatch_lines rdl
  join chiqim_lines cl on cl.id = rdl.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where rdl.serial = p_serial
),
mint_pallet_sources as (
  select sms.source_barcode2, fp.weight_kg as book_weight_kg, fp.calibre_id, fp.serial as source_serial
  from serial_mint_sources sms
  join finished_pallets fp on fp.barcode2 = sms.source_barcode2
  where sms.minted_serial = p_serial and sms.source_kind = 'pallet'
),
mint_pool_sources as (
  select sms.source_pool_id, sms.weight_kg, p.type_id
  from serial_mint_sources sms
  join old_kn_pools p on p.id = sms.source_pool_id
  where sms.minted_serial = p_serial and sms.source_kind = 'weight_pool'
),
raw_received as (
  select rkr.qty_kg as received_kg
  from report_kirim_rows rkr where rkr.serial = p_serial
),
raw_dispatched_total as (
  select coalesce(sum(rdl.net_kg), 0) as kg from raw_dispatch_lines rdl where rdl.serial = p_serial
),
raw_closeout as (
  select osc.closed_at
  from target_line tl2
  join kirim_orders ko2 on ko2.order_id = tl2.order_id
  join old_stock_closeouts osc on osc.kind = 'old_raw' and osc.owner_id = ko2.owner_id and osc.type_id = tl2.type_id
),
raw_still as (
  select coalesce(sum(qty_kg), 0) as kg from stock_on_hand_rows where serial = p_serial and bucket = 'raw_not_washed'
),
raw_storage_loss as (
  select
    (select closed_at from raw_closeout) as closed_at,
    case when (select closed_at from raw_closeout) is not null
      then greatest(0, coalesce((select received_kg from raw_received), 0) - (select sent_kg from sends_total) - (select sent_kg from rezka_sends_total) - (select kg from raw_dispatched_total))
      else 0
    end as kg
),
finished_returned_total as (
  select coalesce(sum(weight_kg), 0) as kg from finished_pallets where serial = p_serial
),
finished_dispatched_total as (
  select coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and exists (
      select 1 from gate_weighings cgw3
      where cgw3.dir = 'chiqim' and cgw3.request_id = cr.id and cgw3.completed_at is not null
    )
),
finished_dispatched_by_calibre as (
  select cl.calibre_id, coalesce(sum(c.qty_kg), 0) as kg
  from chiqim_pallet_consumption c
  join chiqim_lines cl on cl.id = c.chiqim_line_id
  join chiqim_requests cr on cr.id = cl.request_id
  join finished_pallets fp on fp.barcode2 = c.barcode2
  where fp.serial = p_serial
    and exists (
      select 1 from gate_weighings cgw4
      where cgw4.dir = 'chiqim' and cgw4.request_id = cr.id and cgw4.completed_at is not null
    )
  group by cl.calibre_id
),
finished_storage_loss_pallets as (
  select fp.barcode2, fp.calibre_id, fp.weight_kg, fp.voided_at
  from finished_pallets fp
  where fp.serial = p_serial and fp.status = 'storage_loss'
),
finished_other_total as (
  select
    coalesce(sum(weight_kg) filter (where status = 'consumed'), 0) as consumed_kg,
    coalesce(sum(weight_kg) filter (where status = 'bekor_qilindi'), 0) as voided_kg
  from finished_pallets where serial = p_serial
),
finished_still as (
  select
    coalesce(sum(qty_kg), 0) as total_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'awaiting_lab'), 0) as awaiting_lab_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'qayta_yuvish'), 0) as needs_rewash_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
),
finished_still_by_calibre as (
  select calibre_id,
    coalesce(sum(qty_kg) filter (where bucket = 'available'), 0) as available_kg,
    coalesce(sum(qty_kg) filter (where bucket = 'band_qilingan'), 0) as reserved_kg,
    coalesce(sum(qty_kg) filter (where bucket in ('awaiting_lab', 'qayta_yuvish')), 0) as under_review_kg
  from stock_on_hand_rows where serial = p_serial and barcode2 is not null
  group by calibre_id
),
storage_loss_events as (
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object('kind', 'old_washed', 'barcode2', slp.barcode2, 'calibreId', slp.calibre_id, 'weightKg', slp.weight_kg, 'voidedAt', slp.voided_at)
        order by slp.barcode2
      ) from finished_storage_loss_pallets slp
    ), '[]'::jsonb)
    ||
    case when (select closed_at from raw_storage_loss) is not null
      then jsonb_build_array(jsonb_build_object(
        'kind', 'old_raw', 'closedAt', (select closed_at from raw_storage_loss), 'weightKg', (select kg from raw_storage_loss),
        'note', 'Bu turdagi eski xom ashyo yakunlandi -- ko''rsatilgan miqdor shu seriyaning taxminiy ulushi'
      ))
      else '[]'::jsonb
    end as events
),
pending_raw as (
  select distinct cr.id as request_id, cr.request_date, cr.plate, cr.driver
  from chiqim_line_raw_serials clrs
  join chiqim_lines cl on cl.id = clrs.line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where clrs.serial = p_serial
    and cr.voided_at is null
    and cr.ombor_finished_at is null
    and not exists (select 1 from raw_dispatch_lines rdl2 where rdl2.chiqim_line_id = clrs.line_id and rdl2.serial = p_serial)
),
pending_dispatches as (
  select
    (select coalesce(jsonb_agg(
      jsonb_build_object('kind', 'raw', 'requestId', pr.request_id, 'requestDate', pr.request_date, 'plate', pr.plate, 'driver', pr.driver)
      order by pr.request_date desc
    ), '[]'::jsonb) from pending_raw pr)
    as events
)
select jsonb_build_object(
  'serial', p_serial,
  'order', (
    select jsonb_build_object(
      'orderId', ko.order_id, 'ownerId', ko.owner_id, 'ownerName', o.name, 'plate', ko.plate, 'driver', ko.driver,
      'orderDate', ko.order_date, 'declaredQty', tl.declared_qty, 'declaredTotal', ko.declared_total,
      'isMultiLine', tl.line_count > 1, 'targetMoisturePct', tl.target_moisture_pct, 'targetSo2MgKg', tl.target_so2_mg_kg, 'typeId', tl.type_id,
      'partiyaNo', tl.partiya_no,
      'docPhoto', ko.doc_photo, 'isOldStock', ko.origin = 'opening_stock',
      'isMinted', ko.origin = 'internal_reprocess'
    )
    from target_line tl
    join kirim_orders ko on ko.order_id = tl.order_id
    left join owners o on o.id = ko.owner_id
  ),
  'effectiveQty', (
    select jsonb_build_object(
      'valueKg', rkr.qty_kg, 'provisional', rkr.provisional,
      'truckVarianceDiffKg', rkr.truck_variance_diff_kg, 'truckVarianceDiffPct', rkr.truck_variance_diff_pct
    )
    from report_kirim_rows rkr where rkr.serial = p_serial
  ),
  'gate', (
    select jsonb_build_object(
      'gruzhenyKg', gk.gruzheny_kg, 'pustoyKg', gk.pustoy_kg, 'netKg', gk.net_kg,
      'stage1CompletedAt', gk.stage1_completed_at, 'stage1CreatedByName', p1.full_name,
      'stage1PlatePhoto', gk.stage1_plate_photo, 'stage1ScalePhoto', gk.stage1_scale_photo,
      'stage2CompletedAt', gk.completed_at, 'stage2CreatedByName', p2.full_name,
      'stage2ScalePhoto', gk.stage2_scale_photo, 'departureDocPhoto', gk.departure_doc_photo
    )
    from gate_kirim gk
    left join profiles p1 on p1.id = gk.stage1_created_by
    left join profiles p2 on p2.id = gk.stage2_created_by
  ),
  'intake', (
    select jsonb_build_object(
      'actualQty', ir.actual_qty, 'confirmedAt', ir.confirmed_at, 'confirmedByName', p3.full_name,
      'barcode1', ir.barcode1, 'pilePhoto', ir.pile_photo, 'komment', ir.komment,
      'boxMassKg', ir.box_mass_kg
    )
    from intake_row ir
    left join profiles p3 on p3.id = ir.confirmed_by
  ),
  'kirimLab', (
    select jsonb_build_object(
      'sampleDate', kl.sample_date, 'moisturePct', kl.moisture_pct, 'so2MgKg', kl.so2_mg_kg,
      'testedByName', p4.full_name, 'samplePhoto', kl.sample_photo, 'note', kl.note
    )
    from kirim_lab kl
    left join profiles p4 on p4.id = kl.tested_by
  ),
  'cycles', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'cycleNo', 1,
        'inMoykaKg', case when wc.closed_at is not null then 0 else greatest(0, st.sent_kg - (select kg from finished_returned_total)) end,
        'lossKg', case when wc.closed_at is not null then st.sent_kg - (select kg from finished_returned_total) else null end,
        'isRealized', wc.closed_at is not null,
        'closedAt', wc.closed_at,
        'sentKg', st.sent_kg,
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'barcode2', pl.barcode2, 'calibreId', pl.calibre_id, 'weightKg', pl.qty_kg,
              'palletStatus', pl.pallet_status, 'voidSuccessorBarcodes', pl.void_successor_barcodes
            ) order by pl.barcode2
          ), '[]'::jsonb)
          from pallets pl
        ),
        'lab', (
          select jsonb_build_object(
            'verdict', cl.verdict, 'moisturePct', cl.moisture_pct, 'so2MgKg', cl.so2_mg_kg,
            'sampleDate', cl.sample_date, 'testedByName', p5.full_name, 'samplePhoto', cl.sample_photo, 'note', cl.note
          )
          from cycle_lab cl
          left join profiles p5 on p5.id = cl.tested_by
          where cl.verdict is not null
        )
      )
    ), '[]'::jsonb)
    from wc cross join sends_total st
  ),
  'dispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', cr.id, 'requestDate', cr.request_date, 'plate', cr.plate, 'driver', cr.driver,
        'status', cr.status, 'omborFinishedAt', cr.ombor_finished_at, 'omborFinishedByName', p6.full_name,
        'gate', jsonb_build_object(
          'gruzhenyKg', dg.gruzheny_kg, 'pustoyKg', dg.pustoy_kg, 'netKg', dg.net_kg,
          'stage1CompletedAt', dg.stage1_completed_at, 'stage1CreatedByName', p7.full_name,
          'stage1PlatePhoto', dg.stage1_plate_photo, 'stage1ScalePhoto', dg.stage1_scale_photo,
          'stage2CompletedAt', dg.completed_at, 'stage2CreatedByName', p8.full_name,
          'stage2ScalePhoto', dg.stage2_scale_photo, 'departureDocPhoto', dg.departure_doc_photo
        ),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', dp.barcode2, 'calibreId', dp.calibre_id, 'weightKg', dp.weight_kg, 'loadedAt', dp.loaded_at)
            order by dp.loaded_at
          ), '[]'::jsonb)
          from dispatch_pallets dp where dp.request_id = cr.id
        )
      ) order by cr.request_date desc
    ), '[]'::jsonb)
    from dispatch_ids di
    join chiqim_requests cr on cr.id = di.request_id
    left join dispatch_gate dg on dg.request_id = di.request_id
    left join profiles p6 on p6.id = cr.ombor_finished_by
    left join profiles p7 on p7.id = dg.stage1_created_by
    left join profiles p8 on p8.id = dg.stage2_created_by
  ),
  'dispatchedByCalibre', (
    select coalesce(jsonb_agg(
      jsonb_build_object('calibreId', fdbc.calibre_id, 'kg', fdbc.kg)
      order by fdbc.calibre_id
    ), '[]'::jsonb)
    from finished_dispatched_by_calibre fdbc
  ),
  'rawDispatches', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'requestId', rd.request_id, 'requestDate', rd.request_date, 'plate', rd.plate, 'driver', rd.driver,
        'weightKg', rd.weight_kg, 'boxMassKg', rd.box_mass_kg, 'netKg', rd.net_kg, 'loadedAt', rd.loaded_at
      ) order by rd.loaded_at desc
    ), '[]'::jsonb)
    from raw_dispatches rd
  ),
  'mintOrigin', (
    select case when (select count(*) from serial_mint_sources where minted_serial = p_serial) = 0
      then null
      else jsonb_build_object(
        'palletCount',  (select count(*) from mint_pallet_sources),
        'bookTotalKg',  (select coalesce(sum(book_weight_kg), 0) from mint_pallet_sources),
        'poolDrawKg',   (select coalesce(sum(weight_kg), 0) from mint_pool_sources),
        'sentWeighedKg',(select sent_kg from sends_total) + (select sent_kg from rezka_sends_total),
        'pallets', (
          select coalesce(jsonb_agg(
            jsonb_build_object('barcode2', mps.source_barcode2, 'bookWeightKg', mps.book_weight_kg,
                               'calibreId', mps.calibre_id, 'sourceSerial', mps.source_serial)
            order by mps.source_barcode2
          ), '[]'::jsonb) from mint_pallet_sources mps
        )
      )
    end
  ),
  'notes', (
    select coalesce(jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at, 'authorName', pr.full_name)
      order by n.created_at
    ), '[]'::jsonb)
    from notes n
    left join profiles pr on pr.id = n.author
    where n.entity_type = 'moyka' and n.entity_id = p_serial
  ),
  'joriyHolat', jsonb_build_object(
    'raw', jsonb_build_object(
      'receivedKg', coalesce((select received_kg from raw_received), 0),
      'sentToMoykaKg', (select sent_kg from sends_total),
      'collectedRawKg', (select kg from raw_dispatched_total),
      'storageLossKg', (select kg from raw_storage_loss),
      'storageLossClosedAt', (select closed_at from raw_storage_loss),
      'stillInStorageKg', (select kg from raw_still)
    ),
    'finished', jsonb_build_object(
      'returnedKg', (select kg from finished_returned_total),
      'dispatchedKg', (select kg from finished_dispatched_total),
      'storageLossKg', (select coalesce(sum(weight_kg), 0) from finished_storage_loss_pallets),
      'consumedKg', (select consumed_kg from finished_other_total),
      'voidedKg', (select voided_kg from finished_other_total),
      'stillInStorageKg', (select total_kg from finished_still),
      'stillInStorageBreakdown', jsonb_build_object(
        'availableKg', (select available_kg from finished_still),
        'reservedKg', (select reserved_kg from finished_still),
        'awaitingLabKg', (select awaiting_lab_kg from finished_still),
        'needsRewashKg', (select needs_rewash_kg from finished_still)
      ),
      'byCalibre', (
        select coalesce(jsonb_agg(
          jsonb_build_object('calibreId', fsc.calibre_id, 'availableKg', fsc.available_kg, 'reservedKg', fsc.reserved_kg, 'underReviewKg', fsc.under_review_kg)
          order by fsc.calibre_id
        ), '[]'::jsonb)
        from finished_still_by_calibre fsc
      )
    )
  ),
  'storageLossEvents', (select events from storage_loss_events),
  'pendingDispatches', (select events from pending_dispatches)
);
$function$;

-- ============================================================
-- 11. client_report_rows / client_report_totals -- gain state_moykada_kg
--     (item 10 above), sourced from the kirim_line_state join both
--     functions already have -- zero new read. RETURNS TABLE signature
--     change means a plain CREATE OR REPLACE is refused (Postgres OUT-
--     parameter-list restriction, same one every partiya_no/hisobot-column
--     migration in this project has hit) -- DROP FUNCTION first for both.
-- ============================================================
drop function if exists client_report_rows(text[], date, date, uuid, text, integer, integer);

create function client_report_rows(
  p_directions text[],
  p_from date,
  p_to date,
  p_type_id uuid,
  p_serial text,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  kind text,
  row_key text,
  serial text,
  type_id uuid,
  partiya_no integer,
  plate text,
  driver text,
  date_basis date,
  qty_kg numeric,
  declared_qty numeric,
  state_omborda_qoldi numeric,
  state_calibre_kg numeric,
  state_kn_kg numeric,
  state_olib_ketilgan numeric,
  state_xom_jonatilgan numeric,
  state_loss_kg numeric,
  state_moykada_kg numeric
)
language sql
stable
as $function$
  select
    f.kind, f.row_key, f.serial, f.type_id, f.partiya_no, f.plate, f.driver, f.date_basis, f.qty_kg, f.declared_qty,
    s.omborda_qoldi, cs.calibre_kg, cs.kn_kg, s.olib_ketilgan, s.xom_jonatilgan, l.loss_kg, s.moykada
  from client_filtered_report_rows(p_directions, p_from, p_to, p_type_id, p_serial) f
  left join lateral kirim_line_state(f.serial) s on f.serial is not null
  left join lateral client_calibre_split(f.serial) cs on f.serial is not null
  left join lateral (select client_serial_loss_kg(f.serial) as loss_kg) l on f.serial is not null
  order by f.date_basis desc nulls last, f.row_key desc
  limit p_limit offset p_offset;
$function$;

drop function if exists client_report_totals(text[], date, date, uuid, text);

create function client_report_totals(
  p_directions text[],
  p_from date,
  p_to date,
  p_type_id uuid,
  p_serial text
)
returns table (
  total_netto_kg numeric,
  total_nakladnaya_kg numeric,
  state_serial_count bigint,
  state_gotoviy_produkt_kg numeric,
  state_kn_kg numeric,
  state_ostatok_gotoviy_kg numeric,
  state_ostatok_syrye_kg numeric,
  state_otgruzka_gotoviy_kg numeric,
  state_otgruzka_syrye_kg numeric,
  state_ubytok_kg numeric,
  state_ubytok_serial_count bigint,
  state_moykada_kg numeric
)
language sql
stable
as $function$
  with filtered as materialized (
    select * from client_filtered_report_rows(p_directions, p_from, p_to, p_type_id, p_serial)
  ),
  movement as (
    select coalesce(sum(qty_kg), 0) as total_netto, coalesce(sum(declared_qty), 0) as total_nakladnaya
    from filtered
  ),
  distinct_serials as (
    select distinct serial from filtered where serial is not null
  ),
  per_serial as (
    select
      ds.serial,
      s.omborda_qoldi, s.olib_ketilgan, s.xom_jonatilgan, s.moykada,
      cs.calibre_kg, cs.kn_kg,
      client_serial_loss_kg(ds.serial) as loss_kg
    from distinct_serials ds
    cross join lateral kirim_line_state(ds.serial) s
    cross join lateral client_calibre_split(ds.serial) cs
  ),
  state as (
    select
      count(*) as serial_count,
      coalesce(sum(calibre_kg), 0) as gotoviy_produkt,
      coalesce(sum(kn_kg), 0) as kn,
      coalesce(sum(greatest(0, calibre_kg + kn_kg - olib_ketilgan)), 0) as ostatok_gotoviy,
      coalesce(sum(omborda_qoldi), 0) as ostatok_syrye,
      coalesce(sum(olib_ketilgan), 0) as otgruzka_gotoviy,
      coalesce(sum(xom_jonatilgan), 0) as otgruzka_syrye,
      coalesce(sum(loss_kg), 0) as ubytok,
      count(*) filter (where loss_kg is not null) as ubytok_serial_count,
      coalesce(sum(moykada), 0) as moykada
    from per_serial
  )
  select
    movement.total_netto, movement.total_nakladnaya,
    state.serial_count, state.gotoviy_produkt, state.kn, state.ostatok_gotoviy, state.ostatok_syrye,
    state.otgruzka_gotoviy, state.otgruzka_syrye, state.ubytok, state.ubytok_serial_count, state.moykada
  from movement, state;
$function$;

-- ============================================================
-- 12. client_serial_summary -- gains moykadaKg via client_serial_moyka_kg
--     (item 5/11 above). jsonb-returning, so a plain CREATE OR REPLACE
--     applies (no signature change, no DROP needed).
-- ============================================================
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
    'moykadaKg', (select client_serial_moyka_kg((select serial from owned))),
    'lossKg', (select client_serial_loss_kg((select serial from owned)))
  ) end;
$function$;
