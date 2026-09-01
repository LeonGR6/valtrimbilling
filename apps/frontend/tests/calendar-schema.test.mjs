import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarEventSchema } from '../src/features/calendar/schemas/calendarEventSchema.js'

const validEvent = {
  activityType: 'DM',
  lotStart: '1',
  lotEnd: '8',
  date: '2026-08-14',
  builder: 'KB Home',
  community: 'Andara',
  phase: 'Phase 1',
  building: 'Building 3',
  notes: '',
  installOnly: false,
  installDate: '',
  splitPhase: false,
  splitParts: [],
  lockUp: false,
}

test('calendar event schema normalizes a valid lot range', () => {
  const result = calendarEventSchema.parse(validEvent)

  assert.equal(result.activityType, 'DM')
  assert.equal(result.lotStart, 1)
  assert.equal(result.lotEnd, 8)
})

test('calendar event schema rejects an invalid date', () => {
  const result = calendarEventSchema.safeParse({
    ...validEvent,
    date: '14/08/2026',
  })

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'date')
})

test('split phase requires contiguous lot ranges with a date per division', () => {
  const result = calendarEventSchema.parse({
    ...validEvent,
    splitPhase: true,
    splitParts: [
      { id: 'a', lotStart: 1, lotEnd: 5, date: '2026-08-14' },
      { id: 'b', lotStart: 6, lotEnd: 8, date: '2026-08-18' },
    ],
  })

  assert.equal(result.splitParts.length, 2)
  assert.equal(result.splitParts[1].date, '2026-08-18')
})

test('install only requires a separate date', () => {
  const result = calendarEventSchema.safeParse({
    ...validEvent,
    activityType: 'EXT',
    installOnly: true,
  })

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'installDate')
})
