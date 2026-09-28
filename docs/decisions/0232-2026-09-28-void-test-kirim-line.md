# Post-Rezka cleanup, item 6: `void_test_kirim_line` for TEST raw

Post-Rezka cleanup, HANDOFF item "KIRIM raw void path". Migration `0152_void_test_kirim_line.sql`
applied 2026-09-28. The stored md5 is `1c51c930…` and matches the file.

## Premise correction

The brief asked for a function that marks the line voided and is "excluded by every picker via
the existing voided filters". **There are no existing voided filters for KIRIM raw:**
- `kirim_lines` had no void column;
- `kirim_orders.status` is a workflow enum (`kutilmoqda` / `qabul_qilindi` / `olib_ketildi` /
  `yakunlandi`), not a void flag;
- `storage_intake.status` is always `skladda_turibdi`.

So 0152 adds the smallest honest void path, and the raw-stage readers gain the filter
themselves. This design was shown and approved before apply.

## 0152

- **Columns.** `kirim_lines.voided_at timestamptz` and `voided_by uuid references profiles(id)`.
  The void is recorded, never a DELETE (SPEC §2.15), and declared or actual quantities are never
  edited.
- **`void_test_kirim_line(p_serial text)`**, `SECURITY DEFINER`, `search_path=public`:
  - allowed for `service_role` (the specs' Node cleanup client) or an authenticated non-client;
    anyone else gets 42501;
  - refuses (42501) unless the line's order plate starts with `TEST-`;
  - idempotent: a second call is a no-op;
  - locks the line (`for update of kl`) before deciding.
- **Grants.** EXECUTE for `authenticated` and `service_role`, revoked from PUBLIC and anon.
  Verified live: anon has no EXECUTE, `prosecdef` is true, `search_path=public`.
- **Server-side readers need nothing.** A voidable line is TEST- by construction, and reports,
  the ledger (after 0151), the snapshot and `stock_on_hand_rows` already drop TEST- plates.

## Dry run (rolled back, before apply)

1. Staff (TEST Menejer) voids a TEST line: `voided_at` and `voided_by` are set.
2. A second call is idempotent: `voided_at` is unchanged.
3. A real line is refused: `040926-001 is not TEST- data (plate 40U707NB)`.
4. A client is refused: `staff only`.
5. `service_role` voids a TEST line (`voided_by` is null, as there is no uid).
6. Grants: anon has no EXECUTE; `authenticated` and `service_role` do.
7. `declared_qty` and `partiya_no` are untouched.

## Frontend: six not-voided filters (plus one)

Each filter is `.is('voided_at', null)` on the `kirim_lines` read:

| Hook | Screen |
|---|---|
| `useMoykaSerials` | Ombor Moyka / Tashqi pickers, the Moykaga badge, intake Window 2, Menejer Xom pool |
| `useIntakeLines` | Ombor intake Window 1 |
| `useKirimTrips` | Qorovul gate queue |
| `useLaboratorKirim` | Laborator KIRIM |
| `useIntakeHistory` | history twin of intake |
| `useLaboratorHistory` | history twin of Laborator KIRIM |

The history twins follow CLAUDE.md's "history screens use the same rule as their live
counterpart".

`useKirimTrips` also drops a trip left with no lines. A real order always has lines; an order
whose lines were all voided is not a truck anyone should weigh.

Finished-stage screens do not filter on `voided_at`. A voided line has, by construction, no
further processing that the void should hide.

## Specs

- `tests/e2e/helpers/teardown.ts` gains `voidTestKirimLines(db, serials)`. It calls the RPC per
  serial and throws on error.
- `rezka-menejer.spec.ts`: `afterAll` voids every serial the run created.
- `rezka-ombor.spec.ts`: voids the Tashqi and KN serials.
  - The Ichki mint is excluded: its plate is `QAYTA-ISHLASH`, so the RPC would rightly refuse it.
  - It has no intake, so it never sits in a raw-stage queue.

Both are safe whether the run passed or failed, because the function is idempotent.

## Stranded TEST raw, voided live

These were voided through the RPC as TEST Menejer: `280926-005`, `-012`, `-019`, `-026`, `-033`,
`-042`, `-049`, `-056`. All are KN, 60 kg declared each, and `declared_qty` is unchanged.

TEST- counts, before and after:

| Screen | Before | After |
|---|---|---|
| Ombor intake Window 1 | 8 | **0** |
| Intake Window 2 / Moyka + Tashqi pickers / Moykaga badge / Menejer Xom | 0 | 0 |
| Laborator KIRIM pending | 0 | 0 |
| Qorovul trip lines (TEST, all states) | 30 | 22 |
| Intake history (TEST) | 22 | 22 |

The 22 lines that remain are TEST raw that was intaken and fully consumed (0 available). They
appear only in history rows of completed work, which is correct. None of the 8 voided serials is
visible through any not-voided reader.

## Not verified here

There is no `.env.test` in this container, so the two Rezka specs' new cleanup has not been run.
They are in the local run command.
