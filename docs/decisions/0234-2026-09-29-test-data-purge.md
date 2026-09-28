# TEST data purge (append-only exception for test debris)

Applied 2026-09-29 to project `qohoqbapevrcjqxbstxi`, on the user's approval.

- **Backup (restores every purged row):** `docs/data-corrections/2026-09-29_test_purge_backup.sql`
- **Purge script, as run:** `docs/data-corrections/2026-09-29_test_purge.sql`

**Why.** e2e runs left TEST- orders, lines and everything downstream in the Ombor, Laborator,
Qorovul and Menejer history lists. SPEC §2.15 says never DELETE, only void. Test debris is the
documented exception: `0088` "Operational data wipe for a clean testing slate" and `0195`
"Phantom moyka sends cleanup". This purge follows the same exception and removes nothing but
TEST rows.

## Scope

The purge set was derived from three roots.

- **31 `kirim_orders`:**
  - the 23 with plate `TEST-%`;
  - the 8 `QAYTA-ISHLASH` mint orders whose every draw came from a TEST pallet. Each is 25 kg
    from one TEST KN pallet via `rezka_kn_draws`.

  Global Export's two mints, `040926-002` and `240826-001`, draw only from real ESKI-ZAXIRA
  pallets. They fail the test and were kept.
- **11 `chiqim_requests`:** plate `TEST-%` or owner "TEST Rezka E2E". All 11 are both.
- **Every child row,** found from the live FK graph, plus the `notes` and `audit_log` rows
  about them. `audit_log` has no FK; its `row_id` was matched per `table_name`, and a text scan
  for TEST- plates and serials found exactly the same 24 rows.

| Table | Rows | Table | Rows |
|---|---|---|---|
| kirim_orders | 31 | chiqim_requests | 11 |
| kirim_lines | 38 | chiqim_lines | 17 |
| storage_intake | 22 | chiqim_pallet_consumption | 5 |
| gate_weighings | 13 | raw_dispatch_lines | 5 |
| lab_results | 17 | chiqim_line_raw_serials | 6 |
| moyka_sends | 2 | rezka_kn_draws | 8 |
| wash_cycles | 10 | notes | 8 |
| rezka_sends | 23 | audit_log | 24 |
| rezka_cycles | 23 | finished_pallets | 41 |

That is 304 rows in total. `serial_mint_sources`, `dispatch_manifest`, `chiqim_fura_photos` and
`old_kn_collections` held no TEST rows.

## Kept

- The "TEST Rezka E2E" owner row; the Rezka specs need it.
- The five TEST role accounts, `900000001`–`900000005`.
- `partiya_counter` and `serial_counter`.
- The 57 storage objects (gate and pile photos) the purged rows pointed to. They were left in
  their buckets, so a restore resolves to the same files.

**No TEST row was linked to a real row.** Pallet draws, pallet consumption, raw dispatch,
raw-serial links, lab samples and gate weighings were all checked in both directions: zero. The
purge script re-asserts this inside the transaction.

## Partiya numbers

The TEST lines held 30 Subxon numbers: 27–64 except 49. The 8 mint lines had none.
`assign_partiya_no` draws from `partiya_counter` (`last_no + 1`), never `max(partiya_no) + 1`,
and the counter was not touched. So numbers are never reused: the next Subxon delivery gets 65.
The resulting gaps have no effect. Subxon's 20–24 and 26 were already gaps from earlier
hard-deleted test runs.

## Method

1. **Backup.** One INSERT per table, with the rows carried as a JSON array and expanded by
   `jsonb_populate_recordset`. The generated `net_kg` columns are omitted.
   - Each payload is `jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text)`. Its md5 is in the
     header comment and was checked locally against the live md5 for all 18 tables.
   - Restoring must not re-fire `kirim_lines_assign_partiya_no` (it reassigns partiya and bumps
     the counter) or `lab_results_audit` (it duplicates audit rows).
     `session_replication_role = replica` is refused for `postgres` on this project (42501), so
     the file uses `ALTER TABLE ... DISABLE TRIGGER` for those two inside its transaction.
   - Verified two ways:
     - Run as-is on a local Postgres 16 sandbox with stub tables, it reproduced all 18 md5s
       byte-for-byte, with neither trigger firing.
     - A live rolled-back purge followed by a restore in the same statement form left all 22
       table hashes identical: the 18 tables plus `partiya_counter`, `serial_counter`, `owners`
       and `profiles`.
