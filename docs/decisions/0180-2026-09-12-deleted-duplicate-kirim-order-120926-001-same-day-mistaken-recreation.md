## 2026-09-12 — Deleted duplicate KIRIM order 120926-001 (same-day mistaken recreation)

**Context:** User mistakenly recreated yesterday's (2026-09-11) KIRIM order today, producing a duplicate `kirim_lines` row `120926-001` (order_id `6bf637b3-cdbb-4a9b-8411-134564966cce`, plate `40Y788KB`, driver `G'ulomov J`, `order_date` 2026-09-11, `created_at` 2026-09-12). Asked to delete it.

**Investigation before acting, per the task's own gate.** Live schema checked directly: `kirim_orders.status` enum is `kutilmoqda / qabul_qilindi / olib_ketildi / yakunlandi` — no voided/`bekor_qilingan` state, no `voided_at`/`voided_by` columns, unlike `chiqim_requests` and `finished_pallets`. Confirms the standing gap already noted in the 2026-07-30 "Correcting mistaken entries" entry (0092): **`kirim_orders`/`kirim_lines` have no void mechanism, and no in-app delete path, at all.**

Checked every downstream table for this order/serial before touching anything: `gate_weighings`, `storage_intake`, `moyka_sends`, `wash_cycles`, `lab_results`, `finished_pallets`, `rezka_sends`, `rezka_cycles`, `serial_mint_sources`, `chiqim_line_raw_serials`, `raw_dispatch_lines`, `notes` — all zero rows. Order was still `kutilmoqda`, never reached the gate. Also checked `audit_log` — no rows for this order_id/serial (inserts aren't logged by the existing trigger, only edits per 0092).

**Decision, confirmed with the user (hard delete vs. add void support first):** hard delete via direct SQL, matching the established precedent from 0092 ("neither table has an in-app delete path" — that task's own test fixtures were removed the same way). Building a new `bekor_qilingan` status/migration for a one-off, zero-downstream-impact duplicate was flagged as out of scope rather than invented silently.

**Executed:**
```sql
delete from kirim_lines where serial = '120926-001';
delete from kirim_orders where order_id = '6bf637b3-cdbb-4a9b-8411-134564966cce';
```
Verified both rows gone (`select count(*)` = 0 on each). No downstream rows existed to clean up.

**Flagged, not fixed (out of scope):** `kirim_orders`/`kirim_lines` still have no delete or void UI path for a mistaken same-day entry — every occurrence so far (this one, and the fixture cleanup in 0092) has been a manual SQL operation. If mistaken KIRIM recreations turn out to be a recurring operator error rather than a one-off, a proper void/delete action (scoped the same way 0092 scoped its edit-lock: before any `gate_weighings` row exists) is the natural follow-up — not built here since only one instance was reported.
