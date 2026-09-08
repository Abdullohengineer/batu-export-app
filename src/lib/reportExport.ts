import ExcelJS from 'exceljs'
import { dateBasisLabel, WEIGHT_BASIS_LABEL, type ReportRow, type ReportFilters, type ReportTotals, type PalletStatusFilter } from './reportQuery'
import { fetchAllReportRowsForExport } from './useReportQuery'
import { REPORT_COLUMNS, type ReportColumnDef } from './reportColumns'
import { toExcelDate, EXCEL_DATE_FORMAT } from './formatDate'

// §3.2.4/§3.2.2 "Excel export on every view, respecting the active filter,
// with the date basis and weight basis printed in the header." Uses
// `exceljs` rather than the more commonly reached-for `xlsx` (SheetJS) —
// npm's published `xlsx` build carries an unpatched high-severity prototype-
// pollution/ReDoS advisory with "no fix available" on the registry (patched
// 0.20.x builds are only distributed from SheetJS's own CDN, not npm); the
// exploitable path is parsing untrusted input, which this export-only usage
// never does, but `exceljs` avoids shipping the flagged package at all. See
// DECISIONS.md "Reporting query engine" for the full tradeoff (exceljs pulls
// a transitive moderate `uuid` advisory of its own, unreached since exceljs
// never calls it with the vulnerable argument shape).
export interface ExportLookups {
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}

// Same label text ReportTableRow.tsx's 'direction' cell renders — kept as
// its own function (not re-imported from there) because that file returns
// JSX, this needs a plain string.
function directionLabel(row: ReportRow): string {
  switch (row.kind) {
    case 'kirim':
      return 'KIRIM'
    case 'chiqim_raw':
      return "CHIQIM (xom)"
    case 'chiqim_old_kn':
      return 'CHIQIM (eski KN)'
    case 'moyka_send':
      return 'MOYKAGA'
    case 'moyka_output':
      return 'MOYKADAN'
    default:
      return 'CHIQIM'
  }
}

const STATUS_LABEL: Record<Exclude<PalletStatusFilter, ''>, string> = {
  omborda: 'Omborda',
  band_qilingan: 'Band qilingan',
  jonatilgan: "Jo'natilgan",
  bekor_qilingan: 'Bekor qilingan',
  ishlatilgan: 'Ishlatilgan',
}

// Same text ReportTableRow.tsx's 'status' cell renders on screen (that file's
// version returns styled JSX; this is the plain-text equivalent) — kept in
// sync by hand since the two render from the same row shape but to
// different targets. Any change to the on-screen status logic should be
// mirrored here.
function statusText(row: ReportRow): string {
  if (row.kind === 'kirim') {
    if (row.provisionalVarianceFlag) return 'Diqqat: tarozi farqi'
    if (!row.provisional && row.truckVarianceDiffKg !== null && Math.abs(row.truckVarianceDiffKg) > 0) {
      return `${row.truckVarianceDiffKg >= 0 ? '+' : ''}${row.truckVarianceDiffKg.toLocaleString()} kg farq`
    }
    return ''
  }
  if (row.kind === 'chiqim_raw') return 'Xom'
  if (row.kind === 'chiqim_old_kn') return 'Eski KN'
  if (row.kind === 'moyka_send') return 'Moykaga'
  // Per-serial aggregate row (2026-09-03) — no single pallet status applies.
  if (row.kind === 'moyka_output') return ''
  if (row.palletStatus === 'bekor_qilingan') return 'Bekor qilingan'
  if (row.palletStatus !== 'jonatilgan') return STATUS_LABEL[row.palletStatus]
  if (row.labVerdict === 'qayta_yuvish') return 'Qayta yuvish'
  if (row.labVerdict === 'o_tdi') return "O'tdi"
  return 'Tekshirilmagan'
}

