import { supabase } from './supabase'

// Расход sub-tab (Профиль → Отчёт), per-dispatch-event CHIQIM ledger for
// the Global Export client portal. Reads client_chiqim_ledger()
// (supabase/migrations/0107_client_serial_and_chiqim_ledger.sql) — same
// self-scoping (my_owner_id()) as clientSerialLedger.ts.

export type ClientChiqimKind = 'tayyor' | 'konditerka' | 'rezka_kn' | 'xom' | 'vozvrat' | 'eski_yuvilgan' | 'eski_kn'

// "Хом" (xom) has zero rows by construction — chiqim_lines.line_kind='raw'
// carries no field distinguishing a sale from a return, so every such row
// is labelled Возврат (confirmed against the schema before this shipped;
// see migration 0107's own header comment). Listed here anyway so the
// filter and totals bar both show all 7 categories, not 6 — a client
// reading "Хом: 0" is told something real; a missing row would just look
// like an omission.
export const CLIENT_CHIQIM_KIND_OPTIONS: { value: ClientChiqimKind; label: string }[] = [
  { value: 'tayyor', label: 'Тайёр' },
  { value: 'konditerka', label: 'Кондерка' },
  { value: 'rezka_kn', label: 'Резка KN' },
  { value: 'xom', label: 'Хом' },
  { value: 'vozvrat', label: 'Возврат' },
  { value: 'eski_yuvilgan', label: 'Эски (ювилган)' },
  { value: 'eski_kn', label: 'Эски KN' },
]

const KIND_LABEL: Record<ClientChiqimKind, string> = Object.fromEntries(
  CLIENT_CHIQIM_KIND_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ClientChiqimKind, string>

export function chiqimKindLabel(kind: ClientChiqimKind): string {
  return KIND_LABEL[kind] ?? kind
}

// Тури color-coding — swatches, not text color, so the badge reads at a
// glance in a dense table. Xom given its own color despite being
// permanently empty, so the day a schema fix lets it carry real rows this
// already looks right.
export const KIND_COLOR: Record<ClientChiqimKind, { bg: string; text: string }> = {
  tayyor: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300' },
  konditerka: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300' },
  rezka_kn: { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-800 dark:text-violet-300' },
  xom: { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-800 dark:text-orange-300' },
  vozvrat: { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-300' },
  eski_yuvilgan: { bg: 'bg-sky-100 dark:bg-sky-900/40', text: 'text-sky-800 dark:text-sky-300' },
  eski_kn: { bg: 'bg-slate-200 dark:bg-slate-700', text: 'text-slate-700 dark:text-slate-300' },
}

export interface ClientChiqimLedgerFilters {
  from: string
  to: string
  kinds: ClientChiqimKind[] // [] = every kind
}

export function defaultClientChiqimLedgerFilters(from: string, to: string): ClientChiqimLedgerFilters {
  return { from, to, kinds: [] }
}

export interface ClientChiqimCalibre {
  calibreId: string
  label: string
  code: string
  kg: number
}

export interface ClientChiqimLedgerRow {
  requestId: string
  date: string
  plate: string
  driver: string
  kind: ClientChiqimKind
  typeId: string
  serials: string | null // comma-joined, null for Эски KN (pool stock, no serial)
  kg: number
  calibres: ClientChiqimCalibre[] | null // only Тайёр / Эски (ювилган)
}

export interface ClientChiqimLedgerTotals {
  totalKg: number
  byKind: { kind: ClientChiqimKind; kg: number }[]
  tayyorByCalibre: ClientChiqimCalibre[]
}

export interface ClientChiqimLedger {
  period: { from: string; to: string }
  rows: ClientChiqimLedgerRow[]
  totals: ClientChiqimLedgerTotals
}

interface RpcCalibre {
  calibreId: string
  label: string
  code: string
  kg: number | string
}
interface RpcRow {
  requestId: string
  date: string
  plate: string
  driver: string
  kind: ClientChiqimKind
  typeId: string
  serials: string | null
  kg: number | string
  calibres: RpcCalibre[] | null
}
interface RpcResponse {
  period: { from: string; to: string }
  rows: RpcRow[]
  totals: {
    totalKg: number | string
    byKind: { kind: ClientChiqimKind; kg: number | string }[]
    tayyorByCalibre: RpcCalibre[]
  }
}

function n(v: number | string): number {
  return Number(v)
}
function mapCalibre(c: RpcCalibre): ClientChiqimCalibre {
  return { calibreId: c.calibreId, label: c.label, code: c.code, kg: n(c.kg) }
}

export async function fetchClientChiqimLedger(filters: ClientChiqimLedgerFilters): Promise<ClientChiqimLedger> {
  const { data, error } = await supabase.rpc('client_chiqim_ledger', {
    p_from_date: filters.from,
    p_to_date: filters.to,
    p_kinds: filters.kinds.length > 0 ? filters.kinds : null,
  })
  if (error) throw error
  const d = data as RpcResponse
  return {
    period: d.period,
    rows: d.rows.map((r) => ({
      requestId: r.requestId,
      date: r.date,
      plate: r.plate,
      driver: r.driver,
      kind: r.kind,
      typeId: r.typeId,
      serials: r.serials,
      kg: n(r.kg),
      calibres: r.calibres ? r.calibres.map(mapCalibre) : null,
    })),
    totals: {
      totalKg: n(d.totals.totalKg),
      byKind: d.totals.byKind.map((k) => ({ kind: k.kind, kg: n(k.kg) })),
      tayyorByCalibre: d.totals.tayyorByCalibre.map(mapCalibre),
    },
  }
}
