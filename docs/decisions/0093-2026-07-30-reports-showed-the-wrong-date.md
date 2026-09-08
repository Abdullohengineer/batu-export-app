## 2026-07-30 — Reports showed the wrong date

**Context:** Every "Sana" column across Ombor qoldig'i, Menejer's Hisobot, and Rahbar's Hisobotlar was showing today's date for every row, regardless of when the KIRIM order was actually entered — while the serial passport for the same serial correctly showed the real entered date (e.g. 16.07). Diagnosed by the user as a wrong-field bug, not a data problem.

**Confirmed which field the passport reads before touching anything.** `get_serial_passport`'s headline line is `ko.order_date`/`cr.request_date` — the date the Menejer typed on the KIRIM/CHIQIM form (`SerialPassportModal.tsx` lines 120 and 283). Then read every report view/function live (not the migration history, which doesn't reflect several since-superseded columns) and cross-checked against real data — reproduced the exact symptom: a serial with `kirim_orders.order_date = 2026-07-16` was showing `2026-07-29` (today) in both `report_kirim_rows.date_basis` and `stock_on_hand_rows.anchor_date`.

**Root cause: not literally `created_at`, but the same class of bug — a system-set operational timestamp standing in for the typed date.** `report_kirim_rows.date_basis` was `COALESCE(gate_weighings.stage1_completed_at, kirim_orders.order_date)`, preferring the gate weighing timestamp; `report_chiqim_rows.date_basis` was `gate_weighings.completed_at` with **no entered-date fallback at all**; `stock_on_hand_rows`' raw-not-washed bucket used `storage_intake.confirmed_at`, which defaults to `now()` at accept time — functionally an insertion timestamp despite not being named one. This was SPEC.md §3.2.3's own previously-documented, deliberate design ("arrival date — gate stage 1 completion... falling back to order's own stated date only for the case where stage 1 hasn't happened yet," reasoned to be "in practice unreached, since intake requires stage 1 first") — that assumption doesn't hold whenever order entry and the physical gate event land on different days, which is not a testing artifact, it's the normal case whenever a KIRIM order is created before the truck is actually weighed.

**Checked the whole set before fixing anything, per the task's own instruction — confirmed almost everything shares the same root:**
- `get_client_report`'s raw-side totals (`arrivalDate`, opening/received/processed kg, quality record) reuse `report_kirim_rows.date_basis` directly — inherits the fix automatically, no separate change needed.
- Rahbar dashboard (`rahbar_monthly_trends`/`rahbar_client_ranking`/`rahbar_product_mix`) all aggregate purely off `report_kirim_rows.date_basis`/`report_chiqim_rows.date_basis` — inherits the fix the same way.
- `stock_on_hand_rows`' **finished-pallet** bucket (`finished_pallets.received_date`, set to `new Date()` at pack time in `OmborTayyorTab.tsx:160`) is a genuinely different, correct concept — "how long has this pallet existed in its current packed form," not "when did the raw material arrive." Not typed anywhere, not comparable to `order_date`; changing it would misrepresent real shelf-time. Left alone.
- `yield_rows.completed_date` (Hosildorlik) is already documented in the 2026-07-21 "Yield view" entry / SPEC v1.20 as deliberately the serial's *last cycle completion* date, not arrival — a different, intentional date dimension. Left alone.

**One genuine fork, surfaced and confirmed with the user rather than decided silently:** `get_client_report`'s dispatch-side period bucketing (`client_pallets.departure_date`, `period_dispatch_ids` — which decides which period's opening/produced/dispatched/closing totals a shipment's kg counts toward) also used the gate stage-2 timestamp. Unlike the other fixes, this one wasn't purely a display bug — the frontend (`ClientReportTab.tsx`) already showed `requestDate` primarily, gate completion only secondarily and grayed out — so the *visible* label was already correct; only the *period a shipment's kg gets counted in* was still gate-based. Presented as an explicit choice: leave gate-based (period bucketing reflects real financial movement) vs. switch to `request_date` (keeps the whole document on one consistent basis, since the raw side flips to order-date automatically). **User chose to switch it too.** The "must have actually gate-departed" gate (`cgw.completed_at is not null`) was preserved explicitly in the rewritten SQL, since it had been implicit in the old date comparison and would otherwise have been silently lost by switching to a NOT NULL column.

**Fix applied, surgical — only date columns changed, weight-authority logic (§2.16) untouched:**
```sql
-- report_kirim_rows: no COALESCE needed, order_date is never null
ko.order_date AS date_basis, 'order_date'::text AS date_basis_source

-- report_chiqim_rows
cr.request_date AS date_basis

-- stock_on_hand_rows raw_not_washed bucket — reuses the now-corrected report_kirim_rows
r.date_basis AS anchor_date  -- was (si.confirmed_at)::date

-- get_client_report: client_pallets.departure_date and period_dispatch_ids
-- switched from gate_weighings.completed_at to chiqim_requests.request_date,
-- with cgw.completed_at is not null added explicitly to preserve the
-- "actually departed" gate
```
`supabase/migrations/0039_report_date_basis_use_entered_date.sql`.

**Verification.** Re-ran the live comparison query after applying: all previously-wrong rows now show the entered date exactly (`2026-07-16` stays `2026-07-16` in both `report_kirim_rows.date_basis` and `stock_on_hand_rows.anchor_date`; `date_basis_source` reads `'order_date'` throughout). Smoke-tested `get_client_report` and `report_chiqim_rows` directly via SQL — both run cleanly, no syntax errors from the rewrite. `npx tsc -b --noEmit` and `npm run lint` clean (same one pre-existing `AuthProvider.tsx` warning, unrelated — this task touched no `.ts`/`.tsx` files at all, database-only). Unit suite 78/78 unchanged, including `reportQuery.test.ts`'s `date_basis_source: 'gate_stage1'` case — that test asserts the row-mapper preserves whatever value a DB row carries, not that `'gate_stage1'` is still a value the view can produce, so it stays valid unchanged. Live-browser-verified: a serial entered with a back-dated arrival now shows the same date in its passport, Ombor qoldig'i, Menejer's Hisobot, and Rahbar's Hisobotlar. Full Playwright suite run once.

**Out of scope, not touched (per the task):** the cutting line, opening stock, edit-forms (this task's own scope was date field *sourcing* only, not how dates get entered), `stock_on_hand_rows`' finished-pallet bucket and `yield_rows.completed_date` (both confirmed to be different, correct concepts, not this bug).
