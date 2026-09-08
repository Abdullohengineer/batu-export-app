import { HorizontalBar } from './ui/HorizontalBar'

// Shared "Эски" (old stock) drill-down: two sections side by side --
// "Эски (ювилган)" (old washed finished stock, by calibre) and "Старый
// склад Кондитерка" (old KN pool stock, by Vid syrya) -- each with its own
// total kg header. Built for Rahbar's dashboard (RahbarHome.tsx, only
// rendered at the existing Eski scope toggle) and reused unchanged by the
// client portal's Панель tab (ClientPanelTab.tsx) -- see CLAUDE.md task
// "Rebuild the client portal..." Part A/B.1. Deliberately data-shape-only
// (label/kg pairs) so each caller supplies its own already-scoped totals
// (Rahbar: all owners; client: self-scoped via my_owner_id()) without this
// component knowing which.
//
// Horizontal-bar-per-row layout (2026-09-08, replacing a recharts
// <BarChart> per section) -- same visual as RahbarHome.tsx's own "Omborda
// hozir — kalibr bo'yicha" section, via the extracted shared HorizontalBar
// (src/components/ui/HorizontalBar.tsx). recharts is now unused anywhere in
// this app and was removed as a dependency in the same change (confirmed:
// this file was its only caller).

export interface OldStockSeriesPoint {
  label: string
  kg: number
}

export interface OldStockSection {
  totalKg: number
  series: OldStockSeriesPoint[]
}

export interface OldStockDrilldownProps {
  oldWashed: OldStockSection
  oldKn: OldStockSection
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString()
}

function Section({ title, totalKg, series, color }: { title: string; totalKg: number; series: OldStockSeriesPoint[]; color: string }) {
  const max = Math.max(1, ...series.map((p) => p.kg))
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      <div className="mb-3 text-2xl font-extrabold tabular-nums" style={{ color }}>
        {fmt(totalKg)} <span className="text-sm font-semibold opacity-60">кг</span>
      </div>
      {series.length === 0 ? (
        <p className="text-sm text-slate-400">Нет данных.</p>
      ) : (
        <div className="space-y-2.5">
          {series.map((p) => (
            <HorizontalBar
              key={p.label}
              label={p.label}
              value={p.kg}
              max={max}
              color={color}
              pctOfLabel={totalKg > 0 ? `${Math.round((p.kg / totalKg) * 100)}%` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function OldStockDrilldown({ oldWashed, oldKn }: OldStockDrilldownProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Section title="Эски (ювилган)" totalKg={oldWashed.totalKg} series={oldWashed.series} color="#059669" />
      <Section title="Старый склад Кондитерка" totalKg={oldKn.totalKg} series={oldKn.series} color="#78716c" />
    </div>
  )
}
