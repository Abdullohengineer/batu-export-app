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
// balance (sent > received) AND not closed. No manual close event existed
// at all until Yakunlash (2026-08-29, Prompt 10, see DECISIONS.md "Serial
// close-out") reintroduced one — closedAt is now a required third param.
//
// AMENDED 2026-09-15 (multi-wash support, see docs/decisions/0191): these
// cases still exercise the pure function correctly — its logic is
// unchanged. In production the (sent, received, closedAt) triple now
// comes from a serial's CURRENT WASH specifically (useMoykaOutput.ts),
// not its lifetime totals; that's a caller-side contract, not something
// this pure-function test suite needs to model.
test('isInMoyka: never sent is not in Moyka', () => {
  assert.equal(isInMoyka(0, 0, null), false)
})

test('isInMoyka: sent, nothing packed yet — in Moyka', () => {
  assert.equal(isInMoyka(1000, 0, null), true)
})

test('isInMoyka: partially packed, balance still positive — in Moyka', () => {
  assert.equal(isInMoyka(1000, 400, null), true)
})

test('isInMoyka: fully packed, balance at 0 — no longer in Moyka', () => {
  assert.equal(isInMoyka(1000, 1000, null), false)
})

test('isInMoyka: over-packed (received > sent) — no longer in Moyka, regardless of overage', () => {
  assert.equal(isInMoyka(1000, 1200, null), false)
})

test('isInMoyka: closed serial with a positive residual is NOT in Moyka — Yakunlash means no more expected', () => {
  assert.equal(isInMoyka(1000, 400, '2026-08-29T00:00:00Z'), false)
})

// Section mirroring in action: an early-life serial can satisfy
// hasRawRemainder (raw left in storage) AND isInMoyka (sent, balance still
// open) at once — it appears in all four windows (S1W2, S2W1, S2W2, S3W1)
// simultaneously, which is the pattern working as designed.
test('early-life serial: hasRawRemainder and isInMoyka both true at once (all four windows)', () => {
  const actualQty = 6000
  const sent = 5000
  assert.equal(hasRawRemainder(actualQty, sent), true)
  assert.equal(isInMoyka(sent, 0, null), true)
})

// Last portion sent: raw remainder is gone (hasRawRemainder false) but the
// serial's Moyka balance is still open (isInMoyka true) — the serial shows
// only in S2W2/S3W1, not S1W2/S2W1.
test('last portion sent: hasRawRemainder false, isInMoyka true — S2W2/S3W1 only', () => {
  const actualQty = 2700
  const sent = 2700
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isInMoyka(sent, 0, null), true)
})

// Fully packed and no raw remainder: neither predicate holds — the serial
// has left both processing windows on its own, no operator action needed.
test('fully packed and no raw remainder: neither predicate holds — left both processing windows', () => {
  const actualQty = 5000
  const sent = 5000
  assert.equal(hasRawRemainder(actualQty, sent), false)
  assert.equal(isInMoyka(sent, sent, null), false)
})

// The exact regression this migration exists to fix (docs/decisions/0191,
// the P1/P2/P4 report): wash 1 closed with a small realized loss: 50 kg on
// a 2320 kg send against 2270 kg received. A genuinely new wash 2 later
// sends 92 kg, nothing received yet. Called with wash 1's own numbers,
// isInMoyka correctly says "not in Moyka" (it's closed) — that was never
// the bug. Called with wash 2's own numbers (what useMoykaOutput.ts must
// now pass, not the serial's lifetime sent/received), it correctly says
// "in Moyka." The bug was never in this function; it was every caller
// mixing lifetime totals into a single-wash-shaped answer.
test('multi-wash: wash 1 closed (not in Moyka) and wash 2 open (in Moyka) read independently', () => {
  const wash1 = { sent: 2320, received: 2270, closedAt: '2026-08-29T10:10:42.343Z' }
  const wash2 = { sent: 92, received: 0, closedAt: null as string | null }
  assert.equal(isInMoyka(wash1.sent, wash1.received, wash1.closedAt), false)
  assert.equal(isInMoyka(wash2.sent, wash2.received, wash2.closedAt), true)
})
