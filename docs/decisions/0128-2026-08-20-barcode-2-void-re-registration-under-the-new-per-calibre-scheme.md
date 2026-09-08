## 2026-08-20 — Barcode #2 void + re-registration under the new per-calibre scheme

**Context.** The one-barcode-per-physical-pallet rule (§2.2) is being replaced: each calibre now
gets one Barcode #2 covering its full pallets plus a second barcode for any remainder in loose
boxes — partial-calibre truck collection no longer exists. This is the data correction for two
already-received serials onto the new shape; the app-side receive-form change (one barcode per
calibre group) is a separate, later task, deliberately not touched here.

**Pallet-size confirmation.** `calibres` carries no capacity column — pallet capacity is a
physical/box-count fact, not per-calibre data — so confirmed 720 kg directly against live data
instead of schema. Both target serials already carried multiple exact-720 kg rows for Kalibr 4 (4
instances) and Kalibr 6 (2 instances), and the one prior precedent in this codebase
(`0059_revert_rewash_test_and_fix_qandqizil_attribution.sql`, 2026-08-03) also split a Kalibr 6
quantity as 720+320. For Kalibr 1/8/Konditirskiy on these two serials specifically, every existing
total was already under 720 kg, so the split has no full-pallet row for those calibres regardless
of the exact threshold — 720 is directly evidenced for K4/K6 here and moot-but-consistent for the
rest.

**The correction**, applied via direct SQL console — no schema change, not a checked-in migration,
same shape as the `150826-001` tara correction:

| Serial | Voided | Created | Total (unchanged) |
|---|---|---|---|
| 050826-001 | 13 rows | 7 rows (K1→290; K4→2,880+80; K6→1,440+320; K8→580; KN→650) | 6,240 kg |
| 290726-071 | 3 rows | 3 rows (K4→1,440+40; KN→190) | 1,670 kg |

Voided via `status='bekor_qilindi'` + `voided_at=now()`, never deleted (SPEC's void-not-delete
rule). New rows use the existing `PLT-<serial>-<calibre>-<seq>` scheme, `<seq>` continuing past the
highest seq **ever** issued for that (serial, calibre) pair including voided ones
(`FinishedReceiptForm.tsx`'s own documented convention) — checked directly against live data before
writing, zero collisions. Two `audit_log` rows written (one per serial, `table_name`=
`'finished_pallets'`, `row_id`=the serial, `actor=null`, `action=
'barcode2_void_reissue_per_calibre_scheme'`, `before`/`after` as JSON arrays of the voided/created
rows, `after.note` carrying the explanation) — same shape as the `150826-001`
`box_mass_kg_manual_correction` row (`audit_log` id 1160): actor null, human-readable note embedded
in `after`.

**Deliberate choice, confirmed with the user before applying: new rows keep the ORIGINAL
`received_date`** (2026-08-19 for 050826-001, 2026-08-18 for 290726-071), not the correction date.
Matches the one prior precedent (`0059`, which backdated its reissued Qand Qizil pallets to the
original 2025-01-01 seed date) and keeps "when was this actually packed" correct for all normal
reporting (Ombor qoldig'i, monthly trends, client report) going forward.

🚩 **Known gap, accepted not fixed — same class as the two entries below.** `get_client_report`'s
`client_pallets` as-of-date reconstruction (see "Client reports stopped mutating retroactively,"
2026-08-02) keys membership off `received_date`/`voided_at` alone, with no record of when a
`finished_pallets` row was actually inserted. Because the new rows carry the ORIGINAL received_date,
regenerating a closed-period report for `p_to = 2026-08-18` or `p_to = 2026-08-19` specifically (the
two original received_dates — the only values where the new rows are "received as of p_to" while the
old rows are simultaneously "not yet voided as of p_to") would double-count this weight. Both dates
are already in the past as of this correction, so this is a latent risk only for someone regenerating
one of those exact two historical reports from now on, not a growing or forward-looking one — any
`p_to >= 2026-08-20` (today's void date) already reads correctly. Same root cause as "`
report_kirim_rows_as_of` gates event visibility, not values" (2026-08-15) and the closed-period
defect logged in the 2026-08-02 Stage 3 entry ("consuming a pallet retroactively alters closed-period
client reports") — reading current event-date columns for a historical question, with no record of
when the row itself was written. Not fixed here: fixing it means changing the report reconstruction
logic, out of scope for a data-only, no-schema-changes correction.

**Verification — live, post-apply.**

| Check | Result |
|---|---|
| `finished_pallets`, both serials | 13→7 and 3→3 rows exactly as planned; old rows `bekor_qilindi` with `voided_at` set, new rows `in_stock` |
| `stock_on_hand_rows` bucket=`available` | 050826-001: 6,240 kg / 7 rows. 290726-071: 1,670 kg / 3 rows |
| `get_serial_passport`, both serials | `joriyHolat.finished.stillInStorageKg` = 6,240 / 1,670 exactly; all 16 old pallets show `palletStatus: "bekor_qilingan"`, all 10 new show `"omborda"`; `byCalibre` sums match the target split exactly |
| Void blast radius | only `050826-001`/`290726-071` carry any `voided_at` in the apply window — confirmed no other serial touched |
| `dispatch_manifest` / `chiqim_line_pallets` / `serial_mint_sources` | zero references to any of the 16 old barcodes, before and after |
| `audit_log` | 2 new rows (ids 1168, 1169), `actor` null, shape matching the tara-correction precedent |

**Out of scope, not touched:** the receive-form app-side change (one barcode per calibre group), a
print-N-copies button for Barcode #2 (scoped separately in the same session, not built), Rezka, the
Ombor nav branch.
