import { useEffect, useState } from 'react'
import { usePersistentState } from '../../lib/FilterState'
import { useProductTypes } from '../../lib/useProductTypes'
import { FilterField } from '../../components/report/ReportFilterBar'
import {
  defaultClientSerialLedgerFilters,
  fetchClientSerialLedger,
  type ClientSerialLedgerFilters,
  type ClientSerialLedgerRow,
  type ClientSerialLedger,
} from '../../lib/clientSerialLedger'
import { formatDate } from '../../lib/formatDate'
import { formatLossKg } from '../../lib/formatLoss'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { downloadClientSerialLedgerExcel } from '../../lib/clientSerialLedgerExport'

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

// Gap sign convention matches formatLossKg's own documented rule (see
// formatLoss.ts) exactly: positive = real loss (bare, red), negative =
// surplus (explicit "+", green). SPEC.md's column K description reads the
// opposite ("negative = loss") but that contradicts the actual arithmetic
// (На переработку − ИТОГО переработка is positive when less came back than
// went in) and this codebase's own established convention for every other
// signed loss figure — the sign itself is unchanged from the raw
// SQL value, only the color/prefix follow formatLossKg.
function GapCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>
  const color = value > 0 ? 'text-red-600 dark:text-red-400' : value < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
  return <span className={color}>{formatLossKg(value, 'кг')}</span>
}

// Plain signed weight variance (Приход нетто − Приход по накладной) — NOT
// a loss/surplus narrative, so this does NOT use formatLossKg's inverted
// sign convention (that one is specifically for the На переработку ↔
// ИТОГО переработка processing gap). A positive value here just means
// more arrived than the накладная said; shown with an explicit "+" since
// JS's default number formatting only prefixes negatives.
function signedKg(v: number): string {
  const r = Math.round(v)
  return `${r > 0 ? '+' : ''}${r.toLocaleString()} кг`
}

function CalibreSummary({ row }: { row: ClientSerialLedgerRow }) {
  const parts = row.calibres
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((c) => `${c.isNumberless ? 'КН' : c.label}: ${Math.round(c.kg).toLocaleString()}`)
  if (parts.length === 0) return <span className="text-slate-400">—</span>
  return <span className="text-xs text-slate-500 dark:text-slate-400">{parts.join(', ')}</span>
}

function ExpandedPanel({ row }: { row: ClientSerialLedgerRow }) {
  return (
    <div className="grid gap-4 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40 md:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Готовый продукт по калибрам
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
              <th className="py-1 pr-2">№</th>
              <th className="py-1 text-right">Готовый продукт (кг)</th>
              <th className="py-1 text-right">Кондерка</th>
            </tr>
          </thead>
          <tbody>
            {row.calibres.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-slate-400">
                  Нет данных
                </td>
              </tr>
            )}
            {row.calibres.map((c) => (
              <tr key={c.calibreId} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2">{c.label}</td>
                <td className="py-1 text-right tabular-nums">{!c.isNumberless ? kg(c.kg) : '—'}</td>
                <td className="py-1 text-right tabular-nums">{c.isNumberless ? kg(c.kg) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Отгрузка</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 dark:text-slate-400">
              <th className="py-1 pr-2">Дата отгрузки</th>
              <th className="py-1 pr-2">№</th>
              <th className="py-1 text-right">Кол-во (кг)</th>
            </tr>
          </thead>
          <tbody>
            {row.dispatches.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-slate-400">
                  Ещё не отгружено
                </td>
              </tr>
            )}
            {row.dispatches.map((d, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-1 pr-2 whitespace-nowrap">{formatDate(d.date)}</td>
                <td className="py-1 pr-2">{d.label}</td>
                <td className="py-1 text-right tabular-nums">{kg(d.kg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// TotalsBar — server-computed only (ledger.totals from client_serial_ledger
// itself), never summed client-side from `rows` (rows can be a partial/
// filtered view of what the totals object covers, and the task's own
// requirement is explicit: totals must come from the same RPC call as the
// rows, not be re-derived in JS).
function TotalsBar({ totals }: { totals: ClientSerialLedger['totals'] }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm backdrop-blur dark:border-sky-900 dark:bg-sky-950">
      <span className="text-slate-700 dark:text-slate-300">
        Приход нетто: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.nettoKg)}</span>
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        Возврат: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.vozvratKg)}</span>
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        На переработку: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.moykaKg)}</span>
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        В переработке: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.vPererabotkeKg)}</span>
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        ИТОГО переработка: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.itogoPererabotkaKg)}</span>
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        Отгрузка: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.otgruzkaKg)}</span>
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        Потеря: <GapCell value={totals.poteryaKg} />
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        Остаток сырья: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.ostatokSyryaKg)}</span>
      </span>
      <span className="text-slate-700 dark:text-slate-300">
        Остаток гот.: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.ostatokGotovoyKg)}</span>
      </span>
    </div>
  )
}

export function ClientPrihodTab() {
  const { productTypes } = useProductTypes(true)
  const defaultRange = { from: isoFirstOfMonth(), to: isoToday() } // "Default period: current month"
  const [filters, setFilters] = usePersistentState<ClientSerialLedgerFilters>(
    'clientHisobot.prihod.filters',
    defaultClientSerialLedgerFilters(defaultRange.from, defaultRange.to),
  )
  const [ledger, setLedger] = useState<ClientSerialLedger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClientSerialLedger(filters)
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

  function toggle(serial: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(serial)) next.delete(serial)
      else next.add(serial)
      return next
    })
  }

  async function handleExport() {
    if (!ledger) return
    setExporting(true)
    try {
      await downloadClientSerialLedgerExcel(ledger, typeName)
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

      {!loading && !error && ledger && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <th className="px-3 py-2" />
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Вид сырья</th>
                <th className="px-3 py-2 text-right">Приход по накладной</th>
                <th className="px-3 py-2 text-right">Приход нетто</th>
                <th className="px-3 py-2 text-right">Возврат сырья заказчику</th>
                <th className="px-3 py-2 text-right">Разница в весе</th>
                <th className="px-3 py-2 text-right">На переработку</th>
                <th className="px-3 py-2 text-right">В переработке / Потеря</th>
                <th className="px-3 py-2 text-right">ИТОГО переработка</th>
                <th className="px-3 py-2 text-right">Отгрузка</th>
                <th className="px-3 py-2 text-right">Остаток сырья</th>
                <th className="px-3 py-2 text-right">Остаток гот. продукции</th>
                <th className="px-3 py-2">Состав</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-3 py-6 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
              {ledger.rows.map((row) => {
                const isOpen = expanded.has(row.serial)
                return (
                  <>
                    <tr
                      key={row.serial}
                      onClick={() => toggle(row.serial)}
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
                        {formatDate(row.date)}
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                          {row.serial}
                          <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.typeId)} />
                        </div>
                      </td>
                      <td className="px-3 py-2">{typeName(row.typeId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.declaredQtyKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.nettoKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.vozvratKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{signedKg(row.raznitsaKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.moykaKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <GapCell value={row.vPererabotkeKg ?? row.poteryaKg} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.itogoPererabotkaKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.otgruzkaKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.ostatokSyryaKg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{kg(row.ostatokGotovoyKg)}</td>
                      <td className="px-3 py-2">
                        <CalibreSummary row={row} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${row.serial}-panel`}>
                        <td colSpan={14} className="p-0">
                          <ExpandedPanel row={row} />
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

      {!loading && !error && ledger && <TotalsBar totals={ledger.totals} />}
    </div>
  )
}
