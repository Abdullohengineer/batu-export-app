/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jarayonda, ortiqcha } from './tayyorCompletion.ts'

// Exact-match: sent === received.
test('exact match: zero jarayonda, zero ortiqcha', () => {
  assert.equal(jarayonda(2200, 2200), 0)
  assert.equal(ortiqcha(2200, 2200), 0)
})

// Overage: received exceeds sent.
test('overage: jarayonda floors at 0, ortiqcha is positive', () => {
  assert.equal(jarayonda(2200, 2500), 0) // never negative
  assert.equal(ortiqcha(2200, 2500), 300)
})

// Shortfall: received under sent.
test('shortfall: positive jarayonda, zero ortiqcha', () => {
  assert.equal(jarayonda(2200, 1800), 400)
  assert.equal(ortiqcha(2200, 1800), 0)
})

// Degenerate: nothing sent yet (should not occur in practice — a serial
// only appears in Tayyor Mahsulot once it has moyka_sends — but must not
// misbehave).
test('degenerate: sent = 0', () => {
  assert.equal(jarayonda(0, 0), 0)
  assert.equal(ortiqcha(0, 0), 0)
})
