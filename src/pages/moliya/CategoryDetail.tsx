import { useMemo } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import ExcelJS from 'exceljs'
import { EXPENSE_TYPE_LABEL, useCategories, useCounterparties } from '../../lib/useFinance'
import { useAccountBalances } from '../../lib/useAccountBalances'
import { useFinancePeriods, usePeriodParam, CHART_MONTHS } from '../../lib/useFinancePeriods'
import { groupSum, pctChange, periodExpenses, sumAmount } from '../../lib/financeMetrics'
import { addMonths, dayLabel, formatCompact, formatSom, monthLabel, monthLabelShort } from '../../lib/financeFormat'
import { toExcelDate, EXCEL_DATE_FORMAT } from '../../lib/formatDate'
import { MonthBars } from '../../components/finance/MonthBars'
import { PeriodPicker } from '../../components/finance/PeriodPicker'
import { Panel, RowIcon, Tile } from '../../components/finance/FinanceUI'
import { FIN_PALETTE, colorFor } from '../../lib/financeTheme'
import { StatusNote } from '../../components/ui/StatusNote'

// Moliyaviy ko'rsatkichlar → one expense category (mockup artboard
// "CategoryDetail", decision 0252): period total, 6-month average, change,
// share; 6-month trend; receivers; every entry of the period. `none` =
// uncategorized expenses. Confirmed entries only, grouped by period_month.

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

  const h2 = 'text-[15px] font-semibold text-[var(--text-primary)]'
  const catColor = colorFor(catId)
  const delta = total - prevTotal

  return (
    <div className="space-y-6">
      <nav className="text-[11px] font-medium uppercase tracking-[0.8px] text-[var(--text-muted)]" aria-label="Yo'l">
        <Link to={backHref} className="hover:text-[var(--text-secondary)] hover:underline">
          Moliyaviy ko'rsatkichlar
        </Link>{' '}
        / Xarajatlar / <span className="text-[var(--text-secondary)]">{title}</span>
      </nav>
      <div className="-mt-3 flex flex-wrap items-end justify-between gap-4">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-[-0.5px] text-[var(--text-primary)]">
          <span aria-hidden className="h-3 w-3 rounded-[4px]" style={{ background: catColor }} />
          {title}
        </h1>
        <PeriodPicker value={month} onChange={setMonth} current={current} />
      </div>
      {error && <StatusNote tone="problem">{error}</StatusNote>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label={`${name} jami`}>
          {formatCompact(total)}
          <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">so'm</span>
        </Tile>
        <Tile label="6 oy o'rtacha">
          {formatCompact(avg)}
          <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">so'm/oy</span>
        </Tile>
        <Tile label="O'tgan oyga">
          {/* more spend than last month is the bad direction for an expense category */}
          <span className={change === null || Math.round(change) === 0 ? 'text-[var(--text-primary)]' : change > 0 ? 'text-[var(--accent-warning)]' : 'text-[var(--accent-income)]'}>
            {change === null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(Math.round(change))}%`}
          </span>
          <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
            {delta === 0 ? 'o‘zgarishsiz' : `${delta > 0 ? '↑' : '↓'} ${formatCompact(Math.abs(delta))}`}
          </span>
        </Tile>
        <Tile label="Jamidagi ulushi">
          <span style={{ color: catColor }}>{share.toFixed(1)}%</span>
          <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">xarajatning</span>
        </Tile>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <h2 className={h2}>Oylik o'zgarish — {title}</h2>
          <p className="mb-3 text-xs text-[var(--text-muted)]">So'nggi 6 oy · "Qaysi oy uchun" belgisi bo'yicha</p>
          <MonthBars
            title={`Oylik o'zgarish — ${title}`}
            months={months}
            monthLabels={months.map((m) => monthLabel(m).split(' ')[0])}
            series={[{ label: title, color: catColor, values: series }]}
            format={formatCompact}
            selectedIndex={months.length - 1}
            showValuesUnderLabels
          />
        </Panel>

        <Panel>
          <h2 className={h2}>Qabul qiluvchilar</h2>
          <p className="text-xs text-[var(--text-muted)]">{monthLabel(month)}</p>
          {!loading && receivers.length === 0 && <p className="py-2 text-sm text-[var(--text-muted)]">Bu davrda yozuv yo'q.</p>}
          <ul className="mt-3 space-y-3.5">
            {receivers.map((r, i) => {
              const pct = total ? (r.amount / total) * 100 : 0
              const c = FIN_PALETTE[i % 4]
              return (
                <li key={r.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">{r.name}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                      {formatCompact(r.amount)} <span className="text-[11px] font-normal text-[var(--text-muted)]">{Math.round(pct)}%</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-[var(--border)]">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: c }} />
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                    {accName.get(r.last.source_account_id) ?? '—'} · {dayLabel(r.last.payment_date)} · {EXPENSE_TYPE_LABEL[r.last.expense_type].split(' — ')[0]}
                  </div>
                </li>
              )
            })}
          </ul>
          {isBux && receivers.length > 0 && (
            <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)]">💡 Doimiy summalarni "Doimiy xarajatlar" bo'limida o'zgartirish mumkin.</p>
          )}
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className={h2}>{monthLabel(month)} — barcha yozuvlar</h2>
            <p className="text-xs text-[var(--text-muted)]">"Qaysi oy uchun" = {monthLabel(month)} bo'yicha filtrlangan</p>
          </div>
          <button
            type="button"
            onClick={() => void exportXlsx()}
            disabled={rows.length === 0}
            className="min-h-10 rounded-full border border-[var(--border-strong)] bg-[var(--surface-elev)] px-4 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent-income)] disabled:opacity-50"
          >
            ⬇ Eksport
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-[0.8px] text-[var(--text-muted)]">
                <th className="border-b border-[var(--border)] py-2.5 pr-4 font-medium">To'lov sanasi</th>
                <th className="border-b border-[var(--border)] py-2.5 pr-4 font-medium">Qabul qiluvchi</th>
                <th className="border-b border-[var(--border)] py-2.5 pr-4 font-medium">Turi</th>
                <th className="border-b border-[var(--border)] py-2.5 pr-4 text-right font-medium">Summa</th>
                <th className="border-b border-[var(--border)] py-2.5 pr-4 font-medium">Hisobdan</th>
                <th className="border-b border-[var(--border)] py-2.5 font-medium">Davr</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const n = who(e.counterparty_id, e.note)
                const cell = 'border-b border-[var(--border)] py-3.5 pr-4'
                return (
                  <tr key={e.id} className="transition-colors hover:bg-[var(--surface-elev)]">
                    <td className={`${cell} whitespace-nowrap text-[var(--text-secondary)]`}>{dayLabel(e.payment_date)}</td>
                    <td className={cell}>
                      <span className="inline-flex items-center gap-3">
                        <RowIcon name={n} color={catColor} />
                        <span className="text-[var(--text-primary)]">{n}</span>
                      </span>
                    </td>
                    <td className={`${cell} text-[var(--text-secondary)]`}>{EXPENSE_TYPE_LABEL[e.expense_type]}</td>
                    <td className={`${cell} text-right font-medium tabular-nums text-[var(--text-primary)]`}>−{formatSom(e.amount)}</td>
                    <td className={`${cell} text-[var(--text-secondary)]`}>{accName.get(e.source_account_id) ?? '—'}</td>
                    <td className="whitespace-nowrap border-b border-[var(--border)] py-3.5 text-[var(--text-secondary)]">{monthLabelShort(e.period_month)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
          <span className="text-[var(--text-muted)]">
            {rows.length} yozuv · {monthLabel(month)} davri
          </span>
          <span className="font-semibold tabular-nums text-[var(--text-primary)]">Jami: {formatSom(total)} so'm</span>
        </div>
      </Panel>

      <div className="rounded-[var(--radius)] border border-[rgb(244_167_95/0.3)] bg-[rgb(244_167_95/0.06)] px-5 py-4">
        <p className="text-xs leading-5 text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--accent-utility)]">ⓘ Diqqat:</span> "To'lov sanasi" va "Davr" boshqa-boshqa. To'lov keyingi oyda qilingan bo'lsa ham, "Davr" ustuni qaysi
          oyga hisoblanishini aniqlaydi — hisobotlar shuni oladi, to'lov sanasini emas.
        </p>
      </div>
    </div>
  )
}
