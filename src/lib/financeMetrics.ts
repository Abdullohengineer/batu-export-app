// Buxgalteriya Phase 4 (decision 0252): the period figures every output
// screen shows -- Overview, CategoryDetail and Oyni yopish read them from
// here so the three can never disagree. Pure; unit-tested in
// financeMetrics.test.ts. All grouping is by period_month ("qaysi oy uchun").

export interface MetricExpense {
  amount: number
  period_month: string
  category_id: string | null
  counterparty_id: string | null
  expense_type: string
  status: 'pending' | 'confirmed'
}

export interface MetricCashIn {
  amount: number
  period_month: string
  service_type: string
}

export interface PeriodIncome {
  income: number
  /** 'rate' = Moyka kg × moyka rate (+ non-Moyka cash-ins); 'cash' = no rate for the month, so the cash-ins themselves */
  basis: 'rate' | 'cash'
}

/**
 * Daromad for a period. Brief: earnings = Moyka output kg × that month's
 * moyka rate -- accrued, so the current month shows earnings before Global
 * Export pays (a month in arrears). Rezka / other income has no accrual
 * source, so its cash-ins are added as received. A month with no moyka rate
 * falls back to all of its cash-ins.
 */
export function periodIncome(month: string, kg: number | null, rate: number | undefined, cashIns: MetricCashIn[]): PeriodIncome {
  const own = cashIns.filter((c) => c.period_month === month)
  if (rate && kg !== null) {
    const other = own.filter((c) => c.service_type !== 'moyka').reduce((s, c) => s + c.amount, 0)
    return { income: Math.round(kg * rate) + other, basis: 'rate' }
  }
  return { income: own.reduce((s, c) => s + c.amount, 0), basis: 'cash' }
}

/** Confirmed expenses of one period. Pending auto-posts never count. */
export function periodExpenses<T extends MetricExpense>(month: string, expenses: T[]): T[] {
  return expenses.filter((e) => e.period_month === month && e.status === 'confirmed')
}

export function sumAmount(rows: { amount: number }[]): number {
  return rows.reduce((s, r) => s + r.amount, 0)
}

/** Expense ÷ Moyka output kg; null without output. */
export function costPerKg(expense: number, kg: number | null): number | null {
  return kg && kg > 0 ? expense / kg : null
}

/** Relative change in %, null when there's no meaningful base. */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** Sum by a key, largest first. */
export function groupSum<T extends { amount: number }>(rows: T[], key: (r: T) => string): { key: string; amount: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.amount)
  return [...m].map(([k, amount]) => ({ key: k, amount })).sort((a, b) => b.amount - a.amount)
}

export interface Forecast {
  kg: number
  rate: number | null
  income: number | null
  expense: number
  profit: number | null
}

/**
 * Keyingi oy prognozi at the current month's pace (owner's choice,
 * 2026-11-23): this month's Moyka kg and confirmed expenses so far, scaled to
 * a full month; income at the latest moyka rate.
 */
export function forecastFromPace(kgSoFar: number, expenseSoFar: number, dayOfMonth: number, daysInMonth: number, rate: number | null): Forecast {
  const scale = daysInMonth / Math.max(1, dayOfMonth)
  const kg = Math.round(kgSoFar * scale)
  const expense = Math.round(expenseSoFar * scale)
  const income = rate ? Math.round(kg * rate) : null
  return { kg, rate, income, expense, profit: income === null ? null : income - expense }
}
