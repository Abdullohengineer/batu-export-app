-- Debris purge: order 9B1ZK01 (Boysun Quritilgan Mevalar), project qohoqbapevrcjqxbstxi.
-- NOT YET APPLIED -- awaiting approval.
-- Decision: docs/decisions/0235-2026-09-29-boysun-9b1zk01-debris-purge.md
-- Backup: docs/data-corrections/2026-09-29_boysun_9B1ZK01_purge_backup.sql
--
-- e2e debris under a real-looking plate (uniqueRealLookingPlate() + E2E_OWNER_NAME
-- in tests/e2e/helpers/fixtures.ts): created 2026-09-28 by TEST Menejer, driver
-- "TEST Driver", never weighed. Same append-only exception as 0234.
-- Kept: the Boysun and Nukus owner rows (older specs use Boysun; Nukus is
-- already inactive), partiya_counter.
--
-- Aborts, deleting nothing, unless: the order and its 2 lines match the backup
-- md5s; it is still identifiable as test debris (driver 'TEST Driver', created
-- by the TEST Menejer account, owner Boysun); nothing references either line
-- or the order; each delete hits its exact count.

begin;

do $purge$
declare v_order uuid := '605a9040-9dcc-4d7a-8a0b-cb738c915295'; v_n int;
begin
  if (select md5(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text) from kirim_orders x where order_id = v_order)
       is distinct from 'eed283f18b691b44fcab06eb86854224'
     or (select md5(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text) from kirim_lines x where order_id = v_order)
       is distinct from '08e6ea96ccc515804a0cc1e341a647b2'
  then
    raise exception '9B1ZK01 purge aborted: rows differ from the backup';
  end if;

  if not exists (
    select 1 from kirim_orders ko
    join owners o on o.id = ko.owner_id
    join profiles p on p.id = ko.created_by
    where ko.order_id = v_order and ko.plate = '9B1ZK01' and ko.driver = 'TEST Driver'
      and o.name = 'Boysun Quritilgan Mevalar' and p.phone = '900000002' and p.full_name = 'TEST Menejer')
  then
    raise exception '9B1ZK01 purge aborted: order no longer identifiable as test debris';
  end if;

  if exists (select 1 from gate_weighings where order_id = v_order)
     or exists (select 1 from storage_intake where serial in ('280926-035', '280926-036'))
     or exists (select 1 from moyka_sends where serial in ('280926-035', '280926-036'))
     or exists (select 1 from wash_cycles where serial in ('280926-035', '280926-036'))
     or exists (select 1 from rezka_sends where serial in ('280926-035', '280926-036'))
     or exists (select 1 from rezka_cycles where serial in ('280926-035', '280926-036'))
     or exists (select 1 from rezka_kn_draws where minted_serial in ('280926-035', '280926-036'))
     or exists (select 1 from finished_pallets where serial in ('280926-035', '280926-036'))
     or exists (select 1 from lab_results where parent_serial in ('280926-035', '280926-036'))
     or exists (select 1 from raw_dispatch_lines where serial in ('280926-035', '280926-036'))
     or exists (select 1 from chiqim_line_raw_serials where serial in ('280926-035', '280926-036'))
     or exists (select 1 from serial_mint_sources where minted_serial in ('280926-035', '280926-036'))
     or exists (select 1 from notes where entity_id in ('280926-035', '280926-036', v_order::text))
     or exists (select 1 from audit_log where row_id in ('280926-035', '280926-036', v_order::text))
  then
    raise exception '9B1ZK01 purge aborted: something now references the order or its lines';
  end if;

  delete from kirim_lines where order_id = v_order;
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'kirim_lines: % rows', v_n; end if;
  delete from kirim_orders where order_id = v_order;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'kirim_orders: % rows', v_n; end if;

  if (select count(*) from owners where name in ('Boysun Quritilgan Mevalar', 'Nukus Agro Eksport')) <> 2
     or exists (select 1 from owners where name = 'Nukus Agro Eksport' and active)
  then
    raise exception '9B1ZK01 purge: owner rows not as expected';
  end if;
end
$purge$;

commit;
