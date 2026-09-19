-- Applied 2026-09-19 against project qohoqbapevrcjqxbstxi.
-- Residual-reprocess execution for serials 290726-068/069/072, see
-- docs/decisions/0198-2026-09-19-residual-reprocess-068-069-072-execution.md.
--
-- Bookkeeping only. The physical material moved through Moyka already
-- (send 2026-09-15, receive 2026-09-16, ~157kg combined residual sent,
-- ~140kg output -- see docs/decisions/0195 for the original incident this
-- traces back to). This migrates the DB to match reality: opens a real
-- cycle 2 on each closed serial (Path E, docs/decisions/0196/0127), then
-- registers the real send/lab/receive/close for that cycle.
--
-- Final split (confirmed by Abdulloh after two rounds of correction --
-- see the decisions doc for why the original 40/40/10/10/20/20 breakdown
-- couldn't be applied as given):
--   068: sent 92, K8=50, KN=40, output=90, loss=2
--   069: sent 29, K8=10, KN=10, output=20, loss=9
--   072: sent 36, K8=10, KN=20, output=30, loss=6
--   totals: sent 157, K8=70, KN=70, output=140, loss=17
--
-- Both open_second_wash_cycle and close_wash_cycle_serial are role-gated
-- (auth.role()='service_role' / my_role()='ombor') and cannot be invoked
-- literally over this MCP/superuser connection (verified: auth.role() and
-- my_role() both evaluate null here, same precedent as docs/decisions/0196
-- and 0161). Both RPCs' own internal effects are hand-replicated instead
-- (same INSERT/UPDATE shape, same audit_log entries they would write).
--
-- Pre-flight verification (read-only, before touching anything):
--   client_serial_loss_kg: 068=50, 069=45, 072=53 (matches 0195's post-state)
--   kirim_line_state.omborda_qoldi: 068=92, 069=29, 072=36
--   wash_cycles: one row each, cycle_no=1, closed_at=2026-08-29, all with
--     a passing ('o_tdi') chiqim lab verdict -- open_second_wash_cycle's
--     own preconditions all genuinely satisfied.

begin;
do $$
declare
  v_cycle2_id uuid; v_wc_after jsonb; v_send_id uuid; v_send_after jsonb;
  v_k8_after jsonb; v_kn_after jsonb; v_close_before jsonb; v_close_after jsonb;
begin
  insert into wash_cycles (serial, cycle_no, opened_at, closed_at, status)
  values ('290726-068', 2, now(), null, 'active')
  returning id, jsonb_build_object('serial', serial, 'cycle_no', cycle_no, 'opened_at', opened_at, 'closed_at', closed_at, 'status', status)
    into v_cycle2_id, v_wc_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('wash_cycles', v_cycle2_id::text, null, 'insert', null, v_wc_after, now());

  insert into moyka_sends (serial, sent_date, qty_kg, created_by)
  values ('290726-068', '2026-09-15', 92, null)
  returning id, jsonb_build_object('serial', serial, 'sent_date', sent_date, 'qty_kg', qty_kg, 'created_by', created_by)
    into v_send_id, v_send_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('moyka_sends', v_send_id::text, null, 'insert', null, v_send_after, now());

  -- lab_results has its own AFTER INSERT audit trigger (log_audit()) -- no
  -- manual audit_log entry for this one, it would double-log.
  insert into lab_results (scope, parent_serial, wash_cycle_id, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, note)
  values ('chiqim', '290726-068', v_cycle2_id, '2026-09-16', 21, 1044, '97950d26-6fae-4b09-9b48-b5bf574ed48f', 'complete', 'o_tdi', 'residual-reprocess cycle 2');

  insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status)
  values ('PLT-290726-068-08-1', '290726-068', '48aebd73-1de9-4edb-802a-ad38e197fc7e', 'a8a7bdd0-5385-48fe-9fd6-89056bf42492', 50, '2026-09-16', 'in_stock')
  returning jsonb_build_object('barcode2', barcode2, 'serial', serial, 'calibre_id', calibre_id, 'weight_kg', weight_kg, 'received_date', received_date, 'status', status) into v_k8_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('finished_pallets', 'PLT-290726-068-08-1', null, 'insert', null, v_k8_after, now());

  insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status)
  values ('PLT-290726-068-KN-3', '290726-068', '48aebd73-1de9-4edb-802a-ad38e197fc7e', '445fd28d-1f1a-4612-950b-3d5bc7b541ac', 40, '2026-09-16', 'in_stock')
  returning jsonb_build_object('barcode2', barcode2, 'serial', serial, 'calibre_id', calibre_id, 'weight_kg', weight_kg, 'received_date', received_date, 'status', status) into v_kn_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('finished_pallets', 'PLT-290726-068-KN-3', null, 'insert', null, v_kn_after, now());

  select jsonb_build_object('closed_at', closed_at) into v_close_before from wash_cycles where id = v_cycle2_id;
  update wash_cycles set closed_at = now() where id = v_cycle2_id
    returning jsonb_build_object('closed_at', closed_at) into v_close_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('wash_cycles', v_cycle2_id::text, null, 'update_correction', v_close_before, v_close_after, now());
