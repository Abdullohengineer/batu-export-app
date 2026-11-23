/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costPerKg, forecastFromPace, groupSum, pctChange, periodExpenses, periodIncome, sumAmount } from './financeMetrics.ts'

const ci = (amount: number, period_month: string, service_type = 'moyka') => ({ amount, period_month, service_type })
const ex = (amount: number, period_month: string, status: 'pending' | 'confirmed' = 'confirmed', category_id: string | null = 'c1') => ({
  amount,
  period_month,
  category_id,
  counterparty_id: null,
  expense_type: 'one_off',
  status,
})

test('periodIncome = entered tushum only; null when none', () => {
  const rows = [ci(45_000_000, '2026-11-01'), ci(2_000_000, '2026-11-01', 'rezka'), ci(9, '2026-10-01')]
  assert.equal(periodIncome('2026-11-01', rows), 47_000_000)
  assert.equal(periodIncome('2026-10-01', rows), 9)
  assert.equal(periodIncome('2026-12-01', rows), null)
})

test('periodExpenses counts confirmed only, in the period', () => {
  const rows = [ex(10, '2026-11-01'), ex(5, '2026-11-01', 'pending'), ex(7, '2026-10-01')]
  assert.equal(sumAmount(periodExpenses('2026-11-01', rows)), 10)
})

test('costPerKg / pctChange', () => {
  assert.equal(Math.round(costPerKg(44_350_000, 12_500)!), 3_548)
  assert.equal(costPerKg(1, 0), null)
  assert.equal(pctChange(110, 100), 10)
  assert.equal(pctChange(-50, 100), -150)
  assert.equal(pctChange(5, 0), null)
})

test('groupSum sorts largest first', () => {
  const g = groupSum([ex(1, 'm', 'confirmed', 'a'), ex(5, 'm', 'confirmed', 'b'), ex(2, 'm', 'confirmed', 'a')], (r) => r.category_id ?? '')
  assert.deepEqual(g, [{ key: 'b', amount: 5 }, { key: 'a', amount: 3 }])
})

test('forecastFromPace scales the month so far', () => {
  const f = forecastFromPace(9_000, 30_000_000, 22, 30, 4_000)
  assert.equal(f.kg, 12_273)
  assert.equal(f.expense, 40_909_091)
  assert.equal(f.income, 49_092_000)
  assert.equal(f.profit, 49_092_000 - 40_909_091)
  assert.equal(forecastFromPace(1, 1, 1, 30, null).income, null)
})
