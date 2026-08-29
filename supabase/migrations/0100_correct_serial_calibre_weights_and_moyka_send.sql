-- Data correction (no DDL): six serials' output-by-kalibr weights and one
-- moyka send quantity, to the figures the manager reconciled off the
-- Hisobot output-by-kalibr view (0098_hisobot_output_by_kalibr.sql).
--
-- Two separate corrections, one root cause each:
--
-- 1. 280726-029's INCOMING was 2218.4 kg -- 800 + 1418.3999999999996, a
--    float artefact carried into moyka_sends.qty_kg. Corrected to a whole
--    2218 kg by taking the second send to 1418. This is the only serial in
--    the set whose incoming figure changes.
--
-- 2. Twelve finished_pallets rows carried per-kalibr weights a few kg off
--    the reconciled figures. Corrected in place (weight_kg only), NOT by
--    void-and-remint: the pallets are untouched -- none is referenced by
--    chiqim_pallet_consumption -- so their barcode2 labels stay valid and
--    stable, and re-minting would only churn 12 printed labels for a
--    weight edit. (The 2026-08-28 pass that produced the current -2/-3
--    barcode suffixes did use void-and-remint; that pass was re-stating
--    which pallets exist, not adjusting a weight on the ones that do.)
--
-- Loss is NOT written here -- it is derived (incoming - outputs) in both
-- yield_rows and the Hisobot totals, so correcting the outputs lands it on
-- 50 / 45 / 27 / 53 / 58 / 150 kg on its own. Every serial below then
-- satisfies outputs + loss = incoming exactly.
--
-- Pallets are keyed on barcode2 (a natural, human-visible key), never on a
-- generated uuid. Every UPDATE is guarded on the value it replaces, so a
-- re-run after any of these rows has moved on is a no-op rather than a
-- silent overwrite.

begin;

-- 1. 280726-029 incoming: 1418.4 -> 1418 (serial total 2218.4 -> 2218 kg)
update moyka_sends
   set qty_kg = 1418
 where serial = '280726-029'
   and sent_date = '2026-08-15'
   and qty_kg > 1418 and qty_kg < 1419;

-- 2. Per-kalibr output weights
update finished_pallets fp
   set weight_kg = v.new_kg
  from (values
    -- serial 290726-068: K2 430 / K4 1480 already correct
    ('PLT-290726-068-KN-2', 358::numeric, 360::numeric),
    -- serial 290726-069
    ('PLT-290726-069-02-2',  418,  420),
    ('PLT-290726-069-04-3', 1439, 1440),
    ('PLT-290726-069-KN-2',  348,  350),
    -- serial 290726-070
    ('PLT-290726-070-02-2',  114,  110),
    ('PLT-290726-070-04-2',  393,  390),
    ('PLT-290726-070-KN-2',   95,   90),
    -- serial 290726-072: KN 340 already correct
    ('PLT-290726-072-02-2',  407,  410),
    ('PLT-290726-072-04-3', 1406, 1400),
    -- serial 280726-029
    ('PLT-280726-029-02-2',  411,  410),
    ('PLT-280726-029-04-3', 1415, 1410),
    ('PLT-280726-029-KN-2',  342,  340),
    -- serial 110826-001: K2 1350 / K8 20 already correct
    ('PLT-110826-001-04-3', 4657, 4670),
    ('PLT-110826-001-KN-2', 1127, 1130)
  ) as v(barcode2, old_kg, new_kg)
 where fp.barcode2 = v.barcode2
   and fp.weight_kg = v.old_kg
   and fp.status = 'in_stock';

-- Reconciliation guard: outputs + loss = incoming for all six serials, with
-- the loss figures the correction is meant to produce. Fails the whole
-- transaction if any row lands anywhere else.
do $$
declare
  bad text;
begin
  select string_agg(format('%s: incoming %s, output %s, loss %s (expected %s)',
                           e.serial, i.incoming, o.output, i.incoming - o.output, e.loss),
                    '; ' order by e.serial)
    into bad
    from (values
      ('290726-068', 2320::numeric,  50::numeric),
      ('290726-069', 2255,  45),
      ('290726-070',  617,  27),
      ('290726-072', 2203,  53),
      ('280726-029', 2218,  58),
      ('110826-001', 7320, 150)
    ) as e(serial, incoming, loss)
    cross join lateral (
      select coalesce(sum(ms.qty_kg), 0) as incoming
        from moyka_sends ms where ms.serial = e.serial
    ) i
    cross join lateral (
      select coalesce(sum(fp.weight_kg), 0) as output
        from finished_pallets fp
       where fp.serial = e.serial
         and fp.status not in ('bekor_qilindi', 'storage_loss')
    ) o
   where i.incoming <> e.incoming or i.incoming - o.output <> e.loss;

  if bad is not null then
    raise exception 'Serial reconciliation failed -- %', bad;
  end if;
end $$;

commit;