end $$;
commit;

begin;
do $$
declare
  v_cycle2_id uuid; v_wc_after jsonb; v_send_id uuid; v_send_after jsonb;
  v_k8_after jsonb; v_kn_after jsonb; v_close_before jsonb; v_close_after jsonb;
begin
  insert into wash_cycles (serial, cycle_no, opened_at, closed_at, status)
  values ('290726-069', 2, now(), null, 'active')
  returning id, jsonb_build_object('serial', serial, 'cycle_no', cycle_no, 'opened_at', opened_at, 'closed_at', closed_at, 'status', status)
    into v_cycle2_id, v_wc_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('wash_cycles', v_cycle2_id::text, null, 'insert', null, v_wc_after, now());

  insert into moyka_sends (serial, sent_date, qty_kg, created_by)
  values ('290726-069', '2026-09-15', 29, null)
  returning id, jsonb_build_object('serial', serial, 'sent_date', sent_date, 'qty_kg', qty_kg, 'created_by', created_by)
    into v_send_id, v_send_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('moyka_sends', v_send_id::text, null, 'insert', null, v_send_after, now());

  insert into lab_results (scope, parent_serial, wash_cycle_id, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, note)
  values ('chiqim', '290726-069', v_cycle2_id, '2026-09-16', 21, 1044, '97950d26-6fae-4b09-9b48-b5bf574ed48f', 'complete', 'o_tdi', 'residual-reprocess cycle 2');

  insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status)
  values ('PLT-290726-069-08-1', '290726-069', '48aebd73-1de9-4edb-802a-ad38e197fc7e', 'a8a7bdd0-5385-48fe-9fd6-89056bf42492', 10, '2026-09-16', 'in_stock')
  returning jsonb_build_object('barcode2', barcode2, 'serial', serial, 'calibre_id', calibre_id, 'weight_kg', weight_kg, 'received_date', received_date, 'status', status) into v_k8_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('finished_pallets', 'PLT-290726-069-08-1', null, 'insert', null, v_k8_after, now());

  insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status)
  values ('PLT-290726-069-KN-3', '290726-069', '48aebd73-1de9-4edb-802a-ad38e197fc7e', '445fd28d-1f1a-4612-950b-3d5bc7b541ac', 10, '2026-09-16', 'in_stock')
  returning jsonb_build_object('barcode2', barcode2, 'serial', serial, 'calibre_id', calibre_id, 'weight_kg', weight_kg, 'received_date', received_date, 'status', status) into v_kn_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('finished_pallets', 'PLT-290726-069-KN-3', null, 'insert', null, v_kn_after, now());

  select jsonb_build_object('closed_at', closed_at) into v_close_before from wash_cycles where id = v_cycle2_id;
  update wash_cycles set closed_at = now() where id = v_cycle2_id
    returning jsonb_build_object('closed_at', closed_at) into v_close_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('wash_cycles', v_cycle2_id::text, null, 'update_correction', v_close_before, v_close_after, now());
