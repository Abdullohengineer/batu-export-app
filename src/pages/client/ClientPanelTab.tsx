import { useEffect, useState } from 'react'
import { OldStockDrilldown } from '../../components/OldStockDrilldown'
import { fetchClientOldStockBreakdown, fetchClientPanelSummary, type ClientOldStockBreakdown, type ClientPanelSummary } from '../../lib/clientPanelSummary'

// Панель tab (CLAUDE.md task "Rebuild the client portal..." Part B.1) —
// a restricted, self-scoped version of Rahbar's main dashboard. Deliberately
// excludes yield %, per-worker productivity, cost fields, other clients'
// aggregate data, three-ledger reconciliation, and Moykada raw diagnostic
// tiles (task's own exclusion list) -- this screen shows only current
// stock by state, what has left the factory, and the Эски drill-down.

function kg(v: number): string {
  return `${Math.round(v).toLocaleString()} кг`
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1.5 text-2xl font-extrabold tabular-nums" style={{ color }}>
        {kg(value)}
      </div>
    </div>
  )
}

export function ClientPanelTab() {
  const [summary, setSummary] = useState<ClientPanelSummary | null>(null)
  const [oldStock, setOldStock] = useState<ClientOldStockBreakdown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchClientPanelSummary(), fetchClientOldStockBreakdown()])
      .then(([s, o]) => {
        if (cancelled) return
        setSummary(s)
        setOldStock(o)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (loading || !summary || !oldStock) return <p className="text-sm text-slate-400">Загрузка…</p>

  const totalStock = summary.stock.rawKg + summary.stock.moykaKg + summary.stock.finishedKg + summary.stock.oldStockKg

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Всего на складе" value={totalStock} color="#0f172a" />
        <Tile label="Сырьё" value={summary.stock.rawKg} color="#d97706" />
        <Tile label="В мойке" value={summary.stock.moykaKg} color="#0369a1" />
        <Tile label="Готовая продукция" value={summary.stock.finishedKg} color="#059669" />
        <Tile label="Старый склад" value={summary.stock.oldStockKg} color="#78716c" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Отгружено со склада</div>
        <div className="mt-1.5 text-2xl font-extrabold tabular-nums text-red-600 dark:text-red-400">{kg(summary.dispatchedKg)}</div>
        <p className="mt-1 text-xs text-slate-400">Всего материала, покинувшего фабрику</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Старый склад — подробно</div>
        <OldStockDrilldown oldWashed={oldStock.oldWashed} oldKn={oldStock.oldKn} />
      </div>
    </div>
  )
}
