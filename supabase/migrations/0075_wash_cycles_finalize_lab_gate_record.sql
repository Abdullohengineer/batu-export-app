-- Records a policy that is already live on production but was never
-- captured as a file in this directory (2026-08-16).
--
-- Investigated per direct instruction, before any Rezka design work:
-- docs/DECISIONS.md documents "wash_cycles_finalize_lab_gate" (2026-08-14,
-- "Ombor Moyka finalize: restore the lab-verdict hard gate on Tugallash")
-- as applied and live-tested against production. Checked the live database
-- directly (Supabase MCP) rather than trusting the doc:
--   1. `select * from pg_policies where tablename = 'wash_cycles'` shows the
--      ombor_updates UPDATE policy's with_check clause already carries the
--      finalize-verdict branch, byte-identical to what DECISIONS.md quotes.
--   2. `select * from supabase_migrations.schema_migrations where version =
--      '20260813141859'` confirms Supabase's OWN migration history has this
--      as a real, named, applied migration ("wash_cycles_finalize_lab_gate")
--      -- applied via the MCP `apply_migration` tool directly against the
--      project, evidently never pulled down into this directory afterward.
--      Its `statements` column holds the exact SQL below, comments included.
-- Conclusion: the policy is genuinely live, not merely documented. This file
-- makes the migrations directory match reality -- a fresh environment
-- provisioned from `supabase/migrations/*.sql` alone would otherwise get
-- the unguarded pre-2026-08-14 policy (0007_rls.sql: `using (my_role() =
-- 'ombor')`, no with_check at all). `drop policy if exists` (not a bare
-- `drop policy`) so this file is safe to run against either a fresh
-- environment (no policy yet) or production (already has it) -- applying it
-- to production is a no-op, confirmed by comparing this statement to the
-- pg_policies read above.
--
-- NOT touched: a second, smaller instance of the same gap exists for
-- "kirim_lines_is_sulfured_flag" (version 20260815031646 in Supabase's own
-- migration history, no matching local file -- only the second of that
-- day's two applies, "wip_rows_is_sulfured_flag", became local file 0070).
-- That one adds a column + backfills data, not an RLS policy -- lower risk
-- if a fresh environment lacks it (a missing column fails loudly, not a
-- silently-unguarded write path) -- and wasn't the policy asked about here.
-- Flagged, not fixed in this file; out of scope for this task.

drop policy if exists ombor_updates on wash_cycles;
create policy ombor_updates on wash_cycles for update
  using (my_role() = 'ombor')
  with check (
    my_role() = 'ombor'
    and (
      status != 'final'
      or (
        select lr.verdict from lab_results lr
        where lr.wash_cycle_id = wash_cycles.id and lr.scope = 'chiqim'
        order by lr.created_at desc limit 1
      ) = 'o_tdi'
    )
  );