end $$;
commit;

begin;
do $$
declare
  v_cycle2_id uuid; v_wc_after jsonb; v_send_id uuid; v_send_after jsonb;
  v_k8_after jsonb; v_kn_after jsonb; v_close_before jsonb; v_close_after jsonb;
begin
  insert into wash_cycles (serial, cycle_no, opened_at, closed_at, status)
  values ('290726-072', 2, now(), null, 'active')
  returning id, jsonb_build_object('serial', serial, 'cycle_no', cycle_no, 'opened_at', opened_at, 'closed_at', closed_at, 'status', status)
    into v_cycle2_id, v_wc_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('wash_cycles', v_cycle2_id::text, null, 'insert', null, v_wc_after, now());

  insert into moyka_sends (serial, sent_date, qty_kg, created_by)
  values ('290726-072', '2026-09-15', 36, null)
  returning id, jsonb_build_object('serial', serial, 'sent_date', sent_date, 'qty_kg', qty_kg, 'created_by', created_by)
    into v_send_id, v_send_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('moyka_sends', v_send_id::text, null, 'insert', null, v_send_after, now());

  insert into lab_results (scope, parent_serial, wash_cycle_id, sample_date, moisture_pct, so2_mg_kg, tested_by, status, verdict, note)
  values ('chiqim', '290726-072', v_cycle2_id, '2026-09-16', 21, 1044, '97950d26-6fae-4b09-9b48-b5bf574ed48f', 'complete', 'o_tdi', 'residual-reprocess cycle 2');

  insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status)
  values ('PLT-290726-072-08-1', '290726-072', '48aebd73-1de9-4edb-802a-ad38e197fc7e', 'a8a7bdd0-5385-48fe-9fd6-89056bf42492', 10, '2026-09-16', 'in_stock')
  returning jsonb_build_object('barcode2', barcode2, 'serial', serial, 'calibre_id', calibre_id, 'weight_kg', weight_kg, 'received_date', received_date, 'status', status) into v_k8_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('finished_pallets', 'PLT-290726-072-08-1', null, 'insert', null, v_k8_after, now());

  insert into finished_pallets (barcode2, serial, type_id, calibre_id, weight_kg, received_date, status)
  values ('PLT-290726-072-KN-3', '290726-072', '48aebd73-1de9-4edb-802a-ad38e197fc7e', '445fd28d-1f1a-4612-950b-3d5bc7b541ac', 20, '2026-09-16', 'in_stock')
  returning jsonb_build_object('barcode2', barcode2, 'serial', serial, 'calibre_id', calibre_id, 'weight_kg', weight_kg, 'received_date', received_date, 'status', status) into v_kn_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('finished_pallets', 'PLT-290726-072-KN-3', null, 'insert', null, v_kn_after, now());

  select jsonb_build_object('closed_at', closed_at) into v_close_before from wash_cycles where id = v_cycle2_id;
  update wash_cycles set closed_at = now() where id = v_cycle2_id
    returning jsonb_build_object('closed_at', closed_at) into v_close_after;
  insert into audit_log (table_name, row_id, actor, action, before, after, at)
  values ('wash_cycles', v_cycle2_id::text, null, 'update_correction', v_close_before, v_close_after, now());
end $$;
commit;

