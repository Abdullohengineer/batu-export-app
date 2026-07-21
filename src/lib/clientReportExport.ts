import ExcelJS from 'exceljs'
import type { ClientReport } from './clientReport'
import { CLIENT_REPORT_LABELS, type ReportLocale } from './clientReportLabels'

// §3.2.7 requirement E: Excel output (no PDF -- no such dependency exists
// in this codebase; this sheet is designed to print directly). Same
// `exceljs` choice §3.2.4's export already made (DECISIONS.md "Reporting
// query engine" -- xlsx/SheetJS carries an unpatched advisory).
//
// Unlike the UI's collapsed-by-default detail (requirement C), the Excel
// export always includes dispatch trip detail -- a printed document has no
// "click to expand," so collapsed-but-reachable becomes "printed in full."
export interface ClientReportLookups {
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}

export async function buildClientReportWorkbook(
  report: ClientReport,
  locale: ReportLocale,
  lookups: ClientReportLookups,
): Promise<ExcelJS.Workbook> {
  const t = CLIENT_REPORT_LABELS[locale]
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet(t.title)

  sheet.addRow([`BATU EXPORT — ${t.title}`]).font = { bold: true, size: 14 }
  sheet.addRow([report.owner.name]).font = { bold: true }
  sheet.addRow([`${t.period}: ${report.period.from} — ${report.period.to}`])
  sheet.addRow([t.weightBasis])
  sheet.addRow([t.dateBasisRaw])
  sheet.addRow([t.dateBasisFinished])
  sheet.addRow([])

  // ---- RAW ----
  sheet.addRow([t.rawSection]).font = { bold: true, size: 12 }
  sheet.addRow([t.openingBalance, report.raw.openingKg])
  sheet.addRow([`+ ${t.received}`, report.raw.receivedKg])
  sheet.addRow([`- ${t.processed}`, report.raw.processedKg])
  sheet.addRow(['    ' + t.calibreOutput, report.raw.processedBreakdown.calibreKg])
  sheet.addRow(['    ' + t.konditirskiy, report.raw.processedBreakdown.konditirskiyKg])
  sheet.addRow(['    ' + t.processLoss, report.raw.processedBreakdown.lossKg, `${report.raw.processedBreakdown.lossPct}%`])
  const closingRawRow = sheet.addRow([`= ${t.closingBalance}`, report.raw.closingKg])
  closingRawRow.font = { bold: true }

  if (report.raw.processedOverageKg > 0) {
    sheet.addRow([])
    const warnRow = sheet.addRow([t.overageWarning, report.raw.processedOverageKg])
    warnRow.font = { bold: true, color: { argb: 'FFCC0000' } }
    for (const cs of report.raw.cappedSerials) {
      sheet.addRow(['  ' + cs.serial, cs.actualSentKg, cs.effectiveQtyKg, cs.overageKg])
    }
  }

  if (report.raw.crossPeriodRewash.length > 0) {
    sheet.addRow([])
    sheet.addRow([t.crossPeriodNote]).font = { italic: true }
    sheet.addRow([t.seriya, t.cycle, 'Tugagan / Завершён', 'Xom ashyo / Сырьё', t.weight, t.calibreOutput, t.konditirskiy, t.processLoss])
    for (const cp of report.raw.crossPeriodRewash) {
      sheet.addRow([cp.serial, cp.cycleNo, cp.completedDate, cp.rawConsumedDate, cp.sentKg, cp.calibreKg, cp.konditirskiyKg, `${cp.lossKg} (${cp.lossPct}%)`])
    }
  }

  if (report.raw.byType.length > 0) {
    sheet.addRow([])
    sheet.addRow([t.byType]).font = { bold: true }
    sheet.addRow([t.turi, t.openingBalance, t.received, t.processed, t.closingBalance]).font = { bold: true }
    for (const bt of report.raw.byType) {
      sheet.addRow([lookups.typeName(bt.typeId), bt.openingKg, bt.receivedKg, bt.processedKg, bt.closingKg])
    }
  }
  sheet.addRow([])

  // ---- FINISHED ----
  sheet.addRow([t.finishedSection]).font = { bold: true, size: 12 }
  sheet.addRow([t.openingBalance, report.finished.openingKg])
  sheet.addRow([`+ ${t.produced}`, report.finished.producedKg])
  sheet.addRow([`- ${t.departed}`, report.finished.dispatchedKg])
  const closingFinRow = sheet.addRow([`= ${t.closingBalanceHeld}`, report.finished.closingKg])
  closingFinRow.font = { bold: true }
  sheet.addRow([])
  sheet.addRow([t.byCalibre]).font = { bold: true }
  sheet.addRow([t.kalibr, t.openingBalance, t.produced, t.departed, t.closingBalance]).font = { bold: true }
  for (const bc of report.finished.byCalibre) {
    sheet.addRow([lookups.calibreLabel(bc.calibreId), bc.openingKg, bc.producedKg, bc.dispatchedKg, bc.closingKg])
  }
  sheet.addRow([])

  // ---- Section B: quality record ----
  sheet.addRow([t.qualityRecord]).font = { bold: true, size: 12 }
  sheet.addRow([
    t.seriya,
    t.turi,
    'Kelgan sana / Дата прибытия',
    `${t.intake} ${t.moisture}`,
    `${t.intake} ${t.so2}`,
    `${t.delivered} ${t.moisture}`,
    `${t.delivered} ${t.so2}`,
    t.verdict,
    t.cycle,
    t.target,
  ]).font = { bold: true }
  for (const qr of report.qualityRecord) {
    const targetText = qr.targetSo2MgKg === null && qr.targetMoisturePct === null ? t.naturalNoTarget : `${qr.targetMoisturePct ?? '—'}% / ${qr.targetSo2MgKg === null ? t.naturalNoTarget : qr.targetSo2MgKg + 'mg/kg'}`
    sheet.addRow([
      qr.serial,
      lookups.typeName(qr.typeId),
      qr.arrivalDate,
      qr.intakeLab?.moisturePct ?? '',
      qr.intakeLab?.so2MgKg ?? (qr.targetSo2MgKg === null ? t.naturalNoTarget : ''),
      qr.deliveredLab?.moisturePct ?? '',
      qr.deliveredLab?.so2MgKg ?? (qr.deliveredLab && qr.targetSo2MgKg === null ? t.naturalNoTarget : ''),
      qr.deliveredLab ? (qr.deliveredLab.verdict === 'o_tdi' ? t.verdictPassed : t.verdictRewash) : t.untested,
      qr.deliveredLab?.cycleNo ?? '',
      targetText,
    ])
  }
  sheet.addRow([])

  // ---- Collapsed-in-UI detail, printed in full here: dispatch trips ----
  sheet.addRow([t.dispatches]).font = { bold: true, size: 12 }
  for (const d of report.dispatches) {
    sheet.addRow([d.plate, d.driver, d.requestDate, d.departedAt ?? '']).font = { bold: true }
    sheet.addRow(['', 'Barcode #2', t.kalibr, t.weight])
    for (const p of d.pallets) {
      sheet.addRow(['', p.barcode2, lookups.calibreLabel(p.calibreId), p.weightKg])
    }
  }

  sheet.columns.forEach((col) => {
    col.width = 20
  })

  return wb
}

export async function downloadClientReportExcel(report: ClientReport, locale: ReportLocale, lookups: ClientReportLookups): Promise<void> {
  const wb = await buildClientReportWorkbook(report, locale, lookups)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = report.owner.name.replace(/\s+/g, '-')
  a.download = `mijoz-hisoboti-${safeName}-${report.period.from}-${report.period.to}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
