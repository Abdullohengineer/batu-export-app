-- Final 2 auth_rls_initplan findings after 0132: both on INSERT with_check
-- (notes_insert, audit_log_insert), zero read-latency impact -- but trivial
-- and zero-risk to close for full schema-wide closure of this lint.
alter policy notes_insert on notes with check ((select auth.uid()) is not null);
alter policy audit_log_insert on audit_log with check ((select auth.uid()) is not null);
