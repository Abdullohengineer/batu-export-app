-- TEST data purge, project qohoqbapevrcjqxbstxi. NOT YET APPLIED -- awaiting approval.
-- Decision: docs/decisions/0234-2026-09-29-test-data-purge.md
-- Backup (restores every row below): docs/data-corrections/2026-09-29_test_purge_backup.sql
--
-- The documented append-only exception for test debris (DECISIONS.md
-- "Operational data wipe for a clean testing slate", 0088; "Phantom moyka
-- sends cleanup", 0195). Nothing but TEST rows is deleted:
--   * kirim_orders with plate TEST-% (23) and the QAYTA-ISHLASH mint orders
--     whose every draw came from a TEST pallet (8);
--   * chiqim_requests with plate TEST-% or owner "TEST Rezka E2E" (11);
--   * every child row of those, and the audit_log / notes rows about them.
-- Kept: the "TEST Rezka E2E" owner row, the five TEST role accounts,
-- partiya_counter and serial_counter (numbers are never reused), and the
-- storage objects (photos) the rows pointed to.
--
-- One transaction, one DO block. It aborts, deleting nothing, if:
--   * any table's to-be-deleted rows differ in count or md5 from the backup
--     file (i.e. anything changed since the backup was taken);
--   * any TEST row is linked to a real row (pallet draws, consumption, raw
--     dispatch, raw-serial links);
--   * any delete removes a different number of rows than backed up;
--   * afterwards any TEST row remains, or a kept row is missing.
-- Dry-run 2026-09-29 (same body, rolled back): all guards passed, every
-- delete hit its exact count.

begin;

do $purge$
declare v_rec record; v_n int;
begin
  -- ---------------------------------------------------------------------
  -- 1. Target sets. Everything is derived from three roots:
  --    * kirim_orders with plate TEST-%;
  --    * QAYTA-ISHLASH mint orders whose every line drew ONLY from TEST
  --      pallets (rezka_kn_draws / serial_mint_sources);
  --    * chiqim_requests with plate TEST-% or owner "TEST Rezka E2E".
  -- ---------------------------------------------------------------------
  create temp table p_ko on commit drop as
    select order_id from kirim_orders where plate like 'TEST-%'
    union
    select ko.order_id from kirim_orders ko
    where ko.plate = 'QAYTA-ISHLASH'
      and not exists (
        select 1 from kirim_lines kl
        where kl.order_id = ko.order_id
          and (
            -- a mint with no recorded source is not provably TEST
            not exists (select 1 from rezka_kn_draws d where d.minted_serial = kl.serial
                        union all
                        select 1 from serial_mint_sources s where s.minted_serial = kl.serial)
            -- any source pallet whose own order is not TEST- disqualifies it
            or exists (
              select 1
              from (select d.barcode2 bc from rezka_kn_draws d where d.minted_serial = kl.serial
                    union all
                    select s.source_barcode2 from serial_mint_sources s
                    where s.minted_serial = kl.serial and s.source_barcode2 is not null) x
              join finished_pallets fp on fp.barcode2 = x.bc
              join kirim_lines skl on skl.serial = fp.serial
              join kirim_orders sko on sko.order_id = skl.order_id
              where sko.plate not like 'TEST-%')
            -- an old-KN pool source is real stock by definition
            or exists (select 1 from serial_mint_sources s
                       where s.minted_serial = kl.serial and s.source_pool_id is not null)
          ));
  create temp table p_serial on commit drop as select serial from kirim_lines where order_id in (select order_id from p_ko);
  create temp table p_pallet on commit drop as select barcode2 from finished_pallets where serial in (select serial from p_serial);
  create temp table p_wc on commit drop as select id from wash_cycles where serial in (select serial from p_serial);
  create temp table p_cr on commit drop as
    select id from chiqim_requests
    where plate like 'TEST-%' or owner_id = (select id from owners where name = 'TEST Rezka E2E');
  create temp table p_cl on commit drop as select id from chiqim_lines where request_id in (select id from p_cr);
  create temp table p_lab on commit drop as
    select id from lab_results
    where parent_serial in (select serial from p_serial)
       or wash_cycle_id in (select id from p_wc)
       or sampled_pallet in (select barcode2 from p_pallet);
  create temp table p_ms on commit drop as select id from moyka_sends where serial in (select serial from p_serial);
  create temp table p_note on commit drop as
    select id from notes
    where (entity_type in ('moyka', 'rezka') and entity_id in (select serial from p_serial))
       or (entity_type = 'kirim_orders' and entity_id in (select order_id::text from p_ko));
  create temp table p_audit on commit drop as
    select id from audit_log a
    where (a.table_name in ('kirim_lines', 'storage_intake', 'finished_pallets') and a.row_id in (select serial from p_serial))
       or (a.table_name = 'finished_pallets' and a.row_id in (select barcode2 from p_pallet))
       or (a.table_name = 'kirim_orders' and a.row_id in (select order_id::text from p_ko))
       or (a.table_name = 'chiqim_requests' and a.row_id in (select id::text from p_cr))
       or (a.table_name = 'wash_cycles' and a.row_id in (select id::text from p_wc))
       or (a.table_name = 'lab_results' and a.row_id in (select id::text from p_lab))
       or (a.table_name = 'moyka_sends' and (a.row_id in (select id::text from p_ms)
                                            or coalesce(a.after, a.before) ->> 'serial' in (select serial from p_serial)))
       or (a.table_name = 'notes' and a.row_id in (select id::text from p_note));

  -- ---------------------------------------------------------------------
  -- 2. Snapshot of every row about to go, in the backup file's exact form.
  -- ---------------------------------------------------------------------
  create temp table p_rows on commit drop as
            select 'kirim_orders'::text tbl, to_jsonb(x) j from kirim_orders x where order_id in (select order_id from p_ko)
  union all select 'kirim_lines', to_jsonb(x) from kirim_lines x where serial in (select serial from p_serial)
  union all select 'storage_intake', to_jsonb(x) from storage_intake x where serial in (select serial from p_serial)
  union all select 'wash_cycles', to_jsonb(x) from wash_cycles x where id in (select id from p_wc)
  union all select 'moyka_sends', to_jsonb(x) from moyka_sends x where id in (select id from p_ms)
  union all select 'rezka_cycles', to_jsonb(x) from rezka_cycles x where serial in (select serial from p_serial)
  union all select 'rezka_sends', to_jsonb(x) from rezka_sends x where serial in (select serial from p_serial)
  union all select 'finished_pallets', to_jsonb(x) from finished_pallets x where barcode2 in (select barcode2 from p_pallet)
  union all select 'lab_results', to_jsonb(x) from lab_results x where id in (select id from p_lab)
  union all select 'rezka_kn_draws', to_jsonb(x) from rezka_kn_draws x
            where minted_serial in (select serial from p_serial) or barcode2 in (select barcode2 from p_pallet)
  union all select 'chiqim_requests', to_jsonb(x) from chiqim_requests x where id in (select id from p_cr)
  union all select 'chiqim_lines', to_jsonb(x) from chiqim_lines x where id in (select id from p_cl)
  union all select 'gate_weighings', to_jsonb(x) - 'net_kg' from gate_weighings x
            where order_id in (select order_id from p_ko) or request_id in (select id from p_cr)
  union all select 'chiqim_pallet_consumption', to_jsonb(x) from chiqim_pallet_consumption x
            where chiqim_line_id in (select id from p_cl) or barcode2 in (select barcode2 from p_pallet)
  union all select 'raw_dispatch_lines', to_jsonb(x) - 'net_kg' from raw_dispatch_lines x
            where chiqim_line_id in (select id from p_cl) or serial in (select serial from p_serial)
  union all select 'chiqim_line_raw_serials', to_jsonb(x) from chiqim_line_raw_serials x
            where line_id in (select id from p_cl) or serial in (select serial from p_serial)
  union all select 'notes', to_jsonb(x) from notes x where id in (select id from p_note)
  union all select 'audit_log', to_jsonb(x) from audit_log x where id in (select id from p_audit);

  -- ---------------------------------------------------------------------
  -- 3. Guard: the rows about to be deleted must be byte-for-byte the rows
  --    in docs/data-corrections/2026-09-29_test_purge_backup.sql. If
  --    anything changed since the backup was taken, abort.
  -- ---------------------------------------------------------------------
  for v_rec in
    select e.tbl, e.n, e.md5,
           (select count(*) from p_rows r where r.tbl = e.tbl) got_n,
           (select md5(jsonb_agg(r.j order by r.j::text)::text) from p_rows r where r.tbl = e.tbl) got_md5
    from (values
      ('kirim_orders', 31, '0fdd6a766ab3e73803910ba02a810b90'),
      ('kirim_lines', 38, 'f796c70ddb828e97cbdfaf67cc8e76ad'),
      ('storage_intake', 22, '225002e5c9e1ed23243b08089591b910'),
      ('wash_cycles', 10, '35996464a7efa3873b5837880d0c4f84'),
      ('moyka_sends', 2, 'a2d2a9077d117e7e04ed2df199d06ffd'),
      ('rezka_cycles', 23, '42645b41a634451874a28c9cacafd6ec'),
      ('rezka_sends', 23, '9c78f5f81ed99d5fd45e0da038cbee4d'),
      ('finished_pallets', 41, '043e4e0de55e8a1b05165d695ab243fb'),
      ('lab_results', 17, 'd818c3c8bc11d13e3534fb2a59d8ea65'),
      ('rezka_kn_draws', 8, 'c667ccaf8c6d15173c1edb6334d35e19'),
      ('chiqim_requests', 11, '6764151685a0d30052ea1e9cf26579fd'),
      ('chiqim_lines', 17, '0e3d7451c3cf16b0953581944423bcc1'),
      ('gate_weighings', 13, '2b383757b0be9b448dadb60700fad039'),
      ('chiqim_pallet_consumption', 5, 'e08f103e2795fd349489de748ce41e87'),
      ('raw_dispatch_lines', 5, '3c4dc3d926658b83cd525f270c36ae36'),
      ('chiqim_line_raw_serials', 6, 'db0ad22151d4a2e21c7b4b0a46ac7b02'),
      ('notes', 8, 'e5e3e0375983347ffbea7b8184023cf6'),
      ('audit_log', 24, 'eceab0938e8572bdf4c853eb1837443b')
    ) e(tbl, n, md5)
  loop
    if v_rec.got_n <> v_rec.n or v_rec.got_md5 is distinct from v_rec.md5 then
      raise exception 'TEST purge aborted: % has % rows / md5 %, backup has % / %',
        v_rec.tbl, v_rec.got_n, v_rec.got_md5, v_rec.n, v_rec.md5;
    end if;
  end loop;

  -- Tables with no TEST rows today must still have none (nothing to back up).
  if exists (select 1 from dispatch_manifest where request_id in (select id from p_cr) or barcode2 in (select barcode2 from p_pallet))
     or exists (select 1 from chiqim_fura_photos where request_id in (select id from p_cr))
     or exists (select 1 from old_kn_collections where chiqim_line_id in (select id from p_cl))
     or exists (select 1 from serial_mint_sources where minted_serial in (select serial from p_serial) or source_barcode2 in (select barcode2 from p_pallet))
  then
    raise exception 'TEST purge aborted: a table expected to hold no TEST rows now holds some';
  end if;

  -- Cross-contamination guard: no real row may reference a TEST row.
  if exists (select 1 from chiqim_pallet_consumption where chiqim_line_id not in (select id from p_cl) and barcode2 in (select barcode2 from p_pallet))
     or exists (select 1 from chiqim_pallet_consumption where chiqim_line_id in (select id from p_cl) and barcode2 not in (select barcode2 from p_pallet))
     or exists (select 1 from rezka_kn_draws where (minted_serial in (select serial from p_serial)) <> (barcode2 in (select barcode2 from p_pallet)))
     or exists (select 1 from raw_dispatch_lines where (chiqim_line_id in (select id from p_cl)) <> (serial in (select serial from p_serial)))
     or exists (select 1 from chiqim_line_raw_serials where (line_id in (select id from p_cl)) <> (serial in (select serial from p_serial)))
  then
    raise exception 'TEST purge aborted: a TEST row is linked to a real row';
  end if;

  -- ---------------------------------------------------------------------
  -- 4. Delete, children before parents (live FK graph, 2026-09-29).
  --    Each statement must remove exactly the backed-up row count.
  -- ---------------------------------------------------------------------
  delete from audit_log where id in (select id from p_audit);
  get diagnostics v_n = row_count; if v_n <> 24 then raise exception 'audit_log: % rows', v_n; end if;
  delete from notes where id in (select id from p_note);
  get diagnostics v_n = row_count; if v_n <> 8 then raise exception 'notes: % rows', v_n; end if;
  delete from chiqim_pallet_consumption where chiqim_line_id in (select id from p_cl) or barcode2 in (select barcode2 from p_pallet);
  get diagnostics v_n = row_count; if v_n <> 5 then raise exception 'chiqim_pallet_consumption: % rows', v_n; end if;
  delete from raw_dispatch_lines where chiqim_line_id in (select id from p_cl) or serial in (select serial from p_serial);
  get diagnostics v_n = row_count; if v_n <> 5 then raise exception 'raw_dispatch_lines: % rows', v_n; end if;
  delete from chiqim_line_raw_serials where line_id in (select id from p_cl) or serial in (select serial from p_serial);
  get diagnostics v_n = row_count; if v_n <> 6 then raise exception 'chiqim_line_raw_serials: % rows', v_n; end if;
  delete from rezka_kn_draws where minted_serial in (select serial from p_serial) or barcode2 in (select barcode2 from p_pallet);
  get diagnostics v_n = row_count; if v_n <> 8 then raise exception 'rezka_kn_draws: % rows', v_n; end if;
  delete from lab_results where id in (select id from p_lab);
  get diagnostics v_n = row_count; if v_n <> 17 then raise exception 'lab_results: % rows', v_n; end if;
  delete from gate_weighings where order_id in (select order_id from p_ko) or request_id in (select id from p_cr);
  get diagnostics v_n = row_count; if v_n <> 13 then raise exception 'gate_weighings: % rows', v_n; end if;
  delete from chiqim_lines where id in (select id from p_cl);
  get diagnostics v_n = row_count; if v_n <> 17 then raise exception 'chiqim_lines: % rows', v_n; end if;
  delete from chiqim_requests where id in (select id from p_cr);
  get diagnostics v_n = row_count; if v_n <> 11 then raise exception 'chiqim_requests: % rows', v_n; end if;
  delete from finished_pallets where barcode2 in (select barcode2 from p_pallet);
  get diagnostics v_n = row_count; if v_n <> 41 then raise exception 'finished_pallets: % rows', v_n; end if;
  delete from wash_cycles where id in (select id from p_wc);
  get diagnostics v_n = row_count; if v_n <> 10 then raise exception 'wash_cycles: % rows', v_n; end if;
  delete from moyka_sends where id in (select id from p_ms);
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'moyka_sends: % rows', v_n; end if;
  delete from rezka_sends where serial in (select serial from p_serial);
  get diagnostics v_n = row_count; if v_n <> 23 then raise exception 'rezka_sends: % rows', v_n; end if;
  delete from rezka_cycles where serial in (select serial from p_serial);
  get diagnostics v_n = row_count; if v_n <> 23 then raise exception 'rezka_cycles: % rows', v_n; end if;
  delete from storage_intake where serial in (select serial from p_serial);
  get diagnostics v_n = row_count; if v_n <> 22 then raise exception 'storage_intake: % rows', v_n; end if;
  delete from kirim_lines where serial in (select serial from p_serial);
  get diagnostics v_n = row_count; if v_n <> 38 then raise exception 'kirim_lines: % rows', v_n; end if;
  delete from kirim_orders where order_id in (select order_id from p_ko);
  get diagnostics v_n = row_count; if v_n <> 31 then raise exception 'kirim_orders: % rows', v_n; end if;

  -- ---------------------------------------------------------------------
  -- 5. Post-conditions: nothing TEST left; kept rows still there.
  -- ---------------------------------------------------------------------
  if exists (select 1 from kirim_orders where plate like 'TEST-%')
     or exists (select 1 from chiqim_requests where plate like 'TEST-%')
     or exists (select 1 from kirim_orders ko join owners o on o.id = ko.owner_id where o.name = 'TEST Rezka E2E')
     or exists (select 1 from chiqim_requests cr join owners o on o.id = cr.owner_id where o.name = 'TEST Rezka E2E')
  then
    raise exception 'TEST purge: TEST rows remain';
  end if;
  if (select count(*) from owners where name = 'TEST Rezka E2E') <> 1
     or (select count(*) from profiles where phone between '900000001' and '900000005') <> 5
  then
    raise exception 'TEST purge: a kept row (TEST owner or TEST role account) is missing';
  end if;
end
$purge$;

commit;
