import { useEffect, useState } from 'react'
import { usePersistentState } from '../../lib/FilterState'
import { useProductTypes } from '../../lib/useProductTypes'
import { FilterField } from '../../components/report/ReportFilterBar'
import {
  TIP_OPTIONS,
  TIP_COLOR,
  tipLabel,
  tipTotals,
  defaultClientChiqimLedgerFilters,
  fetchClientChiqimLedger,
  type ClientTip,
  type ClientChiqimLedger,
  type ClientChiqimLedgerFilters,
  type ClientChiqimSerialRow,
} from '../../lib/clientChiqimLedger'
import { formatDate } from '../../lib/formatDate'
import { downloadClientChiqimLedgerExcel } from '../../lib/clientChiqimLedgerExport'

// Расход sub-tab — rewritten (CLAUDE.md task "Rebuild the client portal..."
// Part B.3) from a flat per-dispatch-event table to one row per serial,
// each expandable to its own per-dispatch detail. See
// src/lib/clientChiqimLedger.ts for the Тип taxonomy and
// supabase/migrations/0114/0116 for the backing RPC pivot.

const pillClass =
  'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'

function kg(v: number): string {
  return `${Math.round(v).toLocaleString()} кг`
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}
function isoFirstOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function calibreString(calibres: { label: string; kg: number }[]): string {
  if (calibres.length === 0) return '—'
  return calibres.map((c) => `${c.label}: ${Math.round(c.kg).toLocaleString()}`).join(', ')
}

// Тип badge(s) — usually one; the task's own "rare edge case" (a serial
// whose dispatches span multiple types in the period) renders as several
// comma-joined badges rather than picking just one and hiding the rest.
function TipBadges({ tips }: { tips: ClientTip[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tips.map((t) => {
        const c = TIP_COLOR[t]
        return (
          <span key={t} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
            {tipLabel(t)}
          </span>
        )
      })}
    </span>
  )
}

