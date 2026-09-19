-- P0 hotfix: Rahbar dashboard / client Панель timing out in production
-- ("canceling statement due to statement timeout") on rahbar_stock_snapshot
-- and rahbar_dashboard_ledger.
--
-- Root cause, confirmed live (role-switched EXPLAIN ANALYZE, TEST client
-- account, Boshidan/С начала period, scope='yangi'):
--   - Unprivileged (RLS bypassed):                 106 ms,     7,718 buffer hits
--   - Role-switched as a real Rahbar/menejer user: 1,917 ms,   85,288 buffer hits
--   - Role-switched as the TEST client:            5,592 ms,  416,975 buffer hits
-- rahbar_stock_snapshot showed the same shape (106ms unprivileged path is
-- fast; ~1.2s under client role).
--
-- Every client_read_own_*/read_all SELECT policy on every table these two
-- RPCs touch calls the bare functions `my_role()`/`my_owner_id()` directly
-- in its USING clause. Both are real SELECTs against `profiles` (STABLE
-- SECURITY DEFINER, not IMMUTABLE) -- Postgres only recognizes a filter as
-- a "One-Time Filter" (evaluate once, reuse) when the ENTIRE qual has zero
-- per-row correlation; the instant the qual also compares a row column
-- (`owner_id = my_owner_id()`, `EXISTS (... AND ko.owner_id = my_owner_id())`),
-- the whole filter re-evaluates per row, calling `my_role()`/`my_owner_id()`
-- fresh every time even though the result never changes within the
-- statement. This RPC pair joins these tables together dozens of times
-- across ~20 CTEs (worsened by the Path E multi-cycle rewrite adding
-- several more join sites: cycles_all/active_cycle_at_to/
-- active_cycle_before_from), so the per-row overhead compounds badly --
-- worse under the client role specifically because its policies need BOTH
-- `my_role()` AND `my_owner_id()` plus an EXISTS join, versus Rahbar's own
-- policies needing only a single `my_role() <> 'client'` check.
--
-- This is the well-documented Postgres/Supabase RLS performance pattern:
-- wrapping a call as `(select my_role())` instead of bare `my_role()`
-- causes Postgres to plan it as an uncorrelated subquery, cached once per
-- statement (an InitPlan) regardless of what else is in the same qual.
-- Purely a performance rewrite -- every policy's USING clause is
-- byte-for-byte identical in meaning, just with two substrings wrapped.
--
-- Verified live in a rolled-back transaction before applying for real:
--   rahbar_dashboard_ledger, client role: 5,592 ms -> 878 ms  (52,044 buffer
--     hits, down from 416,975 -- an 8x reduction)
--   rahbar_stock_snapshot, client role:   1,245 ms -> 863 ms  (12,677 buffer
--     hits, down from 56,076)
--
-- Scope: every table rahbar_stock_snapshot/rahbar_dashboard_ledger touch
-- (traced via pg_get_functiondef + the join graph), not a schema-wide
-- sweep -- "whichever is minimal" per the task. 🚩 Flagged, not fixed here:
-- this same bare-my_role()/my_owner_id() pattern almost certainly exists on
-- every other client_read_own_*/read_all policy in the schema (the original
-- v1.37 rollout and every table added since), so other RPCs likely carry
-- the same latent cost -- a broader sweep is a real follow-up, not bundled
-- into this hotfix.

