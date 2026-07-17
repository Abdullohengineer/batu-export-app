/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasRawRemainder, isAwaitingTugallash } from './stageMembership.ts'

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

// §5.2 Moyka Window 2 / §5.3 Tayyor Window 1: sent, not yet manually
// finished (Tugallash) — independent of received/sent quantities.
test('isAwaitingTugallash: never sent is not awaiting anything', () => {
  assert.equal(isAwaitingTugallash(0, false), false)
})

test('isAwaitingTugallash: sent, not finished — awaiting Tugallash', () => {
  assert.equal(isAwaitingTugallash(1000, false), true)
})

test('isAwaitingTugallash: sent, under target, not finished — still awaiting (finishing is a judgment call, not a threshold)', () => {
  assert.equal(isAwaitingTugallash(1000, false), true)
})

test('isAwaitingTugallash: sent, OVER target, not finished — still awaiting (over-receipt never auto-graduates)', () => {
  // §3W1 test requirement: 140726-002-style, sent 5000 received 5010 —
  // quantity is irrelevant here, only whether Tugallash has been clicked.
  assert.equal(isAwaitingTugallash(5000, false), true)
})

test('isAwaitingTugallash: finished (Tugallash clicked) — no longer awaiting, regardless of quantity', () => {
  assert.equal(isAwaitingTugallash(1000, true), false)
  assert.equal(isAwaitingTugallash(5000, true), false)
})

// Section mirroring in action: an early-life serial can satisfy
// hasRawRemainder (raw left in storage) AND isAwaitingTugallash (sent, not
// finished) at once — it appears in all four windows (S1W2, S2W1, S2W2,
// S3W1) simultaneously, which is the pattern working as designed.
test('early-life serial: hasRawRemainder and isAwaitingTugallash both true at once (all four windows)', () => {
  const actualQty = 6000
  const sent = 5000
  assert.equal(hasRawRemainder(actualQty, sent), true)
  assert.equal(isAwaitingTugallash(sent, false), true)
})

// Last portion sent: raw remainder is gone (hasRawRemainder false) but the
// serial hasn't been finished yet (isAwaitingTugallash true) — the serial
// shows only in S2W2/S3W1, not S1W2/S2W1.
test('last portion sent: hasRawRemainder false, isAwaitingTugallash true — S2W2/S3W1 only', () => {
  const actualQty = 2700
  const sent = 2700
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isAwaitingTugallash(sent, false), true)
})

// Finished (Tugallash clicked): neither predicate holds if raw remainder is
// also gone — the serial has left both processing windows and only shows
// in S3W2 (Tugallangan) via the separate, unchanged finalized check.
test('finished and no raw remainder: neither predicate holds — left both processing windows', () => {
  const actualQty = 5000
  const sent = 5000
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isAwaitingTugallash(sent, true), false)
})
