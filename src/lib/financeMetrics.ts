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

/**
 * Daromad for a period = the tushum (cash-ins) actually entered for it, all
 * services. Owner, 2026-11-23: earnings and sof foyda count only entered
 * tushum, never production × rate. null = nothing entered yet, so the
 * screens show "—" instead of a made-up profit or loss.
 */
export function periodIncome(month: string, cashIns: MetricCashIn[]): number | null {
  const own = cashIns.filter((c) => c.period_month === month)
  return own.length ? own.reduce((s, c) => s + c.amount, 0) : null
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
 * Joriy oy prognozi (owner, 2026-11-23): the month still in progress,
 * projected to its end at the pace so far -- this month's Moyka kg and
 * confirmed expenses scaled to a full month, expected income at the latest
 * moyka rate. A forecast, not earnings: real Daromad is entered tushum only.
 */
export function forecastFromPace(kgSoFar: number, expenseSoFar: number, dayOfMonth: number, daysInMonth: number, rate: number | null): Forecast {
  const scale = daysInMonth / Math.max(1, dayOfMonth)
  const kg = Math.round(kgSoFar * scale)
  const expense = Math.round(expenseSoFar * scale)
  const income = rate ? Math.round(kg * rate) : null
  return { kg, rate, income, expense, profit: income === null ? null : income - expense }
}
