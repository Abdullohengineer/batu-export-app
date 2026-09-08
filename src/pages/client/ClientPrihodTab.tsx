import { useState } from 'react'
import { usePersistentState } from '../../lib/FilterState'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { FilterField } from '../../components/report/ReportFilterBar'
import { useReportQuery, ExportTooLargeError } from '../../lib/useReportQuery'
import { downloadReportExcel } from '../../lib/reportExport'
import { defaultReportFilters, type KirimReportRow, type ReportFilters, type ReportTotals } from '../../lib/reportQuery'
import { REPORT_COLUMNS } from '../../lib/reportColumns'
import { formatDate } from '../../lib/formatDate'
import { formatLossKg } from '../../lib/formatLoss'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { todayInTashkent, firstOfMonthInTashkent } from '../../lib/dateRange'
import { clientLabel } from '../../lib/clientLabels'
import { StatusNote } from '../../components/ui/StatusNote'

// Приход — client-portal reset (Phase 5, "rewrite Приход only"). A KIRIM-only
// MIRROR of Rahbar/Menejer's own Hisobot: same data-fetching layer
// (useReportQuery -> report_query_page/report_totals, unchanged — NOT a
// parallel RPC, per explicit instruction) and the same Excel export function
// (downloadReportExcel), unchanged. Row/totals rendering is bespoke (not
// ReportTableRow/TotalsStrip) for the same reason ClientRashodTab.tsx already
// established (see that file): this view fixes `directions` to ['kirim']
// permanently, drops several columns/filters/row-detail fields Rahbar's own
// row/detail components don't know how to hide, and needs Russian labels
// where those components hardcode Uzbek — forking the presentation (rather
// than threading override props through a shared Hisobot file Menejer/Rahbar
// also use) keeps this change entirely inside the client portal. NOTE: the
// reused downloadReportExcel still emits Uzbek column headers/summary labels
// inside the .xlsx file itself (REPORT_COLUMNS' own `label`, not translated)
// — flagging this rather than silently forking that too, since the task
// asked to reuse Rahbar's export, not to translate it.
//
// Owner scoping: NO p_owner_id is ever sent (filters.ownerId stays '' always,
// no Buyurtmachi UI). report_query_page/report_totals are plain (non-
// SECURITY DEFINER) functions, but every table underneath them already
// carries a `client_read_own_*` RLS policy scoping to my_owner_id() for the
// 'client' role — confirmed live (2026-09-08): calling both RPCs as the TEST
// CLIENT account with p_owner_id=null still returned exactly one owner's
// rows. RLS is the actual backstop here, same as every other client_* RPC's
// belt-and-suspenders convention, just enforced one layer down (on the base
// tables, not inside these two functions) since they predate the client
// role entirely. See DECISIONS.md "Приход rewrite: RLS safety check."
//
// 27-column set, exact order Rahbar's own REPORT_COLUMNS already declares —
// filtering, not reordering. Dropped vs. Rahbar's 34: Buyurtmachi (scope-
// locked, never shown), Barcode #2/Holat/Namlik/SO2 (finished-goods/lab
// concepts, never populated on a KIRIM row anyway), Netto (redundant with
// Приход нетто, #18 below).
const CLIENT_PRIHOD_COLUMN_KEYS = [
  'direction',
  'date',
  'serial',
  'partiya',
  'type',
  'calibre',
  'declared',
  'tara',
  'plate',
  'driver',
  'qabul_qilingan',
  'omborda_qoldi',
  'moykaga_yuborilgan',
  'moykada',
  'moykadan_chiqgan',
  'yoqotish',
  'xom_jonatilgan',
  'olib_ketilgan',
  'k1',
  'k2',
  'k3',
  'k4',
  'k5',
  'k6',
  'k7',
  'k8',
  'kn',
] as const

