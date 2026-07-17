/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveScan, lineStatus, shortfallLines, sortFinishedByOmborFinish, type ChiqimLineLike } from './chiqimScan.ts'

const lineA: ChiqimLineLike = { id: 'line-a', type_id: 'subxon', calibre_id: 'k6', qty_kg: 3600 }
const lineB: ChiqimLineLike = { id: 'line-b', type_id: 'isfara', calibre_id: 'k8', qty_kg: 2000 }

function basePallet(overrides: Partial<{ type_id: string; calibre_id: string; status: string }> = {}) {
  return { type_id: 'subxon', calibre_id: 'k6', status: 'in_stock', ...overrides }
}

// Happy path: valid, unclaimed, matching pallet is accepted and assigned to
// the correct line.
test('scan happy path: valid pallet accepted and assigned to its matching line', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    alreadyClaimed: false,
    lines: [lineA, lineB],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: true, lineId: 'line-a' })
})

// Scanning enough pallets to reach a line's target exactly is just the
// caller summing accepted scans — resolveScan itself doesn't cap at the
// target (pallets are atomic; overage is a separate, allowed outcome).
test('scan happy path: reaching the target exactly is reported by lineStatus, not blocked by resolveScan', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-2',
    alreadyScannedBarcodes: ['PLT-140726-001-06-1'],
    pallet: basePallet(),
    alreadyClaimed: false,
    lines: [lineA],
    scannedTotalsByLineId: { 'line-a': 1600 }, // one pallet already scanned
  })
  assert.equal(result.ok, true)
  // 1600 (already scanned) + 2000 (this pallet) = 3600 = lineA's target
  assert.equal(lineStatus(lineA.qty_kg, 1600 + 2000), 'exact')
})

test('duplicate-barcode rejection: same barcode already in this scan session', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: ['PLT-140726-001-06-1'],
    pallet: basePallet(),
    alreadyClaimed: false,
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'duplicate' })
})

// Real enforcement point for the overcommit gap — a barcode already present
// in dispatch_manifest for ANY request is rejected, relying on the existing
// unique constraint rather than a reservation system.
test('claimed-elsewhere rejection: barcode already in dispatch_manifest', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    alreadyClaimed: true,
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'claimed' })
})

test('not-found rejection: barcode does not resolve to any pallet', () => {
  const result = resolveScan({
    barcode2: 'PLT-DOES-NOT-EXIST',
    alreadyScannedBarcodes: [],
    pallet: null,
    alreadyClaimed: false,
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'not_found' })
})

test('not-in-stock rejection: pallet exists but already dispatched/voided', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet({ status: 'dispatched' }),
    alreadyClaimed: false,
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'not_in_stock' })
})

test('no-matching-line rejection: pallet type/calibre not requested', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-04-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet({ calibre_id: 'k4' }),
    alreadyClaimed: false,
    lines: [lineA, lineB],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'no_matching_line' })
})

// Two lines share the same type+calibre: the pallet fills whichever has the
// larger remaining gap.
test('duplicate type+calibre lines: pallet fills the line with the larger remaining gap', () => {
  const lineC: ChiqimLineLike = { id: 'line-c', type_id: 'subxon', calibre_id: 'k6', qty_kg: 1000 }
  const lineD: ChiqimLineLike = { id: 'line-d', type_id: 'subxon', calibre_id: 'k6', qty_kg: 5000 }
  const result = resolveScan({
    barcode2: 'PLT-x',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    alreadyClaimed: false,
    lines: [lineC, lineD],
    scannedTotalsByLineId: { 'line-c': 900, 'line-d': 1000 }, // gaps: 100 vs 4000
    })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.lineId, 'line-d')
})

test('lineStatus: shortfall, exact, overage', () => {
  assert.equal(lineStatus(3600, 2000), 'shortfall')
  assert.equal(lineStatus(3600, 3600), 'exact')
  assert.equal(lineStatus(3600, 4000), 'overage')
})

// Finish-with-shortfall: reports every line still short, never blocks —
// the caller decides to proceed regardless (§5.4/§3.1 "never blocks").
test('shortfallLines: reports missing kg per line, non-blocking by construction (pure report only)', () => {
  const result = shortfallLines([lineA, lineB], { 'line-a': 2000, 'line-b': 2000 })
  assert.deepEqual(result, [{ line: lineA, missingKg: 1600 }])
})

test('shortfallLines: empty when every line meets or exceeds its target', () => {
  const result = shortfallLines([lineA, lineB], { 'line-a': 3600, 'line-b': 2500 })
  assert.deepEqual(result, [])
})

// Universal sort rule (SPEC.md §5 intro): Ombor's own W2 sorts newest-first
// by ombor_finished_at — its own per-role finish signal, not any other
// role's date field.
test('Ombor W2 sorts newest-first by ombor_finished_at', () => {
  const requests = [
    { id: 'r1', ombor_finished_at: '2026-07-16T10:00:00Z' },
    { id: 'r2', ombor_finished_at: '2026-07-17T09:00:00Z' },
    { id: 'r3', ombor_finished_at: '2026-07-16T23:00:00Z' },
  ]
  const sorted = sortFinishedByOmborFinish(requests)
  assert.deepEqual(sorted.map((r) => r.id), ['r2', 'r3', 'r1'])
})
