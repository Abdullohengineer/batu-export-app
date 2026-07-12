-- Append-only notes + audit log (SPEC §2.5, §2.7; PHASE0 Part B5)

create table notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  author uuid references profiles,
  body text not null,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  table_name text not null,
  row_id text not null,
  actor uuid,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
