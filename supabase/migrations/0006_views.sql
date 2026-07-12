-- Derived views — this is where reports come from (SPEC §2.15, §3.4; PHASE0 Part B6)
-- Every screen (Kuzatuv, passport, client report, Rahbar oversight) reads the
-- same view, so they can never disagree. New report? New view. Tables untouched.

-- one row per serial: the whole pipeline, always consistent
create view v_serial_balance as
select
  k.serial,
  k.owner_id,
  g.net_kg                                   as xom_kg,
  coalesce(ms.sent_kg, 0)                    as moykaga_kg,
  coalesce(fp.finished_kg, 0)                as tayyor_kg,
  coalesce(dp.dispatched_kg, 0)              as chiqgan_kg,
  coalesce(fp.finished_kg, 0) - coalesce(dp.dispatched_kg, 0) as omborda_kg,
  case when coalesce(ms.sent_kg, 0) > 0
       then round((1 - coalesce(fp.finished_kg, 0) / ms.sent_kg) * 100, 1)
  end                                        as yoqotish_pct
from kirim_orders k
left join gate_weighings g on g.serial = k.serial and g.dir = 'kirim'
left join (select serial, sum(qty_kg) sent_kg from moyka_sends group by serial) ms on ms.serial = k.serial
left join (select serial, sum(weight_kg) finished_kg from finished_pallets
           where status <> 'bekor_qilindi' group by serial) fp on fp.serial = k.serial
left join (select fpp.serial, sum(fpp.weight_kg) dispatched_kg
           from dispatch_manifest dm join finished_pallets fpp on fpp.barcode2 = dm.barcode2
           group by fpp.serial) dp on dp.serial = k.serial;
