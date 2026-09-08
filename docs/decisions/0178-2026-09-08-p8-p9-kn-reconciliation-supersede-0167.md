## 2026-09-08 — P8/P9 KN reconciliation, supersedes 0167 (110826-003 / 180826-001)

**Context:** `docs/decisions/0167-2026-09-08-p8-p9-moyka-batch-reconciliation-110826-003-180826-001.md`
used a wrong P8 baseline. It assumed P8's pre-existing K2/KN pallets were correct as booked
(K2=830, KN=1,290 across two pallets) and only moved material between P8 and P9. Two further
pre-existing errors on P8 — untouched by 0167 either way — were found on top of that: the K2
pallet was over-booked (830 kg booked, paper log says 760 kg), and P8 never had a KN-1 pallet
at all (680 kg booked in error, no physical basis — the paper log shows only one P8 KN pallet,
the 610 kg one). Full SQL archived at
`docs/data-corrections/2026-09-08_p8-p9-kn-reconciliation-supersede-0167.sql`.

**Discrepancy surfaced before writing anything:** the task's own stated Step-1 verification
target (P8 = 5,250 after reverting 0167) did not match a literal revert of 0167's 9 touched
rows, which produces P8 = 6,000 (matching 0167's own documented "before" state exactly). Rather
than force the number, this was flagged to the user with a dry-run (`BEGIN...ROLLBACK`) showing
the 6,000 figure and the two candidate pallets (`K2` −70kg, `KN-1` 680kg = exactly 750kg, closing
the gap to 5,250) before any write. The user confirmed: both pallets are genuine pre-existing
errors, unrelated to 0167, to be corrected in a separate step.

### Three-step mechanism, each dry-run and shown to the user before applying

1. **Revert 0167 in full** — un-void the 3 original `180826-001` pallets 0167 voided
   (`-04-2` 3,610, `-06-1` 580, `-KN-2` 1,430), void the 6 rows 0167 inserted (3 `180826-001`
   replacements, 3 new `110826-003` rows). Result: P8 = 6,000, P9 = 7,880 — matches 0167's
   documented pre-correction state exactly.
2. **Fix the two pre-existing P8 errors** (predate 0167, untouched by it in either direction):
   void `PLT-110826-003-02-1` (K2, 830) and insert `PLT-110826-003-02-2` (760, same
   `received_date` — no date drift, this is a weight correction not a re-dating); void
   `PLT-110826-003-KN-1` (680, phantom) with no replacement. Result: P8 = 5,250, P9 = 7,880
   (unchanged).
3. **Apply the real KN skew** between the two serials on the now-correct baseline. Only KN
   changes — K1/K2/K4/K6/K8 stay exactly as Step 2 left them. Void P8's single remaining KN
   pallet (`PLT-110826-003-KN-2`, 610) and insert `PLT-110826-003-KN-4` (1,260, dated
   2026-09-03 — P8's finish date). Void P9's two KN pallets (`PLT-180826-001-KN-1` 490,
   `PLT-180826-001-KN-2`/restored-then-revoided 1,430 = 1,920 combined) and insert
   `PLT-180826-001-KN-4` (1,270, dated 2026-09-05 — the mixing date, same convention as 0167).

All three steps ran in one `DO $$ ... $$` block so every one of the 17 writes (3 un-voids, 11
voids, 3 inserts) gets its own paired `audit_log` row (`actor = null`, action
`update_correction`/`insert_correction`, `reason` naming this entry and the step). Verified
17 `audit_log` rows written, matching the write count exactly.

### Verification

| | Sent | K1 | K2 | K4 | K6 | K8 | KN | Output | Loss(+danak) | Loss % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 110826-003 (P8) | 7,190 | 800 | 760 | 3,020 | 0 | 60 | 1,260 | 5,900 | 1,290 | 17.94% |
| 180826-001 (P9) | 7,960 | 0 | 320 | 5,020 | 580 | 40 | 1,270 | 7,230 | 730 (incl. 10 danak) | 9.17% |
| Combined | 15,150 | | | | | | | 13,130 | 2,020 | 13.33% |

Every figure matches the target exactly, both serials, mass balance holds (7,190 = 5,900 +
1,290; 7,960 = 7,230 + 730; 15,150 = 13,130 + 2,020, no kg created or destroyed).

Also verified post-apply: `kirim_line_calibre_output` returns the corrected breakdown for both
serials; `get_serial_passport`'s `returnedKg`/`byCalibre` match (5,900/7,230, both breakdowns
correct); `moyka_sends` unchanged (7,190/7,960 — never touched by any of the three steps);
`report_moyka_output_rows_by_serial` (Hisobot MOYKADAN) returns 5,900/7,230; and
`SerialPassportModal.tsx`'s `bekor_qilingan` filter (added in 0167) still excludes every voided
pallet from the passport's pallet list — confirmed against the raw `cycles[0].pallets` array,
which correctly still shows all pallets including the newly-voided ones (0167's originals, the
0167 replacements now re-voided, and the two Step 2/3 pre-existing-error pallets), each labeled
`bekor_qilingan`.
