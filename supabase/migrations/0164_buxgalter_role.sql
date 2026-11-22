-- Buxgalteriya Phase 1 (2026-11-22, docs/decisions/0249): the accountant
-- role. Its own migration because a new enum value can't be used in the
-- transaction that adds it (0165 references it).
alter type public.user_role add value if not exists 'buxgalter';
