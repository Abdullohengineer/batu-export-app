import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePersistentState } from '../../lib/FilterState'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { queryKeys } from '../../lib/queryClient'
import { useProductTypes } from '../../lib/useProductTypes'
import { FilterField } from '../../components/report/ReportFilterBar'
import { StatusNote } from '../../components/ui/StatusNote'
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
  type ClientChiqimTruckRow,
} from '../../lib/clientChiqimLedger'
import { formatDate } from '../../lib/formatDate'
import { downloadClientChiqimLedgerExcel } from '../../lib/clientChiqimLedgerExport'
import { todayInTashkent, firstOfMonthInTashkent } from '../../lib/dateRange'

// Расход sub-tab — rewritten (CLAUDE.md task "Rebuild the client
// portal...", Fix 2) from a per-serial table to one row per TRUCK/dispatch
// event (chiqim_requests.id), no per-serial breakdown anywhere -- a serial
// is single-type by construction (CLAUDE.md) but a truck is not, so the
// expand panel breaks a truck's load down by Вид сырья and (for Готовая
// продукция/Старый склад ювилган only) by calibre instead. See
// src/lib/clientChiqimLedger.ts for the Тип taxonomy and
// supabase/migrations/0125_client_chiqim_ledger_per_truck_grain.sql for the
// backing RPC regrain.

const pillClass =
  'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'

function kg(v: number): string {
  return `${Math.round(v).toLocaleString()} кг`
}

// Тип badge(s) — usually one; a mixed-load truck (rare) renders as several
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

function ExpandedTruck({ row, typeName }: { row: ClientChiqimTruckRow; typeName: (id: string) => string }) {
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">По видам сырья</p>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
        {row.typeBreakdown.map((t) => (
          <span key={t.typeId}>
            {typeName(t.typeId)}: <span className="font-medium">{kg(t.kg)}</span>
          </span>
        ))}
      </div>
      {/* Only Готовая продукция/Старый склад (ювилган) trucks ever populate
          this -- Кондитерка/Возврат/Старый склад Кондитерка have no calibre
          data at all (see the backing RPC's own comment), so the section is
          simply omitted rather than shown empty. */}
      {row.calibreBreakdown.length > 0 && (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">По калибрам</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
            {row.calibreBreakdown.map((c) => (
              <span key={c.calibreId}>
                {c.label}: <span className="font-medium">{kg(c.kg)}</span>
              </span>
            ))}
          </div>
        </>
      )}
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
  // 2026-09-21 (Phase 2 step 1) -- error folded into the query error below.
  const { productTypes, error: productTypesError } = useProductTypes(true)
  const defaultRange = { from: firstOfMonthInTashkent(), to: todayInTashkent() }
  const [filters, setFilters] = usePersistentState<ClientChiqimLedgerFilters>(
    'clientHisobot.rashod.filters',
    defaultClientChiqimLedgerFilters(defaultRange.from, defaultRange.to),
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  // 2026-09-19 (Phase 1B): was a bare useEffect that re-fired
  // client_chiqim_ledger on every filter object change — no debounce, no
  // cancellation, no cache. Debounced so a date-picker tick doesn't fire an
  // RPC per change, and moved onto React Query so returning to this tab
  // within the cache window reuses the result instead of re-querying.
  const debouncedFilters = useDebouncedValue(filters)
  const filterKey = JSON.stringify(debouncedFilters)
  const {
    data: ledger = null,
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.clientChiqimLedger(filterKey),
    queryFn: () => fetchClientChiqimLedger(debouncedFilters),
  })
  const error = queryError ? (queryError.message ?? 'Ошибка загрузки') : productTypesError

  function typeName(id: string): string {
    return productTypes.find((t) => t.id === id)?.name ?? '—'
  }

  function toggle(requestId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(requestId)) next.delete(requestId)
      else next.add(requestId)
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
        <button type="button" onClick={() => setFilters((f) => ({ ...f, from: todayInTashkent(), to: todayInTashkent() }))} className={pillClass}>
          Сегодня
        </button>
        <button type="button" onClick={() => setFilters((f) => ({ ...f, from: firstOfMonthInTashkent(), to: todayInTashkent() }))} className={pillClass}>
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

      {error && <StatusNote tone="problem">{error}</StatusNote>}
      {loading && <p className="text-sm text-slate-400">Загрузка…</p>}

      {!loading && !error && ledger && <TotalsBlock totals={ledger.totals} />}

      {!loading && !error && ledger && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <th className="px-3 py-2" />
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Машина</th>
                <th className="px-3 py-2">Водитель</th>
                <th className="px-3 py-2 text-right">Всего кг</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
              {ledger.rows.map((row) => {
                const isOpen = expanded.has(row.requestId)
                return (
                  <>
                    <tr
                      key={row.requestId}
                      onClick={() => toggle(row.requestId)}
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
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="px-3 py-2">
                        <TipBadges tips={row.tips} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.plate}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.driver}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.totalKg)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${row.requestId}-panel`}>
                        <td colSpan={6} className="p-0">
                          <ExpandedTruck row={row} typeName={typeName} />
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
