import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDraftFromProductionEvent,
  createProductionCalendarEvents,
  getActivityTone,
  getLotsLabel,
  recordProductionDateHistory,
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
  extDateOwner: 'SUPERVISOR',
  extOrderMaterial: false,
  extInstallOnly: false,
  extInstallDate: '',
  extInstallDateOwner: '',
  dmShutters: false,
  shutterDate: '',
  shutterDateOwner: '',
  dmDate: '2026-08-11',
  dmDateOwner: 'JOBSITE_SUPERINTENDENT',
  dmInstallOnly: false,
  dmInstallDate: '',
  dmInstallDateOwner: '',
  dmSplitPhase: false,
  dmSplitParts: [],
  hwDate: '2026-08-12',
  hwDateOwner: 'TENTATIVE',
  hwSplitPhase: false,
  hwSplitParts: [],
  hwLockUp: false,
  hwLockUpDate: '',
  hwLockUpDateOwner: '',
}

test('production activity schema normalizes selected Job, phase and lot range', () => {
  const result = calendarEventSchema.parse(validActivity)

  assert.equal(result.jobId, 1)
  assert.equal(result.phaseId, 2102)
  assert.equal(result.lotStart, 66)
  assert.equal(result.lotEnd, 70)
})

test('non-contiguous lots are grouped without filling gaps', () => {
  const lotNumbers = ['1', '2', '3', '4', '10', '11', '12']

  assert.equal(getLotsLabel(1, 12, lotNumbers), 'Lots 1–4, 10–12')

  const values = calendarEventSchema.parse({
    ...validActivity,
    lotStart: '1',
    lotEnd: '12',
    lotNumbers,
  })
  const events = createProductionCalendarEvents(values, 'production-discrete-lots', 124)

  assert.equal(events[0].title, 'EXT FRAMES • Lots 1–4, 10–12')
  assert.deepEqual(events[0].extendedProps.lotNumbers, lotNumbers)
})

test('production activity requires one valid date for EXT, DM and HW', () => {
  const result = calendarEventSchema.safeParse({
    ...validActivity,
    extDate: '10/08/2026',
  })

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'extDate')
})

test('production dates default to Tentative when no date type is selected', () => {
  const result = calendarEventSchema.parse({
    ...validActivity,
    extDateOwner: '',
    dmDateOwner: '',
    hwDateOwner: '',
  })

  assert.equal(result.extDateOwner, 'TENTATIVE')
  assert.equal(result.dmDateOwner, 'TENTATIVE')
  assert.equal(result.hwDateOwner, 'TENTATIVE')
})

test('production dates reject unsupported date types', () => {
  const unsupportedOwner = calendarEventSchema.safeParse({
    ...validActivity,
    dmDateOwner: 'CREW',
  })

  assert.equal(unsupportedOwner.success, false)
  assert.equal(unsupportedOwner.error.issues[0].path[0], 'dmDateOwner')
})

