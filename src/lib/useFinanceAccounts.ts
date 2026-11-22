import { useMemo } from 'react'
import { useAccountBalances } from './useAccountBalances'
import { useExpenses } from './useFinance'
import { avgMonthlySpendByAccount } from './financeBalances'
import { addMonths, monthOf } from './financeFormat'
import { todayInTashkent } from './dateRange'
import type { AccountCardData } from './financeFormat'

// Accounts with live balance + average monthly spend (for "~2.3 oy").
// Shares useExpenses' cache key with the screens that list expenses, so it
// adds no extra read when both are on screen.
export function useFinanceAccounts() {
  const currentMonth = monthOf(todayInTashkent())
  const since = addMonths(currentMonth, -6)
  const { accounts, loading, error } = useAccountBalances()
  const { expenses } = useExpenses(since)
  const data = useMemo<AccountCardData[]>(() => {
    const avg = avgMonthlySpendByAccount(expenses, currentMonth)
    return accounts.map((a) => ({ ...a, avgMonthlySpend: avg.get(a.id) ?? 0 }))
  }, [accounts, expenses, currentMonth])
  return { accounts: data, loading, error, currentMonth, since }
}
