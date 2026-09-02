import { useEffect, useState } from 'react'
import { usePersistentState } from '../../lib/FilterState'
import { useProductTypes } from '../../lib/useProductTypes'
import { FilterField } from '../../components/report/ReportFilterBar'
import {
  CLIENT_CHIQIM_KIND_OPTIONS,
  KIND_COLOR,
  chiqimKindLabel,
  defaultClientChiqimLedgerFilters,
  fetchClientChiqimLedger,
  type ClientChiqimKind,
  type ClientChiqimLedger,
  type ClientChiqimLedgerFilters,
} from '../../lib/clientChiqimLedger'
import { formatDate } from '../../lib/formatDate'
import { downloadClientChiqimLedgerExcel } from '../../lib/clientChiqimLedgerExport'

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

function KindBadge({ kind }: { kind: ClientChiqimKind }) {
  const c = KIND_COLOR[kind]
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {chiqimKindLabel(kind)}
    </span>
  )
}

function calibreString(calibres: { label: string; kg: number }[] | null): string {
  if (!calibres || calibres.length === 0) return '—'
  return calibres.map((c) => `${c.label}: ${Math.round(c.kg).toLocaleString()}`).join(', ')
}

// Totals bar — server-computed (ledger.totals), never re-derived from
// `rows` client-side, same rule as ClientPrihodTab's TotalsBar.
function TotalsBar({ totals }: { totals: ClientChiqimLedger['totals'] }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm backdrop-blur dark:border-sky-900 dark:bg-sky-950">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-slate-700 dark:text-slate-300">
          Всего отгружено: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.totalKg)}</span>
        </span>
        {CLIENT_CHIQIM_KIND_OPTIONS.map((o) => {
          const t = totals.byKind.find((k) => k.kind === o.value)
          return (
            <span key={o.value} className="text-slate-700 dark:text-slate-300">
              {o.label}: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(t?.kg ?? 0)}</span>
            </span>
          )
        })}
      </div>
      {totals.tayyorByCalibre.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sky-100 pt-1 dark:border-sky-900">
          <span className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Тайёр по калибрам</span>
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
          label="Тури"
          allLabel="Все"
          options={CLIENT_CHIQIM_KIND_OPTIONS}
          selected={filters.kinds}
          onChange={(vals) => setFilters((f) => ({ ...f, kinds: vals as ClientChiqimKind[] }))}
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

      {!loading && !error && ledger && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <th className="px-3 py-2">Тури</th>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Вид сырья</th>
                <th className="px-3 py-2">Серия</th>
                <th className="px-3 py-2 text-right">Кол-во (кг)</th>
                <th className="px-3 py-2">По калибрам</th>
                <th className="px-3 py-2">Мошина №</th>
                <th className="px-3 py-2">Водитель</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
              {ledger.rows.map((row, i) => (
                <tr
                  key={`${row.requestId}-${row.kind}-${i}`}
                  className="border-b border-slate-100 align-top dark:border-slate-800"
                >
                  <td className="px-3 py-2">
                    <KindBadge kind={row.kind} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="px-3 py-2">{typeName(row.typeId)}</td>
                  <td className="px-3 py-2">{row.serials ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{kg(row.kg)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{calibreString(row.calibres)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.plate}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.driver}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && ledger && <TotalsBar totals={ledger.totals} />}
    </div>
  )
}
