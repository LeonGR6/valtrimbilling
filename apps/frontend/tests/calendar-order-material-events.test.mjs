import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isOrderMaterialEvent,
  splitOrderMaterialEvents,
} from '../src/features/calendar/utils/orderMaterialEvents.js'

function event(id, start, props = {}) {
  return {
    id,
    start,
    extendedProps: { activityType: 'EXT', orderMaterial: true, variant: 'base', jobCode: '100', ...props },
  }
}

test('only the EXT events with Order material checked (the yellow ones) are kept', () => {
  assert.equal(isOrderMaterialEvent(event('a', '2026-12-01')), true)
  assert.equal(isOrderMaterialEvent(event('b', '2026-12-01', { variant: 'install-only' })), true)
  assert.equal(isOrderMaterialEvent(event('c', '2026-12-01', { orderMaterial: false })), false)
  assert.equal(isOrderMaterialEvent(event('d', '2026-12-01', { activityType: 'DM' })), false)
  assert.equal(isOrderMaterialEvent(event('e', '2026-12-01', { activityType: 'CHANGE_ORDER' })), false)
})

test('upcoming go soonest first, today included; past go most recent first', () => {
  const { upcoming, past } = splitOrderMaterialEvents([
    event('late', '2026-12-10'),
    event('old', '2026-10-01'),
    event('today-b', '2026-11-25', { jobCode: '1295' }),
    event('today-a', '2026-11-25', { jobCode: '101' }),
    event('recent', '2026-11-20'),
    event('not-order', '2026-12-01', { orderMaterial: false }),
    event('no-date', ''),
  ], '2026-11-25')

  assert.deepEqual(upcoming.map((item) => item.id), ['today-a', 'today-b', 'late'])
  assert.deepEqual(past.map((item) => item.id), ['recent', 'old'])
})

test('no events gives two empty lists', () => {
  assert.deepEqual(splitOrderMaterialEvents(undefined, '2026-11-25'), { upcoming: [], past: [] })
})
