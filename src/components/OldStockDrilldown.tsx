import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// Shared "Эски" (old stock) drill-down: two separate graphs side by side --
// "Эски (ювилган)" (old washed finished stock, by calibre) and "Старый
// склад Кондитерка" (old KN pool stock, by Vid syrya) -- each with its own
// total kg header. Built for Rahbar's dashboard (RahbarHome.tsx, only
// rendered at the existing Eski scope toggle) and reused unchanged by the
// client portal's Панель tab (ClientPanelTab.tsx) -- see CLAUDE.md task
// "Rebuild the client portal..." Part A/B.1. Deliberately data-shape-only
// (label/kg pairs) so each caller supplies its own already-scoped totals
// (Rahbar: all owners; client: self-scoped via my_owner_id()) without this
// component knowing which.

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

function Graph({ title, totalKg, series, color }: { title: string; totalKg: number; series: OldStockSeriesPoint[]; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
      <div className="mb-3 text-2xl font-extrabold tabular-nums" style={{ color }}>
        {fmt(totalKg)} <span className="text-sm font-semibold opacity-60">кг</span>
      </div>
      {series.length === 0 ? (
        <p className="text-sm text-slate-400">Нет данных.</p>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} width={48} />
              <Tooltip formatter={(v: number) => [`${fmt(v)} кг`, '']} labelFormatter={(l) => l} />
              <Bar dataKey="kg" fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export function OldStockDrilldown({ oldWashed, oldKn }: OldStockDrilldownProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Graph title="Эски (ювилган)" totalKg={oldWashed.totalKg} series={oldWashed.series} color="#059669" />
      <Graph title="Старый склад Кондитерка" totalKg={oldKn.totalKg} series={oldKn.series} color="#78716c" />
    </div>
  )
}