const CLIENT_PRIHOD_COLUMN_KEY_SET = new Set<string>(CLIENT_PRIHOD_COLUMN_KEYS)
const CLIENT_PRIHOD_COLUMNS = REPORT_COLUMNS.filter((c) => CLIENT_PRIHOD_COLUMN_KEY_SET.has(c.key))

const pillClass =
  'rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
const inputClass =
  'rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top'

function kg(v: number): string {
  return `${Math.round(v).toLocaleString()} кг`
}

function StateCell({ value }: { value: number | undefined }) {
  return <span className="whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">{value != null ? kg(value) : '—'}</span>
}

function defaultClientPrihodFilters(): ReportFilters {
  return {
    ...defaultReportFilters(firstOfMonthInTashkent(), todayInTashkent()),
    directions: ['kirim'],
  }
}

// Row-expand — trimmed to "weight and date" only, per explicit instruction:
// this is the exact first block of Rahbar's own KirimRowDetail.tsx (E'lon
// qilingan + which date basis governs the row), translated. Everything below
// it there (truck-variance warning, lab readings vs. target, "Seriya
// pasportini ko'rish") is internal navigation/detail and is dropped, not
// hidden — there is no passport modal, void note, or lab-reading concept
// anywhere in this file.
function ClientKirimRowDetail({ row }: { row: KirimReportRow }) {
  return (
    <div className="mt-2 border-t border-slate-200 pt-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {clientLabel('col.declared')}: {row.declaredQty.toLocaleString()} кг
      {!row.provisional && (
        <>{' · '}{row.dateBasisSource === 'gate_stage1' ? 'Дата взвешивания на воротах' : 'Дата заказа'}</>
      )}
    </div>
  )
}

// Totals strip — shows ALL of Rahbar's Hisobot totals for this filtered
// period, both groups (movement + per-serial standing state), including
// Yo'qotish, per explicit instruction — not just the ones tied to the 27
// visible table columns above (which omit Netto/Hisobiy, so those two get
// their own chip here anyway, translated, since the task asked for every
// total regardless of column visibility). Bespoke, not TotalsStrip.tsx: that
// component's chip labels ('Kirim', 'Qabul qilingan', "Yo'qotish
// (yakunlangan)", ...) are hardcoded Uzbek, which would break this screen's
// Russian-only requirement (SPEC.md §3.6) if reused unmodified — same
// row-detail/table divergence reasoning as ClientKirimRowDetail above. The
// VALUES are the exact same report_totals fields Rahbar's own strip reads.
interface TotalChip {
  label: string
  value: number
  loss?: boolean
}

