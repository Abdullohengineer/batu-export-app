// §3.2.1-3.2.4 (SPEC.md v1.10 revision, applied this step) — pure report-
// engine logic, dependency-free (mirrors weightAuthority.ts/rewash.ts's own
// split: this file holds shape + pure rules, useReportQuery.ts is the I/O +
// combination layer around it).
//
// Row model (decided during inspection, not stated literally in the source
// revision — see DECISIONS.md "Reporting query engine" for the full
// reasoning): a KIRIM row is one `kirim_lines` entry (one Barcode #1/serial),
// matching "an arrival line" in the spec text exactly. A CHIQIM row is one
// `finished_pallets` entry (one Barcode #2) — NOT one whole chiqim_request —
// because Barcode #2, wash cycle, and kalibr are all listed as independent
// filter dimensions (§3.2.2) and only make sense at pallet granularity; a
// request-level row would leave those filters ambiguous (which pallet on the
// truck do you mean?). This mirrors KIRIM's own row being at serial (not
// truck) granularity for the identical reason.

export type ReportDirection = 'kirim' | 'chiqim' | 'both'

// The four states named verbatim in §3.2.2. "omborda"/"band_qilingan" have no
// governing event yet (no arrival or dispatch date to filter on) — they
// exist as filter values so a future "stock on hand" saved view (§3.2.6, out
// of scope this prompt) can reuse this same engine, and so a status search
// can surface a pallet that never became a dispatch event. In THIS results
// table (events only, §3.2.4), selecting one of those two returns whatever
// still matches after all other filters — typically nothing, since a
// non-dispatched pallet has no dispatch date to anchor a CHIQIM-direction
// date-range filter on. That's expected, not a bug — see DECISIONS.md.
export type PalletStatusFilter = '' | 'omborda' | 'band_qilingan' | 'jonatilgan' | 'bekor_qilingan'

export type LabVerdictFilter = '' | 'o_tdi' | 'qayta_yuvish' | 'tekshirilmagan'

export type WashCycleFilter = '' | '1' | '2+'

export interface ReportFilters {
  direction: ReportDirection
  from: string // YYYY-MM-DD, inclusive
  to: string // YYYY-MM-DD, inclusive
  ownerId: string // '' = all
  typeId: string // '' = all
  calibreId: string // '' = all — KIRIM rows never match (raw isn't graded, §3.1)
  serial: string // Barcode #1, substring match
  barcode2: string // Barcode #2, substring match (KIRIM rows never match)
  plate: string // substring match
  driver: string // substring match
  washCycle: WashCycleFilter // '' = any — KIRIM rows never match (always cycle 1, raw)
  labVerdict: LabVerdictFilter
  status: PalletStatusFilter // CHIQIM/pallet rows only
}

export function defaultReportFilters(from: string, to: string): ReportFilters {
  return {
    direction: 'both',
    from,
    to,
    ownerId: '',
    typeId: '',
    calibreId: '',
    serial: '',
    barcode2: '',
    plate: '',
    driver: '',
    washCycle: '',
    labVerdict: '',
    status: '',
  }
}

export type DateBasisSource = 'gate_stage1' | 'order_date' | 'gate_stage2' | null

export interface KirimReportRow {
  kind: 'kirim'
  key: string // serial — stable row key
  serial: string
  orderId: string
  typeId: string
  ownerId: string
  plate: string
  driver: string
  dateBasis: string | null // §3.2.3: arrival date — gate stage 1, else order_date
  dateBasisSource: DateBasisSource
  declaredQty: number
  effectiveQtyKg: number
  provisional: boolean
  truckVarianceDiffKg: number | null
  truckVarianceDiffPct: number | null
  provisionalVarianceFlag: boolean
  targetMoisturePct: number | null
  targetSo2MgKg: number | null
  kirimMoisturePct: number | null // lab_results scope=kirim, descriptive only, no verdict (§5.5.2)
  kirimSo2MgKg: number | null
}

export interface ChiqimReportRow {
  kind: 'chiqim'
  key: string // barcode2 — stable row key
  barcode2: string
  serial: string // parent serial
  typeId: string
  calibreId: string
  ownerId: string
  requestId: string
  plate: string
  driver: string
  weightKg: number
  washCycle: number
  palletStatus: Exclude<PalletStatusFilter, ''>
  dateBasis: string | null // §3.2.3: dispatch date (gate stage 2 completed_at) — null unless actually dispatched
  labVerdict: 'o_tdi' | 'qayta_yuvish' | null // null = tekshirilmagan (untested)
  targetMoisturePct: number | null
  targetSo2MgKg: number | null
  moisturePct: number | null
  so2MgKg: number | null
  voidInfo: VoidedBarcodeInfo | null // populated only when palletStatus === 'bekor_qilingan'
}

export type ReportRow = KirimReportRow | ChiqimReportRow