2. **Guarded purge.** One transaction with one DO block. It aborts, deleting nothing, if:
   - any table's to-be-deleted rows differ in count or md5 from the backup;
   - a TEST row is linked to a real row;
   - a table expected to hold no TEST rows holds some;
   - any delete removes a different row count than was backed up;
   - afterwards TEST rows remain, or the TEST owner or a TEST account is missing.

   Deletes run children before parents: `audit_log`, `notes`, `chiqim_pallet_consumption`,
   `raw_dispatch_lines`, `chiqim_line_raw_serials`, `rezka_kn_draws`, `lab_results`,
   `gate_weighings`, `chiqim_lines`, `chiqim_requests`, `finished_pallets`, `wash_cycles`,
   `moyka_sends`, `rezka_sends`, `rezka_cycles`, `storage_intake`, `kirim_lines`,
   `kirim_orders`.
3. **Dry runs.** Two rolled-back dry runs, then the live run. All guards passed and every delete
   hit its exact count.

## Result (live, after commit)

Screen counts, total with the TEST share in parentheses:

| Screen | Before | After |
|---|---|---|
| Ombor intake Window 1 | 2 (0) | 2 (0) |
| Ombor intake Window 2 (SQL approximation of `useMoykaSerials.available > 0`) | 14 (0) | 14 (0) |
| Ombor intake history | 50 (22) | 28 (0) |
| Laborator KIRIM history | 51 (7) | 44 (0) |
| Laborator CHIQIM history | 39 (10) | 29 (0) |
| Qorovul completed trips | 46 (12) | 34 (0) |
| Ombor CHIQIM history | 18 (5) | 13 (0) |
| Menejer KIRIM list (deliveries) | 51 (23) | 28 (0) |
| Menejer CHIQIM list | 24 (11) | 13 (0) |

These are identical to the dry run. The 22 table hashes after the commit equal the dry run's
post-purge hashes exactly, so the live state is byte-for-byte the state the dry run tested.

### The 11 report baselines

The comparisons were order-insensitive: arrays sorted recursively before hashing. Two functions
emit unordered `jsonb_agg` lists, so raw hashes can change with the plan while the values do
not. Boysun's report is one case; it hashes stably, 5 calls in a row, to a different raw md5 than
before, with the same content.

- **9 identical:**
  - snapshot ×3;
  - client report ×3 (Global, Boysun, Nukus);
  - `stock_on_hand_rows`;
  - ledger Eski.
- **`finished_pallet_availability`:** −4 rows. These are the TEST Rezka output pallets
  `PLT-280926-031/040/047/054-RKN-1`, each at 0 kg available. This is a balance view,
  unfiltered by design, so it is expected.
- **`rahbar_dashboard_ledger` Yangi and Hammasi:**
  - `finished.producedKg` 145,020 → 144,900;
  - `finished.dispatchedKg` 86,290 → 86,170 (Yangi) and 97,830 → 97,710 (Hammasi);
  - one `byCalibreType.dispatched` entry removed: 120 kg Standard.

  These are the same 4 × 30 kg TEST pallets. **This is a pre-existing leak, not a purge side
  effect:** `0151` excluded TEST plates from the raw and Moyka event CTEs only, and the finished
  section still counts TEST pallets. The numbers are now correct, but the next e2e run will leak
  again. Logged in HANDOFF as a follow-up.

## Flagged, not done here

- **Boysun's order `9B1ZK01` is also e2e debris,** under a real-looking plate:
  - created by TEST Menejer, with driver "TEST Driver";
  - lines `280926-035` (Subxon 5,000 kg, partiya 49) and `280926-036` (Isfara 500 kg,
    partiya 13);
  - never weighed, waiting at the gate.

  It is outside this purge's TEST- scope. It gets its own backup and guarded purge on the same
  branch, pending separate approval.
