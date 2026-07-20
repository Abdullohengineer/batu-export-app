import ExcelJS from 'exceljs'
import { dateBasisLabel, WEIGHT_BASIS_LABEL, type ReportRow, type ReportFilters, type ReportTotals } from './reportQuery'
import { fetchAllReportRowsForExport } from './useReportQuery'

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

const HEADER = [
  "Yo'nalish",
  'Sana',
  'Seriya / Barcode #2',
  'Buyurtmachi',
  'Tur',
  'Kalibr',
  'Moshina',
  'Haydovchi',
  'Miqdor (kg)',
  'Holat / izoh',
]

export async function buildReportWorkbook(
  rows: ReportRow[],
  filters: ReportFilters,
  lookups: ExportLookups,
  totals: ReportTotals,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Hisobot')

  sheet.addRow(['BATU EXPORT — Hisobot']).font = { bold: true }
  sheet.addRow([dateBasisLabel(filters.direction)])
  sheet.addRow([WEIGHT_BASIS_LABEL])
  sheet.addRow([`Davr: ${filters.from} — ${filters.to}`])
  sheet.addRow([])

  const headerRow = sheet.addRow(HEADER)
  headerRow.font = { bold: true }

  for (const row of rows) {
    if (row.kind === 'kirim') {
      sheet.addRow([
        'KIRIM',
        row.dateBasis ?? '',
        row.serial,
        lookups.ownerName(row.ownerId),
        lookups.typeName(row.typeId),
        '',
        row.plate,
        row.driver,
        row.effectiveQtyKg,
        row.provisional ? 'tarozi kutilmoqda' : '',
      ])
    } else {
      const note = row.voidInfo
        ? `bekor qilindi — sikl ${row.voidInfo.voidedCycle}, yangi: ${
            row.voidInfo.successorBarcodes.length ? row.voidInfo.successorBarcodes.join(', ') : 'hali chiqarilmagan'
          }`
        : row.palletStatus !== 'jonatilgan'
          ? row.palletStatus
          : ''
      sheet.addRow([
        'CHIQIM',
        row.dateBasis ?? '',
        row.barcode2,
        lookups.ownerName(row.ownerId),
        lookups.typeName(row.typeId),
        lookups.calibreLabel(row.calibreId),
        row.plate,
        row.driver,
        row.weightKg,
        note,
      ])
    }
  }

  sheet.addRow([])
  sheet.addRow(['Jami kirim (kg)', totals.kgIn])
  sheet.addRow(['Jami chiqim (kg)', totals.kgOut])
  sheet.addRow(['Neto (kg)', totals.net])

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
export async function downloadReportExcel(filters: ReportFilters, lookups: ExportLookups, totals: ReportTotals): Promise<void> {
  const rows = await fetchAllReportRowsForExport(filters)
  const wb = await buildReportWorkbook(rows, filters, lookups, totals)
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
