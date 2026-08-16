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
-- (0074, this session -- see that file). Rezka has no lab by design
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
-- (0074) with a verdict it structurally can never have, permanently
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
