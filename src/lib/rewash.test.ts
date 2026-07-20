/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeCycleNo, cycleInputKg } from './rewash.ts'

test('activeCycleNo: never voided -> cycle 1', () => {
  assert.equal(activeCycleNo([]), 1)
})

test('activeCycleNo: cycle 1 voided once -> cycle 2', () => {
  assert.equal(activeCycleNo([1]), 2)
})

test('activeCycleNo: cycle 2 also voided (second re-wash) -> cycle 3', () => {
  assert.equal(activeCycleNo([1, 2]), 3)
})

// Defensive: only the highest voided cycle matters, not insertion order or
// count — a serial's history is read fresh each time, not accumulated.
test('activeCycleNo: takes the max regardless of array order', () => {
  assert.equal(activeCycleNo([2, 1]), 3)
})

test('cycleInputKg: cycle 1 always uses the original intake, ignoring any voided figure', () => {
  assert.equal(cycleInputKg(1, 5000, 9999), 5000)
})

test('cycleInputKg: cycle 2+ uses the previous cycle\'s voided kg, ignoring the original intake', () => {
  assert.equal(cycleInputKg(2, 5000, 4500), 4500)
})