function ExpandedDispatches({ row }: { row: ClientChiqimSerialRow }) {
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Отгрузки</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
            <th className="py-1 pr-2">№</th>
            <th className="py-1 pr-2">Дата</th>
            <th className="py-1 pr-2">Машина</th>
            <th className="py-1 pr-2">Водитель</th>
            <th className="py-1 text-right">Кол-во</th>
            <th className="py-1">По калибрам</th>
          </tr>
        </thead>
        <tbody>
          {row.dispatches.map((d, i) => (
            <tr key={d.requestId} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1 pr-2 text-slate-400">N{i + 1}</td>
              <td className="py-1 pr-2 whitespace-nowrap">{formatDate(d.date)}</td>
              <td className="py-1 pr-2 whitespace-nowrap">{d.plate}</td>
              <td className="py-1 pr-2 whitespace-nowrap">{d.driver}</td>
              <td className="py-1 text-right tabular-nums">{kg(d.kg)}</td>
              <td className="py-1 text-xs text-slate-500 dark:text-slate-400">{calibreString(d.calibres)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Top-of-page totals block (task's own list): Всего, one per Тип, plus the
// Готовая продукция per-calibre split. Server-computed (ledger.totals),
// never re-derived from `rows` client-side.
function TotalsBlock({ totals }: { totals: ClientChiqimLedger['totals'] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm dark:border-sky-900 dark:bg-sky-950">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-slate-700 dark:text-slate-300">
          Всего отгружено: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.totalKg)}</span>
        </span>
        {tipTotals(totals).map((t) => (
          <span key={t.tip} className="text-slate-700 dark:text-slate-300">
            {tipLabel(t.tip)}: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(t.kg)}</span>
          </span>
        ))}
      </div>
      {totals.tayyorByCalibre.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sky-100 pt-1 dark:border-sky-900">
          <span className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Готовая продукция по калибрам</span>
          {totals.tayyorByCalibre.map((c) => (
            <span key={c.calibreId} className="text-slate-700 dark:text-slate-300">
              {c.label}: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(c.kg)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function ClientRashodTab() {
  const { productTypes } = useProductTypes(true)
  const defaultRange = { from: isoFirstOfMonth(), to: isoToday() }
  const [filters, setFilters] = usePersistentState<ClientChiqimLedgerFilters>(
    'clientHisobot.rashod.filters',
    defaultClientChiqimLedgerFilters(defaultRange.from, defaultRange.to),
  )
  const [ledger, setLedger] = useState<ClientChiqimLedger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClientChiqimLedger(filters)
      .then((data) => {
        if (!cancelled) setLedger(data)
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
  }, [filters])

  function typeName(id: string): string {
    return productTypes.find((t) => t.id === id)?.name ?? '—'
  }

  function rowKey(row: ClientChiqimSerialRow): string {
    return row.serial ?? `pool-${row.typeId}`
  }

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleExport() {
    if (!ledger) return
    setExporting(true)
    try {
      await downloadClientChiqimLedgerExcel(ledger, typeName)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Период</span>
        <button type="button" onClick={() => setFilters((f) => ({ ...f, from: isoToday(), to: isoToday() }))} className={pillClass}>
          Сегодня
        </button>
        <button type="button" onClick={() => setFilters((f) => ({ ...f, from: isoFirstOfMonth(), to: isoToday() }))} className={pillClass}>
          Этот месяц
        </button>
        <label className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className={pillClass}
          />
          —
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={pillClass} />
        </label>

        <FilterField
          label="Вид сырья"
          allLabel="Все"
          options={productTypes.map((t) => ({ value: t.id, label: t.name }))}
          selected={filters.typeId ? [filters.typeId] : []}
          onChange={(vals) => setFilters((f) => ({ ...f, typeId: vals[0] ?? '' }))}
          multi={false}
          compact
        />

        <FilterField
          label="Тип отгрузки"
          allLabel="Все"
          options={TIP_OPTIONS}
          selected={filters.tips}
          onChange={(vals) => setFilters((f) => ({ ...f, tips: vals as ClientTip[] }))}
          multi
          compact
        />

        <button
          type="button"
          onClick={handleExport}
          disabled={!ledger || exporting}
          className="ml-auto rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {exporting ? 'Экспорт…' : 'Скачать Excel'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Загрузка…</p>}

      {!loading && !error && ledger && <TotalsBlock totals={ledger.totals} />}

      {!loading && !error && ledger && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <th className="px-3 py-2" />
                <th className="px-3 py-2">Серия</th>
                <th className="px-3 py-2">Вид сырья</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2 text-right">ИТОГО отгружено (кг)</th>
                <th className="px-3 py-2">ИТОГО по калибрам</th>
                <th className="px-3 py-2 text-right">Отгрузок</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
              {ledger.rows.map((row) => {
                const key = rowKey(row)
                const isOpen = expanded.has(key)
                return (
                  <>
                    <tr
                      key={key}
                      onClick={() => toggle(key)}
                      className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                    >
                      <td className="px-3 py-2">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                        </svg>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {/* Bare dash, no annotation — matches the internal Hisobot's own
                            convention for a chiqim_old_kn row exactly (ReportTableRow.tsx's
                            Серия cell: `row.kind === 'chiqim_old_kn' ? '—' : row.serial`).
                            The Тип badge in the next column already says "Старый склад
                            Кондитерка", so the row isn't ambiguous without extra text here. */}
                        {row.isPool ? <span className="text-slate-400">—</span> : row.serial}
                      </td>
                      <td className="px-3 py-2">{typeName(row.typeId)}</td>
                      <td className="px-3 py-2">
                        <TipBadges tips={row.tips} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.totalKg)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{calibreString(row.calibres)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.dispatchCount}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${key}-panel`}>
                        <td colSpan={7} className="p-0">
                          <ExpandedDispatches row={row} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
