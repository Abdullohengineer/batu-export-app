import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { todayInTashkent } from '../../lib/dateRange'
import { EXPENSE_TYPE_LABEL, useCategories, useExpenses, useMoykaOutputKg, useObligations, type ExpenseType } from '../../lib/useFinance'
import { useFinanceAccounts } from '../../lib/useFinanceAccounts'
import { useFinancePeriods, usePeriodParam } from '../../lib/useFinancePeriods'
import { forecastFromPace, groupSum, pctChange, periodExpenses, sumAmount } from '../../lib/financeMetrics'
import {
  addMonths,
  coverageHint,
  dailyReserve,
  dayLabel,
  daysBetween,
  daysInMonth,
  formatSom,
  formatSomShort,
  monthLabel,
  monthLabelShort,
} from '../../lib/financeFormat'
import { MonthBars, type BarSeries } from '../../components/finance/MonthBars'
import { PeriodPicker } from '../../components/finance/PeriodPicker'
import { Card } from '../../components/ui/Card'
import { StatusNote } from '../../components/ui/StatusNote'

// Moliyaviy ko'rsatkichlar — Umumiy ko'rinish (mockup artboard "Overview",
// decision 0252). Read-only; mounted under /buxgalter, /rahbar, /menejer.
// Period figures come from financeMetrics via useFinancePeriods, grouped by
// period_month; balances are always today's.

type ChartTab = 'both' | 'expense' | 'cost' | 'profit' | 'types'
const TABS: { key: ChartTab; label: string }[] = [
  { key: 'both', label: 'Tushum va xarajat' },
  { key: 'expense', label: 'Faqat xarajatlar' },
  { key: 'cost', label: '1 kg tannarxi' },
  { key: 'profit', label: 'Sof foyda' },
  { key: 'types', label: 'Xarajat turlari bo‘yicha' },
]
const TYPE_ORDER: ExpenseType[] = ['recurring_required', 'recurring_optional', 'one_off', 'unexpected']

