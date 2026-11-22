// Buxgalteriya (docs/decisions/0249): account balance as of a date.
// Pure function, no I/O. Balances are DATE-based (received_date /
// transfer_date / payment_date), never period_month -- period_month drives
// reports, the dates drive money actually moving (SPEC invariant 1).
//
// balance(account) = Σ cash_ins into it
//                  + Σ transfers into it − Σ transfers out of it
//                  − Σ confirmed expenses paid from it
// Voided rows never count. A 'pending' expense (auto-posted, not yet
// confirmed by the accountant) does not count until confirmed.
// Amounts are bigint so'm, safe as JS numbers (< 2^53).

export interface BalanceCashIn {
  amount: number
  received_date: string
  destination_account_id: string
  voided_at: string | null
}

export interface BalanceTransfer {
  amount: number
  transfer_date: string
  source_account_id: string
  destination_account_id: string
  voided_at: string | null
}

export interface BalanceExpense {
  amount: number
  payment_date: string
  source_account_id: string
  status: 'pending' | 'confirmed'
  voided_at: string | null
}

export interface BalanceInput {
  accountIds: string[]
  cashIns: BalanceCashIn[]
  transfers: BalanceTransfer[]
  expenses: BalanceExpense[]
}

/** asOf: 'YYYY-MM-DD', inclusive. Every account in accountIds gets an entry (0 if untouched). */
export function computeAccountBalances(input: BalanceInput, asOf: string): Map<string, number> {
  const out = new Map<string, number>(input.accountIds.map((id) => [id, 0]))
  const add = (id: string, delta: number) => out.set(id, (out.get(id) ?? 0) + delta)

  for (const c of input.cashIns) {
    if (c.voided_at || c.received_date > asOf) continue
    add(c.destination_account_id, Number(c.amount))
  }
  for (const t of input.transfers) {
    if (t.voided_at || t.transfer_date > asOf) continue
    add(t.source_account_id, -Number(t.amount))
    add(t.destination_account_id, Number(t.amount))
  }
  for (const e of input.expenses) {
    if (e.voided_at || e.status !== 'confirmed' || e.payment_date > asOf) continue
    add(e.source_account_id, -Number(e.amount))
  }
  return out
}

/**
 * Average monthly spend per source account over the `months` full months
 * before `currentMonth` (by period_month, confirmed only). Divides by the
 * number of those months that actually had spend from the account, so a
 * newly used account isn't understated. Feeds the "~2.3 oy" cover hint.
 */
export function avgMonthlySpendByAccount(
  expenses: { amount: number; period_month: string; source_account_id: string; status: string }[],
  currentMonth: string,
  months = 3,
): Map<string, number> {
  const [y, m] = currentMonth.split('-').map(Number)
  const startIdx = y * 12 + (m - 1) - months
  const endIdx = y * 12 + (m - 1) - 1
  const totals = new Map<string, number>()
  const monthsSeen = new Map<string, Set<string>>()
  for (const e of expenses) {
    if (e.status !== 'confirmed') continue
    const [ey, em] = e.period_month.split('-').map(Number)
    const idx = ey * 12 + (em - 1)
    if (idx < startIdx || idx > endIdx) continue
    totals.set(e.source_account_id, (totals.get(e.source_account_id) ?? 0) + Number(e.amount))
    if (!monthsSeen.has(e.source_account_id)) monthsSeen.set(e.source_account_id, new Set())
    monthsSeen.get(e.source_account_id)!.add(e.period_month)
  }
  const out = new Map<string, number>()
  for (const [acc, total] of totals) out.set(acc, total / (monthsSeen.get(acc)?.size || 1))
  return out
}
