-- Found while wiring Ombor's finish action (0018 added
-- chiqim_requests.ombor_finished_at): chiqim_requests had NO update policy
-- at all — only menejer_writes (INSERT) and read_all (SELECT), same gap
-- pattern as every other FK-ripple table found in prior steps, just an RLS
-- gap instead of a dangling FK. Without this, Ombor's finish click would be
-- refused server-side (42501) the moment it tried to write
-- ombor_finished_at, even though the column itself exists.
--
-- Same shape as finished_pallets.ombor_updates (0007_rls.sql) — ombor is the
-- only role that writes this column, matching the per-role finalization
-- invariant (this is Ombor's own signal, not shared).

create policy ombor_updates on chiqim_requests for update
  using (my_role() = 'ombor');