test('DM split phase requires contiguous lot ranges with a date per division', () => {
  const result = calendarEventSchema.parse({
    ...validActivity,
    dmSplitPhase: true,
    dmSplitParts: [
      { id: 'a', lotStart: 66, lotEnd: 68, date: '2026-08-11', dateOwner: 'SUPERVISOR' },
      { id: 'b', lotStart: 69, lotEnd: 70, date: '2026-08-13', dateOwner: 'TENTATIVE' },
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

test('an install-only date also defaults to Tentative when its date type is empty', () => {
  const result = calendarEventSchema.parse({
    ...validActivity,
    extInstallOnly: true,
    extInstallDate: '2026-08-14',
    extInstallDateOwner: '',
  })

  assert.equal(result.extInstallDateOwner, 'TENTATIVE')
})

test('Hardware lock up requires its separate date', () => {
  const result = calendarEventSchema.safeParse({
    ...validActivity,
    hwLockUp: true,
  })

  assert.equal(result.success, false)
  assert.equal(result.error.issues[0].path[0], 'hwLockUpDate')
})

test('the Hardware lock-up option creates a separate event', () => {
  const values = calendarEventSchema.parse({
    ...validActivity,
    hwLockUp: true,
    hwLockUpDate: '2026-08-14',
    hwLockUpDateOwner: '',
    hwLockUpDateNote: 'Secure the building after installation.',
  })
  const events = createProductionCalendarEvents(values, 'production-lock-up', 127)
  const lockUpEvent = events.find((event) => event.extendedProps.variant === 'lock-up')

  assert.equal(events.length, 4)
  assert.equal(lockUpEvent.title, 'Hardware LOCK UP • Lots 66–70')
  assert.equal(lockUpEvent.start, '2026-08-14')
  assert.equal(lockUpEvent.extendedProps.activityType, 'HW')
  assert.equal(lockUpEvent.extendedProps.dateOwner, 'TENTATIVE')
  assert.equal(lockUpEvent.extendedProps.dateNote, 'Secure the building after installation.')

  const restoredDraft = createDraftFromProductionEvent(lockUpEvent)
  assert.equal(restoredDraft.hwLockUp, true)
  assert.equal(restoredDraft.hwLockUpDate, '2026-08-14')
  assert.equal(restoredDraft.hwLockUpDateOwner, 'TENTATIVE')
})

test('date notes are optional and limited to 100 characters', () => {
  const withoutNotes = calendarEventSchema.parse(validActivity)
  const noteTooLong = calendarEventSchema.safeParse({
    ...validActivity,
    extDateNote: 'x'.repeat(101),
  })

  assert.equal(withoutNotes.extDateNote, '')
  assert.equal(withoutNotes.dmDateNote, '')
  assert.equal(withoutNotes.hwDateNote, '')
  assert.equal(noteTooLong.success, false)
  assert.equal(noteTooLong.error.issues[0].path[0], 'extDateNote')
})

test('saving Production creates the EXT, DM and HW calendar events together', () => {
  const values = calendarEventSchema.parse({
    ...validActivity,
    extDateNote: 'Confirm frame delivery before arrival.',
    dmDateNote: 'Meet the superintendent at lot 66.',
    hwDateNote: 'Tentative pending hardware shipment.',
  })
  const events = createProductionCalendarEvents(values, 'production-test', 123)

  assert.equal(events.length, 3)
  assert.deepEqual(events.map((event) => event.extendedProps.activityType), ['EXT', 'DM', 'HW'])
  assert.deepEqual(events.map((event) => event.start), ['2026-08-10', '2026-08-11', '2026-08-12'])
  assert.deepEqual(
    events.map((event) => event.extendedProps.dateOwner),
    ['SUPERVISOR', 'JOBSITE_SUPERINTENDENT', 'TENTATIVE'],
  )
  assert.deepEqual(
    events.map((event) => event.extendedProps.dateNote),
    [
      'Confirm frame delivery before arrival.',
      'Meet the superintendent at lot 66.',
      'Tentative pending hardware shipment.',
    ],
  )

  const restoredDraft = createDraftFromProductionEvent(events[0])
  assert.equal(restoredDraft.extDateOwner, 'SUPERVISOR')
  assert.equal(restoredDraft.extDateNote, 'Confirm frame delivery before arrival.')
  assert.equal(restoredDraft.dmDateOwner, 'JOBSITE_SUPERINTENDENT')
  assert.equal(restoredDraft.hwDateOwner, 'TENTATIVE')
})

test('the Shutter option on DM creates a separate Shutter event', () => {
  const values = calendarEventSchema.parse({
    ...validActivity,
    dmShutters: true,
    shutterDate: '2026-08-04',
    shutterDateOwner: '',
    shutterDateNote: 'Confirm shutter material.',
  })
  const events = createProductionCalendarEvents(values, 'production-shutter', 125)

  assert.equal(events.length, 4)
  assert.deepEqual(
    events.map((event) => event.extendedProps.activityType),
    ['EXT', 'SHUTTER', 'DM', 'HW'],
  )
  assert.equal(events[1].start, '2026-08-04')
  assert.equal(events[1].extendedProps.dateOwner, 'TENTATIVE')
  assert.equal(events[1].extendedProps.dateNote, 'Confirm shutter material.')

  const restoredDraft = createDraftFromProductionEvent(events[1])
  assert.equal(restoredDraft.dmShutters, true)
  assert.equal(restoredDraft.shutterDate, '2026-08-04')
})

test('moving DM preserves the previous Shutter date in its event history', () => {
  const originalValues = calendarEventSchema.parse({
    ...validActivity,
    dmShutters: true,
    shutterDate: '2026-08-04',
    shutterDateOwner: 'TENTATIVE',
    shutterDateNote: 'Original shutter visit.',
  })
  const previousEvent = createProductionCalendarEvents(
    originalValues,
    'production-shutter-history',
    126,
  )[1]
  const editedValues = calendarEventSchema.parse({
    ...createDraftFromProductionEvent(previousEvent),
    dmDate: '2026-08-18',
    shutterDate: '2026-08-11',
  })
  const valuesWithHistory = recordProductionDateHistory(
    editedValues,
    previousEvent,
    '2026-08-03T18:30:00.000Z',
  )

  assert.deepEqual(valuesWithHistory.shutterDateHistory, [{
    date: '2026-08-04',
    dateOwner: 'TENTATIVE',
    note: 'Original shutter visit.',
    changedAt: '2026-08-03T18:30:00.000Z',
  }])
})

test('editing a date or date type stores its previous date, type and note', () => {
  const originalValues = calendarEventSchema.parse({
    ...validActivity,
    extDateNote: 'Call before delivering frames.',
  })
  const originalEvent = createProductionCalendarEvents(originalValues, 'production-history', 200)[0]
  const editedValues = calendarEventSchema.parse({
    ...createDraftFromProductionEvent(originalEvent),
    extDate: '2026-08-15',
    extDateOwner: 'JOBSITE_SUPERINTENDENT',
    extDateNote: 'New delivery window confirmed.',
  })
  const valuesWithHistory = recordProductionDateHistory(
    editedValues,
    originalEvent,
    '2026-08-09T18:30:00.000Z',
  )
  const editedEvent = createProductionCalendarEvents(valuesWithHistory, 'production-history', 201)[0]

  assert.deepEqual(editedEvent.extendedProps.dateHistory, [{
    date: '2026-08-10',
    dateOwner: 'SUPERVISOR',
    note: 'Call before delivering frames.',
    changedAt: '2026-08-09T18:30:00.000Z',
  }])

  const noteOnlyEdit = calendarEventSchema.parse({
    ...createDraftFromProductionEvent(editedEvent),
    extDateNote: 'The date stayed the same.',
  })
  const noteOnlyHistory = recordProductionDateHistory(
    noteOnlyEdit,
    editedEvent,
    '2026-08-10T18:30:00.000Z',
  )

  assert.equal(noteOnlyHistory.extDateHistory.length, 1)
})

test('Order Material changes the EXT tone without changing DM or HW', () => {
  assert.equal(getActivityTone('EXT', false), 'ext')
  assert.equal(getActivityTone('EXT', true), 'ext-order')
  assert.equal(getActivityTone('DM', true), 'dm')
  assert.equal(getActivityTone('HW', true), 'hw')
})