alter policy client_read_own_kirim_lines on kirim_lines
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from kirim_orders ko
  where ((ko.order_id = kirim_lines.order_id) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on kirim_lines
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_kirim_orders on kirim_orders
  using (((select my_role()) = 'client'::user_role) and (owner_id = (select my_owner_id())));
alter policy read_all on kirim_orders
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_wash_cycles on wash_cycles
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from kirim_lines kl
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((kl.serial = wash_cycles.serial) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on wash_cycles
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_storage_intake on storage_intake
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from kirim_lines kl
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((kl.serial = storage_intake.serial) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on storage_intake
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_moyka_sends on moyka_sends
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from kirim_lines kl
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((kl.serial = moyka_sends.serial) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on moyka_sends
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_rezka_sends on rezka_sends
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from kirim_lines kl
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((kl.serial = rezka_sends.serial) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on rezka_sends
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_raw_dispatch_lines on raw_dispatch_lines
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from kirim_lines kl
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((kl.serial = raw_dispatch_lines.serial) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on raw_dispatch_lines
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_chiqim_lines on chiqim_lines
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from chiqim_requests cr
  where ((cr.id = chiqim_lines.request_id) and (cr.owner_id = (select my_owner_id()))))));
alter policy read_all on chiqim_lines
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_chiqim_requests on chiqim_requests
  using (((select my_role()) = 'client'::user_role) and (owner_id = (select my_owner_id())));
alter policy read_all on chiqim_requests
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_old_stock_closeouts on old_stock_closeouts
  using (((select my_role()) = 'client'::user_role) and (owner_id = (select my_owner_id())));
alter policy read_all on old_stock_closeouts
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_finished_pallets on finished_pallets
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from kirim_lines kl
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((kl.serial = finished_pallets.serial) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on finished_pallets
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_serial_mint_sources on serial_mint_sources
  using (((select my_role()) = 'client'::user_role) and ((exists ( select 1
   from finished_pallets fp
     join kirim_lines kl on ((kl.serial = fp.serial))
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((fp.barcode2 = serial_mint_sources.source_barcode2) and (ko.owner_id = (select my_owner_id()))))) or (exists ( select 1
   from kirim_lines kl2
     join kirim_orders ko2 on ((ko2.order_id = kl2.order_id))
  where ((kl2.serial = serial_mint_sources.minted_serial) and (ko2.owner_id = (select my_owner_id())))))));
alter policy read_all on serial_mint_sources
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_chiqim_pallet_consumption on chiqim_pallet_consumption
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from finished_pallets fp
     join kirim_lines kl on ((kl.serial = fp.serial))
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((fp.barcode2 = chiqim_pallet_consumption.barcode2) and (ko.owner_id = (select my_owner_id()))))));
alter policy read_all on chiqim_pallet_consumption
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_lab_results on lab_results
  using (((select my_role()) = 'client'::user_role) and ((exists ( select 1
   from kirim_lines kl
     join kirim_orders ko on ((ko.order_id = kl.order_id))
  where ((kl.serial = lab_results.parent_serial) and (ko.owner_id = (select my_owner_id()))))) or (exists ( select 1
   from wash_cycles wc
     join kirim_lines kl2 on ((kl2.serial = wc.serial))
     join kirim_orders ko2 on ((ko2.order_id = kl2.order_id))
  where ((wc.id = lab_results.wash_cycle_id) and (ko2.owner_id = (select my_owner_id())))))));
alter policy read_all on lab_results
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_old_kn_pools on old_kn_pools
  using (((select my_role()) = 'client'::user_role) and (owner_id = (select my_owner_id())));
alter policy read_all on old_kn_pools
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_old_kn_collections on old_kn_collections
  using (((select my_role()) = 'client'::user_role) and (exists ( select 1
   from old_kn_pools p
  where ((p.id = old_kn_collections.pool_id) and (p.owner_id = (select my_owner_id()))))));
alter policy read_all on old_kn_collections
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));

alter policy client_read_own_gate_weighings on gate_weighings
  using (((select my_role()) = 'client'::user_role) and ((exists ( select 1
   from kirim_orders ko
  where ((ko.order_id = gate_weighings.order_id) and (ko.owner_id = (select my_owner_id()))))) or (exists ( select 1
   from chiqim_requests cr
  where ((cr.id = gate_weighings.request_id) and (cr.owner_id = (select my_owner_id())))))));
alter policy read_all on gate_weighings
  using ((auth.uid() is not null) and ((select my_role()) <> 'client'::user_role));
