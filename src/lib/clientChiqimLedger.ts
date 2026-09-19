import { supabase } from './supabase'

// Расход sub-tab (Отчёт), per-TRUCK (dispatch event) CHIQIM ledger for the
// Global Export client portal — rewritten (CLAUDE.md task "Rebuild the
// client portal...", Fix 2) from the previous per-serial pivot
// (0115/0117) to one row per chiqim_requests.id, no backwards-compat kept
// (the old per-serial frontend is deleted alongside this).
// supabase/migrations/0125_client_chiqim_ledger_per_truck_grain.sql.

// Raw kind values the RPC still emits (unchanged from 0109/0115). 'rezka_kn'
// has zero live rows (Rezka processing is unused) but is folded into the
// Кондитерка Тип bucket below rather than given its own column, matching
// the task's own fixed 5-Тип list.
export type ClientChiqimKind = 'tayyor' | 'konditerka' | 'rezka_kn' | 'vozvrat' | 'eski_yuvilgan' | 'eski_kn'

// The 5 Тип values the task specifies, in display order. Each maps to one
// or more raw `kind` values -- only 'konditerka' is a 2-way merge
// (Кондитерка absorbs the unused rezka_kn bucket too).
export type ClientTip = 'gotovaya' | 'konditerka' | 'vozvrat' | 'eski_yuvilgan' | 'eski_kn'

export const TIP_OPTIONS: { value: ClientTip; label: string }[] = [
  { value: 'gotovaya', label: 'Готовая продукция' },
  { value: 'konditerka', label: 'Кондитерка' },
  { value: 'vozvrat', label: 'Возврат' },
  { value: 'eski_yuvilgan', label: 'Старый склад (ювилган)' },
  { value: 'eski_kn', label: 'Старый склад Кондитерка' },
]

const KIND_TO_TIP: Record<ClientChiqimKind, ClientTip> = {
  tayyor: 'gotovaya',
  konditerka: 'konditerka',
  rezka_kn: 'konditerka',
  vozvrat: 'vozvrat',
  eski_yuvilgan: 'eski_yuvilgan',
  eski_kn: 'eski_kn',
}

const TIP_TO_KINDS: Record<ClientTip, ClientChiqimKind[]> = {
  gotovaya: ['tayyor'],
  konditerka: ['konditerka', 'rezka_kn'],
  vozvrat: ['vozvrat'],
  eski_yuvilgan: ['eski_yuvilgan'],
  eski_kn: ['eski_kn'],
}

const TIP_LABEL: Record<ClientTip, string> = Object.fromEntries(TIP_OPTIONS.map((o) => [o.value, o.label])) as Record<ClientTip, string>

export function tipLabel(tip: ClientTip): string {
  return TIP_LABEL[tip] ?? tip
}

