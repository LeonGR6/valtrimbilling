import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatSearchDate,
  groupEventsByDay,
  searchCalendarEvents,
  searchTerms,
} from '../src/features/calendar/utils/calendarEventSearch.js'

const event = (id, start, props = {}) => ({
  id,
  start,
  extendedProps: {
    calendarType: 'PRODUCTION',
    jobCode: '1319',
    community: 'El Monte',
    builder: 'G3 Urban Homes',
    phase: 'Phase 1',
    building: 'Building 2',
    lotStart: 1,
    lotEnd: 9,
    lotNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    activityType: 'EXT',
    variant: 'base',
    foreman: 'Hilario Najera',
    superintendent: 'Edward Escareno',
    ...props,
  },
})

const events = [
  event('b', '2026-06-09', { activityType: 'DM' }),
  event('a', '2026-05-12'),
  event('c', '2026-05-12', { jobCode: '1400', community: 'Fairview', phase: 'Phase 3', building: 'Building 14', lotNumbers: [20, 21], lotStart: 20, lotEnd: 21 }),
]

test('every typed word has to match, whatever the order', () => {
  assert.deepEqual(searchTerms('  El  MONTE '), ['el', 'monte'])
  assert.deepEqual(searchCalendarEvents(events, 'monte dm').map((item) => item.id), ['b'])
  assert.deepEqual(searchCalendarEvents(events, 'fairview').map((item) => item.id), ['c'])
  assert.deepEqual(searchCalendarEvents(events, 'zzz'), [])
})

test('an empty search matches nothing so the calendar stays in charge', () => {
  assert.deepEqual(searchCalendarEvents(events, ''), [])
  assert.deepEqual(searchCalendarEvents(events, '   '), [])
})

test('events can be found by job, phase, building, lot, person and date', () => {
  const ids = (query) => searchCalendarEvents(events, query).map((item) => item.id)

  assert.deepEqual(ids('1400'), ['c'])
  assert.deepEqual(ids('#1319 p1 b2'), ['a', 'b'])
  assert.deepEqual(ids('building 14'), ['c'])
  assert.deepEqual(ids('lot 21'), ['c'])
  assert.deepEqual(ids('hilario'), ['a', 'c', 'b'])
  assert.deepEqual(ids('may 12'), ['a', 'c'])
  assert.deepEqual(ids('2026-06-09'), ['b'])
  assert.deepEqual(ids('tuesday june 9'), ['b'])
})

test('results come soonest first and are grouped by day', () => {
  const found = searchCalendarEvents(events, 'a')
  assert.deepEqual(found.map((item) => item.id).slice(0, 2), ['a', 'c'])

  assert.deepEqual(
    groupEventsByDay(searchCalendarEvents(events, 'e')).map((group) => [group.date, group.events.length]),
    [['2026-05-12', 2], ['2026-06-09', 1]],
  )
  assert.equal(formatSearchDate('2026-05-12'), 'Tuesday, May 12, 2026')
})