-- ============================================================
-- FOLLOW-UP CORRECTION, applied immediately after the above, same session.
--
-- The three inserts above set opened_at = closed_at = now() (the moment
-- this script ran, 2026-09-19), not the real physical event dates. This
-- is exactly the mistake docs/decisions/0161/0187/0196 warn against --
-- "restore the true physical date, not the correction's execution date."
-- Caught by this file's own mandated post-write verification (not by the
-- writes themselves erroring): kirim_line_loss_range('290726-068',
-- '2026-08-01','2026-08-31') read -40 instead of the required unchanged
-- 50, because cycle 1's window ([opened_at, next_opened_at)) extended all
-- the way to 2026-09-18 (cycle 2's wrongly-late opened_at minus a day),
-- swallowing cycle 2's real September 16 receipt into cycle 1's own
-- already-reported August figure -- the exact leak 0127 exists to
-- prevent, reintroduced by this correction's own bad timestamps.
--
-- Fix: backdate opened_at to each cycle's own earliest moyka_sends.
-- sent_date (2026-09-15 -- the same backfill rule 0196 used for cycle 1)
-- and closed_at to the real receive date (2026-09-16).
-- ============================================================

begin;
do $$
declare v_before jsonb; v_after jsonb; v_id uuid;
begin
  for v_id in select id from wash_cycles where serial in ('290726-068','290726-069','290726-072') and cycle_no = 2 loop
    select jsonb_build_object('serial', serial, 'opened_at', opened_at, 'closed_at', closed_at) into v_before from wash_cycles where id = v_id;
    update wash_cycles set opened_at = '2026-09-15T00:00:00Z', closed_at = '2026-09-16T00:00:00Z' where id = v_id
      returning jsonb_build_object('serial', serial, 'opened_at', opened_at, 'closed_at', closed_at) into v_after;
    insert into audit_log (table_name, row_id, actor, action, before, after, at)
    values ('wash_cycles', v_id::text, null, 'update_correction', v_before, v_after, now());
  end loop;
end $$;
commit;

-- Verified after applying (live, all named surfaces):
--   client_serial_loss_kg: 068=52, 069=54, 072=59 (was 50/45/53)
--   kirim_line_state: omborda_qoldi=0 all three; moykaga_yuborilgan
--     068=2412/069=2284/072=2239; moykadan_chiqgan 068=2360/069=2230/
--     072=2180; moykada=0 all three (both cycles closed)
--   stock_on_hand_rows raw_not_washed: no row for any of the three
--     (previously 92/29/36kg -- fully consumed)
--   kirim_line_loss_range: August unchanged at 50/45/53; September shows
--     only cycle 2's own loss, 2/9/6
--   kirim_line_moyka_asof: 0 for all three (both cycles closed)
--   kirim_line_loss_asof: as-of Aug 31 = 50/45/53 (cycle 2 not closed
--     yet); as-of today = 52/54/59 (both cycles)
--   get_client_report: August's per-serial loss contribution from these
--     three confirmed unchanged (hand-verified against the function's own
--     window logic: their August-closed-cycle sent total is still exactly
--     6778kg = 2320+2255+2203, byte-identical to before this correction);
--     September's per-serial contribution isolates cleanly to 2/9/6
--   client_serial_ledger (replicated via the same kirim_line_moyka_asof/
--     kirim_line_loss_asof calls it makes internally): poteryaKg as-of
--     Aug31 = 50/45/53, as-of today = 52/54/59; vPererabotkeKg = 0 both
--     dates, all three
--
-- FLAGGED, NOT FIXED (out of scope, prompt (b)): yield_rows now shows 8
-- rows per serial with garbled loss figures (-2308/-2176/-2121), not the
-- 2 clean duplicate rows originally estimated during scoping. The view's
-- rewash_flag/lab_readings CTEs are each independently derived 1:1 from
-- finished_serials (which now has 2 rows per serial, one per closed
-- cycle) and rejoined back on serial alone, not wash_cycle_id -- 2x2x2=8
-- rows, with finished_pallets weights multiply-counted in the process.
-- This is a real, live, immediate consequence of these three serials now
-- having a second real cycle -- not hypothetical, not cosmetic as
-- originally estimated during this task's own scoping conversation (that
-- estimate was wrong and is corrected here). Source data (wash_cycles/
-- moyka_sends/finished_pallets/lab_results) is confirmed correct; only
-- this one read-only reporting view (Hosildorlik/Yield screen) is
-- affected. Belongs to prompt (b)'s yield_rows grain redesign, per this
-- task's own explicit out-of-scope list -- not patched here.
