## 2026-08-29 — Lab CHIQIM inline readings, loss sign convention, Hisobot output-by-kalibr columns

Three bundled display-layer changes (SPEC.md §2.18 NEW, §5.5.3, §3.2.4). No schema change, no new
balance calculation anywhere — display and one new per-serial-per-calibre breakdown reusing an
existing read pattern.

**Two wrong premises in the task's own read list, surfaced before coding, same pattern as Prompt
5's own wrong premises:**

1. The task's read list named `computeSignedLossPct`/`computeFinalLossPct` as TS-side functions to
   read. Neither exists anywhere in `src/` — confirmed via `tayyorCompletion.ts`'s own explicit
   header comment: "Tugallash and its locked final_loss_pct are removed (see DECISIONS.md 'Moyka
   loss becomes live'): loss is now computed live, signed, and unconditionally in SQL
   (`client_serial_loss_kg`/`yield_rows.loss_kg`/`get_serial_passport`'s `cycles[].lossKg`) —
   there is no TS-side equivalent any more." Immaterial to the actual work (the task only asked to
   *read* these as context, not extend them), but recorded since it's the second time this specific
   stale premise has appeared in a task brief this project.
2. The "before coding" section's own literal formula for the kalibr columns —
   `sum(finished_pallets.qty) − sum(chiqim_pallet_consumption.qty_kg)` — computes the **live
   available balance** (identical to `finished_pallet_availability`), not what the "Requirements"
   section two paragraphs later explicitly asks for: "total ever produced under that kalibr for
   that serial (available + already-dispatched) ... the full production picture, not just what's
   currently sitting in stock." These are genuinely different numbers for any serial with active
   consumption. Resolved by arithmetic, not guesswork, per CLAUDE.md's "stop, report, do not invent
   a design": `available + already-dispatched = (produced − consumed) + consumed = produced =
   sum(finished_pallets.weight_kg)` — the Requirements text's own formula collapses to plain gross
   production once "already-dispatched" is read as **all** consumption ever recorded (gate-completed
   or still in transit), not just gate-completed departures. Went with gross production — it's also
   exactly `kirim_line_state`'s own `moyka_out`/`Moykadan chiqgan` figure (0074/0088), split by
   calibre instead of totalled, so this is a pure breakdown of a number Hisobot already shows, not a
   new balance concept.

**(1) Lab CHIQIM inline KIRIM readings.** `useLaboratorChiqim.ts` gained a third parallel
`lab_results` fetch (`scope='kirim'`, `parent_serial in (...)`, same latest-wins-by-`created_at`
pattern `useLaboratorKirim.ts` already established) alongside its existing wash_cycles/moyka_sends/
CHIQIM-scope fetches — `latestKirimResultBySerial`, keyed by serial. `AwaitingSerial` and
`ChiqimLabResultRow` both gained `kirimMoisturePct`/`kirimSo2MgKg: number | null`, populated at both
row-construction sites (the awaiting-row push and the finished/sulfur-pending row build), defaulting
to `null` — never `0` — when no KIRIM reading exists (the `internal_reprocess`-origin old-stock
re-wash mint case the task itself names, which never passes through KIRIM Tahlil by construction).
`LaboratorChiqimTab.tsx` gained one shared `KirimReadingLine` component, rendered on: Window 1's
card (directly under the existing "sentKg · yuborilgan date" line — the literal "alongside the
existing serial/kg/date" the task asked for), Window 2's card, and Window 3's expanded detail panel
(not the collapsed header — every other CHIQIM-result field on a Window 3 row is already
expand-gated, so this follows the same existing convention rather than introducing a new
always-visible line on an already-decided, historical row). `ChiqimTahlilForm.tsx` and
`ChiqimTahlilEditForm.tsx` (Tahlil entry + Yakunlangan edit) both gained a "Kirim natijasi" row in
their existing Seriya/Egasi/Tur kv-summary box. Read-only throughout — no write path touches
`lab_results.scope='kirim'` from this tab, by construction (only `useLaboratorKirim.ts`'s own forms
insert those rows).

**(2) Loss sign convention.** Full audit of every loss-display site in the app before writing the
helper (same audit shape the task asked for, mirroring the earlier Rezka fix):

| Site | Field | Before | Fix |
|---|---|---|---|
| `SerialPassportModal.tsx` (per-cycle) | `cycle.lossKg` | Already correct (manual `Math.abs`+conditional `+`) | Extracted into `formatLossKg`, tone-color logic (red/amber/slate by sign) kept as its own small conditional — a color concern, not a text-format one |
| `SerialPassportModal.tsx` (`joriyHolat`) | `storageLossKg` | Plain `${v} kg`, conditional on `>0` | **Untouched** — structurally non-negative book-value write-off, a different concept, not the signed wash-process family |
| `YieldTable.tsx` | `row.lossKg`/`lossPct` | Native `-50 kg` on a surplus row | `formatLossKg`/`formatLossPct` |
| `YieldTab.tsx` | `totalLoss` (locally summed) | Same | `formatLossKg`/`formatLossPct` |
| `ClientHisobotTab.tsx` (totals + per-row) | `ubytokKg` | Local `kg()` helper (generic, non-signed) | `formatLossKg(v, 'кг')` at the two `ubytokKg` call sites only — `kg()` itself untouched, still used for every non-loss figure on the same screen |
| `ClientSerialSummaryModal.tsx` | `summary.lossKg` | Same local-`kg()` pattern | `formatLossKg(v, 'кг')` |
| `RahbarHome.tsx` (Ledger B row) | `ledger.moyka.lossKg`/`lossPct` | Manual `fmt()` + bare `%` | `formatLossKg`/`formatLossPct`; `LedgerRow`'s `sign="−"` prop is a static ledger-flow-direction icon, unrelated to the value's own numeric sign — left unchanged |
| `RahbarHome.tsx` (Bar chart) | same, `pctOfLabel` | Bare `${lossPct}%` | `formatLossPct` on the label text only; the bar's own `value={Math.max(0, lossKg)}` geometry clamp is chart-rendering concern, left as-is |
| `ClientReportTab.tsx` | `processedBreakdown.lossKg`/`lossPct` | Native negative | `formatLossKg`/`formatLossPct` |
| `MenejerExceptionsTab.tsx` (`high_loss`) | `d.lossPct` (from `rahbar_exceptions`/`yield_rows.loss_pct`) | Bare `${lossPct}%` | `formatLossPct` applied for consistency, though **provably a no-op today**: `rahbar_exceptions`'s own SQL only ever surfaces this row when `loss_pct > threshold`, so the value is always positive by construction — a surplus cycle can never trigger a "high loss" exception |
| `clientReportExport.ts` / `yieldExport.ts` | Excel cells | Raw numeric cell | **Untouched, deliberate** — a spreadsheet numeric cell has its own native negative-number convention; forcing a "+"-prefixed string into it would be a different, arguably wrong, convention for that surface |

`formatLossKg(signedKg, unit = 'kg')`/`formatLossPct(signedPct)` (`src/lib/formatLoss.ts`) — one
helper, sign/prefix logic in one place. The `unit` parameter (default `'kg'`, matching the task's own
literal spec) exists because two real screens in this app (`ClientHisobotTab`/
`ClientSerialSummaryModal`, the Global Export client portal) are Russian-labelled end to end and need
`'кг'` to match every other figure on the same row — the sign convention itself is identical either
way, only the unit string differs. Unit test coverage in `src/lib/formatLoss.test.ts` (sign, zero,
rounding, custom unit).

**(3) Hisobot output-by-kalibr columns.** Live `calibres` checked before writing any SQL (not
assumed): a single category ("O'rik"), codes `01`-`08` (Kalibr 1-8), `KN` (Konditirskiy), and `RKN`
(Rezka KN, numberless) — `finished_pallets` grouped by calibre code today has rows under `01, 02, 04,
06, 08, KN` only; `RKN` has zero rows (Rezka's own KN variant has never gone through the
finished-goods pipeline this migration reads). K1-K8 + KN therefore covers 100% of live
`finished_pallets` rows today; noted in the migration's own header that `RKN` would silently fall
outside these 9 columns if it ever did produce a row — a real gap if the production process changes,
not fixed here since it doesn't exist yet.

New `kirim_line_calibre_output(p_serial)` SQL function (`supabase/migrations/0098_hisobot_output_by_
kalibr.sql`) — sibling to `kirim_line_state`, same `base_pallets` CTE and exclusion set (`status not
in ('bekor_qilindi','storage_loss')`, not consumed into a re-wash via `serial_mint_sources`), summed
`filter (where code = ...)` per calibre instead of totalled. `report_query_page`/`report_totals`
(`text[]` overloads) both needed `DROP FUNCTION` + `CREATE FUNCTION` — the same `RETURNS TABLE`
signature-change constraint discovered live during the Partiya raqami work (`CREATE OR REPLACE
FUNCTION` refuses any OUT-parameter-list change, regardless of position) — each gained a second
`LEFT JOIN LATERAL`/`CROSS JOIN LATERAL kirim_line_calibre_output(...)` alongside the existing
`kirim_line_state` one, with the 9 new columns appended at the very end (`state_k1`...`state_k8`,
`state_kn`) to match `report_query_page`'s own "new columns always land last" precedent from the
Partiya raqami migration. Only the `text[]` overloads were touched — the legacy single-`text`
overloads are confirmed dead (see the Partiya raqami entry above), same skip already made there.

Default visibility: **hidden**, matching every other serial-state volume column in this family
(`qabul_qilingan`/`omborda_qoldi`/etc., all `defaultVisible: false`) — the task's own text flagged
the "avoid overwhelming the default view" concern, and 9 more columns on top of the 8 already
default-visible would do exactly that. `reportColumns.ts` registers all 9 as `kind: 'volume',
totalBasis: 'state'` (the "volume-auto-totalled kind" the task asked for); `TotalsStrip.tsx`'s
`STATE_COLUMN_CHIPS` registry gained one chip entry per column — no per-column wiring beyond the
registry entry, matching the file's own "general rule, not per-column wiring" design. `SerialState`
(`reportQuery.ts`), `ReportDbRow`, `mapState`, `zeroState`, `ReportTotals`, and `useReportQuery.ts`'s
RPC-response mapping all extended with `k1`...`k8`/`kn` (row-level) and `stateK1`...`stateK8`/
`stateKn` (totals-level). `ReportTableRow.tsx`'s `cellContent` and `reportExport.ts`'s `columnValue`
both gained the 9 matching `case` branches — the same "no column stays picker-only forever" pattern
its own header comment already documents for every other column.

**Verified live, directly against real data (not a local sandbox):** picked a real serial with
`finished_pallets` across 3 distinct calibres (`020826-034`: K1=30, K6=11540, K8=6260, all others 0)
— `kirim_line_calibre_output('020826-034')` matched a hand-written cross-check query (same exclusion
set, computed independently) exactly. `report_query_page(...)` filtered to that serial returned the
identical `state_k1`/`state_k6`/`state_k8` on all 3 of its rows (the per-serial repeat-per-row
behaviour every other state column already has). `report_totals(...)` for the same filter returned
`state_serial_count = 1` and the identical K1/K6/K8 totals — confirming the distinct-serial dedup
(not a per-row sum) works correctly even though the serial owns 3 rows. `npx tsc -b --noEmit` clean,
`npx oxlint` clean, `npm run build` succeeds, `node --test` 60/60 (8 new: `formatLoss.test.ts`).

**Not run this session:** browser/e2e verification of the Laborator CHIQIM inline-reading UI and the
Hisobot column picker — same disclosed sandbox limitation as the Partiya raqami and CHIQIM FIFO work
earlier in this file: no `.env.test` (test-role credentials) exists here, so no real login session
can be launched. Flagged, not silently skipped. Given no new UI-only failure mode exists beyond what
`tsc`/`build` already catch (no new interaction pattern — every insertion reuses an existing card/
form/table-cell shape verbatim) and the one genuinely new computation (`kirim_line_calibre_output`)
was verified directly against live data above, this is a lower-risk gap than a typical unverified
feature, but still a real one: whoever picks this up next should manually run the task's own
Testing section (TEST- serial with/without a KIRIM reading in Laborator CHIQIM; TEST- serials with
real loss/surplus/zero across passport/Ledger B/client report/Hisobot; a client-filtered Hisobot view
with K1-K8/KN columns toggled on) against the deployed app before calling this feature UI-verified,
same as the standing recommendation left for the Partiya raqami e2e spec.

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/global-export-profile-setup-t1hl6t`.
