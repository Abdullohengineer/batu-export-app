import ExcelJS from 'exceljs'
import type { ClientProductionLedger } from './clientProductionLedger'
import { toExcelDate, EXCEL_DATE_FORMAT } from './formatDate'

// Производство sub-tab Excel export. One row per serial, one column per
// calibre actually present in the filtered set -- unlike the on-screen
// table (fixed K1-K8 + Кондитерка always visible, see
// clientProductionLedger.ts's PRODUCTION_CALIBRE_CODES comment), the
// export only widens to calibres with real data, so a period with no
// Кондитерка output doesn't carry an all-zero column downstream.
const KG_FMT = '#,##0'
// Fixed columns before the variable calibre block, same order as the
// on-screen table (2026-09-30, see docs/decisions/0237): Серия | Партия |
// Вид сырья | Дата прихода | По накладной | Приход нетто | Отправлено на
// мойку | В мойке | Остаток сырья | Всего произведено -- then the calibre
// columns, then Потеря.
const FIXED_HEADERS_BEFORE_CALIBRES = [
  'Серия',
  'Партия',
  'Вид сырья',
  'Дата прихода',
  'По накладной',
  'Приход нетто',
  'Отправлено на мойку',
  'В мойке',
  'Остаток сырья',
  'Всего произведено (кг)',
]
const FIXED_COLUMN_COUNT = FIXED_HEADERS_BEFORE_CALIBRES.length

export async function buildClientProductionLedgerWorkbook(
  ledger: ClientProductionLedger,
  typeName: (id: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Производство')

  const calibreCols = ledger.totals.byCalibre // already server-sorted by sort_order
  const headers = [...FIXED_HEADERS_BEFORE_CALIBRES, ...calibreCols.map((c) => c.label), 'Потеря']

  const headerRow = sheet.addRow(headers)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const lossColIndex = FIXED_COLUMN_COUNT + calibreCols.length + 1

  for (const row of ledger.rows) {
    const excelRow = sheet.addRow([
      row.serial,
      row.partiyaNo ?? '',
      typeName(row.typeId),
      toExcelDate(row.kirimDate),
      row.nakladnoyKg,
      row.nettoKg,
      row.moykagaYuborilganKg,
      row.moykadaKg,
      row.ostatokSyryaKg,
      row.totalKg,
      ...calibreCols.map((c) => row.calibres.find((rc) => rc.calibreId === c.calibreId)?.kg ?? 0),
      row.poteryaKg ?? '',
    ])
    excelRow.getCell(4).numFmt = EXCEL_DATE_FORMAT
    for (let i = 5; i <= FIXED_COLUMN_COUNT; i++) excelRow.getCell(i).numFmt = KG_FMT
    calibreCols.forEach((_, i) => {
      excelRow.getCell(FIXED_COLUMN_COUNT + 1 + i).numFmt = KG_FMT
    })
    if (row.poteryaKg != null) excelRow.getCell(lossColIndex).numFmt = KG_FMT
  }

  const totalRow = sheet.addRow([
    'ИТОГО',
    '',
    '',
    '',
    '',
    ledger.totals.nettoKg,
    ledger.totals.moykagaYuborilganKg,
    ledger.totals.moykadaKg,
    ledger.totals.ostatokSyryaKg,
    ledger.totals.totalKg,
    ...calibreCols.map((c) => c.kg),
    ledger.totals.poteryaKg,
  ])
  totalRow.font = { bold: true }
  for (let i = 6; i <= FIXED_COLUMN_COUNT; i++) totalRow.getCell(i).numFmt = KG_FMT
  calibreCols.forEach((_, i) => {
    totalRow.getCell(FIXED_COLUMN_COUNT + 1 + i).numFmt = KG_FMT
  })
  totalRow.getCell(lossColIndex).numFmt = KG_FMT
  totalRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  })

  sheet.columns.forEach((col, i) => {
    col.width = i === 0 ? 14 : i === 2 ? 16 : i === 3 ? 12 : 14
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
