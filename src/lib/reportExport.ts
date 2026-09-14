import ExcelJS from 'exceljs'
import { dateBasisLabel, WEIGHT_BASIS_LABEL, type ReportRow, type ReportFilters, type ReportTotals } from './reportQuery'
import { fetchAllReportRowsForExport } from './useReportQuery'
import { fetchChiqimDispatchDetailRows, type ChiqimDispatchDetailRow } from './chiqimDispatchDetail'
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

// Optional text overrides (2026-09-08, client Приход export fix) — every
// field defaults to this file's own existing Uzbek text when omitted, so
// Hisobot's own export (HisobotTab.tsx, never passes this) is byte-for-byte
// unchanged. The client portal is the one caller that needs different text:
// it passes clientLabel()-backed values here rather than this file learning
// about clientLabels.ts directly, keeping the shared export function
// caller-agnostic about which glossary (if any) is in play.
export interface ExportTextOverrides {
  title?: string
  dateBasisText?: string
  weightBasisText?: string
  periodLabel?: (from: string, to: string) => string
  columnLabel?: (col: ReportColumnDef) => string
  directionLabel?: (row: ReportRow) => string
  statusText?: (row: ReportRow) => string
  summaryLabels?: {
    kgIn: string
    kgOut: string
    net: string
    taraIn: string
    taraOut: string
  }
}

// Same label text ReportTableRow.tsx's 'direction' cell renders — kept as
// its own function (not re-imported from there) because that file returns
// JSX, this needs a plain string.
function directionLabel(row: ReportRow): string {
  switch (row.kind) {
    case 'kirim':
      return 'KIRIM'
    case 'moyka_send':
      return 'MOYKAGA'
    case 'moyka_output':
      return 'MOYKADAN'
    default:
      return 'CHIQIM'
  }
}

// Same text ReportTableRow.tsx's 'status' cell renders on screen (that
// file's version returns styled JSX; this is the plain-text equivalent) —
// kept in sync by hand since the two render from the same row shape but to
// different targets. Any change to the on-screen status logic should be
// mirrored here. 2026-09-14: chiqim_dispatch/moyka_output both have no
// single pallet status any more (rolled-up/aggregate rows) — see
// reportQuery.ts's ChiqimDispatchReportRow/MoykaOutputReportRow comments.
function statusText(row: ReportRow): string {
  if (row.kind === 'kirim') {
    if (row.provisionalVarianceFlag) return 'Diqqat: tarozi farqi'
    if (!row.provisional && row.truckVarianceDiffKg !== null && Math.abs(row.truckVarianceDiffKg) > 0) {
      return `${row.truckVarianceDiffKg >= 0 ? '+' : ''}${row.truckVarianceDiffKg.toLocaleString()} kg farq`
    }
    return ''
  }
  if (row.kind === 'moyka_send') return 'Moykaga'
  return ''
}

