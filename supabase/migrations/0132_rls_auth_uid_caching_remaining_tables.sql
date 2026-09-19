-- Continuation of 0130/0131: wrap auth.uid()/my_role()/my_owner_id() as
-- (select ...) on the last 10 tables the performance advisor's
-- auth_rls_initplan lint still flags. Same pure, behavior-preserving
-- rewrite, same pattern.
--
-- NOTE on "profiles cascade" -- checked and corrected before applying:
-- my_role()/my_owner_id() are SECURITY DEFINER, owned by `postgres`, and
-- `postgres` has rolbypassrls = true (confirmed via pg_roles). RLS is
-- bypassed entirely for their *internal* SELECT against `profiles` --
-- profiles' own RLS policies have zero performance effect on every OTHER
-- policy that calls those two helpers. `profiles` is fixed here anyway,
-- for its own direct-read paths (e.g. any admin/staff-list screen), not
-- for a cascade that doesn't exist.
--
-- dispatch_manifest / chiqim_line_raw_serials are genuinely relevant to
-- report_query_page/report_totals' CHIQIM-side rows (report_dispatch_rows_v2)
-- -- confirmed live, real tail latency on both functions via pg_stat_statements
-- (report_query_page max 7.07s, report_totals max 6.57s), independent of
-- and in addition to the two dashboard RPCs 0130/0131 already fixed.

alter policy read_all on chiqim_fura_photos using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));

alter policy read_all on chiqim_line_raw_serials using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy client_read_own_chiqim_line_raw_serials on chiqim_line_raw_serials using (
  ((select my_role()) = 'client'::user_role) and exists (
    select 1 from chiqim_lines cl join chiqim_requests cr on cr.id = cl.request_id
    where cl.id = chiqim_line_raw_serials.line_id and cr.owner_id = (select my_owner_id())
  )
);

alter policy read_all on dispatch_manifest using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy client_read_own_dispatch_manifest on dispatch_manifest using (
  ((select my_role()) = 'client'::user_role) and exists (
    select 1 from chiqim_requests cr where cr.id = dispatch_manifest.request_id and cr.owner_id = (select my_owner_id())
  )
);

alter policy notes_read on notes using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));

alter policy read_all on owners using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy client_read_own_owner on owners using (((select my_role()) = 'client'::user_role) and (id = (select my_owner_id())));

alter policy read_all on product_categories using ((select auth.uid()) is not null);

alter policy read_all on profiles using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));
alter policy client_read_own_profile on profiles using (((select my_role()) = 'client'::user_role) and (id = (select auth.uid())));

alter policy read_all on rezka_cycles using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));

alter policy read_all on settings_limits using (((select auth.uid()) is not null) and ((select my_role()) <> 'client'::user_role));

-- audit_log_read has no auth.uid()/current_setting() call at all (bare
-- my_role() as the sole conjunct, already a zero-per-row-correlation
-- expression on its own -- the advisor doesn't even flag it), but wrapped
-- anyway for consistency with the rest of this sweep, zero-risk.
alter policy audit_log_read on audit_log using ((select my_role()) = 'rahbar'::user_role);
