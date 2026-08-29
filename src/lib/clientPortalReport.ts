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

// Default direction is Приход (kirim) only, not "every kind" -- user
// request: the screen should open on arrivals, not a mixed dump of every
// row kind. Every other filter starts unrestricted.
export function defaultClientReportFilters(from: string, to: string): ClientReportFilters {
  return { directions: ['kirim'], from, to, typeId: '', serial: '' }
}

export interface ClientReportRow {
  key: string
  kind: ClientRowKind
  serial: string | null
  typeId: string
  partiyaNo: number | null
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
  // "Убыток" — this serial's own overall processing loss, live and signed
  // (DECISIONS.md "Moyka loss becomes live; remove Tugallash"), same value
  // repeated on every row of that serial (state, not per-row). Null only
  // for rows with no serial at all (e.g. chiqim_old_kn).
  ubytokKg: number | null
}

interface ClientReportDbRow {
  kind: ClientRowKind
  row_key: string
  serial: string | null
  type_id: string
  partiya_no: number | string | null
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
  state_loss_kg: number | string | null
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
    partiyaNo: num(row.partiya_no),
    dateBasis: row.date_basis,
    nettoKg: Number(row.qty_kg),
    nakladnayaKg: num(row.declared_qty),
    gotoviyProduktKg: calibreKg,
    knKg,
    ostatokGotoviyKg,
    ostatokSyroyeKg: num(row.state_omborda_qoldi),
    otgruzkaGotoviyKg: olibKetilganKg,
    otgruzkaSyroyeKg: num(row.state_xom_jonatilgan),
    ubytokKg: num(row.state_loss_kg),
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

// Totals strip (task: parity with the internal Hisobot's own totals strip).
// Movement totals (Нетто/Накладная) sum every matching ROW across the
// WHOLE filtered set, server-side — never derived from the currently
// fetched page, since client_report_rows is limit/offset-paginated and a
// client-side sum would silently under-count once a filter matches more
// rows than the page size. State totals (Готовый продукт/КН/Остаток ×2/
// Отгрузка ×2/Убыток) sum once per DISTINCT serial — the same "never sum
// a repeating per-serial figure once per row" rule the internal Hisobot's
// TotalsStrip follows.
export interface ClientReportTotals {
  nettoKg: number
  nakladnayaKg: number
  serialCount: number
  gotoviyProduktKg: number
  knKg: number
  ostatokGotoviyKg: number
  ostatokSyroyeKg: number
  otgruzkaGotoviyKg: number
  otgruzkaSyroyeKg: number
  ubytokKg: number
  ubytokSerialCount: number // how many of serialCount have a known Убыток — effectively all serial rows now that loss is always live
}

interface ClientReportTotalsDb {
  total_netto_kg: number | string
  total_nakladnaya_kg: number | string
  state_serial_count: number | string
  state_gotoviy_produkt_kg: number | string
  state_kn_kg: number | string
  state_ostatok_gotoviy_kg: number | string
  state_ostatok_syrye_kg: number | string
  state_otgruzka_gotoviy_kg: number | string
  state_otgruzka_syrye_kg: number | string
  state_ubytok_kg: number | string
  state_ubytok_serial_count: number | string
}

export async function fetchClientReportTotals(filters: ClientReportFilters): Promise<ClientReportTotals> {
  const { data, error } = await supabase.rpc('client_report_totals', {
    p_directions: filters.directions.length > 0 ? filters.directions : null,
    p_from: filters.from,
    p_to: filters.to,
    p_type_id: filters.typeId || null,
    p_serial: filters.serial || null,
  })
  if (error) throw error
  const row = (data as ClientReportTotalsDb[])[0]
  return {
    nettoKg: Number(row.total_netto_kg),
    nakladnayaKg: Number(row.total_nakladnaya_kg),
    serialCount: Number(row.state_serial_count),
    gotoviyProduktKg: Number(row.state_gotoviy_produkt_kg),
    knKg: Number(row.state_kn_kg),
    ostatokGotoviyKg: Number(row.state_ostatok_gotoviy_kg),
    ostatokSyroyeKg: Number(row.state_ostatok_syrye_kg),
    otgruzkaGotoviyKg: Number(row.state_otgruzka_gotoviy_kg),
    otgruzkaSyroyeKg: Number(row.state_otgruzka_syrye_kg),
    ubytokKg: Number(row.state_ubytok_kg),
    ubytokSerialCount: Number(row.state_ubytok_serial_count),
  }
}

// Per-serial drill-down (task: "a view section like hisobot, but without
// passport" — this is NOT the internal serial passport, a deliberately
// curated subset: calibre/KN/loss breakdown + nakladnoy links only).
export interface ClientCalibreBreakdown {
  calibreId: string
  weightKg: number
}

// Nakladnoy photo links (kirim doc_photo + chiqim departure_doc_photo) were
// built and then dropped, same day, per explicit user decision: Supabase
// Storage's own RLS (kirim-photos/gate-photos/etc.) has no per-owner
// scoping, so exposing photo links here couldn't be made safe without
// first fixing that separately (see DECISIONS.md "Client role: nakladnoy
// photo links dropped"). Numeric data only — calibre/КН/loss breakdown.
export interface ClientSerialSummary {
  serial: string
  orderDate: string | null
  partiyaNo: number | null
  byCalibre: ClientCalibreBreakdown[]
  knKg: number
  lossKg: number // live, signed — sent minus output kg (DECISIONS.md "Moyka loss becomes live")
}

interface ClientSerialSummaryDb {
  serial: string
  orderDate: string | null
  partiyaNo: number | string | null
  byCalibre: { calibreId: string; weightKg: number | string }[]
  knKg: number | string
  lossKg: number | string
}

export async function fetchClientSerialSummary(serial: string): Promise<ClientSerialSummary | null> {
  const { data, error } = await supabase.rpc('client_serial_summary', { p_serial: serial })
  if (error) throw error
  if (!data) return null
  const d = data as ClientSerialSummaryDb
  return {
    serial: d.serial,
    orderDate: d.orderDate,
    partiyaNo: num(d.partiyaNo),
    byCalibre: d.byCalibre.map((c) => ({ calibreId: c.calibreId, weightKg: Number(c.weightKg) })),
    knKg: Number(d.knKg),
    lossKg: Number(d.lossKg),
  }
}
