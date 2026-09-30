import { callRpc } from './rpc'

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
  partiyaNo: number | null
  kirimDate: string | null
  nakladnoyKg: number
  nettoKg: number
  moykagaYuborilganKg: number
  moykadaKg: number
  ostatokSyryaKg: number
  totalKg: number
  calibres: ClientProductionCalibre[]
  // null = cycle still open within the period (В мойке explains why) --
  // never coerced to 0, same as report_totals' own state_yoqotish/loss_range
  // convention this reuses (kirim_line_loss_range).
  poteryaKg: number | null
}

export interface ClientProductionTotals {
  nettoKg: number
  moykagaYuborilganKg: number
  moykadaKg: number
  ostatokSyryaKg: number
  totalKg: number
  byCalibre: ClientProductionCalibre[]
  // Sum of non-null poteryaKg rows only (server-side, see migration 0154).
  poteryaKg: number
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

// Fixed column set (Серия | Вид сырья | Всего произведено | K1..K8 |
// Кондитерка) -- all 9 always render, regardless of whether a given
// calibre has any data in the filtered period (an empty cell shows "—",
// the column itself is never hidden). Corrected 2026-09-19 (see
// docs/decisions/) -- the original build hardcoded a narrower 6-code
// subset (K1/K2/K3/K4/K6/KN) that permanently excluded K5/K7/K8 from the
// table no matter what the data held, which read as "some calibres go
// missing." client_production_ledger() itself already returns every
// calibre actually present, unfiltered -- this list was always a
// frontend-only restriction, never an RPC limitation.
export const PRODUCTION_CALIBRE_CODES = ['01', '02', '03', '04', '05', '06', '07', '08', 'KN'] as const

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
  partiyaNo: number | null
  kirimDate: string | null
  nakladnoyKg: number | string
  nettoKg: number | string
  moykagaYuborilganKg: number | string
  moykadaKg: number | string
  ostatokSyryaKg: number | string
  totalKg: number | string
  calibres: RpcCalibre[]
  poteryaKg: number | string | null
}
interface RpcResponse {
  period: { from: string; to: string }
  rows: RpcRow[]
  totals: {
    nettoKg: number | string
    moykagaYuborilganKg: number | string
    moykadaKg: number | string
    ostatokSyryaKg: number | string
    totalKg: number | string
    byCalibre: RpcCalibre[]
    poteryaKg: number | string
  }
}

function n(v: number | string): number {
  return Number(v)
}
function mapCalibre(c: RpcCalibre): ClientProductionCalibre {
  return { calibreId: c.calibreId, label: c.label, code: c.code, kg: n(c.kg) }
}

// `signal`: see fetchClientChiqimLedger's own note -- same rule, same reason.
export async function fetchClientProductionLedger(
  filters: ClientProductionFilters,
  signal?: AbortSignal,
): Promise<ClientProductionLedger> {
  const d = await callRpc<RpcResponse>(
    'client_production_ledger',
    {
      p_from_date: filters.from,
      p_to_date: filters.to,
      p_product_type_id: filters.typeId || null,
    },
    signal,
  )
  return {
    period: d.period,
    rows: d.rows.map((r) => ({
      serial: r.serial,
      typeId: r.typeId,
      partiyaNo: r.partiyaNo,
      kirimDate: r.kirimDate,
      nakladnoyKg: n(r.nakladnoyKg),
      nettoKg: n(r.nettoKg),
      moykagaYuborilganKg: n(r.moykagaYuborilganKg),
      moykadaKg: n(r.moykadaKg),
      ostatokSyryaKg: n(r.ostatokSyryaKg),
      totalKg: n(r.totalKg),
      calibres: r.calibres.map(mapCalibre),
      poteryaKg: r.poteryaKg == null ? null : n(r.poteryaKg),
    })),
    totals: {
      nettoKg: n(d.totals.nettoKg),
      moykagaYuborilganKg: n(d.totals.moykagaYuborilganKg),
      moykadaKg: n(d.totals.moykadaKg),
      ostatokSyryaKg: n(d.totals.ostatokSyryaKg),
      totalKg: n(d.totals.totalKg),
      byCalibre: d.totals.byCalibre.map(mapCalibre),
      poteryaKg: n(d.totals.poteryaKg),
    },
  }
}
