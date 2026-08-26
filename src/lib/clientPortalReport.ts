import { supabase } from './supabase'

// Global Export client portal — Russian-only Hisobot-equivalent table.
// Reads client_report_rows()/client_serial_summary()
// (supabase/migrations/0083_client_role_rls_and_reporting.sql), NOT the
// internal report_rows_v2/report_kirim_rows/report_chiqim_rows engine —
// see that migration's own header comment for why (a view-ownership RLS-
// bypass finding made routing the client portal through those views unsafe).

export type ClientRowKind = 'kirim' | 'chiqim' | 'chiqim_raw' | 'chiqim_old_kn' | 'moyka_output'

// Exactly the 5 kinds the task asked for as filters (Kirim, Chiqim's three
// types, Moykadan/"Pererabotano") — moyka_send (internal "sent to
// washing" movement) is deliberately not offered here, unlike the internal
// Hisobot's 6-kind filter.
export const CLIENT_DIRECTION_OPTIONS: { value: ClientRowKind; label: string }[] = [
  { value: 'kirim', label: 'Приход' },
  { value: 'chiqim', label: 'Отгрузка (готовый продукт)' },
  { value: 'chiqim_raw', label: 'Отгрузка (сырьё)' },
  { value: 'chiqim_old_kn', label: 'Отгрузка (старый КН)' },
  { value: 'moyka_output', label: 'Переработано' },
]

const DIRECTION_LABEL: Record<ClientRowKind, string> = Object.fromEntries(
  CLIENT_DIRECTION_OPTIONS.map((o) => [o.value, o.label])
) as Record<ClientRowKind, string>

export function directionLabel(kind: ClientRowKind): string {
  return DIRECTION_LABEL[kind] ?? kind
}

export interface ClientReportFilters {
  directions: ClientRowKind[] // [] = every kind
  from: string // YYYY-MM-DD
  to: string
  typeId: string // '' = every type
  serial: string // substring match, '' = no filter
}

export function defaultClientReportFilters(from: string, to: string): ClientReportFilters {
  return { directions: [], from, to, typeId: '', serial: '' }
}

export interface ClientReportRow {
  key: string
  kind: ClientRowKind
  serial: string | null
  typeId: string
  dateBasis: string | null
  nettoKg: number
  nakladnayaKg: number | null // "Накладная" — declared_qty, KIRIM-only, blank otherwise
  // Per-serial standing figures (same value repeated on every row of that
  // serial) — null on rows with no serial (chiqim_old_kn).
  gotoviyProduktKg: number | null
  knKg: number | null
  ostatokGotoviyKg: number | null // derived: gotoviyProdukt + kn - otgruzkaGotoviy
  ostatokSyroyeKg: number | null
  otgruzkaGotoviyKg: number | null
  otgruzkaSyroyeKg: number | null
}

interface ClientReportDbRow {
  kind: ClientRowKind
  row_key: string
  serial: string | null
  type_id: string
  plate: string | null
  driver: string | null
  date_basis: string | null
  qty_kg: number | string
  declared_qty: number | string | null
  state_omborda_qoldi: number | string | null
  state_calibre_kg: number | string | null
  state_kn_kg: number | string | null
  state_olib_ketilgan: number | string | null
  state_xom_jonatilgan: number | string | null
}

function num(v: number | string | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v)
}

function mapRow(row: ClientReportDbRow): ClientReportRow {
  const calibreKg = num(row.state_calibre_kg)
  const knKg = num(row.state_kn_kg)
  const olibKetilganKg = num(row.state_olib_ketilgan)
  const ostatokGotoviyKg =
    calibreKg !== null && knKg !== null && olibKetilganKg !== null
      ? Math.max(0, calibreKg + knKg - olibKetilganKg)
      : null

  return {
    key: `${row.kind}-${row.row_key}`,
    kind: row.kind,
    serial: row.serial,
    typeId: row.type_id,
    dateBasis: row.date_basis,
    nettoKg: Number(row.qty_kg),
    nakladnayaKg: num(row.declared_qty),
    gotoviyProduktKg: calibreKg,
    knKg,
    ostatokGotoviyKg,
    ostatokSyroyeKg: num(row.state_omborda_qoldi),
    otgruzkaGotoviyKg: olibKetilganKg,
    otgruzkaSyroyeKg: num(row.state_xom_jonatilgan),
  }
}

export async function fetchClientReportRows(
  filters: ClientReportFilters,
  limit = 200,
  offset = 0
): Promise<ClientReportRow[]> {
  const { data, error } = await supabase.rpc('client_report_rows', {
    p_directions: filters.directions.length > 0 ? filters.directions : null,
    p_from: filters.from,
    p_to: filters.to,
    p_type_id: filters.typeId || null,
    p_serial: filters.serial || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return ((data ?? []) as ClientReportDbRow[]).map(mapRow)
}

// Per-serial drill-down (task: "a view section like hisobot, but without
// passport" — this is NOT the internal serial passport, a deliberately
// curated subset: calibre/KN/loss breakdown + nakladnoy links only).
export interface ClientCalibreBreakdown {
  calibreId: string
  weightKg: number
}

export interface ClientNakladnoy {
  photoUrl: string
  date: string
  plate: string
}

export interface ClientChiqimNakladnoy extends ClientNakladnoy {
  requestId: string
}

export interface ClientSerialSummary {
  serial: string
  orderDate: string | null
  washCycleStatus: string | null
  byCalibre: ClientCalibreBreakdown[]
  knKg: number
  lossKg: number | null // null = wash not yet finished, not a real figure yet
  kirimNakladnoy: ClientNakladnoy | null
  chiqimNakladnoys: ClientChiqimNakladnoy[]
}

interface ClientSerialSummaryDb {
  serial: string
  orderDate: string | null
  washCycleStatus: string | null
  byCalibre: { calibreId: string; weightKg: number | string }[]
  knKg: number | string
  lossKg: number | string | null
  kirimNakladnoy: { photoUrl: string; date: string; plate: string } | null
  chiqimNakladnoys: { requestId: string; photoUrl: string; date: string; plate: string }[]
}

export async function fetchClientSerialSummary(serial: string): Promise<ClientSerialSummary | null> {
  const { data, error } = await supabase.rpc('client_serial_summary', { p_serial: serial })
  if (error) throw error
  if (!data) return null
  const d = data as ClientSerialSummaryDb
  return {
    serial: d.serial,
    orderDate: d.orderDate,
    washCycleStatus: d.washCycleStatus,
    byCalibre: d.byCalibre.map((c) => ({ calibreId: c.calibreId, weightKg: Number(c.weightKg) })),
    knKg: Number(d.knKg),
    lossKg: d.lossKg === null ? null : Number(d.lossKg),
    kirimNakladnoy: d.kirimNakladnoy,
    chiqimNakladnoys: d.chiqimNakladnoys,
  }
}
