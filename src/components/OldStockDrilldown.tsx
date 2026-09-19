import type { ReactNode } from 'react'
import type { TypeCalibreCodeKgRow } from '../lib/rahbarDashboardDerived'

// Shared "Эски" (old stock) drill-down: two cards side by side -- "Эски
// (ювилган)" (old washed finished stock, now a full type x calibre
// cross-tab table) and "Старый склад Кондитерка" (old KN pool stock, a
// simple per-type table) -- each with its own total kg header. Built for
// Rahbar's dashboard (RahbarHome.tsx, only rendered at the existing Eski
// scope toggle) and reused unchanged by the client portal's Панель tab
// (ClientPanelTab.tsx) -- see CLAUDE.md task "Rebuild the client
// portal..." Part A/B.1.
//
// Rewritten to tables (2026-09-19, Fix 3) -- replacing the two-graph
// (per-calibre + per-type bars) layout from 2026-09-08/2026-09-16. A
// reader could not answer "how much K4 of Subxon do I have?" from two
// separate one-dimensional breakdowns; a cross-tab answers it directly.
// Both cards render as tables now for visual consistency, even though only
// the Эски (ювилган) one strictly needs two dimensions -- a lone bar chart
// next to a table read as an inconsistent pair.
//
// 🚩 Fixed K1-K8 columns only (matching client Производство's own
// "always all fixed columns" convention, v1.59) -- old-washed stock in a
// KN/numberless calibre is structurally possible but excluded from this
// cross-tab entirely (computeDashboardDerived's regroupByTypeCalibreCode
// drops it), and is currently 0 kg for the one real owner, so this has no
// visible effect today. Flagged, not solved: if that ever becomes nonzero,
// it has nowhere to render in this table and would need its own decision.

export interface OldStockSeriesPoint {
  label: string
  kg: number
}

export interface OldStockSection {
  totalKg: number
  series: OldStockSeriesPoint[]
}

export interface OldStockDrilldownProps {
  oldWashedRows: TypeCalibreCodeKgRow[]
  typeName: (id: string) => string
  oldKn: OldStockSection
}

const CALIBRE_CODES = ['01', '02', '03', '04', '05', '06', '07', '08'] as const
const CALIBRE_COLUMN_LABEL: Record<(typeof CALIBRE_CODES)[number], string> = {
  '01': 'K1',
  '02': 'K2',
  '03': 'K3',
  '04': 'K4',
  '05': 'K5',
  '06': 'K6',
  '07': 'K7',
  '08': 'K8',
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString()
}

function cell(v: number | undefined): string {
  return v && v > 0 ? fmt(v) : '—'
}

interface CrosstabRow {
  typeId: string
  typeLabel: string
  byCode: Partial<Record<string, number>>
  rowTotal: number
}

function CardShell({ title, totalKg, children }: { title: string; totalKg: number; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      <div className="mb-3 text-2xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
        {fmt(totalKg)} <span className="text-sm font-semibold opacity-60">кг</span>
      </div>
      {children}
    </div>
  )
}

function buildCrosstabRows(rows: TypeCalibreCodeKgRow[], typeName: (id: string) => string): CrosstabRow[] {
  const byType = new Map<string, Partial<Record<string, number>>>()
  for (const r of rows) {
    const entry = byType.get(r.typeId) ?? {}
    entry[r.calibreCode] = (entry[r.calibreCode] ?? 0) + r.kg
    byType.set(r.typeId, entry)
  }
  return [...byType.entries()]
    .map(([typeId, byCode]) => ({
      typeId,
      typeLabel: typeName(typeId),
      byCode,
      rowTotal: Object.values(byCode).reduce((sum: number, v) => sum + (v ?? 0), 0),
    }))
    .filter((r) => r.rowTotal > 0)
    .sort((a, b) => b.rowTotal - a.rowTotal)
}

function OldWashedCrosstab({ rows, typeName }: { rows: TypeCalibreCodeKgRow[]; typeName: (id: string) => string }) {
  const crosstabRows = buildCrosstabRows(rows, typeName)
  const columnTotals = CALIBRE_CODES.map((code) => crosstabRows.reduce((sum, r) => sum + (r.byCode[code] ?? 0), 0))
  const grandTotal = crosstabRows.reduce((sum, r) => sum + r.rowTotal, 0)

  if (crosstabRows.length === 0) return <p className="text-sm text-slate-400">Нет данных.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <th className="py-1.5 pr-3">Вид сырья</th>
            {CALIBRE_CODES.map((code) => (
              <th key={code} className="py-1.5 px-2 text-right">
                {CALIBRE_COLUMN_LABEL[code]}
              </th>
            ))}
            <th className="py-1.5 pl-2 text-right">Итого</th>
          </tr>
        </thead>
        <tbody>
          {crosstabRows.map((r) => (
            <tr key={r.typeId} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-1.5 pr-3 whitespace-nowrap">{r.typeLabel}</td>
              {CALIBRE_CODES.map((code) => (
                <td key={code} className="py-1.5 px-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                  {cell(r.byCode[code])}
                </td>
              ))}
              <td className="py-1.5 pl-2 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmt(r.rowTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
            <td className="py-1.5 pr-3">Итого</td>
            {columnTotals.map((v, i) => (
              <td key={CALIBRE_CODES[i]} className="py-1.5 px-2 text-right tabular-nums">
                {cell(v)}
              </td>
            ))}
            <td className="py-1.5 pl-2 text-right tabular-nums">{fmt(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function OldKnTable({ series, totalKg }: OldStockSection) {
  if (series.length === 0) return <p className="text-sm text-slate-400">Нет данных.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[240px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <th className="py-1.5 pr-3">Вид сырья</th>
            <th className="py-1.5 pl-2 text-right">кг</th>
          </tr>
        </thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.label} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-1.5 pr-3 whitespace-nowrap">{p.label}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-slate-900 dark:text-slate-100">{fmt(p.kg)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 font-semibold dark:border-slate-700">
            <td className="py-1.5 pr-3">Итого</td>
            <td className="py-1.5 pl-2 text-right tabular-nums">{fmt(totalKg)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function OldStockDrilldown({ oldWashedRows, typeName, oldKn }: OldStockDrilldownProps) {
  const oldWashedTotalKg = oldWashedRows.reduce((sum, r) => sum + r.kg, 0)
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CardShell title="Эски (ювилган)" totalKg={oldWashedTotalKg}>
        <OldWashedCrosstab rows={oldWashedRows} typeName={typeName} />
      </CardShell>
      <CardShell title="Старый склад Кондитерка" totalKg={oldKn.totalKg}>
        <OldKnTable {...oldKn} />
      </CardShell>
    </div>
  )
}
