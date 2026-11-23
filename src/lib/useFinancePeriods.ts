import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCashIns, useCounterparties, useExpenses, useMoykaKgSeries, useMonthlyRates } from './useFinance'
import { addMonths, monthOf } from './financeFormat'
import { todayInTashkent } from './dateRange'
import { costPerKg, periodExpenses, periodIncome, sumAmount } from './financeMetrics'

// Moliyaviy ko'rsatkichlar (decision 0252): the selected period (URL ?m=,
// so Overview → CategoryDetail keeps it) and the 6 months ending at it, each
// with the shared figures from financeMetrics.

export function usePeriodParam(): [string, (m: string) => void, string] {
  const current = monthOf(todayInTashkent())
  const [params, setParams] = useSearchParams()
  const raw = params.get('m')
  const month = raw && /^\d{4}-\d{2}$/.test(raw) && `${raw}-01` <= current ? `${raw}-01` : current
  const set = (m: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (m === current) n.delete('m')
        else n.set('m', m.slice(0, 7))
        return n
      },
      { replace: true },
    )
  return [month, set, current]
}

export interface PeriodFigures {
  month: string
  income: number
  incomeBasis: 'rate' | 'cash'
  expense: number
  profit: number
  kg: number | null
  costPerKg: number | null
  rate: number | undefined
}

export const CHART_MONTHS = 6

/** Figures for the CHART_MONTHS months ending at `month` (oldest first), plus the raw rows for drill-downs. */
export function useFinancePeriods(month: string) {
  const months = useMemo(() => Array.from({ length: CHART_MONTHS }, (_, i) => addMonths(month, i - (CHART_MONTHS - 1))), [month])
  // one month earlier than the chart, for the first month's "o'tgan oyga"
  const since = addMonths(months[0], -1)
  const { expenses, loading: l1, error: e1 } = useExpenses(since)
  const { cashIns, loading: l2, error: e2 } = useCashIns(since)
  const rates = useMonthlyRates()
  const { counterparties: customers } = useCounterparties('customer')
  const ownerId = customers[0]?.owner_id ?? null
  const kgMonths = useMemo(() => [addMonths(months[0], -1), ...months], [months])
  const { kg } = useMoykaKgSeries(ownerId, kgMonths)

  const figures = useMemo(() => {
    const out = new Map<string, PeriodFigures>()
    for (const m of kgMonths) {
      const k = kg.has(m) ? kg.get(m)! : null
      const rate = rates.get(`${m}:moyka`)
      const inc = periodIncome(m, k, rate, cashIns)
      const expense = sumAmount(periodExpenses(m, expenses))
      out.set(m, { month: m, income: inc.income, incomeBasis: inc.basis, expense, profit: inc.income - expense, kg: k, costPerKg: costPerKg(expense, k), rate })
    }
    return out
  }, [kgMonths, kg, rates, cashIns, expenses])

  return {
    months,
    figures,
    expenses,
    cashIns,
    rates,
    ownerId,
    loading: l1 || l2,
    error: e1 ?? e2,
  }
}
