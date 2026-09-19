import ExcelJS from 'exceljs'
import type { ClientChiqimLedger } from './clientChiqimLedger'
import { tipLabel, tipTotals } from './clientChiqimLedger'
import { toExcelDate, EXCEL_DATE_FORMAT } from './formatDate'

// Расход sub-tab Excel export — one row per TRUCK (matching the on-screen
// per-truck table), widened with Вид N/Калибр N column groups instead of
// the on-screen expand panel (CLAUDE.md task "Rebuild the client
// portal...", Fix 2: "Excel export matches on-screen structure, one row
// per truck, expandable content flattened into columns"). exceljs, same
// choice as every other client_* export.

const BASE_HEADERS = ['Дата', 'Тип', 'Машина', 'Водитель', 'Всего кг']
const KG_FMT = '#,##0'

export async function buildClientChiqimLedgerWorkbook(
  ledger: ClientChiqimLedger,
  typeName: (id: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Расход')

  const maxTypes = ledger.rows.reduce((max, r) => Math.max(max, r.typeBreakdown.length), 0)
  const maxCalibres = ledger.rows.reduce((max, r) => Math.max(max, r.calibreBreakdown.length), 0)
  const typeHeaders = Array.from({ length: maxTypes }, (_, i) => [`Вид ${i + 1} название`, `Вид ${i + 1} кг`]).flat()
  const calibreHeaders = Array.from({ length: maxCalibres }, (_, i) => [`Калибр ${i + 1} название`, `Калибр ${i + 1} кг`]).flat()
  const headers = [...BASE_HEADERS, ...typeHeaders, ...calibreHeaders]

  const headerRow = sheet.addRow(headers)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', xSplit: BASE_HEADERS.length, ySplit: 1 }]

  for (const row of ledger.rows) {
    const typeCells = Array.from({ length: maxTypes }, (_, i) => {
      const t = row.typeBreakdown[i]
      return t ? [typeName(t.typeId), t.kg] : ['', '']
    }).flat()
    const calibreCells = Array.from({ length: maxCalibres }, (_, i) => {
      const c = row.calibreBreakdown[i]
      return c ? [c.label, c.kg] : ['', '']
    }).flat()
    const excelRow = sheet.addRow([
      toExcelDate(row.date),
      row.tips.map((t) => tipLabel(t)).join(', '),
      row.plate,
      row.driver,
      row.totalKg,
      ...typeCells,
      ...calibreCells,
    ])
    excelRow.getCell(1).numFmt = EXCEL_DATE_FORMAT
    excelRow.getCell(5).numFmt = KG_FMT
    for (let i = 0; i < maxTypes; i++) {
      if (row.typeBreakdown[i]) excelRow.getCell(BASE_HEADERS.length + i * 2 + 2).numFmt = KG_FMT
    }
    for (let i = 0; i < maxCalibres; i++) {
      if (row.calibreBreakdown[i]) excelRow.getCell(BASE_HEADERS.length + maxTypes * 2 + i * 2 + 2).numFmt = KG_FMT
    }
  }

  const totalRow = sheet.addRow(['ИТОГО', '', '', '', ledger.totals.totalKg])
  totalRow.font = { bold: true }
  totalRow.getCell(5).numFmt = KG_FMT
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
    col.width = i === 0 ? 14 : i === 1 ? 22 : i === 2 ? 14 : i === 3 ? 16 : 14
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
