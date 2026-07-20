// §3.2.1-3.2.4 (SPEC.md v1.10 revision) — report-engine shapes + the pure
// DB-row-to-app-row mapping. Filtering, pagination, and totals now live in
// Postgres (report_kirim_rows/report_chiqim_rows/report_rows views +
// report_filtered_rows/report_query_page/report_totals functions — see
// DECISIONS.md "Reporting engine: server-side query" and
// supabase/migrations/*_report_server_side_query.sql) — this file no longer
// filters anything client-side. What's left: the row shapes every UI
// component still renders (unchanged), and mapDbRowToReportRow, the one
// remaining pure function, translating the flat SQL row shape back into the
// KirimReportRow/ChiqimReportRow discriminated union those components
// already expect.
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

// §3.2.3 🔒 date basis label, shown on screen and in exports — printed
// exactly once per direction selection, never silently varying per row.
export function dateBasisLabel(direction: ReportDirection): string {
  if (direction === 'kirim') return 'Sana asosi: kelish (darvoza 1-bosqich / buyurtma sanasi)'
  if (direction === 'chiqim') return "Sana asosi: jo'natish (darvoza 2-bosqich)"
  return "Sana asosi: har bir qator o'zining hodisasi bo'yicha (kirim — kelish, chiqim — jo'natish)"
}

export const WEIGHT_BASIS_LABEL = "Og'irlik asosi: effective_qty (darvoza netto / oraliq qiymat, §2.16)"

// The flat shape report_rows (and therefore report_query_page/
// report_chiqim_rows directly, for the voided-barcode exact-match lookup)
// actually returns over the wire. Numeric columns are wrapped in Number(...)
// defensively in the mapper below — PostgREST's `numeric` serialization
// differs between plain table reads and RPC/function results, and this
// avoids silently doing string concatenation instead of arithmetic if a
// given code path happens to come back as text.
export interface ReportDbRow {
  kind: 'kirim' | 'chiqim'
  row_key: string
  serial: string
  barcode2: string | null
  order_id: string | null
  request_id: string | null
  owner_id: string
  type_id: string
  calibre_id: string | null
  plate: string
  driver: string
  date_basis: string | null
  date_basis_source: DateBasisSource
  qty_kg: number | string
  provisional: boolean
  declared_qty: number | string | null
  truck_variance_diff_kg: number | string | null
  truck_variance_diff_pct: number | string | null
  provisional_variance_flag: boolean
  wash_cycle: number | string | null
  pallet_status: Exclude<PalletStatusFilter, ''> | null
  lab_verdict: 'o_tdi' | 'qayta_yuvish' | null
  target_moisture_pct: number | string | null
  target_so2_mg_kg: number | string | null
  moisture_pct: number | string | null
  so2_mg_kg: number | string | null
  void_successor_barcodes: string[] | null
}

function num(v: number | string | null): number | null {
  return v === null ? null : Number(v)
}

export function mapDbRowToReportRow(row: ReportDbRow): ReportRow {
  if (row.kind === 'kirim') {
    return {
      kind: 'kirim',
      key: row.row_key,
      serial: row.serial,
      orderId: row.order_id ?? '',
      typeId: row.type_id,
      ownerId: row.owner_id,
      plate: row.plate,
      driver: row.driver,
      dateBasis: row.date_basis,
      dateBasisSource: row.date_basis_source,
      declaredQty: num(row.declared_qty) ?? 0,
      effectiveQtyKg: Number(row.qty_kg),
      provisional: row.provisional,
      truckVarianceDiffKg: num(row.truck_variance_diff_kg),
      truckVarianceDiffPct: num(row.truck_variance_diff_pct),
      provisionalVarianceFlag: row.provisional_variance_flag,
      targetMoisturePct: num(row.target_moisture_pct),
      targetSo2MgKg: num(row.target_so2_mg_kg),
      kirimMoisturePct: num(row.moisture_pct),
      kirimSo2MgKg: num(row.so2_mg_kg),
    }
  }

  const washCycle = num(row.wash_cycle) ?? 1
  const palletStatus = row.pallet_status ?? 'omborda'
  const voidInfo: VoidedBarcodeInfo | null =
    palletStatus === 'bekor_qilingan'
      ? { voidedCycle: washCycle, successorCycle: washCycle + 1, successorBarcodes: row.void_successor_barcodes ?? [] }
      : null

  return {
    kind: 'chiqim',
    key: row.row_key,
    barcode2: row.barcode2 ?? '',
    serial: row.serial,
    typeId: row.type_id,
    calibreId: row.calibre_id ?? '',
    ownerId: row.owner_id,
    requestId: row.request_id ?? '',
    plate: row.plate,
    driver: row.driver,
    weightKg: Number(row.qty_kg),
    washCycle,
    palletStatus,
    dateBasis: row.date_basis,
    labVerdict: row.lab_verdict,
    targetMoisturePct: num(row.target_moisture_pct),
    targetSo2MgKg: num(row.target_so2_mg_kg),
    moisturePct: num(row.moisture_pct),
    so2MgKg: num(row.so2_mg_kg),
    voidInfo,
  }
}
