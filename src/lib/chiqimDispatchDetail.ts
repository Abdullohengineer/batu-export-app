import { supabase } from './supabase'

// Component-grain rows for the Excel export's detail sheet (2026-09-14, see
// docs/decisions/0188-...-chiqim-regrain-departure-date-dispatch-rollup.md)
// — one row per chiqim/chiqim_raw/chiqim_old_kn component across the
// dispatch requests actually present in the export, read straight from the
// same v2 views report_dispatch_rows_v2 itself sums from (not a parallel
// computation — same numbers, different grain, guaranteed to reconcile).
export interface ChiqimDispatchDetailRow {
  requestId: string
  plate: string
  dateBasis: string | null
  kind: 'chiqim' | 'chiqim_raw' | 'chiqim_old_kn'
  barcode2: string | null
  serial: string | null
  typeId: string
  calibreId: string | null
  qtyKg: number
}

export async function fetchChiqimDispatchDetailRows(requestIds: string[]): Promise<ChiqimDispatchDetailRow[]> {
  const ids = [...new Set(requestIds)].filter(Boolean)
  if (ids.length === 0) return []

  const [chiqim, raw, oldKn] = await Promise.all([
    supabase.from('report_chiqim_rows_v2').select('request_id, barcode2, serial, type_id, calibre_id, qty_kg, plate, date_basis').in('request_id', ids),
    supabase.from('report_raw_dispatch_rows_v2').select('request_id, serial, type_id, qty_kg, plate, date_basis').in('request_id', ids),
    supabase.from('report_old_kn_rows_v2').select('request_id, type_id, qty_kg, plate, date_basis').in('request_id', ids),
  ])

  const rows: ChiqimDispatchDetailRow[] = []
  for (const r of chiqim.data ?? []) {
    rows.push({
      requestId: r.request_id ?? '',
      plate: r.plate ?? '',
      dateBasis: r.date_basis,
      kind: 'chiqim',
      barcode2: r.barcode2,
      serial: r.serial,
      typeId: r.type_id,
      calibreId: r.calibre_id,
      qtyKg: Number(r.qty_kg),
    })
  }
  for (const r of raw.data ?? []) {
    rows.push({
      requestId: r.request_id ?? '',
      plate: r.plate ?? '',
      dateBasis: r.date_basis,
      kind: 'chiqim_raw',
      barcode2: null,
      serial: r.serial,
      typeId: r.type_id,
      calibreId: null,
      qtyKg: Number(r.qty_kg),
    })
  }
  for (const r of oldKn.data ?? []) {
    rows.push({
      requestId: r.request_id ?? '',
      plate: r.plate ?? '',
      dateBasis: r.date_basis,
      kind: 'chiqim_old_kn',
      barcode2: null,
      serial: null,
      typeId: r.type_id,
      calibreId: null,
      qtyKg: Number(r.qty_kg),
    })
  }
  return rows
}
