/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveEffectiveQty, computeVariance, isMaterialVariance } from './weightAuthority.ts'

test('deriveEffectiveQty: before §5.1 intake -> declared, not provisional', () => {
  const r = deriveEffectiveQty({ declaredQty: 5000, intakeActualQty: null, isMultiLine: false, gateNet: null, gateStage2Done: false })
  assert.deepEqual(r, { value: 5000, provisional: false, basis: 'declared_pre_intake' })
})

test('deriveEffectiveQty: intake done, gate stage 2 not yet -> intake, provisional (single-line)', () => {
  const r = deriveEffectiveQty({ declaredQty: 5000, intakeActualQty: 4900, isMultiLine: false, gateNet: null, gateStage2Done: false })
  assert.deepEqual(r, { value: 4900, provisional: true, basis: 'intake_provisional' })
})

test('deriveEffectiveQty: intake done, gate stage 2 not yet -> intake, provisional (multi-line too)', () => {
  const r = deriveEffectiveQty({ declaredQty: 1000, intakeActualQty: 1000, isMultiLine: true, gateNet: null, gateStage2Done: false })
  assert.deepEqual(r, { value: 1000, provisional: true, basis: 'intake_provisional' })
})

test('deriveEffectiveQty: single-line, gate stage 2 done -> gate net, final', () => {
  const r = deriveEffectiveQty({ declaredQty: 5000, intakeActualQty: 4900, isMultiLine: false, gateNet: 5100, gateStage2Done: true })
  assert.deepEqual(r, { value: 5100, provisional: false, basis: 'gate_net_final' })
})

test('deriveEffectiveQty: multi-line, gate stage 2 done -> STILL intake, never gate net', () => {
  const r = deriveEffectiveQty({ declaredQty: 1000, intakeActualQty: 1000, isMultiLine: true, gateNet: 8000, gateStage2Done: true })
  assert.deepEqual(r, { value: 1000, provisional: false, basis: 'intake_multi_line_final' })
})

test('deriveEffectiveQty: single-line, gate stage 2 done but net somehow null -> defensive intake fallback', () => {
  const r = deriveEffectiveQty({ declaredQty: 5000, intakeActualQty: 4900, isMultiLine: false, gateNet: null, gateStage2Done: true })
  assert.deepEqual(r, { value: 4900, provisional: false, basis: 'gate_net_final' })
})

test('computeVariance: positive gap', () => {
  assert.deepEqual(computeVariance(5000, 5500), { fromKg: 5000, toKg: 5500, diffKg: 500, diffPct: 10 })
})

test('computeVariance: negative gap', () => {
  assert.deepEqual(computeVariance(6000, 3000), { fromKg: 6000, toKg: 3000, diffKg: -3000, diffPct: -50 })
})

test('computeVariance: zero-reference guard, no divide-by-zero', () => {
  assert.deepEqual(computeVariance(0, 100), { fromKg: 0, toKg: 100, diffKg: 100, diffPct: 0 })
})

test('isMaterialVariance: within threshold -> false', () => {
  assert.equal(isMaterialVariance(4.9, 5), false)
})

test('isMaterialVariance: beyond threshold, either sign -> true', () => {
  assert.equal(isMaterialVariance(5.1, 5), true)
  assert.equal(isMaterialVariance(-5.1, 5), true)
})
