/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFinalLossPct, jarayonda, ortiqcha, completionBadge, tugallashWarnings } from './tayyorCompletion.ts'

// Exact-match: sent === received.
test('exact match: zero loss, zero jarayonda, zero ortiqcha', () => {
  assert.equal(computeFinalLossPct(2200, 2200), 0)
  assert.equal(jarayonda(2200, 2200), 0)
  assert.equal(ortiqcha(2200, 2200), 0)
})

// Overage: received exceeds sent.
test('overage: loss floors at 0, jarayonda floors at 0, ortiqcha is positive', () => {
  assert.equal(computeFinalLossPct(2200, 2500), 0) // never a negative "loss"
  assert.equal(jarayonda(2200, 2500), 0) // never negative
  assert.equal(ortiqcha(2200, 2500), 300)
})

// Shortfall: received under sent — closing this out is always a manual
// Tugallash decision now (see DECISIONS.md "Manual-only finishing"); there
// is no "cycle complete" threshold anymore, only the operator's judgment.
test('shortfall: positive loss %, positive jarayonda, zero ortiqcha', () => {
  assert.equal(computeFinalLossPct(2200, 1800), 18.2)
  assert.equal(jarayonda(2200, 1800), 400)
  assert.equal(ortiqcha(2200, 1800), 0)
})

// Manual close on a real shortfall (what handleTugallash locks in).
test('manual close on shortfall computes the same floored/derived figures', () => {
  assert.equal(computeFinalLossPct(2200, 1800), 18.2)
  assert.equal(jarayonda(2200, 1800), 400)
})

// Degenerate: nothing sent yet (should not occur in practice — a serial
// only appears in Tayyor Mahsulot once it has moyka_sends — but must not
// divide by zero or misbehave).
test('degenerate: sent = 0 never divides by zero', () => {
  assert.equal(computeFinalLossPct(0, 0), 0)
  assert.equal(jarayonda(0, 0), 0)
  assert.equal(ortiqcha(0, 0), 0)
})

// Window 2 (Tugallangan) badge — the three required cases: exact-match shows
// 0%, overage shows Ortiqcha (never a negative loss), shortfall shows the
// correct positive loss %. lossPct here is the LOCKED wash_cycles figure
// (computeFinalLossPct's output), excess is the derived Ortiqcha figure —
// mirroring exactly what useMoykaOutput hands the component.
test('completion badge: exact-match serial displays 0% (loss kind, not ortiqcha)', () => {
  const badge = completionBadge(computeFinalLossPct(2200, 2200), ortiqcha(2200, 2200))
  assert.deepEqual(badge, { kind: 'loss', pct: 0 })
})

test('completion badge: overage serial displays Ortiqcha, never a negative loss', () => {
  const badge = completionBadge(computeFinalLossPct(2200, 2500), ortiqcha(2200, 2500))
  assert.deepEqual(badge, { kind: 'ortiqcha', excessKg: 300 })
})

test('completion badge: shortfall/manual-Tugallash serial displays correct loss %', () => {
  const badge = completionBadge(computeFinalLossPct(2200, 1800), ortiqcha(2200, 1800))
  assert.deepEqual(badge, { kind: 'loss', pct: 18.2 })
})

// §5.3 Tugallash soft warning (DECISIONS "Manual-only finishing") — the
// four required cases: no warning when clean, raw-remainder-only, loss-only,
// both at once, and a gain never warning even with the remainder present.
test('tugallashWarnings: no remainder, loss under 10% — no warning', () => {
  assert.deepEqual(tugallashWarnings(0, 5), [])
})

test('tugallashWarnings: raw remainder still in storage — warns "remainder"', () => {
  assert.deepEqual(tugallashWarnings(300, 0), ['remainder'])
})

test('tugallashWarnings: loss exceeds 10% — warns "loss"', () => {
  assert.deepEqual(tugallashWarnings(0, 18.2), ['loss'])
})

test('tugallashWarnings: loss exactly 10% does not warn (strictly greater than)', () => {
  assert.deepEqual(tugallashWarnings(0, 10), [])
})

test('tugallashWarnings: both remainder and loss > 10% — warns both, in order', () => {
  assert.deepEqual(tugallashWarnings(300, 18.2), ['remainder', 'loss'])
})

test('tugallashWarnings: gain (received > sent, loss floored at 0) never warns even with remainder', () => {
  const lossPct = computeFinalLossPct(2200, 2500) // overage — floors to 0
  assert.deepEqual(tugallashWarnings(500, lossPct), ['remainder'])
  assert.deepEqual(tugallashWarnings(0, lossPct), [])
})
