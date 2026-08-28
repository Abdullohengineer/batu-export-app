/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineStatus, shortfallLines, type ChiqimLineLike } from './chiqimLineStatus.ts'

const lineA: ChiqimLineLike = { id: 'line-a', type_id: 'subxon', calibre_id: 'k6', line_kind: 'finished', qty_kg: 3600 }
const lineB: ChiqimLineLike = { id: 'line-b', type_id: 'isfara', calibre_id: 'k8', line_kind: 'finished', qty_kg: 2000 }

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
