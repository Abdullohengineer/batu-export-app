/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMonths,
  coverageMonths,
  dayLabel,
  daysBetween,
  dueDateInMonth,
  formatSom,
  formatSomShort,
  monthEnd,
  monthLabel,
  monthLabelShort,
  monthOf,
  monthOptions,
  nextDueDate,
  parseAmount,
} from './financeFormat.ts'

test('formatSom / formatSomShort', () => {
  assert.equal(formatSom(2450000), '2,450,000')
  assert.equal(formatSomShort(44_350_000), '44.35M')
  assert.equal(formatSomShort(45_600_000), '45.6M')
  assert.equal(formatSomShort(30_000_000), '30M')
  assert.equal(formatSomShort(833_000), '833k')
  assert.equal(formatSomShort(-2_450_000), '-2.45M')
})

test('parseAmount keeps digits only', () => {
  assert.equal(parseAmount("2,450,000 so'm"), 2450000)
  assert.equal(parseAmount('2 450 000'), 2450000)
  assert.equal(parseAmount(''), 0)
  assert.equal(parseAmount('abc'), 0)
})

test('month labels', () => {
  assert.equal(monthLabel('2026-11-01'), 'Noyabr 2026')
  assert.equal(monthLabelShort('2026-10-01'), "Okt'26")
  assert.equal(dayLabel('2026-11-22'), '22 Noy')
  assert.equal(monthOf('2026-11-22'), '2026-11-01')
})

test('month arithmetic crosses years', () => {
  assert.equal(addMonths('2026-11-01', 2), '2027-01-01')
  assert.equal(addMonths('2026-01-01', -1), '2025-12-01')
  assert.equal(monthEnd('2026-02-01'), '2026-02-28')
  assert.equal(monthEnd('2028-02-01'), '2028-02-29')
  assert.deepEqual(monthOptions('2026-11-01', 2, 1), ['2026-12-01', '2026-11-01', '2026-10-01', '2026-09-01'])
})

test('recurring due dates clamp to month length and roll forward', () => {
  assert.equal(dueDateInMonth(31, '2026-11-01'), '2026-11-30')
  assert.equal(dueDateInMonth(25, '2026-11-01'), '2026-11-25')
  assert.equal(nextDueDate(25, '2026-11-22'), '2026-11-25')
  assert.equal(nextDueDate(1, '2026-11-22'), '2026-12-01')
  assert.equal(nextDueDate(22, '2026-11-22'), '2026-11-22')
  assert.equal(nextDueDate(31, '2026-12-31'), '2026-12-31')
  assert.equal(daysBetween('2026-11-22', '2026-11-25'), 3)
})

test('coverageMonths', () => {
  assert.equal(coverageMonths(4_200_000, 1_826_087)?.toFixed(1), '2.3')
  assert.equal(coverageMonths(100, 0), null)
  assert.equal(coverageMonths(-5, 10), 0)
})
