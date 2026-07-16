/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasRawRemainder, isProcessing } from './stageMembership.ts'

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

// §5.2 Moyka Window 2 / §5.3 Tayyor Window 1: unreceived sent material,
// serial-level — total_sent > total_received, ignoring wash_cycle number
// and wash_cycles.status entirely.
test('isProcessing: never sent is not processing', () => {
  assert.equal(isProcessing(0, 0), false)
})

test('isProcessing: sent, nothing received yet — processing', () => {
  assert.equal(isProcessing(1000, 0), true)
})

test('isProcessing: sent, partially received — still processing', () => {
  assert.equal(isProcessing(1000, 400), true)
})

test('isProcessing: sent fully received (exact match) — not processing', () => {
  assert.equal(isProcessing(1000, 1000), false)
})

test('isProcessing: overage (received > sent) — not processing, never negative-implying', () => {
  assert.equal(isProcessing(1000, 1200), false)
})

// The live bug this fixes: a serial can have an already-`final` cycle 1 AND
// still have unreceived material sent afterward (more was sent under the
// same wash_cycle=1, re-wash/multi-cycle numbering deferred — serial-level
// is intentional, §2.13 out of scope). isProcessing takes only sent/received
// — it has no "finalized" parameter at all, so a final cycle can never hide
// unreceived material the way the old isInMoyka(sent, finalized) did.
test('isProcessing ignores finalization entirely: unreceived material sent after a final cycle still counts', () => {
  // e.g. 140726-003: sent 5000, received 2890 total, cycle 1 already final.
  assert.equal(isProcessing(5000, 2890), true)
})

// Section mirroring in action: an early-life serial can satisfy
// hasRawRemainder (raw left in storage) AND isProcessing (some already sent,
// unreceived) at once — it appears in all four windows (S1W2, S2W1, S2W2,
// S3W1) simultaneously, which is the pattern working as designed.
test('early-life serial: hasRawRemainder and isProcessing both true at once (all four windows)', () => {
  const actualQty = 6000
  const sent = 5000
  const received = 2890
  assert.equal(hasRawRemainder(actualQty, sent), true)
  assert.equal(isProcessing(sent, received), true)
})

// Last portion sent: raw remainder is gone (hasRawRemainder false) but the
// sent material hasn't all been received back yet (isProcessing true) — the
// serial shows only in S2W2/S3W1, not S1W2/S2W1.
test('last portion sent: hasRawRemainder false, isProcessing true — S2W2/S3W1 only', () => {
  const actualQty = 2700
  const sent = 2700
  const received = 2200
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isProcessing(sent, received), true)
})

// Fully received (or overshot) and finalized: neither predicate holds —
// the serial has left both processing windows, and only shows in S3W2
// (Tugallangan) via the separate, unchanged finalized check.
test('fully received and finalized: neither predicate holds — left both processing windows', () => {
  const actualQty = 5000
  const sent = 5000
  const received = 5000
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isProcessing(sent, received), false)
})
