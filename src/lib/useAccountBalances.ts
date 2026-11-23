import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { run } from './rpc'
import { queryKeys } from './queryClient'
import { todayInTashkent } from './dateRange'
import {
  computeAccountBalances,
  type BalanceCashIn,
  type BalanceExpense,
  type BalanceTransfer,
} from './financeBalances'

// Buxgalteriya (decision 0249): every active money account with its balance
// as of today (Tashkent). Date-based by design -- see financeBalances.ts.
export interface AccountRow {
  id: string
  name_uz: string
  kind: 'bank' | 'kassa' | 'utility'
  supplier_name: string | null
}

export interface AccountWithBalance extends AccountRow {
  balance: number
  /** balance at the end of last month (Moliya: "+6% o'tgan oyga") */
  prevMonthBalance: number
}

function lastDayOfPreviousMonth(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
}

export function useAccountBalances() {
  const asOf = todayInTashkent()
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.accountBalances(asOf),
    queryFn: async ({ signal }): Promise<AccountWithBalance[]> => {
      const [accounts, cashIns, transfers, expenses] = await Promise.all([
        run(
          supabase.from('accounts').select('id, name_uz, kind, supplier_name').eq('is_active', true).order('created_at').abortSignal(signal),
        ),
        run(
          supabase.from('cash_ins').select('amount, received_date, destination_account_id, voided_at').is('voided_at', null).abortSignal(signal),
        ),
        run(
          supabase
            .from('transfers')
            .select('amount, transfer_date, source_account_id, destination_account_id, voided_at')
            .is('voided_at', null)
            .abortSignal(signal),
        ),
        run(
          supabase
            .from('expenses')
            .select('amount, payment_date, source_account_id, status, voided_at')
            .is('voided_at', null)
            .eq('status', 'confirmed')
            .abortSignal(signal),
        ),
      ])
      const accountRows = (accounts as AccountRow[] | null) ?? []
      const balances = computeAccountBalances(
        {
          accountIds: accountRows.map((a) => a.id),
          cashIns: (cashIns as BalanceCashIn[] | null) ?? [],
          transfers: (transfers as BalanceTransfer[] | null) ?? [],
          expenses: (expenses as BalanceExpense[] | null) ?? [],
        },
        asOf,
      )
      const input = {
        accountIds: accountRows.map((a) => a.id),
        cashIns: (cashIns as BalanceCashIn[] | null) ?? [],
        transfers: (transfers as BalanceTransfer[] | null) ?? [],
        expenses: (expenses as BalanceExpense[] | null) ?? [],
      }
      const prev = computeAccountBalances(input, lastDayOfPreviousMonth(asOf))
      return accountRows.map((a) => ({ ...a, balance: balances.get(a.id) ?? 0, prevMonthBalance: prev.get(a.id) ?? 0 }))
    },
  })
  return { accounts: data ?? [], loading: isPending, error: error ? error.message : null }
}
