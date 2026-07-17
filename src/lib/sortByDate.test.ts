/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortByDateDesc, maxDate } from './sortByDate.ts'

test('newest-first: reorders an out-of-order list ascending by date to descending', () => {
  const items = [{ id: 'a', d: '2026-07-01' }, { id: 'b', d: '2026-07-15' }, { id: 'c', d: '2026-07-10' }]
  const sorted = sortByDateDesc(items, (i) => i.d)
  assert.deepEqual(sorted.map((i) => i.id), ['b', 'c', 'a'])
})

test('already-descending input stays newest-first', () => {
  const items = [{ id: 'b', d: '2026-07-15' }, { id: 'c', d: '2026-07-10' }, { id: 'a', d: '2026-07-01' }]
  const sorted = sortByDateDesc(items, (i) => i.d)
  assert.deepEqual(sorted.map((i) => i.id), ['b', 'c', 'a'])
})

test('missing dates sort last, not first', () => {
  const items = [{ id: 'none', d: null }, { id: 'newer', d: '2026-07-15' }, { id: 'older', d: '2026-07-01' }]
  const sorted = sortByDateDesc(items, (i) => i.d)
  assert.deepEqual(sorted.map((i) => i.id), ['newer', 'older', 'none'])
})

test('does not mutate the input array', () => {
  const items = [{ id: 'a', d: '2026-07-01' }, { id: 'b', d: '2026-07-15' }]
  const original = [...items]
  sortByDateDesc(items, (i) => i.d)
  assert.deepEqual(items, original)
})

test('full timestamps (not just dates) compare correctly, same-day newest first', () => {
  const items = [
    { id: 'morning', d: '2026-07-16T08:00:00Z' },
    { id: 'evening', d: '2026-07-16T20:00:00Z' },
    { id: 'noon', d: '2026-07-16T12:00:00Z' },
  ]
  const sorted = sortByDateDesc(items, (i) => i.d)
  assert.deepEqual(sorted.map((i) => i.id), ['evening', 'noon', 'morning'])
})

test('maxDate: picks the later of two dates', () => {
  assert.equal(maxDate('2026-07-01', '2026-07-15'), '2026-07-15')
  assert.equal(maxDate('2026-07-15', '2026-07-01'), '2026-07-15')
})

test('maxDate: either side null falls back to the other', () => {
  assert.equal(maxDate(null, '2026-07-15'), '2026-07-15')
  assert.equal(maxDate('2026-07-15', null), '2026-07-15')
})

test('maxDate: both null is null', () => {
  assert.equal(maxDate(null, null), null)
})
