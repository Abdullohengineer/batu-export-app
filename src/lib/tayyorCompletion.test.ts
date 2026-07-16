/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFinalLossPct, isCycleComplete, jarayonda, ortiqcha } from './tayyorCompletion.ts'

// Exact-match completion: sent === received.
test('exact match: cycle completes, zero loss, zero jarayonda, zero ortiqcha', () => {
  assert.equal(isCycleComplete(2200, 2200), true)
  assert.equal(computeFinalLossPct(2200, 2200), 0)
  assert.equal(jarayonda(2200, 2200), 0)
  assert.equal(ortiqcha(2200, 2200), 0)
})

// Overage: received exceeds sent — this is the "no fixed tolerance" case.
test('overage: cycle completes, loss floors at 0, jarayonda floors at 0, ortiqcha is positive', () => {
  assert.equal(isCycleComplete(2200, 2500), true)
  assert.equal(computeFinalLossPct(2200, 2500), 0) // never a negative "loss"
  assert.equal(jarayonda(2200, 2500), 0) // never negative
  assert.equal(ortiqcha(2200, 2500), 300)
})

// Shortfall: received under sent — cycle is not auto-complete; manual
// Tugallash is the only way to close this out (accepting the loss).
test('shortfall: cycle not complete, positive loss %, positive jarayonda, zero ortiqcha', () => {
  assert.equal(isCycleComplete(2200, 1800), false)
  assert.equal(computeFinalLossPct(2200, 1800), 18.2)
  assert.equal(jarayonda(2200, 1800), 400)
  assert.equal(ortiqcha(2200, 1800), 0)
})

// Manual close on a real shortfall (what handleTugallash locks in).
test('manual close on shortfall computes the same floored/derived figures', () => {
  assert.equal(computeFinalLossPct(2200, 1800), 18.2)
  assert.equal(jarayonda(2200, 1800), 400)
})

// Boundary: one kg under vs exactly at the target.
test('boundary: one kg under target is not complete, exactly at target is', () => {
  assert.equal(isCycleComplete(1000, 999), false)
  assert.equal(isCycleComplete(1000, 1000), true)
})

// Degenerate: nothing sent yet (should not occur in practice — a serial
// only appears in Tayyor Mahsulot once it has moyka_sends — but must not
// divide by zero or misbehave).
test('degenerate: sent = 0 never reports complete and never divides by zero', () => {
  assert.equal(isCycleComplete(0, 0), false)
  assert.equal(computeFinalLossPct(0, 0), 0)
  assert.equal(jarayonda(0, 0), 0)
  assert.equal(ortiqcha(0, 0), 0)
})
