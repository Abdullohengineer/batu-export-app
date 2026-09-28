-- BACKUP of e2e debris order 9B1ZK01 (owner Boysun Quritilgan Mevalar),
-- purged 2026-09-29 from project qohoqbapevrcjqxbstxi.
-- Decision: docs/decisions/0235-2026-09-29-boysun-9b1zk01-debris-purge.md
-- Purge script: docs/data-corrections/2026-09-29_boysun_9B1ZK01_purge.sql
--
-- Running this file restores the three purged rows exactly: 1 kirim_orders,
-- 2 kirim_lines. The order had nothing downstream (no gate weighing, intake,
-- lab, sends, pallets, notes or audit rows). Same form and trigger handling
-- as 2026-09-29_test_purge_backup.sql: kirim_lines_assign_partiya_no is
-- disabled so the lines keep partiya 49 (Subxon) and 13 (Isfara) and the
-- counter is not bumped.

begin;

alter table public.kirim_lines disable trigger kirim_lines_assign_partiya_no;

-- kirim_orders: 1 row, payload md5 eed283f18b691b44fcab06eb86854224
insert into public.kirim_orders (order_id, order_date, plate, driver, owner_id, doc_photo, declared_total, status, created_by, created_at, origin)
select order_id, order_date, plate, driver, owner_id, doc_photo, declared_total, status, created_by, created_at, origin
from jsonb_populate_recordset(null::public.kirim_orders, $j$
[{"plate": "9B1ZK01", "driver": "TEST Driver", "origin": "delivery", "status": "kutilmoqda", "order_id": "605a9040-9dcc-4d7a-8a0b-cb738c915295", "owner_id": "f72a65da-bcb5-4dc5-9ad3-d34b8e5854e1", "doc_photo": null, "created_at": "2026-09-28T10:07:48.32248+00:00", "created_by": "fcbe2304-ae6f-4cb7-b894-a91f70c060b4", "order_date": "2026-09-28", "declared_total": 5500}]
$j$::jsonb);

-- kirim_lines: 2 rows, payload md5 08e6ea96ccc515804a0cc1e341a647b2
insert into public.kirim_lines (serial, order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg, is_sulfured, partiya_no, process, voided_at, voided_by)
select serial, order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg, is_sulfured, partiya_no, process, voided_at, voided_by
from jsonb_populate_recordset(null::public.kirim_lines, $j$
[{"serial": "280926-035", "process": "moyka", "type_id": "48aebd73-1de9-4edb-802a-ad38e197fc7e", "order_id": "605a9040-9dcc-4d7a-8a0b-cb738c915295", "voided_at": null, "voided_by": null, "partiya_no": 49, "is_sulfured": null, "declared_qty": 5000, "target_so2_mg_kg": null, "target_moisture_pct": null}, {"serial": "280926-036", "process": "moyka", "type_id": "b6295a21-df2f-4eef-9c79-de7bc701ee94", "order_id": "605a9040-9dcc-4d7a-8a0b-cb738c915295", "voided_at": null, "voided_by": null, "partiya_no": 13, "is_sulfured": null, "declared_qty": 500, "target_so2_mg_kg": null, "target_moisture_pct": null}]
$j$::jsonb);

alter table public.kirim_lines enable trigger kirim_lines_assign_partiya_no;

commit;
