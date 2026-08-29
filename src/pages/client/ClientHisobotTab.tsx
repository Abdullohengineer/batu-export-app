import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/AuthProvider'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { useProductTypes } from '../../lib/useProductTypes'
import { FilterField } from '../../components/report/ReportFilterBar'
import {
  CLIENT_DIRECTION_OPTIONS,
  defaultClientReportFilters,
  directionLabel,
  fetchClientReportRows,
  fetchClientReportTotals,
  type ClientReportFilters,
  type ClientReportRow,
  type ClientReportTotals,
} from '../../lib/clientPortalReport'
import { formatDate } from '../../lib/formatDate'
import { formatLossKg } from '../../lib/formatLoss'
import { defaultDateRange } from '../../lib/dateRange'
import { ClientSerialSummaryModal } from './ClientSerialSummaryModal'

const pillClass =
  'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'

function kg(v: number | null): string {
  return v === null ? '—' : `${Math.round(v).toLocaleString()} кг`
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}
function isoFirstOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

// Totals strip — parity with the internal Hisobot's own TotalsStrip
// (src/components/report/TotalsStrip.tsx): two groups, never merged into
// one unlabelled "Итого". "Движение" is row sums over the whole filtered
// set (Нетто/Накладная); "По сериям (N)" is per-serial standing figures,
// each summed exactly once regardless of how many rows that serial has —
// summing them per row would double/triple-count a serial with several
// rows in the window, the same trap the internal strip's own comment names.
function TotalsBar({ totals }: { totals: ClientReportTotals }) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm backdrop-blur dark:border-sky-900 dark:bg-sky-950">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          Движение
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Нетто: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.nettoKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Накладная: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.nakladnayaKg)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          По сериям ({totals.serialCount})
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Готовый продукт: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.gotoviyProduktKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          КН: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.knKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Остаток (готовый продукт):{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.ostatokGotoviyKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Остаток (сырьё): <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.ostatokSyroyeKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Отгрузка (готовый продукт):{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.otgruzkaGotoviyKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Отгрузка (сырьё) — возврат:{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.otgruzkaSyroyeKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Мойка: <span className="font-medium text-slate-900 dark:text-slate-100">{kg(totals.moykadaKg)}</span>
        </span>
        <span className="text-slate-700 dark:text-slate-300">
          Убыток:{' '}
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {formatLossKg(totals.ubytokKg, 'кг')}
            {totals.ubytokSerialCount < totals.serialCount && totals.serialCount > 0
              ? ` (по ${totals.ubytokSerialCount} из ${totals.serialCount})`
              : ''}
          </span>
        </span>
      </div>
    </div>
  )
}

// Global Export's own restricted Hisobot equivalent (task: "a view section
// like hisobot, but without passport"). Filters: Направление (5 of the
// internal engine's 6 kinds — no MOYKAGA), date range, Вид продукта,
// Серия search. Deliberately NO buyurtmachi (this client only ever sees
// its own data), NO Holat/lab-verdict/driver/plate/calibre/Barcode #2
// filters — all explicitly excluded per the task. Reuses ReportFilterBar's
// exported FilterField (labels are caller-supplied, so it's already
// language-neutral) rather than the whole ReportFilterBar, which is
// Uzbek-label-hardcoded end to end and internal-screen-coupled.
export function ClientHisobotTab() {
  const { profile } = useAuth()
  const { productTypes } = useProductTypes(true)
  const defaultRange = defaultDateRange(30)
  const [filters, setFilters] = useState<ClientReportFilters>(
    defaultClientReportFilters(defaultRange.from, isoToday())
  )
  const [rows, setRows] = useState<ClientReportRow[]>([])
  const [totals, setTotals] = useState<ClientReportTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openSerial, setOpenSerial] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchClientReportRows(filters), fetchClientReportTotals(filters)])
      .then(([rowsData, totalsData]) => {
        if (!cancelled) {
          setRows(rowsData)
          setTotals(totalsData)
        }
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

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {profile?.full_name ?? 'Отчёт'}
      </h1>

      <div className="flex flex-wrap items-center gap-2">
        <FilterField
          label="Направление"
          allLabel="Все"
          options={CLIENT_DIRECTION_OPTIONS}
          selected={filters.directions}
          onChange={(vals) =>
            setFilters((f) => ({ ...f, directions: vals as ClientReportFilters['directions'] }))
          }
          multi
          compact
        />

        <button type="button" onClick={() => setFilters((f) => ({ ...f, from: isoToday(), to: isoToday() }))} className={pillClass}>
          Сегодня
        </button>
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, from: defaultDateRange(7).from, to: isoToday() }))}
          className={pillClass}
        >
          7 дней
        </button>
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, from: isoFirstOfMonth(), to: isoToday() }))}
          className={pillClass}
        >
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
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className={pillClass}
          />
        </label>

        <FilterField
          label="Вид продукта"
          allLabel="Все"
          options={productTypes.map((t) => ({ value: t.id, label: t.name }))}
          selected={filters.typeId ? [filters.typeId] : []}
          onChange={(vals) => setFilters((f) => ({ ...f, typeId: vals[0] ?? '' }))}
          multi={false}
          compact
        />

        <input
          type="text"
          value={filters.serial}
          onChange={(e) => setFilters((f) => ({ ...f, serial: e.target.value }))}
          placeholder="Поиск по серии"
          className={`${pillClass} w-44`}
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Загрузка…</p>}

      {!loading && !error && totals && <TotalsBar totals={totals} />}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[1300px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                <th className="px-3 py-2">Направление</th>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Серия</th>
                <th className="px-3 py-2">Вид</th>
                <th className="px-3 py-2 text-right">Нетто, кг</th>
                <th className="px-3 py-2 text-right">Накладная, кг</th>
                <th className="px-3 py-2 text-right">Готовый продукт, кг</th>
                <th className="px-3 py-2 text-right">КН, кг</th>
                <th className="px-3 py-2 text-right">Остаток (готовый продукт), кг</th>
                <th className="px-3 py-2 text-right">Остаток (сырьё), кг</th>
                <th className="px-3 py-2 text-right">Отгрузка (готовый продукт), кг</th>
                <th className="px-3 py-2 text-right">Отгрузка (сырьё) — возврат, кг</th>
                <th className="px-3 py-2 text-right">Мойка, кг</th>
                <th className="px-3 py-2 text-right">Убыток, кг</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-3 py-6 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const clickable = !!row.serial
                return (
                  <tr
                    key={row.key}
                    onClick={clickable ? () => setOpenSerial(row.serial) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setOpenSerial(row.serial)
                            }
                          }
                        : undefined
                    }
                    tabIndex={clickable ? 0 : undefined}
                    role={clickable ? 'button' : undefined}
                    aria-label={clickable ? `Подробнее по серии ${row.serial}` : undefined}
                    className={`border-b border-slate-100 align-top dark:border-slate-800 ${
                      clickable ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60' : ''
                    }`}
                  >
                    <td className="px-3 py-2">{directionLabel(row.kind)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.dateBasis)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {row.serial ?? '—'}
                        {row.serial && <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.typeId)} />}
                      </span>
                    </td>
                    <td className="px-3 py-2">{typeName(row.typeId)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.nettoKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.nakladnayaKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.gotoviyProduktKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.knKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.ostatokGotoviyKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.ostatokSyroyeKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.otgruzkaGotoviyKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.otgruzkaSyroyeKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(row.moykadaKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.ubytokKg === null ? '—' : formatLossKg(row.ubytokKg, 'кг')}</td>
                    <td className="px-3 py-2">
                      {clickable && (
                        <span aria-hidden className="block text-slate-400">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                          </svg>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openSerial && <ClientSerialSummaryModal serial={openSerial} onClose={() => setOpenSerial(null)} />}
    </div>
  )
}
