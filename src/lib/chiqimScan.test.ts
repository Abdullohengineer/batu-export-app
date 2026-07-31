/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveScan, lineStatus, shortfallLines, sortFinishedByOmborFinish, type ChiqimLineLike } from './chiqimScan.ts'

const lineA: ChiqimLineLike = { id: 'line-a', type_id: 'subxon', calibre_id: 'k6', raw_serial: null, qty_kg: 3600 }
const lineB: ChiqimLineLike = { id: 'line-b', type_id: 'isfara', calibre_id: 'k8', raw_serial: null, qty_kg: 2000 }

function basePallet(overrides: Partial<{ type_id: string; calibre_id: string; status: string }> = {}) {
  return { type_id: 'subxon', calibre_id: 'k6', status: 'in_stock', ...overrides }
}

// Every case below that doesn't test the fallback path itself uses a
// request with SOME reservation already present (so the fallback filter
// never accidentally activates) unless the test says otherwise.
const reservedElsewhere = { 'PLT-SOMETHING-ELSE': 'line-a' }

// Happy path: a reserved, unclaimed pallet is accepted and assigned to
// exactly the line it was reserved for — no type/calibre guessing.
test('scan happy path: reserved pallet accepted and assigned to its reserved line', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: { 'PLT-140726-001-06-1': 'line-a' },
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
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: { 'PLT-140726-001-06-1': 'line-a', 'PLT-140726-001-06-2': 'line-a' },
    lines: [lineA],
    scannedTotalsByLineId: { 'line-a': 1600 },
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
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: { 'PLT-140726-001-06-1': 'line-a' },
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
    labPassed: true,
    alreadyClaimed: true,
    reservedLineIdByBarcode: { 'PLT-140726-001-06-1': 'line-a' },
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
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: {},
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
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: { 'PLT-140726-001-06-1': 'line-a' },
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'not_in_stock' })
})

// §5.5.3/§8 hard gate (v1.9): an in-stock, unclaimed pallet is still refused
// if its parent serial's current wash cycle hasn't passed lab testing —
// untested and re-wash-flagged stock must never be scannable.
test('not-lab-passed rejection: in-stock, unclaimed pallet whose serial has not passed the current cycle', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    labPassed: false,
    alreadyClaimed: false,
    reservedLineIdByBarcode: { 'PLT-140726-001-06-1': 'line-a' },
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'not_lab_passed' })
})

// Ordering: the lab gate is checked before the claimed-elsewhere check —
// an untested pallet should never even reach the overcommit-guard logic,
// same precedence as not-in-stock.
test('not-lab-passed takes precedence over claimed-elsewhere', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    labPassed: false,
    alreadyClaimed: true,
    reservedLineIdByBarcode: { 'PLT-140726-001-06-1': 'line-a' },
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'not_lab_passed' })
})

// §3.1/§5.4 Option B (2026-07-26): a valid, in-stock, lab-passed, unclaimed
// pallet is rejected if it isn't reserved for THIS request AND its line
// already has SOME OTHER reservation (reservation, once used, is
// exclusive — a wrong-but-plausible pallet doesn't get to piggyback into a
// line someone already curated).
test('not-reserved rejection: valid, type/calibre-matching pallet, but its line already has a different reservation', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet(), // matches lineA's type_id/calibre_id
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: { 'PLT-OTHER-PALLET': 'line-a' }, // lineA has ITS OWN reservation already
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'not_reserved' })
})

test('not-reserved rejection: valid pallet matching no line at all, reserved or not', () => {
  const result = resolveScan({
    barcode2: 'PLT-140726-001-06-1',
    alreadyScannedBarcodes: [],
    pallet: basePallet({ type_id: 'nothing-matches' }),
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: reservedElsewhere,
    lines: [lineA, lineB],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: false, reason: 'not_reserved' })
})

// 🚩 The real gap this session found live, not hypothetical: a line with
// ZERO reservations (stock ordered ahead of production, or a re-wash cycle
// not yet finished at request-creation time) must still be fulfillable
// once matching stock exists — falls back to Option A's original type/
// calibre matching, exactly as if reservation didn't exist for this line.
test('zero-reservation fallback: a line with no reservations at all still accepts a type/calibre match', () => {
  const result = resolveScan({
    barcode2: 'PLT-FRESH-STOCK',
    alreadyScannedBarcodes: [],
    pallet: basePallet(), // matches lineA's type_id/calibre_id
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: {}, // no reservations anywhere on this request
    lines: [lineA],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: true, lineId: 'line-a' })
})

// Two lines share the same type+calibre, NEITHER has a reservation yet —
// the fallback still needs to pick one, so it keeps Option A's original
// "largest remaining gap" tie-break.
test('zero-reservation fallback, duplicate type+calibre lines: largest remaining gap wins', () => {
  const lineC: ChiqimLineLike = { id: 'line-c', type_id: 'subxon', calibre_id: 'k6', raw_serial: null, qty_kg: 1000 }
  const lineD: ChiqimLineLike = { id: 'line-d', type_id: 'subxon', calibre_id: 'k6', raw_serial: null, qty_kg: 5000 }
  const result = resolveScan({
    barcode2: 'PLT-x',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    labPassed: true,
    alreadyClaimed: false,
    reservedLineIdByBarcode: {},
    lines: [lineC, lineD],
    scannedTotalsByLineId: { 'line-c': 900, 'line-d': 1000 }, // gaps: 100 vs 4000
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.lineId, 'line-d')
})

// Two lines share the same type+calibre, but only ONE has a reservation
// (for a DIFFERENT barcode) — that line is excluded from the fallback pool
// even though it type/calibre-matches, so the zero-reservation sibling
// wins outright, not by gap comparison.
test('duplicate type+calibre lines, one already reserved elsewhere: only the zero-reservation sibling is eligible', () => {
  const lineC: ChiqimLineLike = { id: 'line-c', type_id: 'subxon', calibre_id: 'k6', raw_serial: null, qty_kg: 1000 }
  const lineD: ChiqimLineLike = { id: 'line-d', type_id: 'subxon', calibre_id: 'k6', raw_serial: null, qty_kg: 5000 }
  const result = resolveScan({
    barcode2: 'PLT-x',
    alreadyScannedBarcodes: [],
    pallet: basePallet(),
    labPassed: true,
    alreadyClaimed: false,
    // line-d has its own curated reservation (a different barcode) —
    // excluded from fallback even though this pallet's type/calibre
    // matches and line-d's gap (4000) would otherwise win.
    reservedLineIdByBarcode: { 'PLT-ALREADY-RESERVED': 'line-d' },
    lines: [lineC, lineD],
    scannedTotalsByLineId: {},
  })
  assert.deepEqual(result, { ok: true, lineId: 'line-c' })
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
