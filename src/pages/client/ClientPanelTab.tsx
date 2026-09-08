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

// `caption` is optional (2026-09-08) — only the two split old-stock tiles
// use it, matching Rahbar dashboard's own caption line under its old-KN
// tile; the other four tiles are unchanged, still caption-less.
function Tile({ label, value, color, caption }: { label: string; value: number; color: string; caption?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1.5 text-2xl font-extrabold tabular-nums" style={{ color }}>
        {kg(value)}
      </div>
      {caption && <div className="mt-1.5 text-xs text-slate-400">{caption}</div>}
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Всего на складе" value={totalStock} color="#0f172a" />
        <Tile label="Сырьё" value={summary.stock.rawKg} color="#d97706" />
        <Tile label="В мойке" value={summary.stock.moykaKg} color="#0369a1" />
        <Tile label="Готовая продукция" value={summary.stock.finishedKg} color="#059669" />
        {/* Split from the old combined "Старый склад" tile (2026-09-08), per
            explicit instruction to mirror Rahbar dashboard's own tile
            structure 1:1. Both numbers were already fetched (oldStock, used
            below by OldStockDrilldown) -- no new query, frontend-only.
            Старый склад Кондитерка: same color (#78716c, stone-gray) and
            caption pattern as Rahbar's own 6th hero tile (RahbarHome.tsx,
            tone="oldKn") -- an exact counterpart, same position (last in the
            row) on both dashboards. Эски ювилган has no Rahbar HERO TILE
            counterpart to mirror (Rahbar only shows it as a drill-down graph,
            never a hero tile) -- color reuses that drill-down graph's own
            established green (#059669, OldStockDrilldown.tsx), which is also
            already this screen's "Готовая продукция" color; flagged in
            DECISIONS.md rather than silently picked, since Rahbar's own page
            never has to face that particular adjacency. */}
        <Tile
          label="Эски ювилган"
          value={oldStock.oldWashed.totalKg}
          color="#059669"
          caption="Текущий остаток · промытая продукция"
        />
        <Tile
          label="Старый склад Кондитерка"
          value={oldStock.oldKn.totalKg}
          color="#78716c"
          caption="Текущий остаток · из бассейна"
        />
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
