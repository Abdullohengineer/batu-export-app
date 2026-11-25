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
  kind: 'bank' | 'kassa' | 'utility' | 'external'
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
    queryFn: async ({ signal }): Promise<{ accounts: AccountWithBalance[]; names: Record<string, string> }> => {
      const [accounts, cashIns, transfers, expenses] = await Promise.all([
        run(
          supabase.from('accounts').select('id, name_uz, kind, supplier_name, is_active').order('created_at').abortSignal(signal),
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
      // Inactive accounts (incl. the hidden 'external' ones, decision 0254) are
      // listed nowhere, but their names are kept so a transfer to or from one
      // still reads e.g. "Boshlang'ich qoldiq → Naqd pul (bank)" in Tarix.
      const allRows = (accounts as (AccountRow & { is_active: boolean })[] | null) ?? []
      const accountRows = allRows.filter((a) => a.is_active)
      const names = Object.fromEntries(allRows.map((a) => [a.id, a.name_uz]))
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
      return { accounts: accountRows.map((a) => ({ ...a, balance: balances.get(a.id) ?? 0, prevMonthBalance: prev.get(a.id) ?? 0 })), names }
    },
  })
  return { accounts: data?.accounts ?? [], names: data?.names ?? {}, loading: isPending, error: error ? error.message : null }
}
