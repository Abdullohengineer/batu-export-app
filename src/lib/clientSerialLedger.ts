import { supabase } from './supabase'

// Приход sub-tab (Профиль → Отчёт), per-serial KIRIM ledger for the Global
// Export client portal. Reads client_serial_ledger()
// (supabase/migrations/0109_client_serial_and_chiqim_ledger.sql, fixed by
// 0110 -- see that file's own header for the Остаток сырья correction), which
// self-scopes to the caller's own owner via my_owner_id() — this module
// deliberately never sends an owner/client id, see that migration's own
// header comment for why. Replaces the old client_report_rows/
// client_report_totals pair wholesale — one RPC call returns both rows and
// totals together, so a screen literally cannot sum totals from a
// paginated row page by mistake.

export interface ClientSerialLedgerFilters {
  from: string // YYYY-MM-DD
  to: string
  typeId: string // '' = every type
}

export function defaultClientSerialLedgerFilters(from: string, to: string): ClientSerialLedgerFilters {
  return { from, to, typeId: '' }
}

export interface ClientLedgerCalibre {
  calibreId: string
  label: string
  code: string
  kg: number
  isNumberless: boolean
}

export interface ClientLedgerDispatchEvent {
  date: string
  plate: string
  calibreId: string
  label: string
  code: string
  kg: number
}

export interface ClientSerialLedgerRow {
  serial: string
  typeId: string
  partiyaNo: number | null
  date: string
  declaredQtyKg: number
  nettoKg: number
  vozvratKg: number
  raznitsaKg: number
  moykaKg: number
  // Exactly one of these two is non-null per row — never both, never neither
  // (matches the earlier Excel deliverable's own verified invariant).
  vPererabotkeKg: number | null
  poteryaKg: number | null
  itogoPererabotkaKg: number
  otgruzkaKg: number
  ostatokSyryaKg: number
  ostatokGotovoyKg: number
  calibres: ClientLedgerCalibre[]
  dispatches: ClientLedgerDispatchEvent[]
}

export interface ClientSerialLedgerTotals {
  declaredQtyKg: number
  nettoKg: number
  vozvratKg: number
  raznitsaKg: number
  moykaKg: number
  vPererabotkeKg: number
  poteryaKg: number
  itogoPererabotkaKg: number
  otgruzkaKg: number
  ostatokSyryaKg: number
  ostatokGotovoyKg: number
  serialCount: number
}

export interface ClientSerialLedger {
  period: { from: string; to: string }
  rows: ClientSerialLedgerRow[]
  totals: ClientSerialLedgerTotals
}

interface RpcCalibre {
  calibreId: string
  label: string
  code: string
  kg: number | string
  isNumberless: boolean
}
interface RpcDispatch {
  date: string
  plate: string
  calibreId: string
  label: string
  code: string
  kg: number | string
}
interface RpcRow {
  serial: string
  typeId: string
  partiyaNo: number | string | null
  date: string
  declaredQtyKg: number | string
  nettoKg: number | string
  vozvratKg: number | string
  raznitsaKg: number | string
  moykaKg: number | string
  vPererabotkeKg: number | string | null
  poteryaKg: number | string | null
  itogoPererabotkaKg: number | string
  otgruzkaKg: number | string
  ostatokSyryaKg: number | string
  ostatokGotovoyKg: number | string
  calibres: RpcCalibre[]
  dispatches: RpcDispatch[]
}
interface RpcTotals {
  declaredQtyKg: number | string
  nettoKg: number | string
  vozvratKg: number | string
  raznitsaKg: number | string
  moykaKg: number | string
  vPererabotkeKg: number | string
  poteryaKg: number | string
  itogoPererabotkaKg: number | string
  otgruzkaKg: number | string
  ostatokSyryaKg: number | string
  ostatokGotovoyKg: number | string
  serialCount: number | string
}
interface RpcResponse {
  period: { from: string; to: string }
  rows: RpcRow[]
  totals: RpcTotals
}

function n(v: number | string): number {
  return Number(v)
}
function nOrNull(v: number | string | null): number | null {
  return v === null ? null : Number(v)
}

export async function fetchClientSerialLedger(filters: ClientSerialLedgerFilters): Promise<ClientSerialLedger> {
  const { data, error } = await supabase.rpc('client_serial_ledger', {
    p_from_date: filters.from,
    p_to_date: filters.to,
    p_product_type_id: filters.typeId || null,
  })
  if (error) throw error
  const d = data as RpcResponse
  return {
    period: d.period,
    rows: d.rows.map((r) => ({
      serial: r.serial,
      typeId: r.typeId,
      partiyaNo: nOrNull(r.partiyaNo),
      date: r.date,
      declaredQtyKg: n(r.declaredQtyKg),
      nettoKg: n(r.nettoKg),
      vozvratKg: n(r.vozvratKg),
      raznitsaKg: n(r.raznitsaKg),
      moykaKg: n(r.moykaKg),
      vPererabotkeKg: nOrNull(r.vPererabotkeKg),
      poteryaKg: nOrNull(r.poteryaKg),
      itogoPererabotkaKg: n(r.itogoPererabotkaKg),
      otgruzkaKg: n(r.otgruzkaKg),
      ostatokSyryaKg: n(r.ostatokSyryaKg),
      ostatokGotovoyKg: n(r.ostatokGotovoyKg),
      calibres: r.calibres.map((c) => ({ calibreId: c.calibreId, label: c.label, code: c.code, kg: n(c.kg), isNumberless: c.isNumberless })),
      dispatches: r.dispatches.map((x) => ({ date: x.date, plate: x.plate, calibreId: x.calibreId, label: x.label, code: x.code, kg: n(x.kg) })),
    })),
    totals: {
      declaredQtyKg: n(d.totals.declaredQtyKg),
      nettoKg: n(d.totals.nettoKg),
      vozvratKg: n(d.totals.vozvratKg),
      raznitsaKg: n(d.totals.raznitsaKg),
      moykaKg: n(d.totals.moykaKg),
      vPererabotkeKg: n(d.totals.vPererabotkeKg),
      poteryaKg: n(d.totals.poteryaKg),
      itogoPererabotkaKg: n(d.totals.itogoPererabotkaKg),
      otgruzkaKg: n(d.totals.otgruzkaKg),
      ostatokSyryaKg: n(d.totals.ostatokSyryaKg),
      ostatokGotovoyKg: n(d.totals.ostatokGotovoyKg),
      serialCount: n(d.totals.serialCount),
    },
  }
}