// §3.2.2 🔒 "a voided Barcode #2 must remain findable" — a voided pallet's
// cycle was, by construction, the ACTIVE cycle at the moment it was voided
// (only the active cycle can ever be re-washed — see activeCycles.ts), so
// its successor is always exactly `voidedCycle + 1`, never ambiguous about
// WHICH later cycle to look at. What IS genuinely plural: that successor
// cycle can produce more than one new pallet (the daily receipt form is
// "one pallet per save", §5.3) or, if the re-wash send hasn't been received
// back into Moyka output yet, zero. successorBarcodes lists whatever exists;
// the caller renders "yangi barkod" for exactly one, "yangi barkodlar" for
// several, and a "hali chiqarilmagan" note for zero — see DECISIONS.md.
export interface VoidedBarcodeInfo {
  voidedCycle: number
  successorCycle: number
  successorBarcodes: string[]
}

export interface ReportTotals {
  kgIn: number
  kgOut: number
  net: number
}

export function computeTotals(rows: ReportRow[]): ReportTotals {
  let kgIn = 0
  let kgOut = 0
  for (const row of rows) {
    if (row.kind === 'kirim') kgIn += row.effectiveQtyKg
    else kgOut += row.weightKg
  }
  return { kgIn, kgOut, net: kgIn - kgOut }
}

export function matchesText(haystack: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (haystack ?? '').toLowerCase().includes(q)
}

// 🔒 TEST- fixture exclusion (2026-07-20, see DECISIONS.md "Reporting
// engine cleanup"). Same precedent `useFinishedChiqimRequests.ts` already
// established: filtered out unconditionally, not exposed as a toggle — no
// screen in this app has ever built a "show test data" switch, and there's
// no other run-time signal that distinguishes a real record from a test
// fixture. Applied once here so every row-construction path in the shared
// query layer (KIRIM and CHIQIM alike) excludes fixtures the same way,
// rather than each view re-deciding it. A CHIQIM row can be excluded by
// EITHER its own dispatch's plate (if claimed) OR its parent serial's
// originating KIRIM plate (if the pallet itself was born from a TEST-
// intake, dispatched or not) — a request-only check would miss every
// still-in-storage or voided test pallet, which have no dispatch plate of
// their own to catch.
export function isTestPlate(plate: string | null | undefined): boolean {
  return (plate ?? '').startsWith('TEST-')
}

// §3.2.3 🔒 date basis label, shown on screen and in exports — printed
// exactly once per direction selection, never silently varying per row.
export function dateBasisLabel(direction: ReportDirection): string {
  if (direction === 'kirim') return 'Sana asosi: kelish (darvoza 1-bosqich / buyurtma sanasi)'
  if (direction === 'chiqim') return "Sana asosi: jo'natish (darvoza 2-bosqich)"
  return "Sana asosi: har bir qator o'zining hodisasi bo'yicha (kirim — kelish, chiqim — jo'natish)"
}

export const WEIGHT_BASIS_LABEL = "Og'irlik asosi: effective_qty (darvoza netto / oraliq qiymat, §2.16)"

export function washCycleMatches(cycleNo: number, filter: WashCycleFilter): boolean {
  if (filter === '') return true
  if (filter === '1') return cycleNo === 1
  return cycleNo >= 2
}

export function labVerdictMatches(verdict: 'o_tdi' | 'qayta_yuvish' | null, filter: LabVerdictFilter): boolean {
  if (filter === '') return true
  if (filter === 'tekshirilmagan') return verdict === null
  return verdict === filter
}

// A CHIQIM row without a governing dispatch event (band_qilingan/omborda/
// bekor_qilingan — see PalletStatusFilter's own doc) has no date to range-
// filter on. Default behaviour (no explicit status filter) excludes such a
// row from the events table entirely — the default view stays a clean
// history. Choosing that exact status explicitly overrides the date filter
// for rows of that status only, since there's nothing meaningful to range
// them against. A row that DOES have a date is always date-filtered,
// regardless of the status filter.
export function passesDateOrStatusOverride(
  dateBasis: string | null,
  palletStatus: Exclude<PalletStatusFilter, ''>,
  filters: Pick<ReportFilters, 'from' | 'to' | 'status'>,
): boolean {
  if (dateBasis !== null) return dateBasis >= filters.from && dateBasis <= filters.to
  return filters.status !== '' && filters.status === palletStatus
}

// Derives the four named pallet states (§3.2.2) from what's actually
// stored — `finished_pallets.status='dispatched'` is dead code (confirmed
// via useAvailableFinishedStock.ts: nothing in this app ever writes it), so
// "jo'natilgan" is really "claimed AND that dispatch's gate stage 2 is
// complete", not a stored enum value.
export function derivePalletStatus(input: {
  rawStatus: 'in_stock' | 'dispatched' | 'bekor_qilindi'
  claimed: boolean
  dispatchGateCompletedAt: string | null
}): Exclude<PalletStatusFilter, ''> {
  if (input.rawStatus === 'bekor_qilindi') return 'bekor_qilingan'
  if (input.claimed) return input.dispatchGateCompletedAt !== null ? 'jonatilgan' : 'band_qilingan'
  return 'omborda'
}
