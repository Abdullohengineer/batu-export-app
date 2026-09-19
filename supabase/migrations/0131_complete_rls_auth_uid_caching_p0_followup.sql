-- P0 follow-up: 0130 wrapped my_role()/my_owner_id() as (select ...) on 34
-- client_read_own_*/read_all policies across 17 tables, but LEFT the sibling
-- `auth.uid() IS NOT NULL` check in every one of those tables' `read_all`
-- policy completely bare/unwrapped. Confirmed live post-0130:
--
--   read_all qual = "(auth.uid() IS NOT NULL) AND ((SELECT my_role()) <> 'client')"
--
-- A single un-wrapped call anywhere in the qual defeats Postgres's ability to
-- treat the whole expression as a cheap one-time filter -- `read_all` is
-- evaluated on every read from every role (including client reads, via
-- OR-combined permissive policies, even though it always evaluates false for
-- them), so this alone still leaves per-row auth.uid() evaluation on the
-- exact same 17-table hot path 0130 was meant to fix.
--
-- Confirmed via Supabase's own performance advisor (auth_rls_initplan, WARN):
-- still flagged on all 17 of these tables post-0130, plus `calibres` and
-- `product_types` -- two lookup tables joined directly by both
-- rahbar_dashboard_ledger (calibre-split totals) and rahbar_stock_snapshot
-- (byCalibre / oldKnByType), never touched by 0130 at all (their `read_all`
-- was just bare `auth.uid() IS NOT NULL`, no my_role()/my_owner_id() call to
-- begin with).
--
-- Real production impact confirmed via pg_stat_statements: rahbar_dashboard_ledger
-- (822 calls) mean 858ms but max 7302ms; rahbar_stock_snapshot (799 calls)
-- mean 537ms but max 6766ms -- both tails cross the 8s authenticated /
-- 3s anon statement_timeout, matching the live "canceling statement due to
-- statement timeout" errors in postgres_logs. All tables involved are tiny
-- (<300 rows, <250kB), so this is a plan/qual-caching gap, not data volume or
-- bloat (checked and ruled out both).
--
-- Same pure, behavior-preserving rewrite as 0130, just closing the gap it left.

alter policy read_all on kirim_orders using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on kirim_lines using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on wash_cycles using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on storage_intake using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on moyka_sends using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on rezka_sends using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on raw_dispatch_lines using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on chiqim_lines using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on chiqim_requests using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on old_stock_closeouts using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on finished_pallets using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on serial_mint_sources using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on chiqim_pallet_consumption using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on lab_results using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on old_kn_pools using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on old_kn_collections using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy read_all on gate_weighings using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));

-- calibres/product_types: never touched by 0130 -- plain lookup tables with
-- no owner concept, so just a bare auth-check, but still per-row-correlated
-- when joined (both RPCs join calibres per output/stock row, product_types
-- per old-KN-by-type row).
alter policy read_all on calibres using ((select auth.uid()) is not null);
alter policy read_all on product_types using ((select auth.uid()) is not null);
