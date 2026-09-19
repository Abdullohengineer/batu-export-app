-- Two tables missing a client_read_own_* policy, found while auditing
-- whether rahbar_stock_snapshot/rahbar_dashboard_ledger can be safely
-- reused for the client Панель mirror (Fix 3). Both only ever had `read_all`
-- (which explicitly excludes role='client'), same gap shape the original
-- v1.37 client-role rollout closed for ~15 other tables -- these two were
-- simply missed at the time (neither existed in this app's client-facing
-- surface until now).
--
-- rezka_sends: no owner_id column of its own -- same join-through pattern
-- as the existing client_read_own_moyka_sends policy (kirim_lines ->
-- kirim_orders -> owner_id).
--
-- Impact beyond Fix 3: kirim_line_state() (backing the already-shipped
-- client Приход "Omborda qoldi"/"Qabul qilingan" columns) reads
-- rezka_sends directly. Without this policy a client caller always saw 0
-- rezka activity there, silently overstating Omborda qoldi by any real
-- rezka draw -- currently dormant (0 rezka rows for the one real owner
-- today) but a real, live gap. This migration closes it retroactively too.
create policy client_read_own_rezka_sends on rezka_sends for select
using (
  my_role() = 'client'
  and exists (
    select 1 from kirim_lines kl
    join kirim_orders ko on ko.order_id = kl.order_id
    where kl.serial = rezka_sends.serial and ko.owner_id = my_owner_id()
  )
);

-- old_stock_closeouts: has its own owner_id column -- same direct-column
-- pattern as the existing client_read_own_old_kn_pools policy. Affects
-- rahbar_dashboard_ledger's Eski-scope storage-loss figures.
create policy client_read_own_old_stock_closeouts on old_stock_closeouts for select
using (my_role() = 'client' and owner_id = my_owner_id());
