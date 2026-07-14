-- gate_weighings → v1.9 shape (SPEC §2.1, §4, §8; DECISIONS.md "Serial is
-- per type-line, not per truck" + Phase 1 Step 1's FK-ripple note).
--
-- Inspected the live table before writing this (via Supabase MCP, project
-- qohoqbapevrcjqxbstxi) rather than assuming its shape:
--   - `serial` exists but is unconstrained (its FK to kirim_orders(serial)
--     was dropped in 0009, since kirim_orders no longer has a serial).
--   - `request_id` ALREADY exists with a working FK to chiqim_requests(id).
--     chiqim_requests already exists (created in Phase 0's
--     0003_operational.sql) — it was never removed. So, unlike what this
--     step's task description assumed, request_id needs no new FK here.
--   - `net_kg` is already `generated always as (gruzheny_kg - pustoy_kg)`.
--   - RLS is already enabled with exactly the required policies
--     (read_all select, qorovul_writes insert, qorovul_updates update) —
--     nothing to change there either.
--   - The old constraint `gate_weighings_check` enforced
--     "serial IS NOT NULL OR request_id IS NOT NULL". That needs to become
--     "order_id OR request_id" now that serial is gone.
--
-- So the only real work: add order_id, swap the check constraint, drop serial.

alter table gate_weighings
  add column order_id uuid references kirim_orders(order_id);

alter table gate_weighings
  drop constraint gate_weighings_check;

alter table gate_weighings
  add constraint gate_weighings_check
  check (num_nonnulls(order_id, request_id) = 1);

alter table gate_weighings
  drop column serial;
