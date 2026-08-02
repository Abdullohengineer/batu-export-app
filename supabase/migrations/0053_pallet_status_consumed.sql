-- Opening stock, Stage 3 (2026-08-02) -- a pallet that has been physically
-- consumed into a re-wash mint (or, later, a Rezka cut): neither in-stock,
-- nor dispatched to a client, nor voided/mis-recorded.
--
-- Its own migration on purpose: PostgreSQL cannot USE a newly added enum
-- value in the same transaction that adds it, and every migration here runs
-- in one. 0054/0055 are what actually reference it.
alter type pallet_status add value if not exists 'consumed';
