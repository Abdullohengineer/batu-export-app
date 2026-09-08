import { supabase } from './supabase'

// Производство sub-tab (Отчёт) — per-serial pack-output ledger for the
// Global Export client portal. Reads client_production_ledger()
// (supabase/migrations/0114_client_production_ledger.sql), self-scoped via
// my_owner_id(). CLAUDE.md task "Rebuild the client portal..." Part B.4/D.

export interface ClientProductionCalibre {
  calibreId: string
  label: string
  code: string
  kg: number
}

export interface ClientProductionRow {
  serial: string
  typeId: string
  totalKg: number
  calibres: ClientProductionCalibre[]
}

export interface ClientProductionTotals {
  totalKg: number
  byCalibre: ClientProductionCalibre[]
}

export interface ClientProductionLedger {
  period: { from: string; to: string }
  rows: ClientProductionRow[]
  totals: ClientProductionTotals
}

export interface ClientProductionFilters {
  from: string
  to: string
  typeId: string // '' = Все
}

export function defaultClientProductionFilters(from: string, to: string): ClientProductionFilters {
  return { from, to, typeId: '' }
}

// The task's own fixed column set (Серия | Вид сырья | Всего произведено |
// K1 | K2 | K3 | K4 | K6 | Кондитерка) -- deliberately narrower than every
// calibre this app has (K5/K7/K8 exist but aren't in the task's own table
// header); on-screen sticks to exactly these 6 calibre columns, the Excel
// export widens to every calibre actually present instead (see
// clientProductionLedgerExport.ts) so nothing produced is silently lost
// from the download even though the screen doesn't show it.
export const PRODUCTION_CALIBRE_CODES = ['01', '02', '03', '04', '06', 'KN'] as const

export function calibreKgByCode(calibres: ClientProductionCalibre[], code: string): number {
  return calibres.find((c) => c.code === code)?.kg ?? 0
}

interface RpcCalibre {
  calibreId: string
  label: string
  code: string
  kg: number | string
}
interface RpcRow {
  serial: string
  typeId: string
  totalKg: number | string
  calibres: RpcCalibre[]
}
interface RpcResponse {
  period: { from: string; to: string }
  rows: RpcRow[]
  totals: { totalKg: number | string; byCalibre: RpcCalibre[] }
}

function n(v: number | string): number {
  return Number(v)
}
function mapCalibre(c: RpcCalibre): ClientProductionCalibre {
  return { calibreId: c.calibreId, label: c.label, code: c.code, kg: n(c.kg) }
}

export async function fetchClientProductionLedger(filters: ClientProductionFilters): Promise<ClientProductionLedger> {
  const { data, error } = await supabase.rpc('client_production_ledger', {
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
      totalKg: n(r.totalKg),
      calibres: r.calibres.map(mapCalibre),
    })),
    totals: {
      totalKg: n(d.totals.totalKg),
      byCalibre: d.totals.byCalibre.map(mapCalibre),
    },
  }
}
