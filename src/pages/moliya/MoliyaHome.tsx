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
  formatCompact,
  formatSom,
  monthLabel,
  monthLabelShort,
} from '../../lib/financeFormat'
import { MonthBars, type BarSeries } from '../../components/finance/MonthBars'
import { PeriodPicker } from '../../components/finance/PeriodPicker'
import { Donut } from '../../components/finance/Donut'
import { Panel, Pill, Signed, Stat, Tile, ViewPills } from '../../components/finance/FinanceUI'
import { FIN_PALETTE, signClass } from '../../lib/financeTheme'
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

/** "−85% o'tgan oyga" as a pill: good change teal, bad change pink (mockup). */
function Delta({ pct, goodWhenUp }: { pct: number | null; goodWhenUp: boolean }) {
  if (pct === null) return null
  if (Math.round(pct) === 0) return <Pill tone="neutral">≈0% o'tgan oyga</Pill>
  const good = pct > 0 === goodWhenUp
  return (
    <Pill tone={good ? 'done' : 'warning'}>
      {pct > 0 ? '+' : '−'}
      {Math.abs(Math.round(pct))}% o'tgan oyga
    </Pill>
  )
}

const SOM = <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">so'm</span>

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
  const slices = useMemo(() => {
    const top = composition.length > 5 ? composition.slice(0, 4) : composition
    const rest = composition.length > 5 ? composition.slice(4) : []
    const out = top.map((c, i) => ({ key: c.key, amount: c.amount, color: FIN_PALETTE[i], name: c.key === 'none' ? 'Kategoriyasiz' : catName.get(c.key) ?? '—', link: true }))
    if (rest.length) out.push({ key: 'boshqa', amount: sumAmount(rest), color: FIN_PALETTE[4], name: `Boshqa (${rest.length} ta)`, link: false })
    return out
  }, [composition, catName])

  // ---- chart
  const labels = months.map((m) => monthLabel(m).split(' ')[0])
  const val = (m: string, k: 'income' | 'expense' | 'profit' | 'costPerKg') => {
    const x = figures.get(m)
    return x ? x[k] : null
  }
  const series: BarSeries[] =
    tab === 'both'
      ? [
          { label: 'Tushum', color: 'var(--accent-income)', values: months.map((m) => val(m, 'income')) },
          { label: 'Xarajat', color: 'var(--accent-expense)', values: months.map((m) => val(m, 'expense')) },
        ]
      : tab === 'expense'
        ? [{ label: 'Xarajat', color: 'var(--accent-expense)', values: months.map((m) => val(m, 'expense')) }]
        : tab === 'cost'
          ? [{ label: '1 kg tannarxi', color: 'var(--accent-utility)', values: months.map((m) => val(m, 'costPerKg')) }]
          : tab === 'profit'
            ? [{ label: 'Sof foyda', color: 'var(--accent-income)', values: months.map((m) => val(m, 'profit')) }]
            : TYPE_ORDER.map((t, i) => ({
                label: EXPENSE_TYPE_LABEL[t],
                color: FIN_PALETTE[i],
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

  const catHref = (key: string) => `${roleBase}/moliya/kategoriya/${key}${month === current ? '' : `?m=${month.slice(0, 7)}`}`
  const h2 = 'text-[15px] font-semibold text-[var(--text-primary)]'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.8px] text-[var(--text-secondary)]">Moliyaviy ko'rsatkichlar</div>
          <h1 className="text-2xl font-semibold tracking-[-0.5px] text-[var(--text-primary)]">Umumiy ko'rinish</h1>
        </div>
        <PeriodPicker value={month} onChange={setMonth} current={current} />
      </div>
      <p className="-mt-3 text-xs text-[var(--text-muted)]">
        💡 Barcha ko'rsatkichlar tanlangan davrga tegishli yozuvlarga asoslanadi — to'lov sanasi emas, "qaysi oy uchun" belgisi bo'yicha. Balanslar esa hamisha joriy qoldiqni ko'rsatadi.
      </p>
      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {/* ---------------- KPI tiles */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Tile
          label="Umumiy pul qoldiq"
          aside={<span className="text-[11px] text-[var(--text-muted)]">naqd + bank · joriy</span>}
          footer={cash.map((a) => (
            <Stat key={a.id} label={a.kind === 'bank' ? 'Bank' : 'Kassa'}>
              {formatCompact(a.balance)}
            </Stat>
          ))}
        >
          {formatCompact(cashTotal)}
          {SOM}
        </Tile>
        <Tile
          label={`${name} sof foyda`}
          aside={<Delta pct={pctChange(f?.profit ?? null, prev?.profit ?? null)} goodWhenUp />}
          footer={
            <>
              <Stat label="Tushum">{f?.income != null ? <span className="text-[var(--accent-income)]">{formatCompact(f.income)}</span> : 'kiritilmagan'}</Stat>
              <Stat label="Xarajat">{f ? <span className="text-[var(--accent-expense)]">{formatCompact(f.expense)}</span> : '—'}</Stat>
              {f && f.income === null && <span className="basis-full">Sof foyda {name} uchun tushum kiritilgach hisoblanadi.</span>}
            </>
          }
        >
          {f?.profit != null ? (
            <>
              <Signed value={f.profit} />
              {SOM}
            </>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          )}
        </Tile>
        <Tile
          label="1 kg tannarxi"
          aside={<Delta pct={pctChange(f?.costPerKg ?? null, prev?.costPerKg ?? null)} goodWhenUp={false} />}
          footer={
            <span>
              {name} xarajati ({f ? formatCompact(f.expense) : '—'}) ÷ Moykadan chiqdi ({f?.kg != null ? `${formatSom(f.kg)} kg` : '…'}).
              {f?.rate && f.costPerKg != null && (
                <>
                  {' '}
                  Stavkadan ({formatSom(f.rate)}) — <span className={`font-medium ${signClass(f.rate - f.costPerKg)}`}>{formatSom(f.rate - f.costPerKg)} so'm/kg marja</span>
                </>
              )}
            </span>
          }
        >
          {f?.costPerKg != null ? formatSom(f.costPerKg) : <span className="text-[var(--text-muted)]">—</span>}
          <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">so'm/kg</span>
        </Tile>
      </div>

      {/* ---------------- chart */}
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ViewPills value={tab} options={TABS} onChange={setTab} label="Grafik" />
        </div>
        <p className="mb-3 mt-2 text-xs text-[var(--text-muted)]">So'nggi 6 oy · "Qaysi oy uchun" belgisiga ko'ra guruhlangan</p>
        <MonthBars
          title={TABS.find((t) => t.key === tab)!.label}
          months={months}
          monthLabels={labels}
          series={series}
          variant={tab === 'both' ? 'line' : tab === 'types' ? 'stacked' : 'bars'}
          format={tab === 'cost' ? (v) => formatSom(v) : formatCompact}
          selectedIndex={months.length - 1}
        />
      </Panel>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---------------- composition (donut) */}
        <Panel>
          <div className="flex items-baseline justify-between">
            <h2 className={h2}>Xarajatlar tarkibi · {monthLabelShort(month)}</h2>
            <Link to={tarixHref} className="text-xs font-medium text-[var(--accent-expense)] hover:underline">
              Batafsil tarix ›
            </Link>
          </div>
          {!loading && composition.length === 0 && <p className="py-3 text-sm text-[var(--text-muted)]">Bu davrda tasdiqlangan xarajat yo'q.</p>}
          {composition.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <Donut slices={slices.map((x) => ({ key: x.key, value: x.amount, color: x.color }))} centerLabel="JAMI" centerValue={formatCompact(compTotal)} />
              <ul className="w-full min-w-0 flex-1 space-y-1">
                {slices.map((c) => {
                  const share = compTotal ? (c.amount / compTotal) * 100 : 0
                  const body = (
                    <>
                      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">{c.name}</span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular-nums text-[var(--text-primary)]">{formatCompact(c.amount)}</span>
                        <span className="block text-[11px] tabular-nums text-[var(--text-muted)]">{share.toFixed(1)}%</span>
                      </span>
                      <span aria-hidden className={`w-3 text-[var(--text-muted)] ${c.link ? '' : 'invisible'}`}>
                        ›
                      </span>
                    </>
                  )
                  return (
                    <li key={c.key}>
                      {c.link ? (
                        <Link to={catHref(c.key)} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 transition-colors hover:bg-[var(--surface-elev)]">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 px-2 py-2">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
            💡 Istalgan qatorni bosib, kategoriya sahifasiga o'ting — oylik tendentsiya, qabul qiluvchilar va barcha yozuvlar.
          </p>
        </Panel>

        <div className="space-y-4">
          {/* ---------------- balances: 2×2 mini tiles */}
          <Panel>
            <div className="flex items-baseline justify-between">
              <h2 className={h2}>Balanslar</h2>
              <span className="text-xs text-[var(--text-muted)]">joriy qoldiq</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {accounts.map((a) => {
                const hint = coverageHint(a)
                const runway = a.kind === 'utility' && a.avgMonthlySpend ? Math.max(0, a.balance) / a.avgMonthlySpend : null
                const runwayColor = runway === null ? '' : runway >= 3 ? 'var(--accent-success)' : runway >= 1 ? 'var(--accent-utility)' : 'var(--accent-warning)'
                const pct = a.kind === 'bank' ? pctChange(a.balance, a.prevMonthBalance ?? null) : null
                const dot = a.kind === 'bank' ? 'var(--accent-expense)' : a.kind === 'kassa' ? 'var(--accent-utility)' : runwayColor || 'var(--accent-utility)'
                return (
                  <div key={a.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
                        <span className="truncate">
                          {a.name_uz}
                          {hint?.low && ' ⚠'}
                        </span>
                      </span>
                      {hint && (
                        <span className="shrink-0 text-[11px] font-medium tabular-nums" style={{ color: runwayColor }}>
                          {hint.text}
                        </span>
                      )}
                    </div>
                    <div className={`mt-1.5 text-lg font-semibold tabular-nums ${a.balance < 0 ? 'text-[var(--accent-warning)]' : 'text-[var(--text-primary)]'}`}>
                      {formatCompact(a.balance)} <span className="text-xs font-normal text-[var(--text-muted)]">so'm</span>
                    </div>
                    {runway !== null ? (
                      <div className="mt-2 h-1 rounded-full bg-[var(--border)]">
                        <div className="h-1 rounded-full" style={{ width: `${Math.min(100, (runway / 3) * 100)}%`, background: runwayColor }} />
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {a.kind === 'kassa' && a.avgMonthlySpend ? `oyiga ~${formatCompact(a.avgMonthlySpend)} aylanma` : pct !== null ? <Delta pct={pct} goodWhenUp /> : ' '}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* ---------------- obligations + reserve */}
          <Panel>
            <div className="flex items-baseline justify-between">
              <h2 className={h2}>Kutilayotgan majburiyatlar</h2>
              {isBux && (
                <Link to="/buxgalter/kirim/kutilayotgan" className="text-xs font-medium text-[var(--accent-income)] hover:underline">
                  + Qo'shish
                </Link>
              )}
            </div>
            {obligations.length === 0 && <p className="py-2 text-sm text-[var(--text-muted)]">Kutilayotgan majburiyat yo'q.</p>}
            <ul className="mt-3 space-y-2">
              {obligations.slice(0, 5).map((o) => {
                const days = daysBetween(today, o.due_date)
                const per = dailyReserve(o.estimated_amount, days)
                return (
                  <li key={o.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 rounded-[10px] bg-[var(--bg)] px-3 py-2.5">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">{o.name}</span>
                    <span className="text-right text-sm font-semibold tabular-nums text-[var(--text-primary)]">~{formatCompact(o.estimated_amount)}</span>
                    <span className={`text-[11px] ${days < 0 ? 'text-[var(--accent-warning)]' : 'text-[var(--text-muted)]'}`}>
                      {dayLabel(o.due_date)}
                      {o.due_date.slice(0, 4) !== today.slice(0, 4) ? ` ${o.due_date.slice(0, 4)}` : ''} · {days < 0 ? `${-days} kun o'tdi` : days === 0 ? 'bugun' : `${days} kun qoldi`}
                    </span>
                    <span className="justify-self-end">{per !== null && <Pill tone="neutral">{formatCompact(per)}/kun</Pill>}</span>
                  </li>
                )
              })}
            </ul>
            {obligations.length > 0 && (
              <div className="mt-3 rounded-[10px] border border-[rgb(79_211_196/0.3)] bg-[rgb(79_211_196/0.08)] px-3.5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.8px] text-[var(--accent-income)]">Zahira tavsiyasi</div>
                <p className="mt-1 text-sm text-[var(--text-primary)]">
                  Hisobingizda kamida <span className="font-semibold tabular-nums text-[var(--accent-income)]">{formatSom(obligationTotal)} so'm</span> turishi kerak.
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  Kutilayotgan majburiyatlar jami. Hozirda (naqd + bank): {formatCompact(cashTotal)} —{' '}
                  {cashTotal >= obligationTotal ? (
                    <span className="font-medium text-[var(--accent-income)]">yetarli ✓</span>
                  ) : (
                    <span className="font-medium text-[var(--accent-warning)]">{formatCompact(obligationTotal - cashTotal)} yetishmaydi ⚠</span>
                  )}
                </p>
              </div>
            )}
          </Panel>

          {/* ---------------- forecast */}
          <Panel>
            <div className={h2}>📈 Joriy oy prognozi · {monthLabel(current)}</div>
            {forecast ? (
              <>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Oy oxirigacha joriy sur'atda — {formatSom(forecast.kg)} kg{forecast.rate ? `, stavka ${formatSom(forecast.rate)} so'm/kg` : ', stavka belgilanmagan'}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(
                    [
                      ['Kutilgan tushum', forecast.income, 'var(--accent-income)'],
                      ['Xarajat', forecast.expense, 'var(--accent-expense)'],
                      ['Taxminiy natija', forecast.profit, null],
                    ] as const
                  ).map(([label, v, color]) => (
                    <div key={label} className="rounded-[10px] bg-[var(--bg)] px-3 py-2.5">
                      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
                      <div className={`text-base font-semibold tabular-nums ${color ? '' : signClass(v)}`} style={color ? { color } : undefined}>
                        {v === null ? '—' : `~${formatCompact(v)}`}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  {day} kunlik ishlab chiqarish va xarajat oy oxirigacha cho'zilgan — taxmin, haqiqiy daromad emas. Oy boshida kamroq aniq.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-[var(--text-muted)]">Yuklanmoqda…</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
