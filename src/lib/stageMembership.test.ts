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

// §5.2 Moyka Window 2 / §5.3 Tayyor Window 1: sent at all, not finalized.
test('isInMoyka: never sent is not in Moyka', () => {
  assert.equal(isInMoyka(0, false), false)
})

test('isInMoyka: sent, not finalized — currently processing', () => {
  assert.equal(isInMoyka(1000, false), true)
})

test('isInMoyka: sent AND finalized — has left Moyka (now Tugallangan)', () => {
  assert.equal(isInMoyka(1000, true), false)
})

// Section mirroring in action: a partial-send serial satisfies BOTH
// hasRawRemainder (some raw left in storage) AND isInMoyka (some already
// sent, not finalized) at once — the two windows it appears in are adjacent
// (KIRIM W2 / Moyka W1 for the first pair; Moyka W1 / Moyka W2 here),
// which is the expected "appears in two places" case, not a bug.
test('partial send: hasRawRemainder and isInMoyka are both true simultaneously', () => {
  const actualQty = 3000
  const sent = 1000
  assert.equal(hasRawRemainder(actualQty, sent), true)
  assert.equal(isInMoyka(sent, false), true)
})

test('fully sent and finalized: neither predicate holds — has left both windows', () => {
  const actualQty = 3000
  const sent = 3000
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isInMoyka(sent, true), false)
})
