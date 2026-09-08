import ExcelJS from 'exceljs'
import type { ClientProductionLedger } from './clientProductionLedger'

// Производство sub-tab Excel export. One row per serial, one column per
// calibre actually present in the filtered set (a superset of the
// on-screen fixed K1/K2/K3/K4/K6/Кондитерка columns -- see
// clientProductionLedger.ts's PRODUCTION_CALIBRE_CODES comment: nothing
// produced is silently dropped from the download even if the screen
// doesn't have a column for it).
const KG_FMT = '#,##0'

export async function buildClientProductionLedgerWorkbook(
  ledger: ClientProductionLedger,
  typeName: (id: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Производство')

  const calibreCols = ledger.totals.byCalibre // already server-sorted by sort_order
  const headers = ['Серия', 'Вид сырья', 'Всего произведено (кг)', ...calibreCols.map((c) => c.label)]

  const headerRow = sheet.addRow(headers)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of ledger.rows) {
    const excelRow = sheet.addRow([
      row.serial,
      typeName(row.typeId),
      row.totalKg,
      ...calibreCols.map((c) => row.calibres.find((rc) => rc.calibreId === c.calibreId)?.kg ?? 0),
    ])
    excelRow.getCell(3).numFmt = KG_FMT
    calibreCols.forEach((_, i) => {
      excelRow.getCell(4 + i).numFmt = KG_FMT
    })
  }

  const totalRow = sheet.addRow(['ИТОГО', '', ledger.totals.totalKg, ...calibreCols.map((c) => c.kg)])
  totalRow.font = { bold: true }
  totalRow.getCell(3).numFmt = KG_FMT
  calibreCols.forEach((_, i) => {
    totalRow.getCell(4 + i).numFmt = KG_FMT
  })
  totalRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  })

  sheet.columns.forEach((col, i) => {
    col.width = i === 0 ? 14 : i === 1 ? 16 : 14
  })

  return wb
}

export async function downloadClientProductionLedgerExcel(ledger: ClientProductionLedger, typeName: (id: string) => string): Promise<void> {
  const wb = await buildClientProductionLedgerWorkbook(ledger, typeName)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `proizvodstvo-${ledger.period.from}-${ledger.period.to}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