function ChipGroup({ title, chips }: { title: string; chips: TotalChip[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">{title}</span>
      {chips.map((chip) => (
        <span key={chip.label} className="text-slate-700 dark:text-slate-300">
          {chip.label}: <span className="font-medium text-slate-900 dark:text-slate-100">{chip.loss ? formatLossKg(chip.value, 'кг') : kg(chip.value)}</span>
        </span>
      ))}
    </div>
  )
}

function ClientTotalsStrip({ totals }: { totals: ReportTotals }) {
  const movementChips: TotalChip[] = [
    { label: clientLabel('Kirim'), value: totals.kgIn },
    { label: clientLabel('total.chiqim'), value: totals.kgOut },
    { label: clientLabel('total.neto'), value: totals.net },
    { label: clientLabel('col.declared'), value: totals.totalDeclared },
    { label: clientLabel('total.hisobiy'), value: totals.totalHisobiy },
    { label: `${clientLabel('col.tara')} (${clientLabel('Kirim').toLowerCase()})`, value: totals.taraIn },
    { label: `${clientLabel('col.moykaga_yuborilgan')} (за период)`, value: totals.totalToMoyka },
    { label: `${clientLabel('col.moykadan_chiqgan')} (за период)`, value: totals.totalFromMoyka },
  ]

  const stateChips: TotalChip[] = [
    { label: clientLabel('col.qabul_qilingan'), value: totals.stateQabulQilingan },
    { label: clientLabel('col.omborda_qoldi'), value: totals.stateOmbordaQoldi },
    { label: `${clientLabel('col.moykaga_yuborilgan')} (сейчас)`, value: totals.stateMoykagaYuborilgan },
    { label: clientLabel('col.moykada'), value: totals.stateMoykada },
    { label: `${clientLabel('col.moykadan_chiqgan')} (сейчас)`, value: totals.stateMoykadanChiqgan },
    { label: clientLabel('col.yoqotish'), value: totals.stateYoqotish, loss: true },
    { label: clientLabel('col.xom_jonatilgan'), value: totals.stateXomJonatilgan },
    { label: clientLabel('col.olib_ketilgan'), value: totals.stateOlibKetilgan },
    { label: clientLabel('col.k1'), value: totals.stateK1 },
    { label: clientLabel('col.k2'), value: totals.stateK2 },
    { label: clientLabel('col.k3'), value: totals.stateK3 },
    { label: clientLabel('col.k4'), value: totals.stateK4 },
    { label: clientLabel('col.k5'), value: totals.stateK5 },
    { label: clientLabel('col.k6'), value: totals.stateK6 },
    { label: clientLabel('col.k7'), value: totals.stateK7 },
    { label: clientLabel('col.k8'), value: totals.stateK8 },
    { label: clientLabel('col.kn'), value: totals.stateKn },
  ]

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm dark:border-sky-900 dark:bg-sky-950">
      <ChipGroup title="За период" chips={movementChips} />
      <ChipGroup title={`По сериям (${totals.stateSerialCount})`} chips={stateChips} />
    </div>
  )
}

