import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LOADING_THRESHOLDS,
  ghostEventSource,
  ghostEventsBetween,
  loadingPhaseAt,
} from '../src/features/calendar/utils/calendarLoading.js'

test('a load shows nothing while it is short, then loading, then slow', () => {
  const { showAfter, slowAfter } = LOADING_THRESHOLDS

  assert.equal(loadingPhaseAt(0), 'pending')
  assert.equal(loadingPhaseAt(showAfter - 1), 'pending')
  assert.equal(loadingPhaseAt(showAfter), 'loading')
  assert.equal(loadingPhaseAt(slowAfter - 1), 'loading')
  assert.equal(loadingPhaseAt(slowAfter), 'slow')
  assert.equal(loadingPhaseAt(slowAfter * 3), 'slow')
})

test('the thresholds can be replaced', () => {
  const thresholds = { showAfter: 10, slowAfter: 20, reveal: 5 }

  assert.equal(loadingPhaseAt(9, thresholds), 'pending')
  assert.equal(loadingPhaseAt(10, thresholds), 'loading')
  assert.equal(loadingPhaseAt(20, thresholds), 'slow')
})

test('a month gets stand-ins on its days, each marked as a stand-in and fixed in place', () => {
  const ghosts = ghostEventsBetween(new Date(2026, 9, 26), new Date(2026, 11, 7))

  assert.ok(ghosts.length > 30)
  for (const ghost of ghosts) {
    assert.equal(ghost.extendedProps.ghost, true)
    assert.equal(ghost.allDay, true)
    assert.equal(ghost.startEditable, false)
    assert.equal(ghost.durationEditable, false)
    assert.match(ghost.id, /^ghost-\d{4}-\d{2}-\d{2}-\d+$/)
    assert.ok([100, 82, 64].includes(ghost.extendedProps.width))
  }
  assert.equal(new Set(ghosts.map((ghost) => ghost.id)).size, ghosts.length)
})

test('a day looks the same wherever it is shown', () => {
  const month = ghostEventsBetween(new Date(2026, 10, 1), new Date(2026, 11, 1))
  const week = ghostEventsBetween(new Date(2026, 10, 9), new Date(2026, 10, 16))

  const inMonth = month.filter((ghost) => ghost.start >= '2026-11-09' && ghost.start < '2026-11-16')
  assert.deepEqual(week, inMonth)
})

test('weekdays are busier than weekends', () => {
  const ghosts = ghostEventsBetween(new Date(2026, 10, 2), new Date(2026, 10, 30))
  const countOn = (predicate) => ghosts.filter((ghost) => predicate(new Date(`${ghost.start}T00:00:00Z`).getUTCDay())).length
  const weekdays = countOn((day) => day >= 1 && day <= 5)
  const weekend = countOn((day) => day === 0 || day === 6)

  assert.ok(weekdays > weekend * 3)
  const weekendStandIns = ghosts.filter((ghost) => {
    const day = new Date(`${ghost.start}T00:00:00Z`).getUTCDay()
    return day === 0 || day === 6
  })
  assert.ok(weekendStandIns.every((ghost) => ghost.id.endsWith('-0')), 'a weekend day has at most one stand-in')
})

test('the Year view gets no stand-ins', () => {
  assert.deepEqual(ghostEventsBetween(new Date(2026, 0, 1), new Date(2027, 0, 1)), [])
})

test('an empty or reversed range has none', () => {
  const day = new Date(2026, 10, 9)

  assert.deepEqual(ghostEventsBetween(day, day), [])
  assert.deepEqual(ghostEventsBetween(new Date(2026, 10, 10), day), [])
})

test('the event source answers the range the Calendar asks for', () => {
  let delivered = null
  ghostEventSource({ start: new Date(2026, 10, 9), end: new Date(2026, 10, 16) }, (events) => {
    delivered = events
  })

  assert.deepEqual(delivered, ghostEventsBetween(new Date(2026, 10, 9), new Date(2026, 10, 16)))
  assert.ok(delivered.length > 0)
})
