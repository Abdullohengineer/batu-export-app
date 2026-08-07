-- Old-stock reconciliation (2026-08-05): a new pallet_status value for
-- old-washed close-out. Split into its own migration -- Postgres will not
-- let a newly added enum value be used (in a view/function comparison)
-- within the same transaction that adds it.
alter type pallet_status add value if not exists 'storage_loss';