function Delta({ pct, goodWhenUp }: { pct: number | null; goodWhenUp: boolean }) {
  if (pct === null) return null
  if (Math.round(pct) === 0) return <span className="text-xs font-medium text-slate-500">≈0% o'tgan oyga</span>
  const good = pct > 0 === goodWhenUp
  return (
    <span className={`text-xs font-medium ${good === null ? 'text-slate-500' : good ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {pct > 0 ? '+' : pct < 0 ? '−' : ''}
      {Math.abs(Math.round(pct))}% o'tgan oyga
    </span>
  )
}

function Tile({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1">{children}</div>
    </Card>
  )
}

export function MoliyaHome() {
  const { pathname } = useLocation()
  const roleBase = `/${pathname.split('/')[1]}`
  const isBux = roleBase === '/buxgalter'
  const tarixHref = isBux ? '/buxgalter/kirim/tarix' : `${roleBase}/moliya/tarix`

  const [month, setMonth, current] = usePeriodParam()
  const { months, figures, expenses, ownerId, rates, loading, error } = useFinancePeriods(month)
  const { accounts } = useFinanceAccounts()
  const { categories } = useCategories()
  const { obligations } = useObligations()
  const [tab, setTab] = useState<ChartTab>('both')

  const f = figures.get(month)
  const prev = figures.get(addMonths(month, -1))
  const name = monthLabel(month).split(' ')[0]

  // ---- cash
  const cash = accounts.filter((a) => a.kind === 'bank' || a.kind === 'kassa')
  const cashTotal = sumAmount(cash.map((a) => ({ amount: a.balance })))

  // ---- composition
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name_uz])), [categories])
  const composition = useMemo(() => groupSum(periodExpenses(month, expenses), (e) => e.category_id ?? 'none'), [month, expenses])
  const compTotal = sumAmount(composition)

  // ---- chart
  const labels = months.map((m) => monthLabel(m).split(' ')[0])
  const val = (m: string, k: 'income' | 'expense' | 'profit' | 'costPerKg') => {
    const x = figures.get(m)
    return x ? x[k] : null
  }
  const series: BarSeries[] =
    tab === 'both'
      ? [
          { label: 'Tushum', slot: 0, values: months.map((m) => val(m, 'income')) },
          { label: 'Xarajat', slot: 1, values: months.map((m) => val(m, 'expense')) },
        ]
      : tab === 'expense'
        ? [{ label: 'Xarajat', slot: 1, values: months.map((m) => val(m, 'expense')) }]
        : tab === 'cost'
          ? [{ label: '1 kg tannarxi', slot: 0, values: months.map((m) => val(m, 'costPerKg')) }]
          : tab === 'profit'
            ? [{ label: 'Sof foyda', slot: 0, values: months.map((m) => val(m, 'profit')) }]
            : TYPE_ORDER.map((t, i) => ({
                label: EXPENSE_TYPE_LABEL[t],
                slot: i,
                values: months.map((m) => sumAmount(periodExpenses(m, expenses).filter((e) => e.expense_type === t))),
              }))

  // ---- obligations + reserve (owner, 2026-11-23: obligations only)
  const today = todayInTashkent()
  const obligationTotal = sumAmount(obligations.map((o) => ({ amount: o.estimated_amount })))

  // ---- Joriy oy prognozi: the month in progress, projected to its end at its pace so far (owner, 2026-11-23)
  const { expenses: recent } = useExpenses(addMonths(current, -6))
  const { kg: kgNow } = useMoykaOutputKg(ownerId, current)
  const latestRate = useMemo(() => {
    let best: { m: string; r: number } | null = null
    for (const [k, r] of rates) {
      const [m, svc] = k.split(':')
      if (svc === 'moyka' && m <= current && (!best || m > best.m)) best = { m, r }
    }
    return best?.r ?? null
  }, [rates, current])
  const day = Number(today.slice(8, 10))
  const forecast = kgNow === null ? null : forecastFromPace(kgNow, sumAmount(periodExpenses(current, recent)), day, daysInMonth(current), latestRate)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Moliyaviy ko'rsatkichlar</div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Umumiy ko'rinish</h1>
        </div>
        <PeriodPicker value={month} onChange={setMonth} current={current} />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        💡 Barcha ko'rsatkichlar tanlangan davrga tegishli yozuvlarga asoslanadi — to'lov sanasi emas, "qaysi oy uchun" belgisi bo'yicha. Balanslar esa hamisha joriy qoldiqni ko'rsatadi.
      </p>
      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {/* ---------------- KPI tiles */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tile label={<span>Umumiy pul qoldiq · naqd + bank · joriy</span>}>
          <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {formatSom(cashTotal)} <span className="text-sm font-normal text-slate-500">so'm</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600 dark:text-slate-300">
            {cash.map((a) => (
              <span key={a.id}>
                {a.kind === 'bank' ? 'Bank' : 'Kassa'}: <span className="tabular-nums">{formatSomShort(a.balance)}</span>
              </span>
            ))}
          </div>
        </Tile>
        <Tile
          label={
            <>
              <span>{name} sof foyda</span>
              <Delta pct={pctChange(f?.profit ?? null, prev?.profit ?? null)} goodWhenUp />
            </>
          }
        >
          <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {f?.profit != null ? `${f.profit > 0 ? '+' : f.profit < 0 ? '−' : ''}${formatSom(Math.abs(f.profit))}` : '—'}{' '}
            {f?.profit != null && <span className="text-sm font-normal text-slate-500">so'm</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600 dark:text-slate-300">
            <span>Tushum: {f?.income != null ? formatSomShort(f.income) : 'kiritilmagan'}</span>
            <span>Xarajat: {f ? formatSomShort(f.expense) : '—'}</span>
          </div>
          {f && f.income === null && (
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sof foyda {name} uchun tushum kiritilgach hisoblanadi.</div>
          )}
        </Tile>
        <Tile
          label={
            <>
              <span>1 kg tannarxi</span>
              <Delta pct={pctChange(f?.costPerKg ?? null, prev?.costPerKg ?? null)} goodWhenUp={false} />
            </>
          }
        >
          <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {f?.costPerKg != null ? formatSom(f.costPerKg) : '—'} <span className="text-sm font-normal text-slate-500">so'm/kg</span>
          </div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {name} xarajati ({f ? formatSomShort(f.expense) : '—'}) ÷ Moykadan chiqdi ({f?.kg != null ? `${formatSom(f.kg)} kg` : '…'}).
            {f?.rate && f.costPerKg != null && (
              <>
                {' '}
                Stavkadan ({formatSom(f.rate)}) —{' '}
                <span className={f.rate - f.costPerKg >= 0 ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                  {formatSom(f.rate - f.costPerKg)} so'm/kg marja
                </span>
              </>
            )}
          </div>
        </Tile>
      </div>

      {/* ---------------- chart */}
      <Card>
        <div className="-mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Grafik">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-9 shrink-0 rounded-full px-3 text-xs font-medium ${
                tab === t.key ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mb-2 mt-1 text-xs text-slate-500 dark:text-slate-400">So'nggi 6 oy · "Qaysi oy uchun" belgisiga ko'ra guruhlangan</p>
        <MonthBars
          title={TABS.find((t) => t.key === tab)!.label}
          months={months}
          monthLabels={labels}
          series={series}
          stacked={tab === 'types'}
          format={tab === 'cost' ? (v) => formatSom(v) : formatSomShort}
          selectedIndex={months.length - 1}
        />
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---------------- composition */}
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Xarajatlar tarkibi · {monthLabelShort(month)}</h2>
            <Link to={tarixHref} className="text-xs font-medium text-slate-600 underline dark:text-slate-300">
              Batafsil tarix ›
            </Link>
          </div>
          <div className="mt-2 flex items-baseline justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Jami</span>
            <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatSomShort(compTotal)}</span>
          </div>
          {!loading && composition.length === 0 && <p className="py-3 text-sm text-slate-400">Bu davrda tasdiqlangan xarajat yo'q.</p>}
          <ul>
            {composition.map((c) => {
              const share = compTotal ? (c.amount / compTotal) * 100 : 0
              return (
                <li key={c.key}>
                  <Link
                    to={`${roleBase}/moliya/kategoriya/${c.key}${month === current ? '' : `?m=${month.slice(0, 7)}`}`}
                    className="flex items-center gap-3 border-b border-slate-100 py-2 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-900 dark:text-slate-100">{c.key === 'none' ? 'Kategoriyasiz' : catName.get(c.key) ?? '—'}</div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-1.5 rounded-full bg-[#eb6834] dark:bg-[#d95926]" style={{ width: `${Math.max(2, share)}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatSomShort(c.amount)}</div>
                      <div className="text-xs tabular-nums text-slate-500">{share.toFixed(1)}%</div>
                    </div>
                    <span aria-hidden className="text-slate-400">
                      ›
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">💡 Istalgan qatorni bosib, kategoriya sahifasiga o'ting — oylik tendentsiya, qabul qiluvchilar va barcha yozuvlar.</p>
        </Card>

        <div className="space-y-4">
          {/* ---------------- balances */}
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Balanslar</h2>
              <span className="text-xs text-slate-500">joriy qoldiq</span>
            </div>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {accounts.map((a) => {
                const hint = coverageHint(a)
                const prevBal = a.prevMonthBalance ?? null
                const pct = a.kind === 'bank' ? pctChange(a.balance, prevBal) : null
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-900 dark:text-slate-100">
                        {a.name_uz}
                        {hint?.low && ' ⚠'}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {hint ? (
                          <span className={hint.low ? 'text-amber-700 dark:text-amber-400' : ''}>{hint.text}</span>
                        ) : a.kind === 'kassa' && a.avgMonthlySpend ? (
                          `oyiga ~${formatSomShort(a.avgMonthlySpend)} aylanma`
                        ) : pct !== null ? (
                          <Delta pct={pct} goodWhenUp />
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatSomShort(a.balance)} so'm</div>
                  </li>
                )
              })}
            </ul>
          </Card>

          {/* ---------------- obligations + reserve */}
          <Card>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Kutilayotgan majburiyatlar</h2>
              {isBux && (
                <Link to="/buxgalter/kirim/kutilayotgan" className="text-xs font-medium text-slate-600 underline dark:text-slate-300">
                  + Qo'shish
                </Link>
              )}
            </div>
            {obligations.length === 0 && <p className="py-2 text-sm text-slate-400">Kutilayotgan majburiyat yo'q.</p>}
            <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
              {obligations.slice(0, 5).map((o) => {
                const days = daysBetween(today, o.due_date)
                const per = dailyReserve(o.estimated_amount, days)
                return (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-900 dark:text-slate-100">{o.name}</div>
                      <div className={`text-xs ${days < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                        {dayLabel(o.due_date)}
                        {o.due_date.slice(0, 4) !== today.slice(0, 4) ? ` ${o.due_date.slice(0, 4)}` : ''} · {days < 0 ? `${-days} kun o'tdi` : days === 0 ? 'bugun' : `${days} kun qoldi`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">~{formatSomShort(o.estimated_amount)}</div>
                      {per !== null && <div className="text-xs tabular-nums text-slate-500">{formatSomShort(per)}/kun</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
            {obligations.length > 0 && (
              <div className="mt-3 rounded-md bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zahira tavsiyasi</div>
                <p className="mt-1 text-sm text-slate-900 dark:text-slate-100">
                  Hisobingizda kamida <span className="font-semibold tabular-nums">{formatSom(obligationTotal)} so'm</span> turishi kerak.
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  Kutilayotgan majburiyatlar jami. Hozirda (naqd + bank): {formatSomShort(cashTotal)} —{' '}
                  {cashTotal >= obligationTotal ? (
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">yetarli ✓</span>
                  ) : (
                    <span className="font-medium text-red-600 dark:text-red-400">{formatSomShort(obligationTotal - cashTotal)} yetishmaydi ⚠</span>
                  )}
                </p>
              </div>
            )}
          </Card>

          {/* ---------------- forecast */}
          <Card>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">📈 Joriy oy prognozi · {monthLabel(current)}</div>
            {forecast ? (
              <>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Oy oxirigacha joriy sur'atda — {formatSom(forecast.kg)} kg{forecast.rate ? `, stavka ${formatSom(forecast.rate)} so'm/kg` : ', stavka belgilanmagan'}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[
                    ['Kutilgan tushum', forecast.income],
                    ['Xarajat', forecast.expense],
                    ['Taxminiy natija', forecast.profit],
                  ].map(([label, v]) => (
                    <div key={label as string} className="rounded-md bg-slate-50 px-2 py-2 dark:bg-slate-800/60">
                      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                      <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{v === null ? '—' : `~${formatSomShort(v as number)}`}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {day} kunlik ishlab chiqarish va xarajat oy oxirigacha cho'zilgan — taxmin, haqiqiy daromad emas. Oy boshida kamroq aniq.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Yuklanmoqda…</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

