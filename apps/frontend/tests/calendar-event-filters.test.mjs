import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calendarFilterOptions,
  filterCalendarEvents,
  resolveCalendarScope,
} from '../src/features/calendar/utils/calendarEventFilters.js'

const event = (id, props) => ({ id, extendedProps: { activityType: 'EXT', ...props } })
const events = [
  event('a', { jobId: 1, jobCode: '1501', builder: 'Acme', community: 'Lakes' }),
  event('b', { jobId: 2, jobCode: '1502', builder: 'Acme', community: 'Stone Creek', activityType: 'DM' }),
  event('c', { jobId: 3, jobCode: '1601', builder: 'Zed', community: 'Lakes' }),
]
const ids = (list) => list.map(({ id }) => id)
const all = ['EXT', 'DM', 'HW', 'SHUTTER']

test('options only list what has events and follow the chosen Builder', () => {
  assert.deepEqual(calendarFilterOptions(events).builders, ['Acme', 'Zed'])
  assert.deepEqual(calendarFilterOptions(events).communities, ['Lakes', 'Stone Creek'])
  assert.deepEqual(calendarFilterOptions(events, { builder: 'Zed' }).communities, ['Lakes'])
  assert.deepEqual(
    calendarFilterOptions(events, { builder: 'Acme', community: 'Lakes' }).jobs,
    [{ id: '1', label: 'Job #1501 · Lakes' }],
  )
})

test('events are filtered by type, Builder, Community and Job together', () => {
  assert.deepEqual(ids(filterCalendarEvents(events, { types: all })), ['a', 'b', 'c'])
  assert.deepEqual(ids(filterCalendarEvents(events, { types: ['EXT'] })), ['a', 'c'])
  assert.deepEqual(ids(filterCalendarEvents(events, { types: all, builder: 'Acme' })), ['a', 'b'])
  assert.deepEqual(ids(filterCalendarEvents(events, { types: all, community: 'Lakes' })), ['a', 'c'])
  assert.deepEqual(
    ids(filterCalendarEvents(events, { types: all, builder: 'Acme', jobId: '2' })),
    ['b'],
  )
})

test('a remembered scope that no longer has events falls back to All', () => {
  const stale = resolveCalendarScope(events, { builder: 'Gone', community: 'Lakes', jobId: '9' })
  assert.equal(stale.builder, 'ALL')
  assert.equal(stale.community, 'Lakes')
  assert.equal(stale.jobId, 'ALL')

  const valid = resolveCalendarScope(events, { builder: 'Acme', community: 'Lakes', jobId: '1' })
  assert.deepEqual(
    [valid.builder, valid.community, valid.jobId],
    ['Acme', 'Lakes', '1'],
  )
})
