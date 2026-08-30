import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abbreviateCalibre, calibreCodeFromBarcode2 } from './barcodeLabel.ts'

// Guards the one thing in the Konditirskiy → Konditerka rename that touches
// physical inventory: what gets printed on a pallet sticker. The abbreviation
// must come from calibres.code (carried inside barcode2), never from the
// display label, so a cosmetic relabel can never change a printed sticker.
// See DECISIONS.md 2026-08-30 "Konditirskiy → Konditerka".

test('calibre code is the second-to-last segment, not a fixed index', () => {
  // the serial itself contains a dash, which is why index-from-the-left fails
  assert.equal(calibreCodeFromBarcode2('PLT-050826-001-KN-3'), 'KN')
  assert.equal(calibreCodeFromBarcode2('PLT-290726-071-04-2'), '04')
  assert.equal(calibreCodeFromBarcode2('nonsense'), null)
})

test('KN prints as KN regardless of what the calibre is relabelled to', () => {
  const b = 'PLT-050826-001-KN-3'
  assert.equal(abbreviateCalibre(b, 'Konditirskiy'), 'KN') // before the rename
  assert.equal(abbreviateCalibre(b, 'Konditerka'), 'KN')   // after the rename
  assert.equal(abbreviateCalibre(b, 'Кондитерка'), 'KN')   // any future relabel
  assert.equal(abbreviateCalibre(b, ''), 'KN')
})

test('numeric calibres print as K1..K8, leading zero stripped', () => {
  assert.equal(abbreviateCalibre('PLT-050826-001-04-1', 'Kalibr 4'), 'K4')
  assert.equal(abbreviateCalibre('PLT-050826-001-08-2', 'Kalibr 8'), 'K8')
  assert.equal(abbreviateCalibre('PLT-050826-001-01-1', 'Kalibr 1'), 'K1')
})

test('unrecognised code falls back to the label, so Rezka KN is unchanged', () => {
  assert.equal(abbreviateCalibre('PLT-050826-001-RKN-1', 'Rezka KN'), 'Rezka KN')
})

test('malformed barcode still abbreviates via the label fallback', () => {
  assert.equal(abbreviateCalibre('broken', 'Kalibr 6'), 'K6')
  assert.equal(abbreviateCalibre('broken', 'Konditerka'), 'KN')
})
