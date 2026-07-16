/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFinalLossPct, isCycleComplete, jarayonda, ortiqcha, completionBadge } from './tayyorCompletion.ts'

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
