## 2026-09-08 — Rahbar dashboard: Старый склад Кондитерка graph re-verified against live data

**Context:** Follow-up to Part A's own build-time verification (done via direct RPC calls, not a
screenshot), requested again with an explicit live SQL comparison and a screenshot ask. The
screenshot could not be produced — same environment-level egress block described in the previous
entry (this session's browser cannot reach the live Supabase project at all, confirmed via the
proxy's own 403 log, not routed around per that policy's own instruction) — so this entry covers
only the data-correctness half: source code re-read + a live SQL cross-check, both done fresh, not
reused from Part A's memory.

**Decision/finding:** The requested check (`SELECT product_type_id, SUM(current_kg) FROM
old_kn_pools GROUP BY product_type_id`) doesn't match the live schema — flagging per CLAUDE.md
rather than silently substituting: `old_kn_pools` has no `product_type_id` or `current_kg` column;
the real columns are `type_id` and `opening_kg`, and remaining balance is derived (`opening_kg`
minus `sum(old_kn_collections.collected_kg)` for still-open pools), not stored anywhere as a single
figure. The equivalent live check, run directly against `old_kn_pools`/`old_kn_collections` (open
pools only, joined to `product_types` for names) independently of `rahbar_stock_snapshot`,
returned: Isfara 56,120 kg, Subxon 16,420 kg, Natural 7,791 kg, Qand 1,584 kg — total 81,915 kg.
This matches `rahbar_stock_snapshot('eski')`'s own `oldKnByType`/`oldKnKg` output exactly, both in
per-type breakdown and total. `RahbarHome.tsx`/`OldStockDrilldown.tsx` (re-read fresh, unchanged
since Part A) map `snapshot.oldKnByType` 1:1 into a per-type bar series with a total-kg header, via
the same `Graph` component already proven for the neighbouring Эski ювилган chart — no conditional
logic or stale prop-shape mismatch found. Conclusion: the graph is correctly wired and the backend
data is correct; a screenshot to confirm the *rendered* result still requires an environment that
can reach the live Supabase project.