export function ClientPrihodTab() {
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const [filters, setFilters] = usePersistentState<ReportFilters>('clientHisobot.prihod.filters', defaultClientPrihodFilters)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const { rows, totals, totalCount, page, pageCount, setPage, loading } = useReportQuery(filters)
  const kirimRows = rows.filter((r): r is KirimReportRow => r.kind === 'kirim')

  function typeName(id: string): string {
    return productTypes.find((t) => t.id === id)?.name ?? '—'
  }
  function calibreLabel(id: string): string {
    return calibres.find((c) => c.id === id)?.label ?? '—'
  }

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      // ownerName is a stub: 'owner' never appears in CLIENT_PRIHOD_COLUMN_KEYS
      // (Buyurtmachi is scope-locked, never shown/exported), so
      // buildReportWorkbook's 'owner' branch can never actually call this —
      // ExportLookups just requires the shape.
      await downloadReportExcel(filters, { ownerName: () => '', typeName, calibreLabel }, totals, CLIENT_PRIHOD_COLUMN_KEY_SET)
    } catch (err) {
      setExportError(err instanceof ExportTooLargeError ? err.message : 'Ошибка при выгрузке Excel.')
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
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, from: firstOfMonthInTashkent(), to: todayInTashkent() }))}
          className={pillClass}
        >
          Этот месяц
        </button>
        <label className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className={pillClass} />
          —
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className={pillClass} />
        </label>

        <FilterField
          label={clientLabel('col.type')}
          allLabel="Все"
          options={productTypes.map((t) => ({ value: t.id, label: t.name }))}
          selected={filters.typeId ? [filters.typeId] : []}
          onChange={(vals) => setFilters((f) => ({ ...f, typeId: vals[0] ?? '' }))}
          multi={false}
          compact
        />

        <FilterField
          label={clientLabel('col.calibre')}
          allLabel="Все"
          options={calibres.map((c) => ({ value: c.id, label: c.label }))}
          selected={filters.calibreId ? [filters.calibreId] : []}
          onChange={(vals) => setFilters((f) => ({ ...f, calibreId: vals[0] ?? '' }))}
          multi={false}
          compact
        />

        <input
          type="text"
          value={filters.serial}
          onChange={(e) => setFilters((f) => ({ ...f, serial: e.target.value }))}
          placeholder="Поиск по серии"
          className={`${inputClass} w-40`}
        />
        <input
          type="text"
          value={filters.plate}
          onChange={(e) => setFilters((f) => ({ ...f, plate: e.target.value }))}
          placeholder={clientLabel('col.plate')}
          className={`${inputClass} w-28`}
        />
        <input
          type="text"
          value={filters.driver}
          onChange={(e) => setFilters((f) => ({ ...f, driver: e.target.value }))}
          placeholder={clientLabel('col.driver')}
          className={`${inputClass} w-32`}
        />
        <input
          type="number"
          min="1"
          step="1"
          value={filters.partiya}
          onChange={(e) => setFilters((f) => ({ ...f, partiya: e.target.value }))}
          placeholder="Партия №"
          className={`${inputClass} w-24`}
        />

        <button
          type="button"
          onClick={() => setFilters(defaultClientPrihodFilters())}
          className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Сбросить
        </button>

        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || totalCount === 0}
          className="ml-auto rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {exporting ? 'Экспорт…' : 'Скачать Excel'}
        </button>
      </div>

      {exportError && <StatusNote tone="problem">{exportError}</StatusNote>}

      <ClientTotalsStrip totals={totals} />

      {loading && <p className="text-sm text-slate-400">Загрузка…</p>}

      {!loading && (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[1400px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                {CLIENT_PRIHOD_COLUMNS.map((col) => (
                  <th key={col.key} className={col.align === 'right' ? `${th} text-right` : th}>
                    {clientLabel(`col.${col.key}`)}
                  </th>
                ))}
                <th className={th} aria-label="Подробнее" />
              </tr>
            </thead>
            <tbody>
              {kirimRows.length === 0 && (
                <tr>
                  <td colSpan={CLIENT_PRIHOD_COLUMNS.length + 1} className="px-3 py-6 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
              {kirimRows.map((row) => {
                const expanded = expandedKey === row.key
                return (
                  <>
                    <tr
                      key={row.key}
                      onClick={() => setExpandedKey(expanded ? null : row.key)}
                      className="cursor-pointer border-b border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                    >
                      <td className={td}>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {clientLabel('Kirim')}
                        </span>
                      </td>
                      <td className={td}>{formatDate(row.dateBasis)}</td>
                      <td className={td}>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-slate-900 dark:text-slate-100">
                          {row.serial}
                          <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.typeId)} />
                        </span>
                      </td>
                      <td className={td}>
                        <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.typeId)} />
                      </td>
                      <td className={td}>{typeName(row.typeId)}</td>
                      <td className={td}>—</td>
                      <td className={`${td} text-right tabular-nums`}>{row.declaredQty.toLocaleString()} кг</td>
                      <td className={`${td} text-right tabular-nums`}>{row.boxMassKg !== null ? `${row.boxMassKg.toLocaleString()} кг` : '—'}</td>
                      <td className={td}>{row.plate || '—'}</td>
                      <td className={td}>{row.driver || '—'}</td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.qabulQilingan} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.ombordaQoldi} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.moykagaYuborilgan} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.moykada} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.moykadanChiqgan} />
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {row.state.yoqotish != null ? formatLossKg(row.state.yoqotish, 'кг') : '—'}
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.xomJonatilgan} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.olibKetilgan} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k1} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k2} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k3} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k4} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k5} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k6} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k7} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.k8} />
                      </td>
                      <td className={`${td} text-right`}>
                        <StateCell value={row.state.kn} />
                      </td>
                      <td className={`${td} text-right`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedKey(expanded ? null : row.key)
                          }}
                          aria-expanded={expanded}
                          aria-label={expanded ? 'Свернуть' : 'Подробнее'}
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          {expanded ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <td colSpan={CLIENT_PRIHOD_COLUMNS.length + 1} className="bg-slate-50 px-3 py-3 dark:bg-slate-900/40">
                          <ClientKirimRowDetail row={row} />
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

      {!loading && pageCount > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ← Назад
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={page >= pageCount}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Вперёд →
          </button>
        </div>
      )}
    </div>
  )
}
