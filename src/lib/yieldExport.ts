import ExcelJS from 'exceljs'
import type { YieldRow } from './yield'
import { YIELD_LOSS_BASIS_NOTE } from './yield'

// §3.2.8 Excel export — same `exceljs` choice every other saved view's
// export already made (see DECISIONS.md "Reporting query engine").
export interface YieldExportLookups {
  ownerName: (id: string) => string
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}

const HEADER = [
  'Seriya',
  'Buyurtmachi',
  'Tur',
  'Tugagan sana',
  'Sikl',
  'Xom (yuborilgan), kg',
  'Ortiqcha yuborilgan, kg',
  'Chiqish, kg',
  "Yo'qotish, kg",
  "Yo'qotish, %",
  'Yalpi hosildorlik, %',
  'Quruq moddaga solishtirilgan yo\'qotish, %',
  'Kirish namligi, %',
  'Chiqish namligi, %',
]

export async function buildYieldWorkbook(rows: YieldRow[], from: string, to: string, lookups: YieldExportLookups): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Hosildorlik')

  sheet.addRow(['BATU EXPORT — Hosildorlik (§3.2.8)']).font = { bold: true, size: 14 }
  sheet.addRow([`Davr: ${from} — ${to}`])
  sheet.addRow([YIELD_LOSS_BASIS_NOTE])
  sheet.addRow([])

  const headerRow = sheet.addRow(HEADER)
  headerRow.font = { bold: true }

  for (const row of rows) {
    sheet.addRow([
      row.serial,
      lookups.ownerName(row.ownerId),
      lookups.typeName(row.typeId),
      row.completedDate,
      row.rewashed ? `${row.maxCycleNo} (qayta yuvilgan)` : '1',
      row.rawConsumedKg,
      row.rawOverageKg > 0 ? row.rawOverageKg : '',
      row.outputKg,
      row.lossKg,
      row.lossPct,
      row.grossYieldPct,
      row.dryMatterAvailable ? row.trueLossPct : "ma'lumot yo'q",
      row.intakeMoisturePct ?? '',
      row.deliveredMoisturePct ?? '',
    ])
  }

  sheet.columns.forEach((col) => {
    col.width = 18
  })

  return wb
}

export async function downloadYieldExcel(rows: YieldRow[], from: string, to: string, lookups: YieldExportLookups): Promise<void> {
  const wb = await buildYieldWorkbook(rows, from, to, lookups)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hosildorlik-${from}-${to}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
