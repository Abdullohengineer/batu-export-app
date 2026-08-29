/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatLossKg, formatLossPct, computeLossDisplay } from './formatLoss.ts'

test('formatLossKg: real loss (positive signed) renders bare, no sign', () => {
  assert.equal(formatLossKg(50), '50 kg')
})

test('formatLossKg: surplus (negative signed) renders with explicit + prefix on the absolute value', () => {
  assert.equal(formatLossKg(-50), '+50 kg')
})

test('formatLossKg: zero renders "0 kg", not "-0 kg" or blank', () => {
  assert.equal(formatLossKg(0), '0 kg')
})

test('formatLossKg: rounds to whole kg', () => {
  assert.equal(formatLossKg(49.6), '50 kg')
  assert.equal(formatLossKg(-49.6), '+50 kg')
})

test('formatLossKg: custom unit (client-portal Cyrillic labelling)', () => {
  assert.equal(formatLossKg(50, 'кг'), '50 кг')
  assert.equal(formatLossKg(-50, 'кг'), '+50 кг')
  assert.equal(formatLossKg(0, 'кг'), '0 кг')
})

test('formatLossPct: real loss (positive) renders bare', () => {
  assert.equal(formatLossPct(4.5), '4.5%')
})

test('formatLossPct: surplus (negative) renders with explicit + prefix', () => {
  assert.equal(formatLossPct(-4.5), '+4.5%')
})

test('formatLossPct: zero renders "0%"', () => {
  assert.equal(formatLossPct(0), '0%')
})

// computeLossDisplay (2026-08-29, Prompt 10, see DECISIONS.md "Serial
// close-out (Yakunlash) + realized-vs-unrealized loss").
test('computeLossDisplay: open serial (closedAt null) — gap is Moykada, Yo\'qotish unrealized (null)', () => {
  assert.deepEqual(computeLossDisplay(1000, 400, null), { moykadaKg: 600, yoqotishKg: null, isRealized: false })
})

test('computeLossDisplay: open serial, fully received — Moykada floors at 0, still unrealized', () => {
  assert.deepEqual(computeLossDisplay(1000, 1000, null), { moykadaKg: 0, yoqotishKg: null, isRealized: false })
})

test('computeLossDisplay: open serial, over-received — Moykada floors at 0 (never negative), still unrealized', () => {
  assert.deepEqual(computeLossDisplay(1000, 1200, null), { moykadaKg: 0, yoqotishKg: null, isRealized: false })
})

test('computeLossDisplay: closed serial with a residual — Moykada 0, Yo\'qotish is the signed gap, realized', () => {
  assert.deepEqual(computeLossDisplay(1000, 900, '2026-08-29T00:00:00Z'), { moykadaKg: 0, yoqotishKg: 100, isRealized: true })
})

test('computeLossDisplay: closed serial with a surplus — Yo\'qotish is negative (a gain), realized', () => {
  assert.deepEqual(computeLossDisplay(1000, 1050, '2026-08-29T00:00:00Z'), { moykadaKg: 0, yoqotishKg: -50, isRealized: true })
})

test('computeLossDisplay: closed serial, exact match — Yo\'qotish is exactly 0, realized', () => {
  assert.deepEqual(computeLossDisplay(1000, 1000, '2026-08-29T00:00:00Z'), { moykadaKg: 0, yoqotishKg: 0, isRealized: true })
})
