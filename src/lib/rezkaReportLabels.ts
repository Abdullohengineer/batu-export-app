import type { RezkaReportRow, RezkaRowKind } from './reportQuery'

// Rezka Hisobot labels (2026-09-28, Rezka Prompt 4) -- one place, shared by
// the table row, the mobile card and the Excel export, so the three
// renderings can never drift apart.
export const REZKA_DIRECTION_LABEL: Record<RezkaRowKind, string> = {
  rezka_kirim: 'REZKA KIRIM',
  rezka_send: 'REZKAGA',
  rezka_output: 'REZKADAN',
  rezka_chiqim: 'REZKA CHIQIM',
}

// "Tashqi" for a truck arrival; "Ichki KN · PLT-…(25 kg), …" for a serial
// minted from Konditerka pallets (the parent Barcode #2 list).
export function rezkaManbaText(row: RezkaReportRow): string {
  if (row.rezka.manba === 'tashqi') return 'Tashqi'
  if (row.rezka.manba !== 'ichki') return '—'
  const parents = row.rezka.parents.map((p) => `${p.barcode2} (${p.qtyKg.toLocaleString()} kg)`).join(', ')
  return parents ? `Ichki KN · ${parents}` : 'Ichki KN'
}

// Rezkada is signed (open cycle: sent − returned). A negative value is an
// Ortiqcha -- more came back than was sent -- and reads that way, never as
// "-X kg".
export function rezkadaText(kg: number): string {
  if (kg < 0) return `Ortiqcha +${Math.round(-kg).toLocaleString()} kg`
  return `${kg.toLocaleString()} kg`
}
