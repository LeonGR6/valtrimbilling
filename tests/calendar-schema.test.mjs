import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarEventSchema } from '../src/features/calendar/schemas/calendarEventSchema.js'

const validEvent = {
  code: 'ext',
  workType: 'Exterior',
  lots: '9, 10',
  date: '2026-08-14',
  builder: 'KB Home',
  community: 'Andara',
  phase: 'Fase 1',
  building: 'Edificio 3',
  status: 'Confirmado',
  foreman: 'Miguel Santos',
  crew: 'Crew 04',
  plan: 'Plan 1',
  rate: 2000,
}

test('calendar event schema normalizes a valid activity', () => {
  const result = calendarEventSchema.parse(validEvent)

  assert.equal(result.code, 'EXT')
  assert.equal(result.rate, 2000)
})

test('calendar event schema rejects an invalid date', () => {
  const result = calendarEventSchema.safeParse({
    ...validEvent,
    date: '14/08/2026',
  })

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'date')
})
