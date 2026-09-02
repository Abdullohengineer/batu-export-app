import ExcelJS from 'exceljs'
import type { ClientChiqimLedger } from './clientChiqimLedger'
import { CLIENT_CHIQIM_KIND_OPTIONS, chiqimKindLabel } from './clientChiqimLedger'
import { toExcelDate, EXCEL_DATE_FORMAT } from './formatDate'

// Расход sub-tab Excel export — flat one-row-per-event table, matching the
// manual CHIQIM export built for this exact client (chiqim_report_
// jul16_todate.xlsx). exceljs, same choice as clientSerialLedgerExport.ts.

const HEADERS = ['Тури', 'Дата', 'Вид сырья', 'Серия', 'Кол-во (кг)', 'По калибрам', 'Мошина №', 'Водитель']
const KG_FMT = '#,##0'

export async function buildClientChiqimLedgerWorkbook(
  ledger: ClientChiqimLedger,
  typeName: (id: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Расход')

  const headerRow = sheet.addRow(HEADERS)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of ledger.rows) {
    const calibreText = row.calibres ? row.calibres.map((c) => `${c.label}: ${Math.round(c.kg).toLocaleString()}`).join(', ') : ''
    const excelRow = sheet.addRow([
      chiqimKindLabel(row.kind), toExcelDate(row.date), typeName(row.typeId), row.serials ?? '', row.kg, calibreText, row.plate, row.driver,
    ])
    excelRow.getCell(2).numFmt = EXCEL_DATE_FORMAT
    excelRow.getCell(5).numFmt = KG_FMT
  }

  const totalRow = sheet.addRow(['ИТОГО', '', '', '', ledger.totals.totalKg, '', '', ''])
  totalRow.font = { bold: true }
  totalRow.getCell(5).numFmt = KG_FMT
  totalRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  })

  sheet.addRow([])
  const kindHdr = sheet.addRow(['Итоги по Тури'])
  kindHdr.font = { bold: true, size: 12 }
  for (const o of CLIENT_CHIQIM_KIND_OPTIONS) {
    const t = ledger.totals.byKind.find((k) => k.kind === o.value)
    const r = sheet.addRow([o.label, t?.kg ?? 0])
    r.getCell(2).numFmt = KG_FMT
  }

  if (ledger.totals.tayyorByCalibre.length > 0) {
    sheet.addRow([])
    const calHdr = sheet.addRow(['Тайёр по калибрам'])
    calHdr.font = { bold: true, size: 12 }
    for (const c of ledger.totals.tayyorByCalibre) {
      const r = sheet.addRow([c.label, c.kg])
      r.getCell(2).numFmt = KG_FMT
    }
  }

  sheet.columns.forEach((col, i) => {
    col.width = i === 0 ? 16 : i === 3 ? 26 : i === 5 ? 24 : 14
  })

  return wb
}

export async function downloadClientChiqimLedgerExcel(ledger: ClientChiqimLedger, typeName: (id: string) => string): Promise<void> {
  const wb = await buildClientChiqimLedgerWorkbook(ledger, typeName)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `rashod-${ledger.period.from}-${ledger.period.to}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
