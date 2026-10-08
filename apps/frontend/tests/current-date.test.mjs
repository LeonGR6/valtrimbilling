import test from 'node:test'
import assert from 'node:assert/strict'
import { isSameLocalDay, msUntilNextDay } from '../src/hooks/useCurrentDate.js'

test('two readings on the same local day are the same day', () => {
  assert.equal(isSameLocalDay(new Date(2026, 9, 8, 0, 0), new Date(2026, 9, 8, 23, 59)), true)
  assert.equal(isSameLocalDay(new Date(2026, 9, 8, 23, 59), new Date(2026, 9, 9, 0, 1)), false)
  assert.equal(isSameLocalDay(new Date(2026, 9, 8), new Date(2027, 9, 8)), false)
})

test('the day change is scheduled just after the next local midnight', () => {
  assert.equal(msUntilNextDay(new Date(2026, 9, 8, 23, 59, 0)), 61_000)
  assert.equal(msUntilNextDay(new Date(2026, 9, 8, 0, 0, 0)), 24 * 60 * 60 * 1000 + 1000)
})
