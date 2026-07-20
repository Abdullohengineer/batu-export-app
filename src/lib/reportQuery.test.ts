/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeTotals,
  matchesText,
  washCycleMatches,
  labVerdictMatches,
  derivePalletStatus,
  passesDateOrStatusOverride,
  isTestPlate,
  type KirimReportRow,
  type ChiqimReportRow,
} from './reportQuery.ts'

function kirimRow(effectiveQtyKg: number): KirimReportRow {
  return {
    kind: 'kirim',
    key: 's1',
    serial: 's1',
    orderId: 'o1',
    typeId: 't1',
    ownerId: 'own1',
    plate: 'P1',
    driver: 'D1',
    dateBasis: '2026-07-01',
    dateBasisSource: 'gate_stage1',
    declaredQty: 1000,
    effectiveQtyKg,
    provisional: false,
    truckVarianceDiffKg: null,
    truckVarianceDiffPct: null,
    provisionalVarianceFlag: false,
    targetMoisturePct: null,
    targetSo2MgKg: null,
    kirimMoisturePct: null,
    kirimSo2MgKg: null,
  }
}

function chiqimRow(weightKg: number): ChiqimReportRow {
  return {
    kind: 'chiqim',
    key: 'PLT-1',
    barcode2: 'PLT-1',
    serial: 's1',
    typeId: 't1',
    calibreId: 'c1',
    ownerId: 'own1',
    requestId: 'r1',
    plate: 'P1',
    driver: 'D1',
    weightKg,
    washCycle: 1,
    palletStatus: 'jonatilgan',
    dateBasis: '2026-07-02',
    labVerdict: 'o_tdi',
    targetMoisturePct: null,
    targetSo2MgKg: null,
    moisturePct: null,
    so2MgKg: null,
    voidInfo: null,
  }
}

test('computeTotals: sums kirim effective_qty as kg in, chiqim weight as kg out, net is the difference', () => {
  const rows = [kirimRow(5000), kirimRow(2000), chiqimRow(3000)]
  assert.deepEqual(computeTotals(rows), { kgIn: 7000, kgOut: 3000, net: 4000 })
})

test('computeTotals: empty set', () => {
  assert.deepEqual(computeTotals([]), { kgIn: 0, kgOut: 0, net: 0 })
})

test('matchesText: empty query matches everything, including null', () => {
  assert.equal(matchesText(null, ''), true)
  assert.equal(matchesText('anything', ''), true)
})

test('matchesText: case-insensitive substring', () => {
  assert.equal(matchesText('PLT-150726-001-04', 'plt-150726'), true)
  assert.equal(matchesText('PLT-150726-001-04', 'zzz'), false)
})

test('washCycleMatches: any/1/2+ ', () => {
  assert.equal(washCycleMatches(1, ''), true)
  assert.equal(washCycleMatches(2, ''), true)
  assert.equal(washCycleMatches(1, '1'), true)
  assert.equal(washCycleMatches(2, '1'), false)
  assert.equal(washCycleMatches(1, '2+'), false)
  assert.equal(washCycleMatches(2, '2+'), true)
  assert.equal(washCycleMatches(3, '2+'), true)
})

test('labVerdictMatches: tekshirilmagan means null verdict specifically', () => {
  assert.equal(labVerdictMatches(null, ''), true)
  assert.equal(labVerdictMatches(null, 'tekshirilmagan'), true)
  assert.equal(labVerdictMatches('o_tdi', 'tekshirilmagan'), false)
  assert.equal(labVerdictMatches('o_tdi', 'o_tdi'), true)
  assert.equal(labVerdictMatches('qayta_yuvish', 'o_tdi'), false)
})

test('derivePalletStatus: voided wins regardless of claim state', () => {
  assert.equal(
    derivePalletStatus({ rawStatus: 'bekor_qilindi', claimed: true, dispatchGateCompletedAt: '2026-07-01T00:00:00Z' }),
    'bekor_qilingan',
  )
})

test('derivePalletStatus: unclaimed in_stock -> omborda', () => {
  assert.equal(derivePalletStatus({ rawStatus: 'in_stock', claimed: false, dispatchGateCompletedAt: null }), 'omborda')
})

test('derivePalletStatus: claimed but dispatch gate stage 2 not done -> band_qilingan', () => {
  assert.equal(derivePalletStatus({ rawStatus: 'in_stock', claimed: true, dispatchGateCompletedAt: null }), 'band_qilingan')
})

test('derivePalletStatus: claimed and dispatch gate stage 2 done -> jonatilgan', () => {
  assert.equal(
    derivePalletStatus({ rawStatus: 'in_stock', claimed: true, dispatchGateCompletedAt: '2026-07-01T00:00:00Z' }),
    'jonatilgan',
  )
})

test('passesDateOrStatusOverride: dated row always goes through the date range, status ignored', () => {
  const filters = { from: '2026-07-01', to: '2026-07-10', status: '' as const }
  assert.equal(passesDateOrStatusOverride('2026-07-05', 'jonatilgan', filters), true)
  assert.equal(passesDateOrStatusOverride('2026-06-30', 'jonatilgan', filters), false)
})

test('passesDateOrStatusOverride: dateless row excluded by default, included only when its exact status is asked for', () => {
  const filters = { from: '2026-07-01', to: '2026-07-10', status: '' as const }
  assert.equal(passesDateOrStatusOverride(null, 'omborda', filters), false)
  assert.equal(passesDateOrStatusOverride(null, 'omborda', { ...filters, status: 'omborda' }), true)
  assert.equal(passesDateOrStatusOverride(null, 'band_qilingan', { ...filters, status: 'omborda' }), false)
})

test('isTestPlate: TEST- prefix, same convention as useFinishedChiqimRequests', () => {
  assert.equal(isTestPlate('TEST-HISOBOT-MRSX29RUEHX0-7'), true)
  assert.equal(isTestPlate('TEST-'), true)
  assert.equal(isTestPlate('01A777AA'), false)
  assert.equal(isTestPlate(''), false)
  assert.equal(isTestPlate(null), false)
  assert.equal(isTestPlate(undefined), false)
})