// Color-coded Тип, matching the task's "Color-coded" requirement for the
// Тип column. Swatches, not text color, so it reads at a glance in a
// dense table.
export const TIP_COLOR: Record<ClientTip, { bg: string; text: string }> = {
  gotovaya: { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-800 dark:text-emerald-300' },
  konditerka: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-800 dark:text-amber-300' },
  vozvrat: { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-800 dark:text-rose-300' },
  eski_yuvilgan: { bg: 'bg-sky-100 dark:bg-sky-900/40', text: 'text-sky-800 dark:text-sky-300' },
  eski_kn: { bg: 'bg-slate-200 dark:bg-slate-700', text: 'text-slate-700 dark:text-slate-300' },
}

// Every distinct Тип a truck's raw kinds resolve to, in TIP_OPTIONS order,
// deduped -- a truck usually carries one Тип, but nothing stops a mixed
// load (e.g. Готовая продукция + Возврат on the same truck), rendered as
// several comma-joined badges rather than picking just one.
export function tipsForKinds(kinds: ClientChiqimKind[]): ClientTip[] {
  const set = new Set(kinds.map((k) => KIND_TO_TIP[k]))
  return TIP_OPTIONS.map((o) => o.value).filter((t) => set.has(t))
}

export interface ClientChiqimLedgerFilters {
  from: string
  to: string
  typeId: string // '' = Все (Вид сырья, single-select)
  tips: ClientTip[] // [] treated as "all 5" (default all, per task)
}

export function defaultClientChiqimLedgerFilters(from: string, to: string): ClientChiqimLedgerFilters {
  return { from, to, typeId: '', tips: TIP_OPTIONS.map((o) => o.value) }
}

export interface ClientChiqimCalibre {
  calibreId: string
  label: string
  code: string
  kg: number
}

export interface ClientChiqimTypeShare {
  typeId: string
  kg: number
}

// One row per truck/dispatch event (chiqim_requests.id) -- no per-serial
// identity anywhere in this shape (explicit instruction: "no per-serial
// breakdown"). A truck can carry more than one Вид сырья (typeBreakdown)
// and, for Готовая продукция/Старый склад (ювилган) only, more than one
// calibre (calibreBreakdown) -- see the migration header for why
// Кондитерка/Возврат/Старый склад Кондитерка never populate the latter.
export interface ClientChiqimTruckRow {
  requestId: string
  date: string
  plate: string
  driver: string
  kinds: ClientChiqimKind[]
  tips: ClientTip[] // usually one; more than one is a mixed-load truck
  totalKg: number
  typeBreakdown: ClientChiqimTypeShare[]
  calibreBreakdown: ClientChiqimCalibre[] // [] for Кондитерка/Возврат/Старый склад Кондитерка trucks
}

export interface ClientChiqimLedgerTotals {
  totalKg: number
  byKind: { kind: ClientChiqimKind; kg: number }[]
  tayyorByCalibre: ClientChiqimCalibre[]
}

export interface ClientChiqimLedger {
  period: { from: string; to: string }
  rows: ClientChiqimTruckRow[]
  totals: ClientChiqimLedgerTotals
}

// Top-of-page totals block (task's own list): Всего, Готовая продукция,
// Кондитерка, Возврат, Старый склад ювилган, Старый склад Кондитерка, plus
// the per-calibre Готовая продукция split. All read straight off
// `totals.byKind`/`totals.tayyorByCalibre` -- server-computed, never
// re-summed client-side, same rule as every other client_* ledger here.
export function tipTotals(totals: ClientChiqimLedgerTotals): { tip: ClientTip; kg: number }[] {
  return TIP_OPTIONS.map((o) => ({
    tip: o.value,
    kg: totals.byKind.filter((k) => TIP_TO_KINDS[o.value].includes(k.kind)).reduce((sum, k) => sum + k.kg, 0),
  }))
}

interface RpcCalibre {
  calibreId: string
  label: string
  code: string
  kg: number | string
}
interface RpcTypeShare {
  typeId: string
  kg: number | string
}
interface RpcRow {
  requestId: string
  date: string
  plate: string
  driver: string
  kinds: string // comma-joined, e.g. "tayyor" or "tayyor, vozvrat"
  totalKg: number | string
  typeBreakdown: RpcTypeShare[]
  calibreBreakdown: RpcCalibre[]
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
function parseKinds(s: string): ClientChiqimKind[] {
  return s.split(',').map((k) => k.trim()) as ClientChiqimKind[]
}

export async function fetchClientChiqimLedger(filters: ClientChiqimLedgerFilters): Promise<ClientChiqimLedger> {
  const tips = filters.tips.length > 0 ? filters.tips : TIP_OPTIONS.map((o) => o.value)
  const kinds = [...new Set(tips.flatMap((t) => TIP_TO_KINDS[t]))]
  const { data, error } = await supabase.rpc('client_chiqim_ledger', {
    p_from_date: filters.from,
    p_to_date: filters.to,
    p_kinds: kinds,
    p_type_id: filters.typeId || null,
  })
  if (error) throw error
  const d = data as RpcResponse
  return {
    period: d.period,
    rows: d.rows.map((r) => {
      const kindsArr = parseKinds(r.kinds)
      return {
        requestId: r.requestId,
        date: r.date,
        plate: r.plate,
        driver: r.driver,
        kinds: kindsArr,
        tips: tipsForKinds(kindsArr),
        totalKg: n(r.totalKg),
        typeBreakdown: r.typeBreakdown.map((t) => ({ typeId: t.typeId, kg: n(t.kg) })),
        calibreBreakdown: r.calibreBreakdown.map(mapCalibre),
      }
    }),
    totals: {
      totalKg: n(d.totals.totalKg),
      byKind: d.totals.byKind.map((k) => ({ kind: k.kind, kg: n(k.kg) })),
      tayyorByCalibre: d.totals.tayyorByCalibre.map(mapCalibre),
    },
  }
}
