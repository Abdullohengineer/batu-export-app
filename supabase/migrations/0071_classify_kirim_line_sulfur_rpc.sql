-- Natural/sulphured classification moved from Menejer to Laborator
-- (2026-08-15) -- the lab physically observes the product, and because it's
-- set on a form the lab can reopen, a misclassification is fixable in-app
-- instead of requiring SQL. See DECISIONS.md "Natural/sulphured
-- classification moved from Menejer to Laborator; audit trail".
--
-- SECURITY DEFINER, matching send_old_stock_to_moyka's pattern (0055) --
-- deliberately NOT a broad kirim_lines UPDATE policy. A row-level policy
-- would grant Laborator UPDATE on every column of kirim_lines --
-- declared_qty, type_id, order_id -- all of which feed
-- report_kirim_rows_as_of and every downstream balance; "the UI only ever
-- sends is_sulfured" is a client-side assumption, not an enforced one, and
-- the blast radius here isn't comparable to Menejer's date/plate/driver
-- Tahrirlash precedent (0038). This function is the ONLY way is_sulfured
-- can change post-intake: it updates exactly that one column, in the same
-- transaction as its own audit_log row, with actor derived server-side
-- from auth.uid() -- never a client-supplied parameter, since audit_log's
-- own INSERT policy is permissive-by-role (any authenticated user), and a
-- client-supplied actor on a field that gates dispatch isn't trustworthy.
-- A separate client-side audit insert could also fail silently after the
-- flag had already changed; wrapping both writes in one function call
-- makes that impossible -- either both happen or neither does.
create or replace function classify_kirim_line_sulfur(
  p_serial      text,
  p_is_sulfured boolean
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor  uuid := auth.uid();
  v_before boolean;
begin
  if my_role() is distinct from 'laborator' then
    raise exception 'Faqat Laborator mahsulot turini belgilay oladi' using errcode = '42501';
  end if;
  if p_is_sulfured is null then
    raise exception 'Mahsulot turi ko''rsatilmagan' using errcode = '22023';
  end if;

  select is_sulfured into v_before from kirim_lines where serial = p_serial for update;
  if not found then
    raise exception 'Seriya topilmadi: %', p_serial using errcode = 'P0002';
  end if;

  -- No-op if unchanged -- avoids audit noise when the lab saves a form
  -- (e.g. correcting an unrelated field) without actually touching the
  -- classification.
  if v_before is not distinct from p_is_sulfured then
    return;
  end if;

  update kirim_lines set is_sulfured = p_is_sulfured where serial = p_serial;

  insert into audit_log (table_name, row_id, actor, action, before, after)
  values (
    'kirim_lines', p_serial, v_actor, 'is_sulfured',
    jsonb_build_object('is_sulfured', v_before),
    jsonb_build_object('is_sulfured', p_is_sulfured)
  );
end
$function$;

revoke all on function classify_kirim_line_sulfur(text, boolean) from public;
grant execute on function classify_kirim_line_sulfur(text, boolean) to authenticated;
