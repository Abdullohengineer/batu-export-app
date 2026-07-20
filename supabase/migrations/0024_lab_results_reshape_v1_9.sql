-- Laborator foundations, part A (Step 8 prompt 2, split 2a — schema + RLS
-- only, no app code). Reshapes the Phase 0 lab_results table into the
-- v1.9 design (SPEC.md §5.5, §8 amendment) rather than creating it fresh --
-- inspection (CLAUDE.md's own rule: check live schema before assuming
-- shape) found it already existed, 0 rows, never used since Laborator was
-- never built. Its `serial` FK was one of six dropped in 0009's
-- kirim_orders->kirim_lines ripple and never re-pointed -- the last
-- dangling one; storage_intake/moyka_sends/finished_pallets/wash_cycles
-- each got the same fix on their own first-write step (0014/0016/0017).
--
-- scope stays the existing `direction` enum (kirim/chiqim) rather than a
-- new text column -- already correct, matches gate_weighings.dir.

alter table lab_results rename column serial to parent_serial;
alter table lab_results
  add constraint lab_results_parent_serial_fkey foreign key (parent_serial) references kirim_lines(serial);

-- request_id -> wash_cycle_id: v1.9's CHIQIM trigger is Moyka output
-- (a wash cycle), not a dispatch request (SPEC.md v1.9 §5.5.3/§8).
alter table lab_results drop constraint lab_results_request_id_fkey;
alter table lab_results rename column request_id to wash_cycle_id;
alter table lab_results
  add constraint lab_results_wash_cycle_id_fkey foreign key (wash_cycle_id) references wash_cycles(id);

alter table lab_results rename column created_by to tested_by;
alter table lab_results alter column tested_by set not null;

-- unsulfured (boolean flag) is superseded by v1.9 §5.5.1: "no SO2 target on
-- the parent line" is now the single source of truth for "natural product",
-- not a separate stored flag that could drift from it.
alter table lab_results drop column unsulfured;

alter table lab_results add column created_at timestamptz not null default now();
alter table lab_results add column status text not null default 'moisture_in';
alter table lab_results add column verdict text;
alter table lab_results add column note text;

-- A row only ever gets created once Tahlil is submitted (moisture always
-- entered at that point) -- safe to tighten on a 0-row table.
alter table lab_results alter column moisture_pct set not null;

alter table lab_results add constraint lab_results_status_check check (status in ('moisture_in', 'complete'));
alter table lab_results add constraint lab_results_verdict_check check (verdict is null or verdict in ('o_tdi', 'qayta_yuvish'));
-- No verdict on KIRIM (descriptive only); CHIQIM always needs one eventually.
alter table lab_results add constraint lab_results_scope_verdict_check check ((scope = 'kirim' and verdict is null) or scope = 'chiqim');
-- wash_cycle_id required exactly on CHIQIM scope, null on KIRIM (KIRIM
-- tests the raw serial itself, not any wash cycle's output).
alter table lab_results add constraint lab_results_scope_cycle_check check ((scope = 'kirim' and wash_cycle_id is null) or (scope = 'chiqim' and wash_cycle_id is not null));

-- RLS already correct on this table from Phase 0 (read_all + laborator_writes
-- insert + laborator_updates update, unrestricted -- matches every other
-- role's update policy shape, e.g. ombor_updates). No RLS change needed.

-- Generic audit-log trigger (SPEC.md §2.7) -- confirmed via full migration +
-- src/ grep that NO table has ever had one; audit_log (0005_notes_audit.sql)
-- has sat empty and unwired since Phase 0. Systemic gap, flagged in
-- DECISIONS.md, not retrofitted onto every existing table here -- that's
-- its own future task. Attached only to lab_results, the table this prompt
-- owns, per explicit instruction. Not security definer: audit_log's
-- existing insert policy (auth.uid() is not null) already permits any
-- authenticated session, so no privilege escalation is needed here, unlike
-- complete_chiqim_stage2 (qorovul has zero write access to chiqim_requests
-- directly).
create or replace function log_audit() returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into audit_log (table_name, row_id, actor, action, before, after)
  values (
    TG_TABLE_NAME,
    coalesce(new.id, old.id)::text,
    auth.uid(),
    TG_OP,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return new;
end;
$$;

create trigger lab_results_audit
  after insert or update on lab_results
  for each row execute function log_audit();
