import ExcelJS from 'exceljs'
import type { ClientChiqimLedger } from './clientChiqimLedger'
import { tipLabel, tipTotals } from './clientChiqimLedger'
import { toExcelDate, EXCEL_DATE_FORMAT } from './formatDate'

// Расход sub-tab Excel export — one row per serial (matching the on-screen
// compact view), widened with N1..N(max) dispatch-detail column groups
// instead of the on-screen expand panel (CLAUDE.md task "Rebuild the
// client portal..." Part B.3: "on-screen stays compact; Excel goes wide").
// exceljs, same choice as clientSerialLedgerExport.ts.

const BASE_HEADERS = ['Серия', 'Вид сырья', 'Тип', 'ИТОГО отгружено (кг)', 'ИТОГО по калибрам', 'Отгрузок']
const KG_FMT = '#,##0'

function calibreString(calibres: { label: string; kg: number }[]): string {
  if (calibres.length === 0) return ''
  return calibres.map((c) => `${c.label}: ${Math.round(c.kg).toLocaleString()}`).join(', ')
}

export async function buildClientChiqimLedgerWorkbook(
  ledger: ClientChiqimLedger,
  typeName: (id: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Расход')

  const maxDispatches = ledger.rows.reduce((max, r) => Math.max(max, r.dispatches.length), 0)
  const dispatchHeaders = Array.from({ length: maxDispatches }, (_, i) => [
    `N${i + 1} Дата`,
    `N${i + 1} Машина`,
    `N${i + 1} Водитель`,
    `N${i + 1} Кол-во`,
    `N${i + 1} По калибрам`,
  ]).flat()
  const headers = [...BASE_HEADERS, ...dispatchHeaders]

  const headerRow = sheet.addRow(headers)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', xSplit: BASE_HEADERS.length, ySplit: 1 }]

  for (const row of ledger.rows) {
    const dispatchCells = Array.from({ length: maxDispatches }, (_, i) => {
      const d = row.dispatches[i]
      if (!d) return ['', '', '', '', '']
      return [toExcelDate(d.date), d.plate, d.driver, d.kg, calibreString(d.calibres)]
    }).flat()
    const excelRow = sheet.addRow([
      row.isPool ? '—' : row.serial, // bare dash, matching the internal Hisobot's own chiqim_old_kn convention exactly
      typeName(row.typeId),
      row.tips.map((t) => tipLabel(t)).join(', '),
      row.totalKg,
      calibreString(row.calibres),
      row.dispatchCount,
      ...dispatchCells,
    ])
    excelRow.getCell(4).numFmt = KG_FMT
    for (let i = 0; i < maxDispatches; i++) {
      const dateCol = BASE_HEADERS.length + i * 5 + 1
      const qtyCol = BASE_HEADERS.length + i * 5 + 4
      if (row.dispatches[i]) {
        excelRow.getCell(dateCol).numFmt = EXCEL_DATE_FORMAT
        excelRow.getCell(qtyCol).numFmt = KG_FMT
      }
    }
  }

  const totalRow = sheet.addRow(['ИТОГО', '', '', ledger.totals.totalKg, '', ''])
  totalRow.font = { bold: true }
  totalRow.getCell(4).numFmt = KG_FMT
  totalRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  })

  sheet.addRow([])
  const tipHdr = sheet.addRow(['Итоги по Типу'])
  tipHdr.font = { bold: true, size: 12 }
  for (const t of tipTotals(ledger.totals)) {
    const r = sheet.addRow([tipLabel(t.tip), t.kg])
    r.getCell(2).numFmt = KG_FMT
  }

  if (ledger.totals.tayyorByCalibre.length > 0) {
    sheet.addRow([])
    const calHdr = sheet.addRow(['Готовая продукция по калибрам'])
    calHdr.font = { bold: true, size: 12 }
    for (const c of ledger.totals.tayyorByCalibre) {
      const r = sheet.addRow([c.label, c.kg])
      r.getCell(2).numFmt = KG_FMT
    }
  }

  sheet.columns.forEach((col, i) => {
    col.width = i === 0 ? 14 : i === 1 ? 16 : i === 2 ? 22 : i === 4 ? 24 : 14
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
