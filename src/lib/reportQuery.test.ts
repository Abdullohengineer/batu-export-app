/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapDbRowToReportRow, type ReportDbRow } from './reportQuery.ts'

// Filtering, ordering, and totals moved server-side (report_filtered_rows/
// report_query_page/report_totals — see DECISIONS.md "Reporting engine:
// server-side query"), so matchesText/washCycleMatches/labVerdictMatches/
// derivePalletStatus/passesDateOrStatusOverride/isTestPlate/computeTotals
// have no remaining caller and were removed along with their tests here.
// What's left worth unit-testing is mapDbRowToReportRow — the one pure
// function still translating the wire shape back into the app's row types.

function kirimDbRow(overrides: Partial<ReportDbRow> = {}): ReportDbRow {
  return {
    kind: 'kirim',
    row_key: 's1',
    serial: 's1',
    barcode2: null,
    order_id: 'o1',
    request_id: null,
    owner_id: 'own1',
    type_id: 't1',
    calibre_id: null,
    plate: 'P1',
    driver: 'D1',
    date_basis: '2026-07-01',
    date_basis_source: 'gate_stage1',
    qty_kg: 1000,
    provisional: false,
    declared_qty: 950,
    truck_variance_diff_kg: 50,
    truck_variance_diff_pct: 5.26,
    provisional_variance_flag: false,
    wash_cycle: null,
    pallet_status: null,
    lab_verdict: null,
    target_moisture_pct: null,
    target_so2_mg_kg: null,
    moisture_pct: null,
    so2_mg_kg: null,
    void_successor_barcodes: null,
    ...overrides,
  }
}

function chiqimDbRow(overrides: Partial<ReportDbRow> = {}): ReportDbRow {
  return {
    kind: 'chiqim',
    row_key: 'PLT-1',
    serial: 's1',
    barcode2: 'PLT-1',
    order_id: 'o1',
    request_id: 'r1',
    owner_id: 'own1',
    type_id: 't1',
    calibre_id: 'c1',
    plate: 'P1',
    driver: 'D1',
    date_basis: '2026-07-02',
    date_basis_source: null,
    qty_kg: 3000,
    provisional: false,
    declared_qty: null,
    truck_variance_diff_kg: null,
    truck_variance_diff_pct: null,
    provisional_variance_flag: false,
    wash_cycle: 1,
    pallet_status: 'jonatilgan',
    lab_verdict: 'o_tdi',
    target_moisture_pct: null,
    target_so2_mg_kg: null,
    moisture_pct: null,
    so2_mg_kg: null,
    void_successor_barcodes: null,
    ...overrides,
  }
}

test('mapDbRowToReportRow: KIRIM row maps field-for-field', () => {
  const row = mapDbRowToReportRow(kirimDbRow())
  assert.equal(row.kind, 'kirim')
  if (row.kind !== 'kirim') return
  assert.equal(row.key, 's1')
  assert.equal(row.effectiveQtyKg, 1000)
  assert.equal(row.declaredQty, 950)
  assert.equal(row.truckVarianceDiffKg, 50)
  assert.equal(row.truckVarianceDiffPct, 5.26)
  assert.equal(row.provisional, false)
  assert.equal(row.dateBasisSource, 'gate_stage1')
})

test('mapDbRowToReportRow: numeric columns coerced even when the wire sends them as strings (PostgREST numeric quirk)', () => {
  const row = mapDbRowToReportRow(
    kirimDbRow({ qty_kg: '1000', declared_qty: '950', truck_variance_diff_kg: '50', truck_variance_diff_pct: '5.26' }),
  )
  if (row.kind !== 'kirim') throw new Error('expected kirim')
  assert.equal(row.effectiveQtyKg, 1000)
  assert.equal(typeof row.effectiveQtyKg, 'number')
  assert.equal(row.declaredQty, 950)
  assert.equal(row.truckVarianceDiffKg, 50)
  assert.equal(row.truckVarianceDiffPct, 5.26)
})

test('mapDbRowToReportRow: KIRIM null truck variance stays null, not zero', () => {
  const row = mapDbRowToReportRow(kirimDbRow({ truck_variance_diff_kg: null, truck_variance_diff_pct: null }))
  if (row.kind !== 'kirim') throw new Error('expected kirim')
  assert.equal(row.truckVarianceDiffKg, null)
  assert.equal(row.truckVarianceDiffPct, null)
})

test('mapDbRowToReportRow: CHIQIM row maps field-for-field, no voidInfo when not voided', () => {
  const row = mapDbRowToReportRow(chiqimDbRow())
  assert.equal(row.kind, 'chiqim')
  if (row.kind !== 'chiqim') return
  assert.equal(row.key, 'PLT-1')
  assert.equal(row.weightKg, 3000)
  assert.equal(row.washCycle, 1)
  assert.equal(row.palletStatus, 'jonatilgan')
  assert.equal(row.labVerdict, 'o_tdi')
  assert.equal(row.voidInfo, null)
})

test('mapDbRowToReportRow: CHIQIM voided pallet WITH successors builds voidInfo from wash_cycle/wash_cycle+1', () => {
  const row = mapDbRowToReportRow(
    chiqimDbRow({
      wash_cycle: 1,
      pallet_status: 'bekor_qilingan',
      void_successor_barcodes: ['PLT-2', 'PLT-3'],
    }),
  )
  if (row.kind !== 'chiqim') throw new Error('expected chiqim')
  assert.deepEqual(row.voidInfo, { voidedCycle: 1, successorCycle: 2, successorBarcodes: ['PLT-2', 'PLT-3'] })
})

test('mapDbRowToReportRow: CHIQIM voided pallet with NO successor yet -> empty array, not null crash', () => {
  const row = mapDbRowToReportRow(
    chiqimDbRow({ wash_cycle: 1, pallet_status: 'bekor_qilingan', void_successor_barcodes: null }),
  )
  if (row.kind !== 'chiqim') throw new Error('expected chiqim')
  assert.deepEqual(row.voidInfo, { voidedCycle: 1, successorCycle: 2, successorBarcodes: [] })
})

test('mapDbRowToReportRow: CHIQIM missing request_id/barcode2/calibre_id fall back to empty string, not null', () => {
  const row = mapDbRowToReportRow(chiqimDbRow({ request_id: null, barcode2: null, calibre_id: null, pallet_status: 'omborda' }))
  if (row.kind !== 'chiqim') throw new Error('expected chiqim')
  assert.equal(row.requestId, '')
  assert.equal(row.barcode2, '')
  assert.equal(row.calibreId, '')
})