// The one place a column key maps to a row's actual value for THIS row —
// mirrors ReportTableRow.tsx's cellContent switch (same column keys, same
// blank-vs-zero rules) but returns a plain Excel-cell value instead of JSX.
// Driven by REPORT_COLUMNS' own key set so a column added to the picker
// needs a branch here to actually export, the same way it needs one in
// ReportTableRow.tsx to actually render on screen — there is no way for a
// column to silently stay picker-only forever, but there also isn't a way
// to share the two switches directly (one returns JSX, this returns values).
function columnValue(row: ReportRow, key: string, lookups: ExportLookups): string | number | Date {
  const qty = row.kind === 'kirim' ? row.effectiveQtyKg : row.weightKg
  const declared = row.kind === 'kirim' ? row.declaredQty : null
  const hisobiy = row.kind === 'kirim' ? row.hisobiyKg : null
  const moisture = row.kind === 'kirim' ? row.kirimMoisturePct : row.kind === 'chiqim' || row.kind === 'moyka_output' ? row.moisturePct : null
  const so2 = row.kind === 'kirim' ? row.kirimSo2MgKg : row.kind === 'chiqim' || row.kind === 'moyka_output' ? row.so2MgKg : null

  switch (key) {
    case 'direction':
      return directionLabel(row)
    case 'date':
      return row.dateBasis ? toExcelDate(row.dateBasis) : ''
    case 'serial':
      return row.kind === 'chiqim_old_kn' ? '' : row.serial
    case 'owner':
      return lookups.ownerName(row.ownerId)
    case 'type':
      return lookups.typeName(row.typeId)
    // moyka_output rows are a per-serial aggregate (2026-09-03) — no single
    // calibre/barcode2 applies any more, see reportQuery.ts's
    // MoykaOutputReportRow comment.
    case 'calibre':
      return row.kind === 'chiqim' ? lookups.calibreLabel(row.calibreId) : ''
    case 'barcode2':
      return row.kind === 'chiqim' ? row.barcode2 : ''
    case 'netto':
      return row.kind === 'kirim' && row.provisional ? 'tarozi kutilmoqda' : qty
    case 'declared':
      return declared ?? ''
    case 'hisobiy':
      return hisobiy ?? ''
    case 'tara':
      return row.boxMassKg ?? ''
    case 'plate':
      return row.plate ?? ''
    case 'driver':
      return row.driver ?? ''
    case 'moisture':
      return moisture ?? ''
    case 'so2':
      return so2 ?? ''
    case 'status':
      return statusText(row)
    case 'qabul_qilingan':
      return row.state?.qabulQilingan ?? ''
    case 'omborda_qoldi':
      return row.state?.ombordaQoldi ?? ''
    case 'moykaga_yuborilgan':
      return row.state?.moykagaYuborilgan ?? ''
    case 'moykada':
      return row.state?.moykada ?? ''
    case 'moykadan_chiqgan':
      return row.state?.moykadanChiqgan ?? ''
    case 'xom_jonatilgan':
      return row.state?.xomJonatilgan ?? ''
    case 'olib_ketilgan':
      return row.state?.olibKetilgan ?? ''
    // Exported as a raw signed number, not formatLossKg's display string —
    // every other kg column in this file exports numerically so the cell
    // stays summable in Excel. `?? ''` covers both nulls (no serial, and a
    // serial whose loss is not booked yet), same as every sibling.
    case 'yoqotish':
      return row.state?.yoqotish ?? ''
    case 'k1':
      return row.state?.k1 ?? ''
    case 'k2':
      return row.state?.k2 ?? ''
    case 'k3':
      return row.state?.k3 ?? ''
    case 'k4':
      return row.state?.k4 ?? ''
    case 'k5':
      return row.state?.k5 ?? ''
    case 'k6':
      return row.state?.k6 ?? ''
    case 'k7':
      return row.state?.k7 ?? ''
    case 'k8':
      return row.state?.k8 ?? ''
    case 'kn':
      return row.state?.kn ?? ''
    default:
      return ''
  }
}

export async function buildReportWorkbook(
  rows: ReportRow[],
  filters: ReportFilters,
  lookups: ExportLookups,
  totals: ReportTotals,
  visibleColumnKeys: Set<string>,
): Promise<ExcelJS.Workbook> {
  const columns: ReportColumnDef[] = REPORT_COLUMNS.filter((c) => visibleColumnKeys.has(c.key))
  const dateColIndex = columns.findIndex((c) => c.key === 'date') // 0-based; +1 for exceljs' 1-based cells

  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Hisobot')

  sheet.addRow(['BATU EXPORT — Hisobot']).font = { bold: true }
  sheet.addRow([dateBasisLabel(filters.directions)])
  sheet.addRow([WEIGHT_BASIS_LABEL])
  sheet.addRow([`Davr: ${filters.from} — ${filters.to}`])
  sheet.addRow([])

  const headerRow = sheet.addRow(columns.map((c) => c.label))
  headerRow.font = { bold: true }

  for (const row of rows) {
    const excelRow = sheet.addRow(columns.map((c) => columnValue(row, c.key, lookups)))
    if (dateColIndex >= 0) excelRow.getCell(dateColIndex + 1).numFmt = EXCEL_DATE_FORMAT
  }

  sheet.addRow([])
  sheet.addRow(['Jami kirim (kg)', totals.kgIn])
  sheet.addRow(['Jami chiqim (kg)', totals.kgOut])
  sheet.addRow(['Neto (kg)', totals.net])
  sheet.addRow(['Jami tara — kirim (kg)', totals.taraIn])
  sheet.addRow(['Jami tara — chiqim (kg)', totals.taraOut])

  sheet.columns.forEach((col) => {
    col.width = 18
  })

  return wb
}

// §ex requirement: export always covers the full filtered set, never just
// the visible page — fetches it fresh (chunked, see fetchAllReportRowsForExport)
// rather than reusing whatever page happens to be in memory. `totals` comes
// from the caller's own already-current report_totals result (HisobotTab's
// live state at the moment Export is clicked) rather than being recomputed
// here — one source of truth, no risk of the two ever disagreeing.
//
// `visibleColumnKeys` (2026-08-22 fix) — the export used to emit a fixed,
// hardcoded 11-column layout regardless of the on-screen column picker
// ("Ustunlar"), so a column added there (e.g. Namlik, Qabul qilingan) never
// reached the file. Now it's the exact same set, in the exact same order,
// as REPORT_COLUMNS.filter(visibleColumnKeys) already renders on screen —
// "what I see is what I export."
export async function downloadReportExcel(
  filters: ReportFilters,
  lookups: ExportLookups,
  totals: ReportTotals,
  visibleColumnKeys: Set<string>,
): Promise<void> {
  const rows = await fetchAllReportRowsForExport(filters)
  const wb = await buildReportWorkbook(rows, filters, lookups, totals, visibleColumnKeys)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hisobot-${filters.from}-${filters.to}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
