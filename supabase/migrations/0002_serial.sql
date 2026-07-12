-- Serial generation — IN THE DATABASE (SPEC §2.1, §2.15; PHASE0 Part B2)
-- Two phones can never mint the same serial, because Postgres serialises it.

create table serial_counter (
  day date primary key,
  last_no int not null default 0
);

-- security definer: runs as the migration owner so it can write to
-- serial_counter even though that table has no direct grants to any
-- app role (see 0007_rls.sql) — the ONLY way to obtain a serial is
-- through this function.
create or replace function next_serial() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  d date := (now() at time zone 'Asia/Tashkent')::date;
begin
  insert into serial_counter (day, last_no) values (d, 1)
  on conflict (day) do update set last_no = serial_counter.last_no + 1
  returning last_no into n;

  -- DDMMYY-NNN  e.g. 120826-003
  return to_char(d, 'DDMMYY') || '-' || lpad(n::text, 3, '0');
end;
$$;
