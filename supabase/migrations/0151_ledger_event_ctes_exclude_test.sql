-- Post-Rezka cleanup (2026-09-28), found while doing item 5: two of
-- rahbar_dashboard_ledger's event CTEs never excluded TEST- data.
-- Decision: docs/decisions/0231-*.
--
-- Every other ledger term reads lines through report_kirim_rows_as_of, which
-- drops TEST- plates. raw_dispatch_events (raw dispatchedKg, the "vozvrat"
-- chart) and moyka_send_events (sentToMoykaKg, Ledger B, the chart) joined
-- kirim_orders with no such filter, so e2e runs leaked into Rahbar's
-- dashboard: on 2026-09-28, this month's Yangi raw "dispatched" was 50 kg --
-- all of it the five TEST Xom dispatches from rezka-menejer runs -- and 20 kg
-- of TEST Moyka sends were in sentToMoykaKg, while the matching TEST receipts
-- were (correctly) excluded, so the identity residual carried the difference.
-- Same filter as the rest of the ledger: ko.plate not like 'TEST-%'.
--
-- Checked text edit of the post-0150 body (md5 below); each anchor exactly once.
do $edit$
declare
  v_src text;
  v_c_old constant text := E'  from moyka_sends ms\n  join kirim_lines kl on kl.serial = ms.serial\n  join kirim_orders ko on ko.order_id = kl.order_id';
  v_c_new constant text := E'  from moyka_sends ms\n  join kirim_lines kl on kl.serial = ms.serial\n  join kirim_orders ko on ko.order_id = kl.order_id and ko.plate not like ''TEST-%''';
  v_d_old constant text := E'  join kirim_lines kl on kl.serial = rdl.serial and kl.process <> ''rezka''\n  join kirim_orders ko on ko.order_id = kl.order_id';
  v_d_new constant text := E'  join kirim_lines kl on kl.serial = rdl.serial and kl.process <> ''rezka''\n  join kirim_orders ko on ko.order_id = kl.order_id and ko.plate not like ''TEST-%''';
begin
  select prosrc into v_src from pg_proc
  where proname = 'rahbar_dashboard_ledger_rls' and pronamespace = 'public'::regnamespace;
  if md5(v_src) <> '78fbfa97ef046fefb9f963cf0ba20b35' then
    raise exception '0151: rahbar_dashboard_ledger_rls body is not the expected post-0150 body (md5 %)', md5(v_src);
  end if;
  if (length(v_src) - length(replace(v_src, v_c_old, ''))) / length(v_c_old) <> 1 then
    raise exception '0151: moyka_send_events anchor not found exactly once';
  end if;
  if (length(v_src) - length(replace(v_src, v_d_old, ''))) / length(v_d_old) <> 1 then
    raise exception '0151: raw_dispatch_events anchor not found exactly once';
  end if;
  execute format(
    'create or replace function public.rahbar_dashboard_ledger_rls(p_from date, p_to date, p_scope text) returns jsonb language sql stable as %L',
    replace(replace(v_src, v_c_old, v_c_new), v_d_old, v_d_new));
end;
$edit$;
