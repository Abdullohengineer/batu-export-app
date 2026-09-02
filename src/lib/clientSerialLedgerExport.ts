import ExcelJS from 'exceljs'
import type { ClientSerialLedger } from './clientSerialLedger'
import { toExcelDate, EXCEL_DATE_FORMAT } from './formatDate'

// Приход sub-tab Excel export — same 19-column layout, merged serial
// blocks, and ИТОГО row as the manual KIRIM export built for this exact
// client (kirim_report_jul16_todate.xlsx), reusing `exceljs` (the
// established choice, see clientReportExport.ts — xlsx/SheetJS carries an
// unpatched advisory, not used anywhere in this codebase). Values only, no
// live formulas — the source of truth is ledger.totals from
// client_serial_ledger itself, written directly rather than re-derived by
// an Excel formula.

const HEADERS = [
  'Дата',
  'Вид сырья',
  'Приход по накладной',
  'Приход нетто',
  'Возврат сырья заказчику',
  'Разница в весе',
  'На переработку',
  'В переработке',
  '№',
  'Готовый продукт (кг)',
  'Кондерка',
  'Потеря (кг)',
  'ИТОГО переработка',
  'Отгрузка',
  'Дата отгрузки',
  '№',
  'Кол-во (кг)',
  'Остаток сырья',
  'Остаток гот. продукции',
]

const KG_FMT = '#,##0'

export async function buildClientSerialLedgerWorkbook(
  ledger: ClientSerialLedger,
  typeName: (id: string) => string,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Приход')

  const headerRow = sheet.addRow(HEADERS)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const acc = {
    declared: 0, netto: 0, vozvrat: 0, moyka: 0, vPer: 0, gotoviy: 0, kn: 0, poterya: 0,
    itogo: 0, otgruzka: 0, kolvo: 0, ostSyrya: 0, ostGot: 0,
  }

  for (const row of ledger.rows) {
    const span = Math.max(1, row.calibres.length, row.dispatches.length)
    const startRow = sheet.rowCount + 1

    for (let i = 0; i < span; i++) {
      const excelRow = sheet.addRow([])
      const r = startRow + i
      if (i === 0) {
        sheet.getCell(r, 1).value = toExcelDate(row.date)
        sheet.getCell(r, 1).numFmt = EXCEL_DATE_FORMAT
        sheet.getCell(r, 2).value = typeName(row.typeId)
        sheet.getCell(r, 3).value = row.declaredQtyKg
        sheet.getCell(r, 4).value = row.nettoKg
        sheet.getCell(r, 5).value = row.vozvratKg
        sheet.getCell(r, 6).value = row.raznitsaKg
        sheet.getCell(r, 7).value = row.moykaKg
        if (row.vPererabotkeKg !== null) sheet.getCell(r, 8).value = row.vPererabotkeKg
        if (row.poteryaKg !== null) sheet.getCell(r, 12).value = row.poteryaKg
        sheet.getCell(r, 13).value = row.itogoPererabotkaKg
        sheet.getCell(r, 18).value = row.ostatokSyryaKg
        sheet.getCell(r, 19).value = row.ostatokGotovoyKg
        for (const col of [3, 4, 5, 6, 7, 8, 12, 13, 18, 19]) sheet.getCell(r, col).numFmt = KG_FMT
      }
      const c = row.calibres[i]
      if (c) {
        sheet.getCell(r, 9).value = c.label
        sheet.getCell(r, c.isNumberless ? 11 : 10).value = c.kg
        sheet.getCell(r, c.isNumberless ? 11 : 10).numFmt = KG_FMT
      }
      const d = row.dispatches[i]
      if (d) {
        sheet.getCell(r, 15).value = toExcelDate(d.date)
        sheet.getCell(r, 15).numFmt = EXCEL_DATE_FORMAT
        sheet.getCell(r, 16).value = d.label
        sheet.getCell(r, 17).value = d.kg
        sheet.getCell(r, 17).numFmt = KG_FMT
      }
      excelRow.commit()
    }

    if (span > 1) {
      for (const col of [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 18, 19]) {
        sheet.mergeCells(startRow, col, startRow + span - 1, col)
      }
    }

    acc.declared += row.declaredQtyKg
    acc.netto += row.nettoKg
    acc.vozvrat += row.vozvratKg
    acc.moyka += row.moykaKg
    if (row.vPererabotkeKg !== null) acc.vPer += row.vPererabotkeKg
    if (row.poteryaKg !== null) acc.poterya += row.poteryaKg
    acc.itogo += row.itogoPererabotkaKg
    acc.otgruzka += row.otgruzkaKg
    acc.ostSyrya += row.ostatokSyryaKg
    acc.ostGot += row.ostatokGotovoyKg
    for (const c of row.calibres) {
      if (c.isNumberless) acc.kn += c.kg
      else acc.gotoviy += c.kg
    }
  }

  const totalRow = sheet.addRow([
    'ИТОГО', '', ledger.totals.declaredQtyKg, ledger.totals.nettoKg, ledger.totals.vozvratKg,
    ledger.totals.raznitsaKg, ledger.totals.moykaKg, ledger.totals.vPererabotkeKg, '',
    acc.gotoviy, acc.kn, ledger.totals.poteryaKg, ledger.totals.itogoPererabotkaKg,
    ledger.totals.otgruzkaKg, '', '', '', ledger.totals.ostatokSyryaKg, ledger.totals.ostatokGotovoyKg,
  ])
  totalRow.font = { bold: true }
  totalRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  })
  for (const col of [3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 18, 19]) totalRow.getCell(col).numFmt = KG_FMT

  sheet.columns.forEach((col, i) => {
    col.width = i === 0 ? 14 : i === 1 ? 16 : 14
  })

  return wb
}

export async function downloadClientSerialLedgerExcel(ledger: ClientSerialLedger, typeName: (id: string) => string): Promise<void> {
  const wb = await buildClientSerialLedgerWorkbook(ledger, typeName)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `prihod-${ledger.period.from}-${ledger.period.to}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
