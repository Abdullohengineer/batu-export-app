-- Post-Rezka cleanup, item 5 (2026-09-28): Ledger A (rahbar_dashboard_ledger's
-- raw section) excludes Rezka lines. Decision: docs/decisions/0231-*.
--
-- 0143 moved unsent Rezka raw OUT of rahbar_stock_snapshot's rawKg
-- (rezkaRawKg), but the ledger's `lines` CTE filtered on origin only, so a
-- Tashqi Rezka delivery would count in raw receivedKg / openingKg / closingKg
-- -- raw the snapshot says is not Oddiy raw. Rezka raw never enters Ledger A
-- now, and so it must not leave it either: raw_dispatch_events (the
-- dispatchedKg term and the "vozvrat" chart) drops Rezka lines too, keeping
-- the identity opening + received - dispatched - sentToMoyka - storageLoss =
-- closing closed. moyka_send_events / processed_lines need nothing: a Rezka
-- serial can never have moyka_sends or a wash cycle (enforce_serial_process).
--
-- Live effect on 2026-09-28: 0 kg. The 8 Rezka lines currently in `lines` are
-- Ichki mints (no storage_intake, so has_intake is false and every raw term
-- already skipped them); Tashqi Rezka lines are all TEST and already dropped
-- by report_kirim_rows_as_of; no Rezka serial has raw_dispatch_lines.
--
-- Checked text edit of the live body (post-0149, md5 below), as in 0147/0149:
-- each anchor must occur exactly once or this aborts.
do $edit$
declare
  v_src text;
  v_a_old constant text := E'    coalesce(fp_to.kg, 0) as output_as_of_to_kg\n  from kirim_lines kl\n  join kirim_orders ko on ko.order_id = kl.order_id\n';
  v_a_new constant text := E'    coalesce(fp_to.kg, 0) as output_as_of_to_kg\n  from kirim_lines kl\n  join kirim_orders ko on ko.order_id = kl.order_id and kl.process <> ''rezka''\n';
  v_b_old constant text := E'  join kirim_lines kl on kl.serial = rdl.serial\n  join kirim_orders ko on ko.order_id = kl.order_id';
  v_b_new constant text := E'  join kirim_lines kl on kl.serial = rdl.serial and kl.process <> ''rezka''\n  join kirim_orders ko on ko.order_id = kl.order_id';
begin
  select prosrc into v_src from pg_proc
  where proname = 'rahbar_dashboard_ledger_rls' and pronamespace = 'public'::regnamespace;
  if md5(v_src) <> '473f8c6cc9c7da2f87bab504323100c6' then
    raise exception '0150: rahbar_dashboard_ledger_rls body is not the expected post-0149 body (md5 %)', md5(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, v_a_old, ''))) / length(v_a_old) <> 1 then
    raise exception '0150: lines anchor not found exactly once';
  end if;
  if (length(v_src) - length(replace(v_src, v_b_old, ''))) / length(v_b_old) <> 1 then
    raise exception '0150: raw_dispatch_events anchor not found exactly once';
  end if;
  execute format(
    'create or replace function public.rahbar_dashboard_ledger_rls(p_from date, p_to date, p_scope text) returns jsonb language sql stable as %L',
    replace(replace(v_src, v_a_old, v_a_new), v_b_old, v_b_new));
end;
$edit$;
