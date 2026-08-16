-- Rezka cutting-line data layer (2026-08-16). Design only in this pass --
-- Ombor UI and the Rezka reporting section (Rahbar dashboard tiles beyond
-- the one narrow fix below, Hisobot, the passport's own Rezka-side history)
-- are explicitly out of scope; stages 2 and 3. See docs/DECISIONS.md
-- "Rezka data layer" for the full investigation this migration is built on
-- (docs/DECISIONS.md "Rezka readiness investigation", 2026-08-15) and the
-- decisions still needed before stage 2.
--
-- Shape of the change:
--  1. calibres.is_rezka_output + a "Rezka KN" calibre row per category that
--     already has a plain KN row. One narrow, verified-necessary patch to
--     rahbar_stock_snapshot (the only aggregate confirmed vulnerable to
--     silently merging Rezka KN into the existing "Konditirskiy" figure --
--     see the section comment below for how the other three candidates
--     were ruled OUT, not just three left unexamined).
--  2. rezka_sends + rezka_cycles -- copies of moyka_sends/wash_cycles'
--     current shape exactly, NOT a reuse of wash_cycles itself. A trigger
--     on both tables makes it structurally impossible for one serial to
--     ever have rows in both -- the actual mechanism that keeps this from
--     becoming a hole for real Moyka serials.
--  3. finished_pallets' INSERT policy gets one new OR-branch: a serial with
--     a rezka_cycles row may mint Barcode #2 with no lab verdict at all --
--     exactly and only because Rezka has no lab by design (SPEC.md). The
--     existing Moyka branch is untouched, byte-identical.
--  4. Two new callers of mint_serial_from_sources (0055) -- unchanged,
--     exactly as its own header promised in 2026-08-02: "Rezka reuses this
--     unchanged." One per inside source (washed-KN consumed pallets,
--     old-KN weight-pool draw), each mirroring send_old_stock_to_moyka's
--     one-transaction shape.
--
-- Surplus handling (item 5, no schema change needed): rezka_cycles.
-- final_loss_pct is a bare `numeric`, no CHECK constraint -- copied
-- directly from wash_cycles' own column, which has never had one either.
-- A negative value (received > sent, e.g. rice-powder gain during cutting)
-- is accepted with zero resistance, same as every other numeric column
-- touched by this migration (rezka_sends.qty_kg > 0 constrains the SEND
-- side only, exactly mirroring moyka_sends.qty_kg -- never compared against
-- received). Full audit of every constraint/floor/threshold reachable by
-- the Rezka path is in DECISIONS.md, not repeated here as SQL since nothing
-- in this migration needed to change to satisfy it -- the one real bug
-- found (computeFinalLossPct's `Math.max(0, ...)` floor) is frontend,
-- out of scope this pass, flagged for stage 2.
--
-- Provenance (item 6, no schema change needed): kirim_orders.origin +
-- serial_mint_sources.source_kind already fully derive which of the three
-- sources a Rezka line came from -- see the DECISIONS.md entry for the
-- exact derivation. get_serial_passport's existing mintOrigin section
-- already reports pallet- and pool-sourced provenance correctly for a
-- Rezka-minted serial with zero changes (its poolDrawKg field, dormant
-- since 0056, starts reading real numbers the moment #4 below is called);
-- one field inside that same section, sentWeighedKg, currently sources
-- ONLY moyka_sends and would misreport 0 for a Rezka-minted serial --
-- documented precisely in DECISIONS.md with the exact fix, not applied
-- here (touches get_serial_passport, a stage-2/3 concern).
--
-- Standing hazard, addressed by NOT choosing a new kirim_orders.origin
-- value: Rezka mints keep origin='internal_reprocess', unchanged from what
-- mint_serial_from_sources already stamps. Verified directly, not assumed,
-- against every origin-filtered view that could plausibly see Rezka
-- activity: rahbar_dashboard_ledger's processed_konditirskiy_total,
-- get_client_report's loss_output/processedBreakdown, and yield_rows'
-- konditirskiy_kg are ALL gated on wash_cycles.status='final' upstream of
-- where origin is even checked -- a Rezka serial structurally cannot reach
-- any of them regardless of its origin value, because it will never have a
-- wash_cycles row (see #2/#3 above). A new origin value was considered and
-- rejected: it would buy no additional protection here (the wash_cycles
-- gate already does the real work) and would need its own entry in every
-- one of CLAUDE.md's origin-filtering categories for no behavioural gain.
--
-- 🚩 SEPARATE, MORE URGENT FINDING -- not fixed here, flagged for a
-- decision before ANY Rezka serial goes live, not just before stage 2:
-- an outside-KN serial sent PARTIALLY to Rezka (no minting involved, since
-- it's an ordinary kirim_lines row) would still show its FULL original raw
-- balance as available in every place that currently computes "raw
-- remaining" by subtracting moyka_sends (+ raw_dispatch_lines) alone --
-- confirmed directly in stock_on_hand_rows.raw_rows
-- (`r.qty_kg - total_sent - total_raw`, total_sent sourced only from
-- moyka_sends) and rahbar_dashboard_ledger's `lines` CTE
-- (sent_before_from_kg/sent_as_of_to_kg, same). Nothing today subtracts
-- rezka_sends anywhere. Left unfixed, Ombor could send the same raw
-- kilograms to both Moyka and Rezka -- a real double-commit risk, not a
-- cosmetic dashboard gap. (Minted-serial Rezka lines are NOT at risk of
-- this specific issue -- mint_serial_from_sources deliberately gives a
-- minted serial no storage_intake row, and every one of these views already
-- requires has_intake/an inner join to storage_intake before a line can
-- appear in a raw balance at all, the same protection Moyka's own mint
-- path has always relied on. Verified directly, not assumed.) Not
-- patched in this migration -- every one of the confirmed call sites is a
-- reporting/balance view (out of scope this pass), and get_client_report's
-- own client_lines equivalent needs the same direct verification before
-- anyone touches it. Listed first in the decisions-needed list.

-- ============================================================
-- 1. Rezka KN calibre -- distinct from plain KN, both is_numberless
-- ============================================================
-- is_numberless stays true for Rezka KN -- it genuinely has no calibre
-- number, same as plain KN. The merge risk lives entirely in four SQL
-- aggregates that each independently compute
-- `sum(...) filter (where c.is_numberless)` with no companion split.
-- Investigated all four directly, not assumed:
--   - rahbar_stock_snapshot.finished_konditirskiy_total (0068) -- reads
--     stock_on_hand_rows, which has no wash_cycles gate at all (it's a
--     live snapshot of everything with status='in_stock'). CONFIRMED
--     VULNERABLE -- patched below.
--   - rahbar_dashboard_ledger.processed_konditirskiy_total (0068, "Ledger
--     B") -- reads processed_lines, which requires
--     `wc.status = 'final' and wc.finalized_at is not null` (0068:334).
--     A Rezka serial never has a wash_cycles row (see #2/#3 below), so it
--     structurally cannot enter this CTE. CONFIRMED IMMUNE, not patched.
--   - get_client_report.loss_output/processedBreakdown.konditirskiyKg
--     (0065:460-483) -- reads loss_totals, which requires the identical
--     `cl.wash_cycle_status = 'final' and cl.finalized_at is not null`
--     (0065:463-465). CONFIRMED IMMUNE, not patched.
--   - yield_rows.output.konditirskiy_kg (0049:14-75) -- its finished_serials
--     CTE requires wash_cycle_status = 'final' as well. CONFIRMED IMMUNE,
--     not patched.
-- Every other calibre-grouped figure in the codebase (stock_on_hand_rows
-- itself, get_client_report's finished.byCalibre, rahbar_dashboard_ledger's
-- byCalibreType.processed/dispatched, yield_rows' calibre_mix, Barcode #2
-- minting) is already keyed by calibre_id directly, not the is_numberless
-- boolean -- already plural-safe, confirmed, not touched.
alter table calibres add column is_rezka_output boolean not null default false;

-- One "Rezka KN" row per category that already has a plain KN row -- not
-- hardcoded to a specific category, since a fresh category with its own KN
-- calibre could exist later. Live-checked: exactly one category (O'rik)
-- and one is_numberless row (KN) exist in production today.
insert into calibres (category_id, code, label, is_numberless, is_rezka_output, sort_order, active)
select category_id, 'RKN', 'Rezka KN', true, true, sort_order + 1, true
from calibres
where is_numberless and not is_rezka_output
on conflict (category_id, code) do nothing;

-- rahbar_stock_snapshot -- narrowed finished_konditirskiy_total to exclude
-- is_rezka_output (preserves today's values exactly, since no row has
-- is_rezka_output=true until the insert above), added finished_rezka_kn_
-- total as its own figure, included in totalKg so nothing goes invisible
-- (same reasoning DECISIONS.md already recorded for oldKnKg: dropping a
-- real balance from totalKg to avoid a merge is the worse error). Every
-- other CTE in this function is byte-identical to 0068's own definition
-- (confirmed by direct read immediately before writing this).
create or replace function rahbar_stock_snapshot(p_scope text)
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
  where s.barcode2 is not null and c.is_numberless and not c.is_rezka_output
),
-- Rezka KN -- cut/processed Konditirskiy-shaped output from the cutting
-- line, kept OUT of finished_konditirskiy_total above. Same is_numberless
-- =true as plain KN (neither carries a calibre number), but a genuinely
-- different product: plain KN is a raw source, Rezka KN is finished cut
-- output. Merging them into one "Konditirskiy" figure would silently
-- misrepresent both.
finished_rezka_kn_total as (
  select coalesce(sum(s.qty_kg), 0) as kg
  from scoped s join calibres c on c.id = s.calibre_id
  where s.barcode2 is not null and c.is_numberless and c.is_rezka_output
),
old_kn_total as (
  select coalesce(sum(qty_kg), 0) as kg from scoped where bucket = 'old_kn'
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
  'rezkaKnKg', (select kg from finished_rezka_kn_total),
  'rezkaKnNote', 'cut Konditirskiy-shaped output from the Rezka line -- kept separate from konditirskiyKg (plain, unwashed Konditirskiy) even though both are is_numberless; the two must never be summed together',
  'oldKnKg', (select kg from old_kn_total),
  'oldKnNote', 'pool stock -- not backed by finished_pallets, structurally outside Ledger C''s coverage; shown separately, never reconciled against it',
  'totalKg', (select kg from raw_total) + (select kg from finished_calibred_total)
             + (select kg from finished_konditirskiy_total) + (select kg from finished_rezka_kn_total)
             + (select kg from old_kn_total),
  'byType', (
    select coalesce(jsonb_agg(jsonb_build_object('typeId', type_id, 'kg', kg) order by kg desc), '[]'::jsonb)
    from by_type
  ),
  'distinctTypeCount', (select count(*) from by_type)
);
$function$;

-- ============================================================
-- 2. rezka_sends + rezka_cycles -- copies of moyka_sends/wash_cycles'
--    CURRENT shape, not a reuse of wash_cycles itself
-- ============================================================
-- rezka_sends mirrors moyka_sends' final shape exactly (post-0035, which
-- dropped moyka_sends.wash_cycle -- Moyka has been one-row-per-serial for
-- wash_cycles since then, so there's nothing cycle-numbered left to mirror
-- here either).
create table rezka_sends (
  id uuid primary key default gen_random_uuid(),
  serial text not null references kirim_lines(serial),
  sent_date date not null,
  qty_kg numeric not null check (qty_kg > 0),
  created_by uuid references profiles
);
alter table rezka_sends enable row level security;
create policy read_all on rezka_sends for select using (auth.uid() is not null);
create policy ombor_writes on rezka_sends for insert
  with check (my_role() = 'ombor');

-- rezka_cycles mirrors wash_cycles' current (post-0035) one-row-per-serial
-- shape exactly -- id/serial/status/final_loss_pct/finalized_at. What it
-- deliberately does NOT copy: wash_cycles' finalize-verdict UPDATE policy
-- (0075, this session -- see that file). Rezka has no lab by design
-- (SPEC.md), so there is no verdict to check on finalize here -- this
-- table's own update policy stays the plain ombor-role check wash_cycles
-- itself had before that gate existed (0007_rls.sql). The real control
-- point for whether a Rezka serial may mint Barcode #2s is the
-- finished_pallets policy in #3 below, not this table.
create table rezka_cycles (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique references kirim_lines(serial),
  status text not null default 'active',
  -- Signed, no floor -- a negative value (received > sent, e.g. the
  -- rice-powder gain routine to cutting) is a real, legitimate figure, not
  -- an error state. No CHECK constraint, matching wash_cycles.
  -- final_loss_pct's own total absence of one.
  final_loss_pct numeric,
  finalized_at timestamptz
);
alter table rezka_cycles enable row level security;
create policy read_all on rezka_cycles for select using (auth.uid() is not null);
create policy ombor_writes on rezka_cycles for insert
  with check (my_role() = 'ombor');
create policy ombor_updates on rezka_cycles for update
  using (my_role() = 'ombor')
  with check (my_role() = 'ombor');

-- The actual mechanism that keeps #3's new gate from becoming a hole for
-- real Moyka serials: a serial can never have rows in BOTH wash_cycles and
-- rezka_cycles. Without this, nothing would stop an ombor-role client from
-- inserting a rezka_cycles row for an ordinary Moyka serial specifically to
-- route around the finished_pallets lab-verdict check in #3. Symmetric --
-- also blocks the reverse (a Rezka serial acquiring a wash_cycles row),
-- which would otherwise let it try to satisfy Moyka's OWN finalize gate
-- (0075) with a verdict it structurally can never have, permanently
-- unfinalizable there -- the exact failure mode DECISIONS.md flagged in
-- 2026-08-14 as the reason not to let Rezka touch wash_cycles at all.
create or replace function prevent_dual_process_serial()
returns trigger
language plpgsql
as $function$
begin
  if TG_TABLE_NAME = 'wash_cycles' then
    if exists (select 1 from rezka_cycles where serial = new.serial) then
      raise exception 'Bu seriya Rezkaga yuborilgan -- Moykaga yuborib bo''lmaydi' using errcode = '23514';
    end if;
  elsif TG_TABLE_NAME = 'rezka_cycles' then
    if exists (select 1 from wash_cycles where serial = new.serial) then
      raise exception 'Bu seriya Moykaga yuborilgan -- Rezkaga yuborib bo''lmaydi' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create trigger wash_cycles_prevent_dual_process
  before insert on wash_cycles
  for each row execute function prevent_dual_process_serial();

create trigger rezka_cycles_prevent_dual_process
  before insert on rezka_cycles
  for each row execute function prevent_dual_process_serial();

-- ============================================================
-- 3. Barcode #2 gate -- one new OR-branch, Moyka's own branch untouched
-- ============================================================
-- Exactly what this lets through: an INSERT into finished_pallets succeeds
-- for a serial with NO passing CHIQIM verdict, IF AND ONLY IF that serial
-- has a rezka_cycles row. It does not relax the Moyka branch in any way --
-- that subquery is copied verbatim from the live policy (confirmed via
-- direct pg_policies read against production immediately before writing
-- this, byte-identical). It cannot become a hole for a real Moyka serial
-- because #2's trigger makes a rezka_cycles row and a wash_cycles row
-- mutually exclusive per serial -- the only way to satisfy this new branch
-- is to genuinely have gone through a Rezka send (#4 below), which by the
-- same trigger means that serial can never also be mid-Moyka.
drop policy ombor_writes on finished_pallets;
create policy ombor_writes on finished_pallets for insert
  with check (
    my_role() = 'ombor'
    and (
      (
        select lr.verdict from lab_results lr
        join wash_cycles wc on wc.id = lr.wash_cycle_id
        where wc.serial = finished_pallets.serial and lr.scope = 'chiqim'
        order by lr.created_at desc limit 1
      ) = 'o_tdi'
      or exists (select 1 from rezka_cycles rc where rc.serial = finished_pallets.serial)
    )
  );

-- ============================================================
-- 4. mint_serial_from_sources callers -- the function itself is untouched
-- ============================================================
-- Both call mint_serial_from_sources (0055) exactly as its own header
-- promised in 2026-08-02: "Rezka reuses this unchanged." Same
-- security-definer + explicit my_role() gate pattern as
-- send_old_stock_to_moyka, since kirim_orders/kirim_lines are
-- menejer-insert-only under RLS and Ombor is the actor here too.

-- Inside source 1: washed-KN finished pallets (consume-and-mint, the
-- pallet shape) -- mirrors send_old_stock_to_moyka's one-transaction shape
-- exactly, substituting rezka_cycles/rezka_sends for wash_cycles/
-- moyka_sends and entity_type='rezka' for the auto-note.
create or replace function send_finished_pallets_to_rezka(
  p_owner_id        uuid,
  p_type_id         uuid,
  p_pallet_barcodes text[],
  p_weighed_kg      numeric
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_serial text;
  v_actor  uuid := auth.uid();
  v_book   numeric;
  v_count  int := coalesce(array_length(p_pallet_barcodes, 1), 0);
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor Rezkaga yubora oladi' using errcode = '42501';
  end if;
  if p_weighed_kg is null or p_weighed_kg <= 0 then
    raise exception 'Tarozidagi og''irlikni kiriting' using errcode = '22023';
  end if;

  -- Book total read BEFORE the pallets are consumed (mint_serial_from_sources
  -- flips them to status='consumed').
  select coalesce(sum(weight_kg), 0) into v_book
    from finished_pallets where barcode2 = any(p_pallet_barcodes);

  -- declared_qty = the WEIGHED figure, not the book figure -- same
  -- reasoning send_old_stock_to_moyka's own comment gives: keeps the
  -- minted line's own balance honest against what was actually measured,
  -- not a year-old book estimate.
  v_serial := mint_serial_from_sources(p_owner_id, p_type_id, p_weighed_kg,
                                       p_pallet_barcodes, null, null);

  insert into rezka_cycles (serial, status) values (v_serial, 'active')
    on conflict (serial) do nothing;

  insert into rezka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_weighed_kg, v_actor);

  insert into notes (entity_type, entity_id, author, body)
  values ('rezka', v_serial, v_actor,
    format('Yuvilgan KN dan Rezkaga: %s ta pallet ishlatildi, kitob bo''yicha ~%s kg, tarozida %s kg yuborildi.',
           v_count, round(v_book), round(p_weighed_kg)));

  return v_serial;
end
$function$;

revoke all on function send_finished_pallets_to_rezka(uuid,uuid,text[],numeric) from public;
grant execute on function send_finished_pallets_to_rezka(uuid,uuid,text[],numeric) to authenticated;

-- Inside source 2: old-KN weight-pool draw -- the weight_pool branch of
-- mint_serial_from_sources, dormant since 0055 (2026-08-02, "No caller in
-- Stage 3; Rezka is the first"). p_pool_weight_kg is used as both the
-- mint's declared_qty and the rezka_sends amount, matching how
-- send_old_stock_to_moyka uses its own single weighed figure for both --
-- unlike a pallet draw, a pool draw has no separate "book vs re-weighed"
-- distinction to preserve (it's a bookkeeping draw against a known-weight
-- pool, not a re-weighing event), so one figure is correct, not a
-- simplification.
create or replace function send_old_kn_pool_to_rezka(
  p_owner_id       uuid,
  p_type_id        uuid,
  p_pool_id        uuid,
  p_pool_weight_kg numeric
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_serial text;
  v_actor  uuid := auth.uid();
begin
  if my_role() is distinct from 'ombor' then
    raise exception 'Faqat Ombor Rezkaga yubora oladi' using errcode = '42501';
  end if;
  if p_pool_weight_kg is null or p_pool_weight_kg <= 0 then
    raise exception 'Og''irlik kiritilmagan' using errcode = '22023';
  end if;

  -- Availability against the pool (opening_kg - collections - prior mints)
  -- is enforced inside mint_serial_from_sources itself (0055) -- not
  -- re-checked here, so there is exactly one place this arithmetic lives.
  v_serial := mint_serial_from_sources(p_owner_id, p_type_id, p_pool_weight_kg,
                                       null, p_pool_id, p_pool_weight_kg);

  insert into rezka_cycles (serial, status) values (v_serial, 'active')
    on conflict (serial) do nothing;

  insert into rezka_sends (serial, sent_date, qty_kg, created_by)
  values (v_serial, (now() at time zone 'Asia/Tashkent')::date, p_pool_weight_kg, v_actor);

  insert into notes (entity_type, entity_id, author, body)
  values ('rezka', v_serial, v_actor,
    format('Eski KN havzasidan Rezkaga: %s kg tortib olindi.', round(p_pool_weight_kg)));

  return v_serial;
end
$function$;

revoke all on function send_old_kn_pool_to_rezka(uuid,uuid,uuid,numeric) from public;
grant execute on function send_old_kn_pool_to_rezka(uuid,uuid,uuid,numeric) to authenticated;

-- Outside-KN intake -> Rezka needs no new RPC: an ordinary delivered
-- kirim_lines row already exists (from Menejer's normal KIRIM form, no
-- minting involved), so sending it to Rezka is the same two plain inserts
-- OmborMoykaTab.handleSend already does for Moyka today (upsert
-- rezka_cycles, insert rezka_sends), both already covered by the
-- ombor_writes policies in #2 -- a frontend concern, stage 2.

-- ============================================================
-- 5. Partial-send raw-balance fix -- moyka_sends subtraction sites,
--    extended to rezka_sends. Folded into stage 1 per direct instruction:
--    "stock integrity, not cosmetic."
-- ============================================================
-- Every place that computes "how much of a serial's raw balance remains"
-- by subtracting moyka_sends (usually alongside raw_dispatch_lines) grepped
-- exhaustively, both SQL and frontend, and classified. Nine SQL sites
-- needed the fix; several more that also reference moyka_sends did NOT,
-- because they compute a Moyka-specific MOVEMENT or COMPLETION total (e.g.
-- "kg sent to Moyka this period", raw_processed_total, moykada_total,
-- yield_rows) rather than a cross-destination REMAINING balance -- those
-- stay untouched on purpose, listed here so the omission reads as
-- deliberate, not missed:
--   - rahbar_dashboard_ledger.processed_konditirskiy_total / get_client_
--     report.loss_totals / yield_rows.raw_consumed_kg -- all gated on
--     wash_cycles.status='final', structurally unreachable by a Rezka
--     serial regardless (confirmed in this migration's section 1 comment).
--   - moyka_sent_period_total / raw_sent_to_moyka_period_total / chart_
--     chiqgan / report_moyka_send_rows -- "kg moved to Moyka this period,"
--     a movement total, not a remaining balance. Rezka gets its own
--     equivalent movement total in its own reporting section later
--     (out of scope this pass, matches Hisobot's own moyka_send row kind
--     staying Moyka-only, never merged with a hypothetical rezka_send kind).
--   - moyka_in_process / moyka_opening_total / kirim_line_state.moykada /
--     useMoykaOutput.ts's inProcess/excess -- Moyka's own in-process WIP
--     (sent_to_moyka - output_from_moyka), scoped to serials that already
--     have a moyka_sends row; correct as-is regardless of Rezka activity.
--
-- The nine sites, each patched below in this order:
--   1. stock_on_hand_rows.raw_rows            (0065:187, view)
--   2. get_client_report.client_lines          (0065:317, function)
--   3. close_out_old_stock (old_raw branch) +
--      old_stock_closeout_lines.old_raw_lines  (0066, function + view)
--   4. rahbar_dashboard_ledger.lines            (0068:181, function)
--   5. wip_rows.raw_not_sent                    (0070:13, view)
--   6. correct_kirim_line_tara                  (0073:74, function)
--   7. kirim_line_state.omborda_qoldi           (0074:79, function)
--   8. get_serial_passport.raw_storage_loss     (0067:55, function)
--
-- 🔒 Sequencing note: get_serial_passport (site 8) is written here ALREADY
-- INCLUDING the separate mintOrigin.sentWeighedKg fix (a different bug --
-- display accuracy for a Rezka-minted serial's OWN send figure, not the
-- double-commit risk this section fixes) that was shipped as its own
-- standalone migration, first, per direct instruction ("small, unrelated,
-- doesn't need to ride with Rezka"). That standalone migration's own
-- get_serial_passport body is the starting point this section's version
-- was written against -- applying this migration without ever separately
-- applying that one would still leave both fixes in place, since this
-- CREATE OR REPLACE carries the complete function body either way. See
-- that standalone migration's own header for why it references
-- rezka_sends (a table this migration creates) despite being otherwise
-- unrelated to Rezka -- it cannot actually be applied before this one,
-- whatever "shipped first" ends up meaning for merge order.
--
-- 🔒 What was explicitly NOT re-derived: raw_still (get_serial_passport)
-- reads stock_on_hand_rows directly and needed no separate edit -- it
-- inherits site 1's fix automatically. No new balance formula was written
-- anywhere in this section -- every patch is the existing "total - Σexit1 -
-- Σexit2" shape with one more Σ added, reusing kirim_line_effective_qty
-- and report_kirim_rows(_as_of) exactly as before.
--
-- 🚩 NOT fixed in this section, flagged for your judgment (not the same
-- double-commit risk, a different, narrower gap):
--   - get_client_report/rahbar_dashboard_ledger's sent_capped_kg/
--     overage_kg over-send DETECTOR compares Moyka's own sent total
--     against effective_qty -- it would not recognize a serial over-
--     committed across BOTH Moyka and Rezka combined as an overage. This
--     audit/exception feature, not the availability GATE that actually
--     prevents new over-commits (fixed above) -- narrower, and left alone.
--   - src/lib/stageMembership.ts's hasRawRemainder(inputKg, sent) --
--     used by OmborMoykaTab.tsx to decide which serials appear in the
--     "Yuborish uchun" (send-to-Moyka) window -- reads raw inputKg/sent
--     directly, not useMoykaSerials.ts's own (post-fix) available field.
--     A serial fully committed to Rezka would still appear as a Moyka
--     send candidate. Frontend, not touched this pass -- named here so it
--     isn't rediscovered as a surprise.

-- ---- Site 1: stock_on_hand_rows.raw_rows ----
-- Full view reproduced (CREATE OR REPLACE has no partial-patch form).
-- pallet_rows and old_kn_rows CTEs, and the closing three-way UNION ALL,
-- are byte-identical to 0065's own definition -- only raw_rows changes:
-- one new lateral join (rezka), subtracted alongside sent/raw in both the
-- select list and the qty_kg > 0 filter.
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
    r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(rezka.total_rezka_sent, 0) - coalesce(raw.total_raw, 0) as qty_kg,
    r.date_basis as anchor_date, kirim_lr.moisture_pct, r.box_mass_kg,
    r.origin = 'opening_stock' as is_old_stock, false as weight_is_estimate
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
  left join lateral (select coalesce(sum(rs.qty_kg), 0) as total_rezka_sent from rezka_sends rs where rs.serial = r.serial) rezka on true
  left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
  left join lateral (
    select lr4.moisture_pct from lab_results lr4
    where lr4.scope = 'kirim' and lr4.parent_serial = r.serial
    order by lr4.created_at desc limit 1
  ) kirim_lr on true
  where (r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(rezka.total_rezka_sent, 0) - coalesce(raw.total_raw, 0)) > 0
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

-- ---- Site 2: get_client_report.client_lines (raw opening/closing) ----
-- Full function reproduced. Two new columns on client_lines
-- (rezka_sent_before_from_kg / rezka_sent_as_of_to_kg, mirroring the
-- existing moyka pair exactly), subtracted in raw_opening_total/
-- raw_closing_total and their by-type variants ONLY. Every other CTE
-- (sent_actual_kg, sent_during_period_kg, sent_capped_kg, moykada_total,
-- loss_totals/loss_output/loss_main, and everything from
-- cumulative_received_total onward) is byte-identical to 0065's own
-- definition -- those are Moyka-specific movement/completion figures,
-- correctly scoped, not touched (see this section's own header comment).
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

-- ---- Site 3: close_out_old_stock (old_raw branch) + old_stock_closeout_lines.old_raw_lines ----
-- Only the old_raw branch/CTE touches moyka_sends -- old_washed and old_kn
-- are untouched, reproduced verbatim below only because CREATE OR REPLACE
-- requires the whole function/view. This is the one WRITE site in this
-- section: v_remaining here is persisted permanently into
-- old_stock_closeouts.book_remaining_kg, not just read live -- a partial
-- Rezka send left unfixed here would have overstated a closed-out line's
-- book remainder forever, not just until the next query.
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
    select coalesce(sum(greatest(0, r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(rezka.total_rezka_sent, 0) - coalesce(raw.total_raw, 0))), 0)
      into v_remaining
      from report_kirim_rows r
      join storage_intake si on si.serial = r.serial
      join kirim_orders rko on rko.order_id = r.order_id
      left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
      left join lateral (select coalesce(sum(rs.qty_kg), 0) as total_rezka_sent from rezka_sends rs where rs.serial = r.serial) rezka on true
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
    sum(coalesce(sent.total_sent, 0) + coalesce(rezka.total_rezka_sent, 0) + coalesce(raw.total_raw, 0)) as collected_kg,
    sum(greatest(0, r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(rezka.total_rezka_sent, 0) - coalesce(raw.total_raw, 0))) as remaining_kg
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  join kirim_orders rko on rko.order_id = r.order_id
  left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
  left join lateral (select coalesce(sum(rs.qty_kg), 0) as total_rezka_sent from rezka_sends rs where rs.serial = r.serial) rezka on true
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

-- ---- Site 4: rahbar_dashboard_ledger.lines (raw_opening_total/raw_closing_total) ----
-- Full function reproduced. Same two-column addition as get_client_report
-- above (this function is its documented "sync-twin" -- 0068's own header
-- comment already requires hand-syncing any client_lines change here).
-- rahbar_stock_snapshot (this same file, section 1 above) is a SEPARATE
-- function, already patched there for the is_numberless concern -- not
-- reproduced again here.
create or replace function rahbar_dashboard_ledger(p_from date, p_to date, p_scope text)
returns jsonb
language sql
stable
as $function$
with lines as (
  select
    kl.serial, kl.type_id, ko.origin,
    rkr.qty_kg as effective_qty, rkr.date_basis as arrival_date,
    (si.serial is not null) as has_intake,
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
    wc.status as wash_cycle_status, wc.finalized_at,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date < p_from) as output_before_from_kg,
    (select coalesce(sum(fp.weight_kg), 0) from finished_pallets fp where fp.serial = kl.serial and fp.received_date <= p_to) as output_as_of_to_kg
  from kirim_lines kl
  join kirim_orders ko on ko.order_id = kl.order_id
  join report_kirim_rows_as_of(p_to) rkr on rkr.serial = kl.serial
  left join storage_intake si on si.serial = kl.serial and si.confirmed_at is not null and (si.confirmed_at at time zone 'utc')::date <= p_to
  left join wash_cycles wc on wc.serial = kl.serial
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
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date <= p_to then 0
         else greatest(0, sent_as_of_to_kg - output_as_of_to_kg)
    end
  ), 0) as kg
  from lines where arrival_date <= p_to and has_intake
),
moyka_opening_total as (
  select coalesce(sum(
    case when wash_cycle_status = 'final' and finalized_at is not null and (finalized_at at time zone 'utc')::date < p_from then 0
         else greatest(0, sent_before_from_kg - output_before_from_kg)
    end
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
  where wc.status = 'final' and wc.finalized_at is not null and (wc.finalized_at at time zone 'utc')::date <= p_to
    and (select min(fp.received_date) from finished_pallets fp where fp.serial = kl.serial) between p_from and p_to
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
pallets as (
  select
    fp.barcode2, fp.serial, fp.calibre_id, kl.type_id, fp.weight_kg, fp.received_date, ko.origin,
    (
      select cr.request_date
      from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      join chiqim_requests cr on cr.id = dm.request_id
      where dm.barcode2 = fp.barcode2
        and cgw.completed_at is not null and (cgw.completed_at at time zone 'utc')::date <= p_to
      order by cgw.completed_at desc nulls last limit 1
    ) as departure_date
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

-- ---- Site 5: wip_rows.raw_not_sent ----
-- Full view reproduced. Only raw_not_sent changes (new rezka lateral join,
-- subtracted in both the select and the threshold filter) -- moyka_not_
-- returned/awaiting_lab/so2_pending/chiqim_open/provisional_weight are all
-- byte-identical to 0070's own definition; the first three are wash_cycles-
-- keyed and structurally unreachable by a Rezka serial regardless.
create or replace view wip_rows as
with limits as (
  select
    (select value from settings_limits where key = 'raw_idle_days') as raw_idle_days,
    (select value from settings_limits where key = 'moyka_idle_days') as moyka_idle_days,
    (select value from settings_limits where key = 'tahlil_kechikdi_days') as tahlil_kechikdi_days,
    (select value from settings_limits where key = 'sulfur_overdue_days') as sulfur_overdue_days,
    (select value from settings_limits where key = 'chiqim_idle_days') as chiqim_idle_days
), raw_not_sent as (
  select 'raw_not_sent' as wip_kind, r.row_key, r.serial, null::uuid as request_id, r.owner_id, r.type_id,
    current_date - (si.confirmed_at at time zone 'utc')::date as days_waiting,
    l.raw_idle_days::integer as threshold_days
  from report_kirim_rows r
  join storage_intake si on si.serial = r.serial
  left join lateral (select coalesce(sum(ms.qty_kg), 0) as total_sent from moyka_sends ms where ms.serial = r.serial) sent on true
  left join lateral (select coalesce(sum(rs.qty_kg), 0) as total_rezka_sent from rezka_sends rs where rs.serial = r.serial) rezka on true
  left join lateral (select coalesce(sum(rdl.net_kg), 0) as total_raw from raw_dispatch_lines rdl where rdl.serial = r.serial) raw on true
  cross join limits l
  where (r.qty_kg - coalesce(sent.total_sent, 0) - coalesce(rezka.total_rezka_sent, 0) - coalesce(raw.total_raw, 0)) > 0
    and r.origin != 'opening_stock'
    and (current_date - (si.confirmed_at at time zone 'utc')::date)::numeric > l.raw_idle_days
), moyka_not_returned as (
  select 'moyka_not_returned' as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id, ko.owner_id, kl.type_id,
    current_date - ms_first.sent_date as days_waiting, l.moyka_idle_days::integer as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (select min(ms2.sent_date) as sent_date from moyka_sends ms2 where ms2.serial = wc.serial) ms_first on true
  cross join limits l
  where wc.status = 'active' and ko.plate not like 'TEST-%'
    and (current_date - ms_first.sent_date)::numeric > l.moyka_idle_days
), awaiting_lab as (
  select 'awaiting_lab' as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id, ko.owner_id, kl.type_id,
    current_date - ms_first.sent_date as days_waiting, l.tahlil_kechikdi_days::integer as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (select min(ms2.sent_date) as sent_date from moyka_sends ms2 where ms2.serial = wc.serial) ms_first on true
  cross join limits l
  where not exists (select 1 from lab_results lr where lr.scope = 'chiqim' and lr.wash_cycle_id = wc.id)
    and ko.plate not like 'TEST-%'
    and (current_date - ms_first.sent_date)::numeric > l.tahlil_kechikdi_days
), so2_pending as (
  select 'so2_pending' as wip_kind, wc.serial as row_key, wc.serial, null::uuid as request_id, ko.owner_id, kl.type_id,
    current_date - lr.sample_date as days_waiting, l.sulfur_overdue_days::integer as threshold_days
  from wash_cycles wc
  join kirim_lines kl on kl.serial = wc.serial
  join kirim_orders ko on ko.order_id = kl.order_id
  join lateral (
    select lr2.sample_date, lr2.status from lab_results lr2
    where lr2.scope = 'chiqim' and lr2.wash_cycle_id = wc.id
    order by lr2.created_at desc limit 1
  ) lr on true
  cross join limits l
  where lr.status = 'moisture_in' and kl.is_sulfured is distinct from false and ko.plate not like 'TEST-%'
    and (current_date - lr.sample_date)::numeric > l.sulfur_overdue_days
), chiqim_open as (
  select 'chiqim_open' as wip_kind, cr.id::text as row_key, null::text as serial, cr.id as request_id, cr.owner_id, null::uuid as type_id,
    current_date - (cr.created_at at time zone 'utc')::date as days_waiting, l.chiqim_idle_days::integer as threshold_days
  from chiqim_requests cr
  left join lateral (
    select cgw_1.completed_at from gate_weighings cgw_1
    where cgw_1.dir = 'chiqim' and cgw_1.request_id = cr.id
    order by cgw_1.completed_at desc nulls last limit 1
  ) cgw on true
  cross join limits l
  where not (cr.ombor_finished_at is not null and cgw.completed_at is not null)
    and cr.plate not like 'TEST-%'
    and (current_date - (cr.created_at at time zone 'utc')::date)::numeric > l.chiqim_idle_days
), provisional_weight as (
  select 'provisional_weight' as wip_kind, r.row_key, r.serial, null::uuid as request_id, r.owner_id, r.type_id,
    null::integer as days_waiting, null::integer as threshold_days
  from report_kirim_rows r
  where r.provisional
)
select * from raw_not_sent
union all select * from moyka_not_returned
union all select * from awaiting_lab
union all select * from so2_pending
union all select * from chiqim_open
union all select * from provisional_weight;

-- ---- Site 6: correct_kirim_line_tara (new_available_kg) ----
-- kirim_line_effective_qty (called, not redefined) is untouched. Only
-- correct_kirim_line_tara's own body changes: one new variable/select
-- fetching Σrezka_sends, subtracted alongside v_sent/v_raw. The RPC's
-- RETURNS TABLE shape is unchanged (no new exposed rezka_sent_kg column --
-- that's UI surface, a frontend decision out of scope this pass); only the
-- correctness of the existing new_available_kg figure changes.
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
  v_rezka_sent numeric;
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

  v_after_eq := kirim_line_effective_qty(p_serial);

  select coalesce(sum(qty_kg), 0) into v_sent from moyka_sends where serial = p_serial;
  select coalesce(sum(qty_kg), 0) into v_rezka_sent from rezka_sends where serial = p_serial;
  select coalesce(sum(net_kg), 0) into v_raw from raw_dispatch_lines where serial = p_serial;

  return query select
    v_before, p_box_mass_kg, v_before_eq, v_after_eq, v_sent, v_raw,
    greatest(0, v_after_eq - v_sent - v_rezka_sent - v_raw);
end
$function$;

-- ---- Site 7: kirim_line_state.omborda_qoldi ----
-- 🔒 Trade-off, surfaced not silently made: this narrows omborda_qoldi's
-- correctness (the stock-integrity priority) at the cost of the existing
-- reconciliation identity's completeness (Qabul qilingan = Omborda qoldi +
-- Moykaga yuborilgan + Xom holda jo'natilgan, verified exactly on real
-- data when this function was first built). Once real Rezka activity
-- exists, that identity will read as qabul_qilingan > omborda_qoldi +
-- moykaga_yuborilgan + xom_jonatilgan by exactly the Rezka-sent amount --
-- there is no "Rezkaga yuborilgan" column yet to absorb it (would mean
-- widening report_query_page/report_totals' return shape and the frontend
-- SerialState type, Hisobot reporting work, out of scope this pass). Left
-- this way deliberately rather than either (a) leaving the overcount in
-- place, or (b) inventing a new balance term to keep the identity whole --
-- (b) would be new balance arithmetic, the thing "don't write new balance
-- calculation" already rules out. Flagged for stage 2/3's own Rezka
-- reporting work.
create or replace function kirim_line_state(p_serial text)
returns table (
  qabul_qilingan     numeric,
  omborda_qoldi      numeric,
  moykaga_yuborilgan numeric,
  moykada            numeric,
  moykadan_chiqgan   numeric,
  xom_jonatilgan     numeric,
  olib_ketilgan      numeric
)
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
  departed as (
    select coalesce(sum(bp.weight_kg), 0) as v
    from base_pallets bp
    where exists (
      select 1 from dispatch_manifest dm
      join gate_weighings cgw on cgw.request_id = dm.request_id and cgw.dir = 'chiqim'
      where dm.barcode2 = bp.barcode2 and cgw.completed_at is not null
    )
  )
  select
    eq.v as qabul_qilingan,
    greatest(0, eq.v - sent.v - rezka_sent.v - raw_disp.v) as omborda_qoldi,
    sent.v as moykaga_yuborilgan,
    greatest(0, sent.v - moyka_out.v) as moykada,
    moyka_out.v as moykadan_chiqgan,
    raw_disp.v as xom_jonatilgan,
    departed.v as olib_ketilgan
  from eq, sent, rezka_sent, raw_disp, moyka_out, departed;
$function$;

-- ---- Site 8: get_serial_passport.raw_storage_loss ----
-- 🔒 This function also carries the mintOrigin.sentWeighedKg fix -- a
-- DIFFERENT bug (display accuracy for a Rezka-minted serial's own send
-- figure, not the double-commit risk this section fixes), and the one
-- asked to be "shipped separately and first, small, unrelated, doesn't
-- need to ride with Rezka." Investigated keeping it truly separate and
-- it isn't possible: that fix reads rezka_sends, a table this migration
-- creates -- a migration referencing it cannot be applied before this one
-- regardless of which file it lives in or which branch it's authored on.
-- Bundled here rather than shipping a migration file that would fail on
-- `apply_migration` if actually run standalone. Both changes are additive
-- and independent within this one CREATE OR REPLACE (a new rezka_sends_
-- total CTE, read from two places: raw_storage_loss or mintOrigin), so
-- nothing about the "separate concern" framing is lost -- they're just
-- necessarily one deployable unit.
--
-- raw_still (used at line ~163, joriyHolat.raw.stillInStorageKg) reads
-- stock_on_hand_rows directly and needed no edit here -- it already
-- inherits site 1's fix automatically, confirmed by direct reference
-- tracing, not re-derived.
create or replace function get_serial_passport(p_serial text)
returns jsonb
language sql
stable
as $function$
with target_line as (
  select kl.serial, kl.order_id, kl.type_id, kl.declared_qty, kl.target_moisture_pct, kl.target_so2_mg_kg,
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
-- New (2026-08-16): the same total for Rezka sends. Read from mintOrigin.
-- sentWeighedKg (a serial can only ever have been sent one way or the
-- other -- 0076's own trigger enforces this at the wash_cycles/rezka_
-- cycles level -- so summing both here is safe, not double-counting) and
-- from raw_storage_loss (the actual stock-integrity fix this section is
-- for).
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
  select distinct dm.request_id
  from dispatch_manifest dm
  join finished_pallets fp on fp.barcode2 = dm.barcode2
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
  select dm.request_id, dm.barcode2, dm.loaded_at, fp.calibre_id, fp.weight_kg
  from dispatch_manifest dm
  join finished_pallets fp on fp.barcode2 = dm.barcode2
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
  select coalesce(sum(fp.weight_kg), 0) as kg
  from finished_pallets fp
  where fp.serial = p_serial
    and exists (
      select 1 from dispatch_manifest dm3
      join gate_weighings cgw3 on cgw3.dir = 'chiqim' and cgw3.request_id = dm3.request_id and cgw3.completed_at is not null
      where dm3.barcode2 = fp.barcode2
    )
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
pending_finished as (
  select distinct cr.id as request_id, cr.request_date, cr.plate, cr.driver, clp.barcode2, fp.calibre_id, fp.weight_kg
  from chiqim_line_pallets clp
  join finished_pallets fp on fp.barcode2 = clp.barcode2
  join chiqim_lines cl on cl.id = clp.line_id
  join chiqim_requests cr on cr.id = cl.request_id
  where fp.serial = p_serial
    and clp.released_at is null
    and cr.voided_at is null
    and not exists (select 1 from dispatch_manifest dm4 where dm4.barcode2 = clp.barcode2)
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
      jsonb_build_object('kind', 'finished', 'requestId', pf.request_id, 'requestDate', pf.request_date, 'plate', pf.plate, 'driver', pf.driver,
                          'barcode2', pf.barcode2, 'calibreId', pf.calibre_id, 'weightKg', pf.weight_kg)
      order by pf.request_date desc
    ), '[]'::jsonb) from pending_finished pf)
    ||
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
        'cycleNo', 1, 'status', wc.status, 'finalLossPct', wc.final_loss_pct, 'sentKg', st.sent_kg,
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
