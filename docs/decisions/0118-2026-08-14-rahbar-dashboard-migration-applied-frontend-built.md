## 2026-08-14 — Rahbar dashboard: migration applied, frontend built

**Context:** Abdulloh's call: ship the dashboard visual with what exists; stop the date-basis
work (both proposed gate changes deferred, logged above).

**Decision:**
- Applied `0068_rahbar_dashboard.sql` as-is (`rahbar_stock_snapshot`, `rahbar_dashboard_ledger`).
  Post-apply, re-verified against live data in all three scopes: ledger closing = snapshot
  (both raw and finished), Ledger A identity exact, both `residualKg` lines read 0, all three
  chart series sum exactly to their ledger totals.
- `RahbarHome.tsx` (Bosh sahifa) rebuilt against `docs/mockups/BATU-Rahbar-dashboard-v3.html`,
  replacing its previous trends/ranking/product-mix content on this route. The backing
  functions (`rahbar_monthly_trends`/`rahbar_client_ranking`/`rahbar_product_mix`) and their
  hooks (`useRahbarDashboard.ts`) are untouched — nothing currently routes to that content;
  flagged, not silently decided, since the task didn't specify where (or whether) it should
  move. **Confirmed 2026-08-14 (follow-up round): this is a deliberate hold, not an
  oversight.** The trends/ranking/product-mix RPCs, their hooks, and the old `RahbarHome.tsx`
  content stay exactly where they were — unrouted, not deleted, not touched further. Whether
  to remove them, re-site them elsewhere in the nav, or restore them alongside the new
  dashboard is a separate decision, out of scope for this task.
- Frontend reads both RPCs directly (`rahbar_stock_snapshot`, `rahbar_dashboard_ledger`) and
  performs no balance arithmetic of its own beyond client-side re-slicing of
  `byCalibreType` for the Turlar filter (a pure filter/regroup of already-summed server data,
  not a new sum).

**Out of scope:** Rezka, qoldig'i itself (read-only reuse target), the `target_so2_mg_kg`/`so2_mg_kg` column names.
