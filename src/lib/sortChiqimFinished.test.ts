/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortFinishedByOmborFinish } from './sortChiqimFinished.ts'

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
