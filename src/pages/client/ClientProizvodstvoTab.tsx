import { useEffect, useState } from 'react'
import { usePersistentState } from '../../lib/FilterState'
import { useProductTypes } from '../../lib/useProductTypes'
import { FilterField } from '../../components/report/ReportFilterBar'
import {
  PRODUCTION_CALIBRE_CODES,
  calibreKgByCode,
  defaultClientProductionFilters,
  fetchClientProductionLedger,
  type ClientProductionFilters,
  type ClientProductionLedger,
} from '../../lib/clientProductionLedger'
import { downloadClientProductionLedgerExcel } from '../../lib/clientProductionLedgerExport'

// Производство sub-tab (NEW, CLAUDE.md task "Rebuild the client portal..."
// Part B.4) — per-serial calendar view of pack output within the filter
// period. A serial with zero output in the period is simply absent from
// `rows` (the RPC only returns serials with output) rather than hidden
// client-side, matching the task's own "hidden" instruction exactly.

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

const COLUMN_LABEL: Record<(typeof PRODUCTION_CALIBRE_CODES)[number], string> = {
  '01': 'K1',
  '02': 'K2',
  '03': 'K3',
  '04': 'K4',
  '06': 'K6',
  KN: 'Кондитерка',
}

function TotalsBlock({ totals }: { totals: ClientProductionLedger['totals'] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm dark:border-sky-900 dark:bg-sky-950">
      <span className="text-slate-700 dark:text-slate-300">
        Всего произведено: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.totalKg)}</span>
      </span>
      {totals.byCalibre.map((c) => (
        <span key={c.calibreId} className="text-slate-700 dark:text-slate-300">
          {c.label}: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(c.kg)}</span>
        </span>
      ))}
    </div>
  )
}

export function ClientProizvodstvoTab() {
  const { productTypes } = useProductTypes(true)
  const defaultRange = { from: isoFirstOfMonth(), to: isoToday() }
  const [filters, setFilters] = usePersistentState<ClientProductionFilters>(
    'clientHisobot.proizvodstvo.filters',
    defaultClientProductionFilters(defaultRange.from, defaultRange.to),
  )
  const [ledger, setLedger] = useState<ClientProductionLedger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClientProductionLedger(filters)
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

  async function handleExport() {
    if (!ledger) return
    setExporting(true)
    try {
      await downloadClientProductionLedgerExcel(ledger, typeName)
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
                <th className="px-3 py-2">Серия</th>
                <th className="px-3 py-2">Вид сырья</th>
                <th className="px-3 py-2 text-right">Всего произведено (кг)</th>
                {PRODUCTION_CALIBRE_CODES.map((code) => (
                  <th key={code} className="px-3 py-2 text-right">
                    {COLUMN_LABEL[code]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 && (
                <tr>
                  <td colSpan={3 + PRODUCTION_CALIBRE_CODES.length} className="px-3 py-6 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
              {ledger.rows.map((row) => (
                <tr key={row.serial} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 whitespace-nowrap">{row.serial}</td>
                  <td className="px-3 py-2">{typeName(row.typeId)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{kg(row.totalKg)}</td>
                  {PRODUCTION_CALIBRE_CODES.map((code) => {
                    const v = calibreKgByCode(row.calibres, code)
                    return (
                      <td key={code} className="px-3 py-2 text-right tabular-nums">
                        {v > 0 ? Math.round(v).toLocaleString() : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
