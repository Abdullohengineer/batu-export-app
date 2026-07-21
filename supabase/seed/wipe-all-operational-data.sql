-- Clean-room reset for client-report balance-arithmetic verification
-- (2026-07-21). Wipes EVERY operational row -- both the accumulated e2e
-- test debris (TEST- fixtures from months of dev sessions) and the
-- reporting-pilot demo data (Boysun/Farg'ona/Samarqand/Toshkent, §3.2.6-9's
-- own test data) -- leaving only master data behind. See docs/DECISIONS.md
-- "Clean-room reset for client-report verification" for why.
--
-- MASTER DATA KEPT: product_types, product_categories (the latter is a
-- dependency of the former and of calibres -- neither can be deleted while
-- product_types/calibres exist, and both ARE genuine unchanging master
-- data, not fixtures), calibres, profiles, settings_limits.
--
-- OWNERS IS NOT MASTER DATA HERE: every one of the 7 current rows is a
-- fixture (4 from the reporting-demo seed, 3 "Test Client A/B/C" orphans
-- from unrelated earlier sessions with no cleanup script of their own,
-- confirmed live -- there is no genuine standing business client in this
-- table at all). Deleting all 7 is intentional, not an oversight against
-- "keep master data: owners" -- the reseed script recreates the ones it
-- needs with fresh ids, and owners.name is UNIQUE, so leaving old demo rows
-- in place would make the reseed fail outright on the very first insert.
--
-- Dependency order: CHIQIM claim chain first, then the pallet/lab/wash/
-- moyka chain, then KIRIM intake/gate/lines/orders, then owners, then the
-- three standalone tables with no FK relationships at all.

delete from dispatch_manifest;
delete from gate_weighings;
delete from chiqim_lines;
delete from chiqim_requests;
delete from lab_results;
delete from finished_pallets;
delete from wash_cycles;
delete from moyka_sends;
delete from storage_intake;
delete from kirim_lines;
delete from kirim_orders;
delete from owners;
delete from notes;
delete from audit_log;
delete from serial_counter;
