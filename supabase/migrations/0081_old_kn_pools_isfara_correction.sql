-- Data correction, not a schema change: Isfara's eski KN (old Konditirskiy)
-- pool was seeded at 56,359 kg; the correct opening figure is 56,120 kg.
-- No collections or mints have been recorded against this pool yet (the
-- displayed balance IS opening_kg unmodified), so this is a direct,
-- one-row correction to old_kn_pools.opening_kg -- same "book-value
-- correction, not a quantity redesign" shape as the 2026-08-03 Qand/Qand
-- Qizil attribution fix (see DECISIONS.md "Opening stock data correction").
-- Scoped by owner+type (only one Isfara pool exists -- Global Export
-- Company) rather than by id, so the migration stays readable without a
-- hardcoded uuid.
update old_kn_pools p
set opening_kg = 56120
from product_types t
where t.id = p.type_id
  and t.name = 'Isfara'
  and p.opening_kg = 56359;
