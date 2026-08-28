/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasRawRemainder, isInMoyka } from './stageMembership.ts'

// §5.1 KIRIM Window 2 / §5.2 Moyka Window 1: raw remainder > 0.
test('hasRawRemainder: untouched serial (nothing sent yet) has full remainder', () => {
  assert.equal(hasRawRemainder(3000, 0), true)
})

test('hasRawRemainder: fully-sent serial has no remainder left', () => {
  assert.equal(hasRawRemainder(3000, 3000), false)
})

test('hasRawRemainder: partial send still has a positive remainder', () => {
  assert.equal(hasRawRemainder(3000, 1000), true)
})

test('hasRawRemainder: over-sent (should be blocked at the write path, but must not misbehave) is not a remainder', () => {
  assert.equal(hasRawRemainder(1000, 1200), false)
})

// §5.2 Moyka Window 2 / §5.3 Tayyor Window 1: a positive live in-Moyka
// balance (sent > received). No manual close event any more — see
// DECISIONS.md "Moyka loss becomes live; remove Tugallash".
test('isInMoyka: never sent is not in Moyka', () => {
  assert.equal(isInMoyka(0, 0), false)
})

test('isInMoyka: sent, nothing packed yet — in Moyka', () => {
  assert.equal(isInMoyka(1000, 0), true)
})

test('isInMoyka: partially packed, balance still positive — in Moyka', () => {
  assert.equal(isInMoyka(1000, 400), true)
})

test('isInMoyka: fully packed, balance at 0 — no longer in Moyka', () => {
  assert.equal(isInMoyka(1000, 1000), false)
})

test('isInMoyka: over-packed (received > sent) — no longer in Moyka, regardless of overage', () => {
  assert.equal(isInMoyka(1000, 1200), false)
})

// Section mirroring in action: an early-life serial can satisfy
// hasRawRemainder (raw left in storage) AND isInMoyka (sent, balance still
// open) at once — it appears in all four windows (S1W2, S2W1, S2W2, S3W1)
// simultaneously, which is the pattern working as designed.
test('early-life serial: hasRawRemainder and isInMoyka both true at once (all four windows)', () => {
  const actualQty = 6000
  const sent = 5000
  assert.equal(hasRawRemainder(actualQty, sent), true)
  assert.equal(isInMoyka(sent, 0), true)
})

// Last portion sent: raw remainder is gone (hasRawRemainder false) but the
// serial's Moyka balance is still open (isInMoyka true) — the serial shows
// only in S2W2/S3W1, not S1W2/S2W1.
test('last portion sent: hasRawRemainder false, isInMoyka true — S2W2/S3W1 only', () => {
  const actualQty = 2700
  const sent = 2700
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isInMoyka(sent, 0), true)
})

// Fully packed and no raw remainder: neither predicate holds — the serial
// has left both processing windows on its own, no operator action needed.
test('fully packed and no raw remainder: neither predicate holds — left both processing windows', () => {
  const actualQty = 5000
  const sent = 5000
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isInMoyka(sent, sent), false)
})
