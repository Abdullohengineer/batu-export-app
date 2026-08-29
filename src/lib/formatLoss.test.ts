/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatLossKg, formatLossPct } from './formatLoss.ts'

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
