-- Correction to migration 0121's Subxon line only -- 0121 anchored old_kn_pools.opening_kg
-- for Subxon to a 2026-07-16 physical count baseline, but the actual physical count date is
-- 2026-09-12, which is AFTER the 21,782 kg collection on 2026-08-21 (3 chiqim requests,
-- confirmed by SELECT before writing this migration: sum = exactly 21,782). docs/decisions/0187
-- (new entry -- 0121's decision log, docs/decisions/0186, is left as written, not rewritten).
--
-- Because the 2026-09-12 count postdates that collection, the pool's opening_kg needs to
-- reflect gross stock as of 2026-09-12 -- i.e. what remained (37,439) PLUS what had already
-- left by then (21,782) -- not the post-collection remainder alone. 37,439 + 21,782 = 59,221.
-- Once opening_kg = 59,221, the live balance (opening_kg - collected - minted) nets back down
-- to 59,221 - 21,782 - 0 = 37,439, matching the physical count exactly.
--
-- Scope: Subxon old_kn_pools.opening_kg only. No other pool, no pallet, no collection touched.
-- Isfara/Natural/Qand opening_kg (set correctly in 0121, unaffected by this baseline-date
-- issue since they have zero collections) are left untouched.

DO $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_reason text := 'physical count date correction -- Subxon KN opening_kg rebased for 2026-09-12 count';
BEGIN

  SELECT row_to_json(p)::jsonb INTO v_before FROM old_kn_pools p WHERE p.id = 'b3aedb92-90dc-43b3-84eb-33af207b81d2'; -- Subxon
  UPDATE old_kn_pools SET opening_kg = 59221 WHERE id = 'b3aedb92-90dc-43b3-84eb-33af207b81d2'
    RETURNING row_to_json(old_kn_pools)::jsonb INTO v_after;
  INSERT INTO audit_log(table_name, row_id, actor, action, before, after, at)
  VALUES ('old_kn_pools', 'b3aedb92-90dc-43b3-84eb-33af207b81d2', NULL, 'update_correction',
    v_before || jsonb_build_object('reason', v_reason), v_after || jsonb_build_object('reason', v_reason), now());

END $$;
