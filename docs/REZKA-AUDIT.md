# Rezka cutting line — design audit (2026-09-23)

Read-only, single pass, time-boxed to 20 minutes. Repo `main` @ `1038732`. Live DB read with SELECT only. Live migrations go up to **0140**; repo files stop at **0137**. "unverified" = not confirmed within the time box.

## One-page summary (plain language)

- **Already there (from stage 1):** the database can record "sent to Rezka" amounts and a Rezka batch. It blocks one serial from going to both Moyka and Rezka. It lets Ombor register Rezka pallets without a lab result. Two "take from inside stock" functions exist. There are no screens yet.
- **Missing at the start of the flow:** there is nowhere to mark a truck line as "Rezka". The KIRIM form and the database have no such field. Until there is, Rezka raw material will land in the Laborator queue and in the Moyka send picker like any other delivery.
- **Blocks dispatch:** finished Rezka pallets can go into the warehouse, but the dispatch side (Menejer's stock picker and the automatic pallet assignment) only shows pallets with a passed lab result. Rezka pallets never get one, so they cannot leave.
- **Taking part of a Konditerka pallet is not possible today.** The system uses up whole pallets only. Drawing, say, 300 kg from a 500 kg pallet needs a design decision first.
- **Dashboard regression:** the stage-1 change that kept "Rezka KN" separate from ordinary Konditerka on the Rahbar dashboard was lost in a later rewrite (0137). Rezka output would currently be counted as Konditerka.
- **Closing a batch:** Moyka has a "close" step and multi-cycle support. The Rezka table was copied from the older Moyka shape and lacks both.
- **Printing:** Barcode #2 prints through the Android app's printer plugin. If everyone is really on the web app, printing needs checking before pilot.
- **Decisions needed from you:** (1) where the "process" field lives; (2) whole pallets or partial kg for the inside draw; (3) rename "Rezka KN" to "Standard" or add a new calibre; (4) whether Rezka is a new CHIQIM line type or a normal calibrated line.
- **Proposed order:** 4 prompts: data model and guards → Ombor screens → dispatch → reports.

## 1. Item table

| Item | Status | Objects | Note |
|---|---|---|---|
| A1 KIRIM process select | **Missing** | `kirim_lines` has no `process` column (live); `KirimForm.tsx` | Needs a column plus filters in Laborator and Moyka-picker hooks. Gate, intake, tara and Barcode #1 hooks filter only `origin='delivery'`, so a Tashqi line flows through unchanged. |
| A2 pill | Missing | `OmborMoykaTab.tsx` (route `/ombor/moyka`, nav label "Moykaga Chiqarish") | UI only. |
| A2 Tashqaridan olish | Partial | `rezka_sends` (RLS `ombor_writes`), `useMoykaSerials.available` already subtracts `rezka_sends` | No hook lists process=rezka serials. Nothing creates a `rezka_cycles` row for Tashqi. The 0127 "available to send to Rezka" RPC was never built. |
| A2 Ichkaridan olish | Partial | `send_finished_pallets_to_rezka(owner, type, pallet_barcodes[], weighed_kg)` → `mint_serial_from_sources` + `rezka_cycles('active')` + `rezka_sends` + note, in one transaction | Takes **explicit whole pallets**, not a kg amount with FIFO. Enforces owner/type per pallet. No lab-pass check. No FIFO picker. Does not touch `wash_cycles`. |
| A2 Window 2 | Missing | `serial_mint_sources` (provenance: `source_kind` pallet/weight_pool, `source_barcode2`) | No hook yet. Badge can be derived from `origin` plus mint sources. |
| A3 receive | Partial | `finished_pallets` INSERT policy has `OR EXISTS rezka_cycles` branch; `FinishedReceiptForm.tsx`; `ReceiveFromMoykaForm.tsx:41` gate `labStatus === 'passed'`; `useMoykaOutput` (reads `moyka_sends`, `wash_cycles`) | The form can be reused. The picker and hook are Moyka-only. `FinishedReceiptForm` filters calibres by `category_id` only, so RKN already shows in **Moyka** receive too (leak). |
| A3 Barcode #2 | Partial | `barcodeLabel.ts` (QR since the barcode-to-QR switch), `p1Printer.ts` (Capacitor `P1Printer` native plugin, `isNativePlatform()`) | Printing needs the native app. The "no APK" premise conflicts. Web fallback unverified. |
| A4 calibre | Partial | calibre `RKN` / "Rezka KN", `is_numberless`, `is_rezka_output` (one row, per **category**) | No "Standard" row. Calibres are keyed by category, not product type. |
| B loss/close-out | Partial | `computeLossDisplay` (`formatLoss.ts:62`, signed once closed); `isInMoyka(sent, received, closedAt)`; `close_wash_cycle_if_settled`, `close_wash_cycle_serial`, `ensure_open_wash_cycle`, `open_second_wash_cycle` | `rezka_cycles` = id, serial, status, final_loss_pct, finalized_at. Missing `closed_at`, `cycle_no`, `opened_at` (all on `wash_cycles`). No close RPCs for Rezka. |
| B mutual exclusion | Exists | `prevent_dual_process_serial` on `wash_cycles` and `rezka_cycles` inserts | No trigger on `moyka_sends`/`rezka_sends`, so the guard only fires when a cycle row is created. The Ichki path does not touch `wash_cycles`. |
| B one owner / one source per batch | Exists by construction | Ichki always mints a new serial; the mint checks `ko.owner_id = p_owner_id` per pallet | A delivery serial has no mint sources, so a batch cannot mix Tashqi and Ichki. |
| C1 Rezka tab | Missing | `chiqim_lines.line_kind` CHECK: finished, raw, old_washed, old_kn, old_raw | Decide: new `line_kind` or a `finished` line with the RKN calibre. |
| C2 verdict gates | Blocker | `useAvailableFinishedStock.ts:15` ('o_tdi' verdict); `attribute_chiqim_line_fifo` (live, reads `lab_results`/verdict); `finished_pallet_availability` (live, verdict hit, unverified) | `chiqimScan.ts` is **deleted** (comments in `chiqimLineStatus.ts:1`). Exemption: "verdict passed OR `rezka_cycles` exists" at all three sites. |
| C3 Ombor CHIQIM card | Missing | `OmborChiqimTab.tsx` | Badge keyed on the C1 decision. |
| D1 Hisobot Rezka group | Missing | Live engine: `report_query_page_rows` (0138), `report_page_enrich` (0139), `report_totals`, views `report_rows_v2`, `report_moyka_output_rows` | `report_rows_v2` is a view, not the page function. Proposed: new direction values in the same `p_directions[]` engine. 12 s timeout and 0140 statement cap apply. |
| D2 Moykadan chiqgan | Exists (mostly) | `kirim_line_state` pallet filter `status not in ('bekor_qilindi','storage_loss')`, so consumed pallets still count as produced; `report_moyka_output_rows` keeps consumed rows as `'ishlatilgan'` | Stock-side exclusion of consumed: `stock_on_hand_rows` has a consumption CTE; exact status predicate unverified. |
| D3 passport | Partial | `get_serial_passport` reads `rezka_` and `'consumed'`; `serialPassport.ts` mint fields (`poolDrawKg`, `sentWeighedKg`) | Parent-side line "→ serial X" and Rezka received/loss block: unverified / likely missing. |
| D4 Rahbar tiles | Missing + **regression** | Live `rahbar_stock_snapshot` has **no Rezka key**; it splits only on `is_numberless` | The 0076 `finished_rezka_kn_total` split was lost (probably in 0137 set-based). `rezkaKnKg` does not exist. RKN would merge into Konditirskiy. |
| D5 qoldig'i / client | Missing | `stock_on_hand_rows` raw bucket already subtracts `rezka_sends`; RLS `client_read_own_rezka_sends` exists, **no client policy on `rezka_cycles`** | Tashqi raw merges into the ordinary raw line. Ichki mints have no `storage_intake`, so they are invisible in raw stock. Client block: scope only. |

## 2. Wrong premises

1. `computeSignedLossPct` and `computeFinalLossPct` do not exist in `src/`. Only `computeLossDisplay`, `formatLossKg` and `formatLossPct` exist. The only `Math.max(0,…)` is the unrealized `moykadaKg`.
2. `rahbar_stock_snapshot.rezkaKnKg` does not exist. The live function has no Rezka split at all (regression, see D4).
3. Pallet status "active" does not exist. The live values are `in_stock`, `consumed`, `bekor_qilindi` (plus `storage_loss` referenced in code).
4. `chiqimScan` is gone (deleted with the 0087–0092 FIFO work).
5. Partial-pallet kg draw is **not supported**. `serial_mint_sources` CHECK forces `weight_kg IS NULL` for `source_kind='pallet'`, and the mint sets the whole pallet to `consumed`.
6. The Ichki RPC takes explicit pallet barcodes, not "owner + type + kg, FIFO".
7. "Standard" calibre does not exist. The seeded row is `RKN` / "Rezka KN". Calibres are per category, not per product type.
8. `rezka_cycles` has no `closed_at`, and there are no close RPCs. It also lacks `cycle_no`/`opened_at` (0076 predates multi-cycle `wash_cycles`).
9. Hisobot is not served by `report_rows_v2`. It is served by `report_query_page_rows` / `report_page_enrich` / `report_totals` (0138/0139).
10. The Hisobot direction + serial-state migration is **0074** (`hisobot_moyka_rows_and_serial_state`), not 0073 (0073 is `correct_kirim_line_tara_rpc`).
11. "No APK": Barcode #2 printing depends on the Capacitor native `P1Printer` plugin.
12. The Ombor section names are "Moykaga Chiqarish" / "Tayyor Mahsulot", not "Moykaga yuborish" / "Moykadan qabul qilish".
13. CLAUDE.md has no literal "never create a new balance calculation" rule. That wording is a SPEC.md convention; CLAUDE.md's closest rule is "Derive, don't store".
14. "SPEC has no Rezka section": correct, but SPEC does mention Rezka in passing (raw dispatch lines, `partiya_no`, v1.54/1.62 history).
15. "Old-KN pool as a Rezka source is pending": `send_old_kn_pool_to_rezka` already exists live. It is unused but callable by Ombor.

## 3. Gate / filter hit list (grep only, not hand-verified)

**Lab-verdict: src** (file, hit count): `clientReportLabels.ts` 9, `LaboratorChiqimTab.tsx` 7, `useLaboratorHistory.ts` 7, `useLaboratorChiqim.ts` 6, `labVerdict.ts` 6, `LaboratorTarixTab.tsx` 5, `ChiqimTahlilEditForm.tsx` 5, `useReportQuery.ts` 4, `ClientReportTab.tsx` 3, `ChiqimTahlilForm.tsx` 3, `reportQuery.ts` 3, `SerialPassportModal.tsx` 2, `queryClient.ts` 2, `clientReportExport.ts` 2, `ReceiveFromMoykaForm.tsx` 1 (**blocks Rezka receive**), `OmborTayyorTab.tsx` 1 (Yakunlash `labStatus==='passed'`), `serialPassport.ts` 1, `clientReport.ts` 1, plus `useAvailableFinishedStock.ts` (**blocks dispatch**).

**Lab-verdict: live SQL:** `attribute_chiqim_line_fifo` (**blocks dispatch**), `finished_pallet_availability`, `chiqim_component_is_match`, `chiqim_dispatch_calibre_breakdown`, `close_wash_cycle_serial`, `open_second_wash_cycle`, `get_client_report`, `get_serial_passport`, `lab_turnaround_avg`, `stock_on_hand_rows`, `wip_rows`, `yield_rows`, `report_totals`, `report_query_page`, `report_query_page_rows`, `report_page_enrich`, `report_rows`, `report_rows_v2`, `report_filtered_rows(_v2)`, `report_kirim_rows(_as_of)`, `report_chiqim_rows(_v2)`, `report_dispatch_rows_v2`, `report_moyka_output_rows(_by_serial)`, `report_moyka_send_rows`, `report_old_kn_rows(_v2)`, `report_raw_dispatch_rows(_v2)`. Policy: `finished_pallets.ombor_writes` (already has the Rezka OR-branch).

**`origin = 'delivery'`: src:** `useLaboratorKirim.ts:132`, `useIntakeLines.ts:65,76`, `useKirimTrips.ts:53,64`, `useGateHistory.ts:109`, `useIntakeHistory.ts:80`. These keep Ichki mints out, which is intended. None of them excludes a Tashqi Rezka line, so the Laborator queue needs a process filter.

**`origin = 'delivery'`: live SQL:** `assign_partiya_no`, `client_filtered_report_rows`, `client_serial_ledger`, `get_client_report`, `rahbar_client_ranking`, `rahbar_monthly_trends`, `rahbar_product_mix`, `report_rows`, `report_rows_v2`. These exclude Ichki mints from arrival figures, which is intended. A "Rezka kirim / Ichki" row needs its own source.

**Moyka-only reads relevant to Rezka:** `useMoykaOutput` (`moyka_sends`, `wash_cycles`); `useMoykaSerials` has no process filter; `FinishedReceiptForm` calibre list has no `is_rezka_output` filter.

## 4. Balance sites touched by the Ichki draw

Live objects that read `'consumed'`: `client_production_ledger`, `get_serial_passport`, `mint_serial_from_sources`, `report_chiqim_rows(_v2)`, `report_moyka_output_rows`. Live objects that read `rezka_*`: `client_chiqim_ledger`, `close_out_old_stock`, `correct_kirim_line_tara`, `get_client_report`, `get_serial_passport`, `kirim_line_report_bundle(_set)`, `kirim_line_state`, `old_stock_closeout_lines`, `rahbar_dashboard_ledger`, `stock_on_hand_rows`, `wip_rows`.

| Site | Consumed excluded? |
|---|---|
| `stock_on_hand_rows` finished bucket | Likely (has `consumed_by_pallet` CTE); predicate unverified |
| `rahbar_stock_snapshot` | Reads `stock_on_hand_rows`, so it inherits that. **RKN not split** (see D4). |
| `rahbar_dashboard_ledger` (Ledger C) | unverified |
| `get_client_report` | unverified |
| `kirim_line_state` | Produced figure keeps consumed pallets (intended, see D2). Stock columns unverified. |
| `useAvailableFinishedStock` / `attribute_chiqim_line_fifo` | unverified (FIFO likely `in_stock` only) |
| `client_production_ledger` | Reads `consumed`; direction unverified |

## 5. Partial-pallet consumption

**Not possible today.** The mint consumes whole pallets. It accepts a pallet that is partly *departed* (`weight − departed > 0`), rejects one with *pending* CHIQIM consumption, and flips the whole pallet to `consumed`. The book figure in `send_finished_pallets_to_rezka` sums the **full** `weight_kg`, not net of departed kg. That is a small overstatement on the note only.

Smallest options:
- **(a) Whole pallets, FIFO (recommended).** Draw whole pallets FIFO until the target kg is covered. Send the weighed kg; any excess stays in the Rezka serial. No schema change; the only new code is the FIFO selector.
- **(b) Real partial draw.** Allow `weight_kg` on `pallet` rows and subtract `Σ serial_mint_sources.weight_kg` wherever pallet remaining is computed. That is a new term in several balances (costly).

## 6. Build order (migrations reserved from 0141)

1. **Data model and guards: 0141–0142.**
   - Add `kirim_lines.process` (default `moyka`).
   - Add `rezka_cycles.closed_at` / `opened_at` / `cycle_no`, plus `close_rezka_cycle_if_settled` / `close_rezka_cycle_serial`.
   - Tashqi send RPC (`rezka_sends` + `rezka_cycles`).
   - FIFO Ichki wrapper over `send_finished_pallets_to_rezka`.
   - Restore the RKN split in `rahbar_stock_snapshot`.
   - Guard: reject `moyka_sends`/`wash_cycles` for `process='rezka'`.
   - Calibre rename decision.
   - Dry run: TEST- delivery line (process=rezka) plus TEST- KN pallets. Assert it is absent from the Laborator and Moyka pickers, the raw balance drops by the send, pallets become consumed, and KN stock drops. Void on cleanup.
2. **Ombor UI (A2/A3/B): no migration expected (reserve 0143).**
   - Pill, two tiles, Window 2 with provenance, Rezka receive picker without lab gate.
   - RKN-only calibre list for Rezka receive; hide RKN in Moyka receive.
   - Yakunlash twin. New hooks on React Query.
   - Dry run on TEST- serial through send → receive → close.
3. **Dispatch (C1–C3): 0144.**
   - Exempt Rezka at `useAvailableFinishedStock`, `attribute_chiqim_line_fifo` and `finished_pallet_availability`.
   - Rezka tab and Ombor card badge.
   - Dry run: TEST- request consuming TEST- RKN pallets, normal and fura.
4. **Reporting (D1, D3–D5): 0145–0146.**
   - Rezka directions in `report_query_page_rows` / `report_totals`, passport lines, two Rahbar tiles, qoldig'i lines.
   - Check the 12 s statement budget.
   - Dry run against the same TEST- fixtures.

- **Cheap:** A4, B exclusion/ownership (already exists), C3, the D4 tiles once the snapshot is fixed.
- **Costly:** D1 (perf-constrained engine), true partial pallets (5b).
- **Drop or defer:** partial-pallet kg draw (5b), the client Rezka block (out of scope).

## 7. Invariant conflicts

- **Origin filtering:** Ichki mints are `internal_reprocess`. Showing them as "Rezka kirim" needs its own row source, not the `origin='delivery'` arrival allowlist. Tashqi is `delivery` and correctly counts as an arrival.
- **Section mirroring:** Rezka section 2 Window 2 must reuse the same set as the section 3 picker (`in_rezka > 0`). Build them as one hook.
- **Manual finishing:** the Moyka Yakunlash path calls `close_wash_cycle_if_settled` automatically after a receive (`OmborTayyorTab.tsx:136`). A Rezka twin should copy the same behaviour, not invent a new one.
- **Derive, don't store:** the "Rezkada" and "Rezka xom" figures must be computed from `rezka_sends` minus received pallets, not stored.
- **Append-only:** partial draw option 5b would mutate pallet meaning. Option 5a keeps it clean.