// The one place a column key maps to a row's actual value for THIS row —
// mirrors ReportTableRow.tsx's cellContent switch (same column keys, same
// blank-vs-zero rules) but returns a plain Excel-cell value instead of JSX.
// Driven by REPORT_COLUMNS' own key set so a column added to the picker
// needs a branch here to actually export, the same way it needs one in
// ReportTableRow.tsx to actually render on screen — there is no way for a
// column to silently stay picker-only forever, but there also isn't a way
// to share the two switches directly (one returns JSX, this returns values).
function columnValue(row: ReportRow, key: string, lookups: ExportLookups, overrides?: ExportTextOverrides): string | number | Date {
  const qty = row.kind === 'kirim' ? row.effectiveQtyKg : row.weightKg
  const declared = row.kind === 'kirim' ? row.declaredQty : null
  const hisobiy = row.kind === 'kirim' ? row.hisobiyKg : null
  const moisture = row.kind === 'kirim' ? row.kirimMoisturePct : row.kind === 'moyka_output' ? row.moisturePct : null
  const so2 = row.kind === 'kirim' ? row.kirimSo2MgKg : row.kind === 'moyka_output' ? row.so2MgKg : null

  switch (key) {
    case 'direction':
      return overrides?.directionLabel ? overrides.directionLabel(row) : directionLabel(row)
    case 'date':
      return row.dateBasis ? toExcelDate(row.dateBasis) : ''
    case 'serial':
      return row.kind === 'chiqim_dispatch' ? '' : row.serial
    case 'owner':
      return lookups.ownerName(row.ownerId)
    case 'type':
      return row.kind === 'chiqim_dispatch' ? '' : lookups.typeName(row.typeId)
    // moyka_output (per-serial aggregate) and chiqim_dispatch (rolled-up
    // dispatch line, 2026-09-14) have no single calibre/barcode2 any more —
    // see reportQuery.ts's MoykaOutputReportRow/ChiqimDispatchReportRow.
    case 'calibre':
      return ''
    case 'barcode2':
      return ''
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
      return overrides?.statusText ? overrides.statusText(row) : statusText(row)
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
    case 'moykaga_yuborilgan_jami':
      return row.state?.moykagaYuborilganLifetime ?? ''
    case 'moykadan_chiqgan_jami':
      return row.state?.moykadanChiqganLifetime ?? ''
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
  overrides?: ExportTextOverrides,
): Promise<ExcelJS.Workbook> {
  const columns: ReportColumnDef[] = REPORT_COLUMNS.filter((c) => visibleColumnKeys.has(c.key))
  const dateColIndex = columns.findIndex((c) => c.key === 'date') // 0-based; +1 for exceljs' 1-based cells

  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Hisobot')

  sheet.addRow([overrides?.title ?? 'BATU EXPORT — Hisobot']).font = { bold: true }
  sheet.addRow([overrides?.dateBasisText ?? dateBasisLabel(filters.directions)])
  sheet.addRow([overrides?.weightBasisText ?? WEIGHT_BASIS_LABEL])
  sheet.addRow([overrides?.periodLabel ? overrides.periodLabel(filters.from, filters.to) : `Davr: ${filters.from} — ${filters.to}`])
  sheet.addRow([])

  const headerRow = sheet.addRow(columns.map((c) => (overrides?.columnLabel ? overrides.columnLabel(c) : c.label)))
  headerRow.font = { bold: true }

  for (const row of rows) {
    const excelRow = sheet.addRow(columns.map((c) => columnValue(row, c.key, lookups, overrides)))
    if (dateColIndex >= 0) excelRow.getCell(dateColIndex + 1).numFmt = EXCEL_DATE_FORMAT
  }

  const summary = overrides?.summaryLabels ?? {
    kgIn: 'Jami kirim (kg)',
    kgOut: 'Jami chiqim (kg)',
    net: 'Neto (kg)',
    taraIn: 'Jami tara — kirim (kg)',
    taraOut: 'Jami tara — chiqim (kg)',
  }
  sheet.addRow([])
  sheet.addRow([summary.kgIn, totals.kgIn])
  sheet.addRow([summary.kgOut, totals.kgOut])
  sheet.addRow([summary.net, totals.net])
  sheet.addRow([summary.taraIn, totals.taraIn])
  sheet.addRow([summary.taraOut, totals.taraOut])

  sheet.columns.forEach((col) => {
    col.width = 18
  })

  // Detail sheet, component grain (2026-09-14, see docs/decisions/0188-...
  // -chiqim-regrain-departure-date-dispatch-rollup.md) — the summary sheet
  // above is now request grain for chiqim_dispatch rows (one line per
  // dispatch); this second sheet breaks each dispatch present in the export
  // back down to its pallet/raw/old-KN components, same basis the summary
  // line's own total is summed from (not a parallel computation). Only
  // added when the export actually contains a chiqim_dispatch row — a pure
  // KIRIM/MOYKA export has nothing to detail.
  const dispatchRequestIds = rows.filter((r) => r.kind === 'chiqim_dispatch').map((r) => r.requestId)
  if (dispatchRequestIds.length > 0) {
    const detailRows = await fetchChiqimDispatchDetailRows(dispatchRequestIds)
    const detailSheet = wb.addWorksheet('Chiqim tafsilot')
    const detailHeader = detailSheet.addRow(['Sana', 'Moshina', "Yo'nalish", 'Barcode #2', 'Seriya', 'Tur', 'Kalibr', 'Kg'])
    detailHeader.font = { bold: true }
    const kindLabel: Record<ChiqimDispatchDetailRow['kind'], string> = {
      chiqim: 'Pallet',
      chiqim_raw: 'Xom',
      chiqim_old_kn: 'Eski KN',
    }
    for (const d of detailRows) {
      const detailExcelRow = detailSheet.addRow([
        d.dateBasis ? toExcelDate(d.dateBasis) : '',
        d.plate,
        kindLabel[d.kind],
        d.barcode2 ?? '',
        d.serial ?? '',
        d.typeId ? lookups.typeName(d.typeId) : '',
        d.calibreId ? lookups.calibreLabel(d.calibreId) : '',
        d.qtyKg,
      ])
      detailExcelRow.getCell(1).numFmt = EXCEL_DATE_FORMAT
    }
    detailSheet.columns.forEach((col) => {
      col.width = 16
    })
  }

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
  overrides?: ExportTextOverrides,
): Promise<void> {
  const rows = await fetchAllReportRowsForExport(filters)
  const wb = await buildReportWorkbook(rows, filters, lookups, totals, visibleColumnKeys, overrides)
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
