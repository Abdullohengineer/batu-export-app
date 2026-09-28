# Debris purge: order 9B1ZK01 (Boysun)

Applied 2026-09-29 to project `qohoqbapevrcjqxbstxi`, on the user's approval.

- **Backup (restores the 3 purged rows):** `docs/data-corrections/2026-09-29_boysun_9B1ZK01_purge_backup.sql`
- **Purge script, as run:** `docs/data-corrections/2026-09-29_boysun_9B1ZK01_purge.sql`

## Why

Found during the TEST purge (`0234`). Order `9B1ZK01` is e2e debris under a real-looking plate.
The older specs create orders this way (`uniqueRealLookingPlate()` + `E2E_OWNER_NAME` = Boysun in
`tests/e2e/helpers/fixtures.ts`), so the `TEST-` filter never caught it.

- **Created:** 2026-09-28 by the TEST Menejer account (`900000002`), driver "TEST Driver", owner
  Boysun Quritilgan Mevalar.
- **Lines:**
  - `280926-035`: Subxon, 5,000 kg declared, partiya 49;
  - `280926-036`: Isfara, 500 kg declared, partiya 13.
- **State:** never weighed. It sat in the Qorovul gate queue, in Ombor intake Window 1 and in
  the Laborator KIRIM queue, and put 5,500 kg of phantom receipts on Boysun's client report.

It uses the same append-only exception for test debris as `0234`.

## Scope and guards

**Deleted: 3 rows,** the order and its 2 lines. Nothing referenced them. No rows existed in:
- `gate_weighings` or `storage_intake`;
- `moyka_sends`, `wash_cycles`, `rezka_sends` or `rezka_cycles`;
- `rezka_kn_draws`, `finished_pallets` or `lab_results`;
- `raw_dispatch_lines`, `chiqim_line_raw_serials` or `serial_mint_sources`;
- `notes` or `audit_log`, including a text scan of the audit payloads.

**Kept:**
- the Boysun owner row, which the older specs use;
- the Nukus owner row, already inactive, so no change was needed;
- `partiya_counter` (6 / 16 / 64). Numbers are never reused, so 49 (Subxon) and 13 (Isfara)
  simply become gaps.

**The guarded transaction aborts, deleting nothing, unless:**
- both rows' md5s equal the backup's (`kirim_orders` `eed283f1…`, `kirim_lines` `08e6ea96…`);
- the order still matches the debris fingerprint: plate, driver, TEST Menejer creator, owner
  Boysun;
- nothing references the order or its lines;
- each delete hits its exact count;
- afterwards both owner rows exist and Nukus is inactive.

**Backup form.** Same as `0234`: the payload md5s were checked locally against live. The file
disables `kirim_lines_assign_partiya_no` for the insert, so the lines keep 49 and 13 and the
counter is not bumped.

## Verification

**Dry run (rolled back).**
- Every guard passed.
- Purging and then running the backup statements left `kirim_orders`, `kirim_lines`,
  `partiya_counter`, `serial_counter`, `owners` and `audit_log` hash-identical to before.
- Baselines, compared ignoring array order: 10 of 11 identical. Only Boysun's own client report
  changed: `raw.receivedKg` 5,500 → 0, and the two `byType` rows and the two `qualityRecord`
  lines for 9B1ZK01 were removed.

**Live, after commit.**

| Screen | Before | After |
|---|---|---|
| Qorovul gate queue | 1 | 0 |
| Ombor intake Window 1 | 2 | 0 |
| Laborator KIRIM pending (approximation) | 4 | 2 |
| Menejer KIRIM list (deliveries) | 28 | 27 |
| Ombor intake history | 28 | 28 |

- The order and both lines are gone.
- Boysun's client report shows received 0 kg.
- Owners: Boysun active, Nukus inactive, Global and TEST Rezka E2E unchanged.
- `partiya_counter` is unchanged.

## Not changed

The older specs (`full-chain`, `lab-relocation-loss-verification`, `helpers/fixtures.ts`) still
create real-looking-plate debris under Boysun with a hard-delete teardown. A failed run leaves
exactly this kind of order behind. That design question is already carried in HANDOFF.
