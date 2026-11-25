import { useMemo } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import ExcelJS from 'exceljs'
import { EXPENSE_TYPE_LABEL, useCategories, useCounterparties } from '../../lib/useFinance'
import { useAccountBalances } from '../../lib/useAccountBalances'
import { useFinancePeriods, usePeriodParam, CHART_MONTHS } from '../../lib/useFinancePeriods'
import { groupSum, pctChange, periodExpenses, sumAmount } from '../../lib/financeMetrics'
import { addMonths, dayLabel, formatSom, formatSomShort, monthLabel, monthLabelShort } from '../../lib/financeFormat'
import { toExcelDate, EXCEL_DATE_FORMAT } from '../../lib/formatDate'
import { MonthBars } from '../../components/finance/MonthBars'
import { PeriodPicker } from '../../components/finance/PeriodPicker'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'

// Moliyaviy ko'rsatkichlar → one expense category (mockup artboard
// "CategoryDetail", decision 0252): period total, 6-month average, change,
// share; 6-month trend; receivers; every entry of the period. `none` =
// uncategorized expenses. Confirmed entries only, grouped by period_month.

function initials(name: string): string {
  const w = name.replace(/["«»]/g, '').trim().split(/\s+/)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '—'
}

export function CategoryDetail() {
  const { categoryId = 'none' } = useParams()
  const { pathname } = useLocation()
  const roleBase = `/${pathname.split('/')[1]}`
  const isBux = roleBase === '/buxgalter'
  const [month, setMonth, current] = usePeriodParam()
  const { months, expenses, loading, error } = useFinancePeriods(month)
  const { categories } = useCategories()
  const { counterparties } = useCounterparties('receiver')
  const { names: accountNames } = useAccountBalances()

  const catId = categoryId === 'none' ? null : categoryId
  const title = catId ? categories.find((c) => c.id === catId)?.name_uz ?? '…' : 'Kategoriyasiz'
  const cpName = useMemo(() => new Map(counterparties.map((c) => [c.id, c.name])), [counterparties])
  const accName = useMemo(() => new Map(Object.entries(accountNames)), [accountNames])

  const inCat = (m: string) => periodExpenses(m, expenses).filter((e) => e.category_id === catId)
  const rows = inCat(month).sort((a, b) => (a.payment_date === b.payment_date ? b.created_at.localeCompare(a.created_at) : b.payment_date.localeCompare(a.payment_date)))
  const total = sumAmount(rows)
  const prevTotal = sumAmount(inCat(addMonths(month, -1)))
  const series = months.map((m) => sumAmount(inCat(m)))
  // Average over the window's months that have any confirmed entry at all, so
  // months before the module existed don't drag it down.
  const activeMonths = months.filter((m) => periodExpenses(m, expenses).length > 0).length
  const avg = sumAmount(series.map((amount) => ({ amount }))) / Math.max(1, Math.min(CHART_MONTHS, activeMonths))
  const allTotal = sumAmount(periodExpenses(month, expenses))
  const share = allTotal ? (total / allTotal) * 100 : 0
  const change = pctChange(total, prevTotal)
  const who = (id: string | null, note: string | null) => (id ? cpName.get(id) ?? '—' : note ?? '—')

  const receivers = groupSum(rows, (e) => e.counterparty_id ?? `note:${e.note ?? ''}`).map((g) => {
    const mine = rows.filter((e) => (e.counterparty_id ?? `note:${e.note ?? ''}`) === g.key)
    const lastRow = mine[0]
    return { ...g, name: who(lastRow.counterparty_id, lastRow.note), last: lastRow }
  })

  async function exportXlsx() {
    const wb = new ExcelJS.Workbook()
    const sh = wb.addWorksheet(title.slice(0, 31))
    const head = sh.addRow(["To'lov sanasi", 'Qabul qiluvchi', 'Turi', 'Summa', 'Hisobdan', 'Davr'])
    head.font = { bold: true }
    for (const e of rows) {
      const r = sh.addRow([toExcelDate(e.payment_date), who(e.counterparty_id, e.note), EXPENSE_TYPE_LABEL[e.expense_type], e.amount, accName.get(e.source_account_id) ?? '—', monthLabel(e.period_month)])
      r.getCell(1).numFmt = EXCEL_DATE_FORMAT
      r.getCell(4).numFmt = '#,##0'
    }
    sh.columns.forEach((c, i) => (c.width = [14, 32, 20, 16, 24, 14][i]))
    const buf = await wb.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `xarajat-${title.replace(/[^\p{L}\p{N}]+/gu, '-')}-${month.slice(0, 7)}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const name = monthLabel(month).split(' ')[0]
  const backHref = `${roleBase}/moliya${month === current ? '' : `?m=${month.slice(0, 7)}`}`

  return (
    <div className="space-y-4">
      <nav className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400" aria-label="Yo'l">
        <Link to={backHref} className="underline">
          Moliyaviy ko'rsatkichlar
        </Link>{' '}
        / Xarajatlar / <span className="text-slate-900 dark:text-slate-100">{title}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        <PeriodPicker value={month} onChange={setMonth} current={current} />
      </div>
      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card padding="compact">
          <div className="text-xs text-slate-500 dark:text-slate-400">{name} jami</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatSomShort(total)}</div>
          <div className="text-xs text-slate-500">so'm</div>
        </Card>
        <Card padding="compact">
          <div className="text-xs text-slate-500 dark:text-slate-400">6 oy o'rtacha</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatSomShort(avg)}</div>
          <div className="text-xs text-slate-500">so'm/oy</div>
        </Card>
        <Card padding="compact">
          <div className="text-xs text-slate-500 dark:text-slate-400">O'tgan oyga</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {change === null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(Math.round(change))}%`}
          </div>
          <div className="text-xs text-slate-500">
            {total - prevTotal === 0 ? 'o‘zgarishsiz' : `${total > prevTotal ? '↑' : '↓'} ${formatSomShort(Math.abs(total - prevTotal))}`}
          </div>
        </Card>
        <Card padding="compact">
          <div className="text-xs text-slate-500 dark:text-slate-400">Jamidagi ulushi</div>
          <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{share.toFixed(1)}%</div>
          <div className="text-xs text-slate-500">xarajatning</div>
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Oylik o'zgarish — {title}</h2>
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">So'nggi 6 oy · "Qaysi oy uchun" belgisi bo'yicha</p>
        <MonthBars
          title={`Oylik o'zgarish — ${title}`}
          months={months}
          monthLabels={months.map((m) => monthLabel(m).split(' ')[0])}
          series={[{ label: title, slot: 1, values: series }]}
          format={formatSomShort}
          selectedIndex={months.length - 1}
        />
      </Card>

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Qabul qiluvchilar</h2>
          <span className="text-xs text-slate-500">{monthLabel(month)}</span>
        </div>
        {!loading && receivers.length === 0 && <p className="py-2 text-sm text-slate-400">Bu davrda yozuv yo'q.</p>}
        <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
          {receivers.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-slate-900 dark:text-slate-100">{r.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {accName.get(r.last.source_account_id) ?? '—'} · {dayLabel(r.last.payment_date)} · {EXPENSE_TYPE_LABEL[r.last.expense_type].split(' — ')[0]}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatSomShort(r.amount)}</div>
                <div className="text-xs tabular-nums text-slate-500">{total ? Math.round((r.amount / total) * 100) : 0}%</div>
              </div>
            </li>
          ))}
        </ul>
        {isBux && receivers.length > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">💡 Doimiy summalarni "Doimiy xarajatlar" bo'limida o'zgartirish mumkin.</p>}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{monthLabel(month)} — barcha yozuvlar</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">"Qaysi oy uchun" = {monthLabel(month)} bo'yicha filtrlangan</p>
          </div>
          <button
            type="button"
            onClick={() => void exportXlsx()}
            disabled={rows.length === 0}
            className="min-h-11 rounded-full border border-emerald-300 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          >
            ⬇ Eksport
          </button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-2 py-2">To'lov sanasi</th>
                <th className="px-2 py-2">Qabul qiluvchi</th>
                <th className="px-2 py-2">Turi</th>
                <th className="px-2 py-2 text-right">Summa</th>
                <th className="px-2 py-2">Hisobdan</th>
                <th className="px-2 py-2">Davr</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const n = who(e.counterparty_id, e.note)
                return (
                  <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-2 whitespace-nowrap">{dayLabel(e.payment_date)}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {initials(n)}
                        </span>
                        <span className="text-slate-900 dark:text-slate-100">{n}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2">{EXPENSE_TYPE_LABEL[e.expense_type]}</td>
                    <td className="px-2 py-2 text-right tabular-nums">−{formatSom(e.amount)}</td>
                    <td className="px-2 py-2">{accName.get(e.source_account_id) ?? '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{monthLabelShort(e.period_month)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
          <span className="text-slate-500">
            {rows.length} yozuv · {monthLabel(month)} davri
          </span>
          <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">Jami: {formatSom(total)} so'm</span>
        </div>
      </Card>

      <Card tone="info">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          ⓘ <span className="font-semibold">Diqqat:</span> "To'lov sanasi" va "Davr" boshqa-boshqa. To'lov keyingi oyda qilingan bo'lsa ham, "Davr" ustuni qaysi oyga hisoblanishini aniqlaydi —
          hisobotlar shuni oladi, to'lov sanasini emas.
        </p>
      </Card>
    </div>
  )
}
