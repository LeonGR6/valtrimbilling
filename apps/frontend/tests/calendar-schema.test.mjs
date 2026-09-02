import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createProductionCalendarEvents,
  getActivityTone,
} from '../src/features/calendar/data/calendarEvents.js'
import { calendarEventSchema } from '../src/features/calendar/schemas/calendarEventSchema.js'

const validActivity = {
  calendarType: 'PRODUCTION',
  jobId: '1',
  phaseId: '2102',
  jobCode: '1307',
  builder: 'Trumark Homes',
  community: 'Andara',
  phase: 'Phase 2',
  building: 'Building 15',
  lotStart: '66',
  lotEnd: '70',
  lotNumbers: ['66', '67', '68', '69', '70'],
  foreman: 'Lauren Mitchell',
  superintendent: 'Daniel Torres',
  notes: '',
  extDate: '2026-08-10',
  extOrderMaterial: false,
  extInstallOnly: false,
  extInstallDate: '',
  dmDate: '2026-08-11',
  dmInstallOnly: false,
  dmInstallDate: '',
  dmSplitPhase: false,
  dmSplitParts: [],
  dmShutters: false,
  hwDate: '2026-08-12',
  hwSplitPhase: false,
  hwSplitParts: [],
  hwLockUp: false,
}

test('production activity schema normalizes selected Job, phase and lot range', () => {
  const result = calendarEventSchema.parse(validActivity)

  assert.equal(result.jobId, 1)
  assert.equal(result.phaseId, 2102)
  assert.equal(result.lotStart, 66)
  assert.equal(result.lotEnd, 70)
})

test('production activity requires one valid date for EXT, DM and HW', () => {
  const result = calendarEventSchema.safeParse({
    ...validActivity,
    extDate: '10/08/2026',
  })

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'extDate')
})

test('DM split phase requires contiguous lot ranges with a date per division', () => {
  const result = calendarEventSchema.parse({
    ...validActivity,
    dmSplitPhase: true,
    dmSplitParts: [
      { id: 'a', lotStart: 66, lotEnd: 68, date: '2026-08-11' },
      { id: 'b', lotStart: 69, lotEnd: 70, date: '2026-08-13' },
    ],
  })

  assert.equal(result.dmSplitParts.length, 2)
  assert.equal(result.dmSplitParts[1].date, '2026-08-13')
})

test('EXT install only requires its separate date', () => {
  const result = calendarEventSchema.safeParse({
    ...validActivity,
    extInstallOnly: true,
  })

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'extInstallDate')
})

test('saving Production creates the EXT, DM and HW calendar events together', () => {
  const values = calendarEventSchema.parse(validActivity)
  const events = createProductionCalendarEvents(values, 'production-test', 123)

  assert.equal(events.length, 3)
  assert.deepEqual(events.map((event) => event.extendedProps.activityType), ['EXT', 'DM', 'HW'])
  assert.deepEqual(events.map((event) => event.start), ['2026-08-10', '2026-08-11', '2026-08-12'])
})

test('Order Material changes the EXT tone without changing DM or HW', () => {
  assert.equal(getActivityTone('EXT', false), 'ext')
  assert.equal(getActivityTone('EXT', true), 'ext-order')
  assert.equal(getActivityTone('DM', true), 'dm')
  assert.equal(getActivityTone('HW', true), 'hw')
})
