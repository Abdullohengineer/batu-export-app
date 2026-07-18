-- Client quality targets per product line (SPEC.md v1.9 §3.1, Step 8 prompt
-- 1). Nullable, no backfill -- every existing row predates this feature.
-- target_so2_mg_kg's null is not just a migration artifact: it is the
-- permanent, meaningful encoding of "natural/unsulfured product" going
-- forward (§5.5.1) -- never a validation error, never a warning.
--
-- Lives on kirim_lines, not kirim_orders: one truck may carry two products
-- with different client requirements, and the target flows down the
-- lineage to every pallet produced from this serial. No RLS change needed
-- -- kirim_lines already has menejer_writes (INSERT) + read_all (SELECT),
-- which covers Menejer setting these at creation and every other role
-- reading them.

alter table kirim_lines
  add column target_moisture_pct numeric,
  add column target_so2_mg_kg numeric;
