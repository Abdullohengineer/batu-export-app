-- Removes exactly the demo data inserted by demo-data-2026-07-20.sql.
-- Scoped entirely by the four owner names that script created and that
-- nothing else in the system references (confirmed before writing the seed
-- script) -- no hardcoded IDs to keep in sync, no TEST- prefix needed.
-- Same "never DELETE operational data, only this session's own disposable
-- rows" boundary as docs/DECISIONS.md's TEST- CHIQIM cleanup entry -- this
-- is demo/pilot data, not a real client's, so the same DELETE exception
-- applies. Run this before the pilot goes live on real data, or any time
-- this demo set needs to be cleared.
--
-- Dependency order: CHIQIM claim chain first (releases pallets), then the
-- pallets/lab/wash-cycle/moyka chain, then KIRIM intake/gate/lines/orders,
-- then the owners themselves last.

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar',
    'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi',
    'Toshkent Agro Savdo'
  )
),
demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
),
demo_serials as (
  select serial from kirim_lines where order_id in (select order_id from demo_orders)
),
demo_requests as (
  select id from chiqim_requests where owner_id in (select id from demo_owners)
)
delete from dispatch_manifest where request_id in (select id from demo_requests);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_requests as (
  select id from chiqim_requests where owner_id in (select id from demo_owners)
)
delete from gate_weighings where request_id in (select id from demo_requests);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
)
delete from chiqim_requests where owner_id in (select id from demo_owners);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
), demo_serials as (
  select serial from kirim_lines where order_id in (select order_id from demo_orders)
), demo_cycles as (
  select id from wash_cycles where serial in (select serial from demo_serials)
)
delete from lab_results where scope = 'chiqim' and wash_cycle_id in (select id from demo_cycles);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
), demo_serials as (
  select serial from kirim_lines where order_id in (select order_id from demo_orders)
)
delete from finished_pallets where serial in (select serial from demo_serials);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
), demo_serials as (
  select serial from kirim_lines where order_id in (select order_id from demo_orders)
)
delete from lab_results where scope = 'kirim' and parent_serial in (select serial from demo_serials);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
), demo_serials as (
  select serial from kirim_lines where order_id in (select order_id from demo_orders)
)
delete from moyka_sends where serial in (select serial from demo_serials);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
), demo_serials as (
  select serial from kirim_lines where order_id in (select order_id from demo_orders)
)
delete from wash_cycles where serial in (select serial from demo_serials);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
), demo_serials as (
  select serial from kirim_lines where order_id in (select order_id from demo_orders)
)
delete from storage_intake where serial in (select serial from demo_serials);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
)
delete from gate_weighings where order_id in (select order_id from demo_orders);

with demo_owners as (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
), demo_orders as (
  select order_id from kirim_orders where owner_id in (select id from demo_owners)
)
delete from kirim_lines where order_id in (select order_id from demo_orders);

delete from kirim_orders where owner_id in (
  select id from owners where name in (
    'Boysun Quritilgan Mevalar', 'Farg''ona Eksport Guruhi',
    'Samarqand Meva Kompaniyasi', 'Toshkent Agro Savdo'
  )
);

delete from owners where name in (
  'Boysun Quritilgan Mevalar',
  'Farg''ona Eksport Guruhi',
  'Samarqand Meva Kompaniyasi',
  'Toshkent Agro Savdo'
);
