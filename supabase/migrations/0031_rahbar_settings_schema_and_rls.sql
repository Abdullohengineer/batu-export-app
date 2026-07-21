-- §3.3 Rahbar settings: schema + RLS changes.
--
-- 1. calibres needs an active flag -- the only master table missing one
--    (owners/product_types/product_categories already have it, unused by
--    any admin UI until now since none existed).
alter table calibres add column if not exists active boolean not null default true;

-- 2. Extend the "Never DELETE" invariant (SPEC.md §2.15) to master data.
--    The prior rahbar_admin_* policies granted FOR ALL (insert/update/
--    DELETE), even though SPEC.md's own §2.15 text already documented
--    "INSERT/UPDATE only" as the intended design -- this closes that gap
--    rather than opening a new restriction. Master data referenced by
--    operational rows must not be deletable at all, not just missing a
--    delete button in the UI.
drop policy if exists rahbar_admin_owners on owners;
create policy rahbar_admin_owners_insert on owners for insert to public with check (my_role() = 'rahbar');
create policy rahbar_admin_owners_update on owners for update to public using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

drop policy if exists rahbar_admin_product_types on product_types;
create policy rahbar_admin_product_types_insert on product_types for insert to public with check (my_role() = 'rahbar');
create policy rahbar_admin_product_types_update on product_types for update to public using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

drop policy if exists rahbar_admin_product_categories on product_categories;
create policy rahbar_admin_product_categories_insert on product_categories for insert to public with check (my_role() = 'rahbar');
create policy rahbar_admin_product_categories_update on product_categories for update to public using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

drop policy if exists rahbar_admin_calibres on calibres;
create policy rahbar_admin_calibres_insert on calibres for insert to public with check (my_role() = 'rahbar');
create policy rahbar_admin_calibres_update on calibres for update to public using (my_role() = 'rahbar') with check (my_role() = 'rahbar');

drop policy if exists rahbar_admin_settings_limits on settings_limits;
create policy rahbar_admin_settings_limits_update on settings_limits for update to public using (my_role() = 'rahbar') with check (my_role() = 'rahbar');
-- no insert policy: threshold keys are seeded by migrations only, never created from the UI.

-- 3. NEW: Menejer may create/rename clients (owners) only -- "a new buyer
--    shouldn't require the owner." Scoped to this one table only; Menejer
--    gets no write access to product_types/calibres/product_categories/
--    settings_limits.
--
-- 🔒 Deliberately row-level, not column-restricted, even though this grants
-- Menejer the technical ability to also flip `active` on an owner (not just
-- name) -- confirmed with the user. A real column-level restriction would
-- need either a BEFORE UPDATE trigger or routing Menejer through a narrow
-- RPC instead of a raw table UPDATE, since this app's RLS model has every
-- app-role sharing one Postgres role (`authenticated`) with role-checks done
-- entirely inside USING/WITH CHECK -- native column-level GRANTs can't
-- distinguish "menejer" from "rahbar" here, only a real per-write-check
-- mechanism could. Disproportionate for a reversible, low-stakes case: the
-- Menejer clients screen (built this task) simply never renders a
-- deactivate control, so the only path to exploiting the widened grant is a
-- deliberate direct API call, not an accidental UI click. Documented in
-- DECISIONS.md "Rahbar settings (§3.3)" per the user's explicit instruction
-- not to leave this unstated either way.
create policy menejer_owners_insert on owners for insert to public with check (my_role() = 'menejer');
create policy menejer_owners_update on owners for update to public using (my_role() = 'menejer') with check (my_role() = 'menejer');
