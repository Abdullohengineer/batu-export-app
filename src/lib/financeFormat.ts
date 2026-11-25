// Buxgalteriya (decisions 0249/0250): pure formatting + date helpers shared
// by every finance screen. No I/O -- unit-tested in financeFormat.test.ts.
// Months are always the FIRST of the month as 'YYYY-MM-DD' (period_month).

const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
const MONTHS_UZ_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

/** 2450000 → "2,450,000" (so'm are whole numbers). */
export function formatSom(v: number): string {
  return Math.round(v).toLocaleString('en-US')
}

/** 44350000 → "44.35M", 833000 → "833k", 900 → "900". */
export function formatSomShort(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (a >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(Math.round(v))
}

/** "2,450,000 so'm" / "2 450 000" / "2450000" → 2450000; nothing usable → 0. */
export function parseAmount(input: string): number {
  const digits = input.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

/** '2026-11-01' → "Noyabr 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS_UZ[m - 1]} ${y}`
}

/** '2026-11-01' → "Noy'26". */
export function monthLabelShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS_UZ_SHORT[m - 1]}'${String(y).slice(2)}`
}

/** '2026-11-22' → "22 Noy". */
export function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS_UZ_SHORT[m - 1]}`
}

/** Any 'YYYY-MM-DD' → first of its month. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Last day of the month, 'YYYY-MM-DD'. */
export function monthEnd(month: string): string {
  return `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, '0')}`
}

/** Months for a picker, newest first: `forward` months after `current`, then `current`, then `back` before it. */
export function monthOptions(current: string, back = 12, forward = 1): string[] {
  const out: string[] = []
  for (let i = forward; i >= -back; i--) out.push(addMonths(current, i))
  return out
}

/** A recurring schedule's due date in `month`; day 31 in a 30-day month → the 30th. */
export function dueDateInMonth(dayOfMonth: number, month: string): string {
  const d = Math.min(dayOfMonth, daysInMonth(month))
  return `${month.slice(0, 7)}-${String(d).padStart(2, '0')}`
}

/** Next due date on or after `today` for a monthly schedule. */
export function nextDueDate(dayOfMonth: number, today: string): string {
  const thisMonth = dueDateInMonth(dayOfMonth, monthOf(today))
  return thisMonth >= today ? thisMonth : dueDateInMonth(dayOfMonth, addMonths(monthOf(today), 1))
}

/** Whole days from a to b ('YYYY-MM-DD'), b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** How many months a balance lasts at a monthly spend; null when there's no spend history. */
export function coverageMonths(balance: number, avgMonthlySpend: number): number | null {
  if (!(avgMonthlySpend > 0)) return null
  return Math.max(0, balance) / avgMonthlySpend
}

export interface AccountCardData {
  id: string
  name_uz: string
  kind: string
  supplier_name: string | null
  balance: number
  /** average monthly spend from this account (for the "~2.3 oy" hint); 0 = unknown */
  avgMonthlySpend?: number
  /** balance at the end of last month, when known */
  prevMonthBalance?: number
}

/** "~2.3 oy", with low = under ~1.5 months of cover. */
export function coverageHint(a: AccountCardData): { text: string; low: boolean } | null {
  if (a.kind !== 'utility') return null
  const c = coverageMonths(a.balance, a.avgMonthlySpend ?? 0)
  if (c === null) return null
  return { text: `~${c.toFixed(1)} oy`, low: c < 1.5 }
}

/** "X so'm/kun ajrating" (Kutilayotgan): amount spread over the days left, to the nearest 1,000; null once due. */
export function dailyReserve(amount: number, daysLeft: number): number | null {
  if (daysLeft <= 0) return null
  return Math.round(amount / daysLeft / 1000) * 1000
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

/** Tiles and chart axes (decision 0256): 8479103 → "8.48M", 833000 → "833K", −2.9e8 → "−290M". Full precision stays in tables. */
export function formatCompact(v: number): string {
  const s = COMPACT.format(Math.abs(v))
  return v < 0 ? `−${s}` : s
}
