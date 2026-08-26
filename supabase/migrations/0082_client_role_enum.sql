-- Add 'client' to user_role -- first step of the Global Export client
-- portal (see docs/DECISIONS.md "Client role: RLS scoping, view-ownership
-- RLS-bypass finding" for the full design). Split into its own migration,
-- applied before anything that references the new value: Postgres refuses
-- to use a freshly-added enum value inside the SAME transaction that added
-- it (ALTER TYPE ... ADD VALUE is not transaction-safe for immediate use).
-- 0083 (RLS + reporting SQL, which references 'client' throughout) is a
-- separate migration/transaction so it never collides with this rule.
alter type user_role add value if not exists 'client';
