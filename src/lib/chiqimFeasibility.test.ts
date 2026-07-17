/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFeasibility } from './chiqimFeasibility.ts'

// Exact-match: some subset of pallets sums exactly to the target.
test('exact match: target reachable as a sum of whole pallets', () => {
  const result = checkFeasibility([1500, 1600, 2000], 3600)
  assert.equal(result.achievable, true)
  assert.equal(result.nearestBelow, 3600)
  assert.equal(result.nearestAbove, 3600)
})

// A single pallet exactly matching the target also counts.
test('exact match: a single pallet equals the target', () => {
  const result = checkFeasibility([1500, 1600, 2000], 2000)
  assert.equal(result.achievable, true)
})

// No exact-match combination — nearest achievable totals on both sides.
test('no exact match: reports nearest achievable totals above and below', () => {
  const result = checkFeasibility([1500, 1600, 2000], 3000)
  assert.equal(result.achievable, false)
  // Achievable sums from {1500,1600,2000}: 0,1500,1600,2000,3100,3500,3600,5100
  assert.equal(result.nearestBelow, 2000)
  assert.equal(result.nearestAbove, 3100)
})

// Target above total stock — no "above" figure exists.
test('target exceeds total stock: nearestAbove is null', () => {
  const result = checkFeasibility([1500, 1600], 5000)
  assert.equal(result.achievable, false)
  assert.equal(result.nearestBelow, 3100)
  assert.equal(result.nearestAbove, null)
})

// Empty stock — only the zero-pallet total (0) is achievable.
test('no pallets available: only zero is achievable', () => {
  const result = checkFeasibility([], 1000)
  assert.equal(result.achievable, false)
  assert.equal(result.nearestBelow, 0)
  assert.equal(result.nearestAbove, null)
})

// Target of exactly 0 is trivially achievable (the empty subset).
test('target of zero is always achievable', () => {
  const result = checkFeasibility([1500, 1600], 0)
  assert.equal(result.achievable, true)
})

// Fractional kg weights don't drift due to floating-point sums.
test('fractional weights sum exactly without float drift', () => {
  const result = checkFeasibility([1500.5, 1499.5], 3000)
  assert.equal(result.achievable, true)
})
