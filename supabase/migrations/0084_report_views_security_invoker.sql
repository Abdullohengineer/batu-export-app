-- Close the RLS-bypass gap found while verifying the client role (see
-- docs/DECISIONS.md "Client role: RLS scoping, view-ownership RLS-bypass
-- finding"). Confirmed live, empirically, against a disposable TEST-
-- client account (owning zero real data): `select count(*) from
-- report_kirim_rows` returned 26 (all real rows, every owner) and
-- `stock_on_hand_rows` returned 128, despite kirim_orders/finished_pallets
-- themselves correctly returning 0 for the same session. Root cause: every
-- view below is owned by `postgres`, which has rolbypassrls = true; a
-- Postgres view defaults to security_invoker = false, meaning row security
-- on the view's own underlying tables is evaluated as the VIEW OWNER, not
-- the querying session -- and since that owner bypasses RLS entirely, the
-- view returns every row to every caller regardless of the caller's own
-- RLS scoping. `get_client_report`/`report_query_page` happened to read
-- back as empty during testing only because they ALSO separately re-join
-- to real, RLS-scoped tables (kirim_orders/owners) with an explicit
-- owner_id filter -- an incidental protection, not a real one:
-- `get_serial_passport`'s effectiveQty/gate/dispatches sections pull
-- straight from report_kirim_rows/report_chiqim_rows with no such re-join,
-- and would have leaked any real serial's data to any authenticated
-- 'client' caller who simply guessed/knew the serial string.
--
-- Fix: security_invoker = true (PG15+ view option) makes each view
-- evaluate privileges AND row security as the CALLING role instead of the
-- owner. Zero behaviour change for the 5 existing internal-staff roles --
-- their own base-table policies are the same permissive
-- `auth.uid() is not null and my_role() <> 'client'` either way, so the
-- boolean result is identical whether evaluated as postgres or as
-- themselves. Only 'client' is newly, correctly constrained -- to
-- whatever the tightened base-table policies (0083) already allow.
alter view report_kirim_rows        set (security_invoker = true);
alter view report_chiqim_rows       set (security_invoker = true);
alter view report_raw_dispatch_rows set (security_invoker = true);
alter view report_old_kn_rows       set (security_invoker = true);
alter view report_moyka_send_rows   set (security_invoker = true);
alter view report_moyka_output_rows set (security_invoker = true);
alter view report_rows              set (security_invoker = true);
alter view report_rows_v2           set (security_invoker = true);
alter view stock_on_hand_rows       set (security_invoker = true);
alter view wip_rows                 set (security_invoker = true);
alter view yield_rows               set (security_invoker = true);
alter view old_stock_closeout_lines set (security_invoker = true);
