-- Move Rahbar's Sozlamalar (master data + threshold admin) write access to
-- Menejer, per the Rahbar->Menejer screen-move task. Diqqat talab needed no
-- RLS change (its backing rahbar_* RPCs were already `grant execute to
-- authenticated`, not role-restricted). Foydalanuvchilar's real gate is the
-- admin-users Edge Function (service_role key, bypasses RLS) -- handled
-- separately, not here.
--
-- Confirmed with the user: Rahbar loses these write grants entirely (not
-- left as an unreachable-via-UI safety net) -- Rahbar becomes fully
-- read-only app-wide, matching "this is a move."

drop policy rahbar_admin_product_categories_insert on product_categories;
drop policy rahbar_admin_product_categories_update on product_categories;
create policy menejer_admin_product_categories_insert on product_categories for insert to public with check (my_role() = 'menejer');
create policy menejer_admin_product_categories_update on product_categories for update to public using (my_role() = 'menejer') with check (my_role() = 'menejer');

drop policy rahbar_admin_product_types_insert on product_types;
drop policy rahbar_admin_product_types_update on product_types;
create policy menejer_admin_product_types_insert on product_types for insert to public with check (my_role() = 'menejer');
create policy menejer_admin_product_types_update on product_types for update to public using (my_role() = 'menejer') with check (my_role() = 'menejer');

drop policy rahbar_admin_calibres_insert on calibres;
drop policy rahbar_admin_calibres_update on calibres;
create policy menejer_admin_calibres_insert on calibres for insert to public with check (my_role() = 'menejer');
create policy menejer_admin_calibres_update on calibres for update to public using (my_role() = 'menejer') with check (my_role() = 'menejer');

drop policy rahbar_admin_settings_limits_update on settings_limits;
create policy menejer_admin_settings_limits_update on settings_limits for update to public using (my_role() = 'menejer') with check (my_role() = 'menejer');

-- owners: Menejer's own menejer_owners_insert/update already exists
-- (0031_rahbar_settings_schema_and_rls.sql) -- just drop Rahbar's now-unused grant.
drop policy rahbar_admin_owners_insert on owners;
drop policy rahbar_admin_owners_update on owners;

-- profiles: drop Rahbar's FOR ALL grant. Not replaced with a Menejer
-- equivalent -- Foydalanuvchilar never writes to profiles directly (it goes
-- through the admin-users Edge Function's service_role key, which bypasses
-- RLS entirely), and a broad FOR ALL grant here would let Menejer
-- self-promote via a raw `update profiles set role='rahbar'` call, which
-- nothing today requires.
drop policy rahbar_admin_profiles on profiles;
