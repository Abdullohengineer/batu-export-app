/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAccountBalances, type BalanceInput } from './financeBalances.ts'

const BANK = 'bank'
const KASSA = 'kassa'
const GAZ = 'gaz'

function input(partial: Partial<BalanceInput>): BalanceInput {
  return { accountIds: [BANK, KASSA, GAZ], cashIns: [], transfers: [], expenses: [], ...partial }
}

test('every account gets an entry, untouched ones are 0', () => {
  const b = computeAccountBalances(input({}), '2026-11-22')
  assert.deepEqual([...b.entries()], [[BANK, 0], [KASSA, 0], [GAZ, 0]])
})

test('cash-in credits, transfer moves, confirmed expense debits', () => {
  const b = computeAccountBalances(
    input({
      cashIns: [{ amount: 45_595_200, received_date: '2026-11-05', destination_account_id: BANK, voided_at: null }],
      transfers: [
        { amount: 15_000_000, transfer_date: '2026-11-21', source_account_id: BANK, destination_account_id: KASSA, voided_at: null },
        { amount: 4_200_000, transfer_date: '2026-11-10', source_account_id: BANK, destination_account_id: GAZ, voided_at: null },
      ],
      expenses: [
        { amount: 2_450_000, payment_date: '2026-11-22', source_account_id: GAZ, status: 'confirmed', voided_at: null },
        { amount: 1_200_000, payment_date: '2026-11-20', source_account_id: KASSA, status: 'confirmed', voided_at: null },
      ],
    }),
    '2026-11-22',
  )
  assert.equal(b.get(BANK), 45_595_200 - 15_000_000 - 4_200_000)
  assert.equal(b.get(KASSA), 15_000_000 - 1_200_000)
  assert.equal(b.get(GAZ), 4_200_000 - 2_450_000)
})

test('voided rows and pending expenses never count', () => {
  const b = computeAccountBalances(
    input({
      cashIns: [{ amount: 100, received_date: '2026-11-01', destination_account_id: BANK, voided_at: '2026-11-02T00:00:00Z' }],
      transfers: [{ amount: 50, transfer_date: '2026-11-01', source_account_id: BANK, destination_account_id: KASSA, voided_at: '2026-11-02T00:00:00Z' }],
      expenses: [
        { amount: 30, payment_date: '2026-11-01', source_account_id: BANK, status: 'pending', voided_at: null },
        { amount: 20, payment_date: '2026-11-01', source_account_id: BANK, status: 'confirmed', voided_at: '2026-11-02T00:00:00Z' },
      ],
    }),
    '2026-11-22',
  )
  assert.equal(b.get(BANK), 0)
  assert.equal(b.get(KASSA), 0)
})

test('as-of date is inclusive and date-based (period_month plays no part)', () => {
  const data = input({
    cashIns: [
      { amount: 1000, received_date: '2026-11-05', destination_account_id: BANK, voided_at: null },
      { amount: 500, received_date: '2026-11-06', destination_account_id: BANK, voided_at: null },
    ],
    expenses: [{ amount: 300, payment_date: '2026-11-06', source_account_id: BANK, status: 'confirmed', voided_at: null }],
  })
  assert.equal(computeAccountBalances(data, '2026-11-04').get(BANK), 0)
  assert.equal(computeAccountBalances(data, '2026-11-05').get(BANK), 1000)
  assert.equal(computeAccountBalances(data, '2026-11-06').get(BANK), 1200)
})

test('accounts referenced but not listed still accumulate', () => {
  const b = computeAccountBalances(
    input({ accountIds: [BANK], cashIns: [{ amount: 7, received_date: '2026-11-01', destination_account_id: 'other', voided_at: null }] }),
    '2026-11-22',
  )
  assert.equal(b.get('other'), 7)
})
