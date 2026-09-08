## 2026-08-03 — Opening stock data correction (Qand → Qand Qizil) + Stage 3 test-pollution revert

**Context.** Two problems on the same 1,040 kg of old-washed K6 stock, surfaced together and fixed in one migration because the second explains why the first was found. `supabase/migrations/0059_revert_rewash_test_and_fix_qandqizil_attribution.sql`, plus a correction to the seed itself (`0048_opening_stock_stage1_seed.sql`, lines 758-763 and 781-788).

**Problem 1 — the user's own transcription error, owned and reported by them.** 1,040 kg of K6 old-washed stock was seeded as "Qand" from a misread of the original spreadsheet screenshot; it belongs to "Qand Qizil". Corrected attribution: Qand carries only its 50 kg K8 line (nothing else); Qand Qizil carries 1,040 kg K6 + 180 kg K8 = 1,220 kg. Total opening stock (52,210 kg / 79 pallets) is unchanged — this is a reattribution between two types, not a quantity change.

**Problem 2 — this agent's error.** The Stage 3 live-verification test (logged in the 2026-08-02 Stage 3 entry) re-washed two *real* seeded pallets (`PLT-020826-037-06-1/-2`, minted into serial `020826-040`) instead of purpose-seeded disposable fixtures. Owned at the time: *"Consuming real seeded stock in that test was my error. You'd said 'hand-verify on real data,' and I chose the smallest real pallets rather than seeding disposable ones. That was the wrong reading — destructive, irreversible-by-design operations need their own fixtures regardless of how the verification is framed."* Those two pallets turned out to be exactly the misattributed K6 stock, which is why both problems are fixed in one migration: reverting first, then reattributing, would have left a moment where the reverted pallets still carried the wrong product type.

**Why `type_id` alone was insufficient.** There are two different type columns read by different consumer sets: `finished_pallets.type_id` (stock_on_hand_rows, report_chiqim_rows, useAvailableFinishedStock, ChiqimForm pickers) and the parent serial's `kirim_lines.type_id` (yield_rows, get_client_report `client_lines`, the passport's Buyurtma section). Patching only the pallet would have left the parent serial's `declared_qty`, passport, and client-report attribution still reading "Qand". Fix: move the pallets onto the Qand Qizil serial (`020826-038`) entirely, with `declared_qty` corrected on both affected serials (Qand → 50, Qand Qizil → 1,220).

**Why reissue `barcode2` instead of updating it in place.** `barcode2` encodes the parent serial (`PLT-<serial>-<calibre>-<seq>`), so moving product between serials means a new code, not an edit — reissuing an already-printed label would silently invalidate it. Safe here specifically because old-washed pallets are never physically labelled at seed time (Stage 2's print-per-row/print-all exists precisely because of that). Confirmed with the user before running: *"No labels have been printed from old stock — proceed with the barcode reissue as planned."*

**The migration, in order:**
- Part A reverts the Stage 3 test chain for serial `020826-040` in FK-safe order: notes → lab_results → finished_pallets → moyka_sends → wash_cycles → serial_mint_sources → kirim_orders → kirim_lines. Fully restores the pre-mint state.
- Part B deletes the two misattributed pallets and reinserts them as `PLT-020826-038-06-1` (720 kg) / `-06-2` (320 kg) on the Qand Qizil serial, `in_stock`, `is_old_stock=true` — then corrects both serials' `declared_qty`.

**Verification — live, post-migration, all five stated outcomes:**

| Check | Result |
|---|---|
| Old-washed total | 52,210 kg / 79 pallets ✓ |
| Qand Qizil | 1,220 kg ✓ |
| Qand | 50 kg ✓ |
| `internal_reprocess` orders remaining | 0 ✓ |
| `serial_mint_sources` rows remaining | 0 ✓ |
| `finished_pallets.status='consumed'` remaining | 0 ✓ |
| Leftover `020826-040` pallets | 0 ✓ |
| Global Export client report (closed period, 2025-01-01→2026-08-01) | `finished.closingKg` 52,210, `producedKg` 52,210, `processedKg` 0, `dispatches` [], `reconciliation.balancesKg` 0 — no trace of the phantom 890 kg output or 90 kg loss |
| Same report, current period (→2026-08-03) | identical: 52,210 / 52,210 / 0 / [] / 0 |

**Seed script corrected too** (`0048`, Part C) so a future reseed produces the right attribution rather than repeating the error: the `qand`/`qandqizil` branches in both the `declared_qty` case expression (lines ~758-763) and the old-washed-pallet-generation `values` list (lines ~781-788) now assign the 1,040 kg K6 line to `qandqizil` instead of `qand`.

**🚩 New standing rule, added to `CLAUDE.md`'s Testing workflow section:** live/destructive verification — hand-verification included, not just automated Playwright tests — must never consume, void, or dispatch real seeded stock. Must use `TEST-`-prefixed fixtures or purpose-seeded disposable pallets removed afterward, regardless of whether the task instruction says "verify on real data." Reversible operations (e.g. a voidable CHIQIM test request) remain fine against real data; the rule is specifically for irreversible/destructive ones.

**Verification.** `npm run build` clean, unit suite green, Playwright run once. See the run's own report for exact counts.

**Out of scope:** the raw-side as-of-date defect (queued as the next task), old-KN dispatch reporting, Rezka.
