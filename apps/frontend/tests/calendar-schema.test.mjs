import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDraftFromProductionEvent,
  createProductionCalendarEvents,
  getActivityTone,
  getLotsLabel,
  getMonthEventLabel,
  recordProductionDateHistory,
} from '../src/features/calendar/data/calendarEvents.js'
import {
  addSplitDivision,
  createDefaultSplitParts,
  formatBuilding,
  formatPhaseBuilding,
} from '../src/features/calendar/components/calendarSchedulerUtils.js'
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
  lotIds: [501, 502, 503, 504, 505],
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
    lotIds: [601, 602, 603, 604, 610, 611, 612],
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
  assert.equal(getActivityTone('DM', false, 'baseboard-install'), 'baseboard')
  assert.equal(getActivityTone('DM', false, 'base'), 'dm')
})

test('the Month view shows one line: job, community, phase and building, lots and event', () => {
  const props = {
    jobCode: '1319',
    community: 'El Monte',
    phase: 'Phase 1',
    building: 'Building 2',
    lotStart: 1,
    lotEnd: 9,
    lotNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    activityType: 'EXT',
    variant: 'base',
  }

  assert.equal(getMonthEventLabel(props), 'El Monte · P1 B2 · (1–9) · EXT')
  assert.equal(
    getMonthEventLabel({ ...props, phase: '1.1', building: 'B', lotNumbers: [4], activityType: 'HW', variant: 'install-only' }),
    'El Monte · P1.1 B · (4) · HW INSTALL ONLY',
  )
})

test('split divisions start without a date or a note', () => {
  const parts = createDefaultSplitParts({ lotStart: 1, lotEnd: 9 }, 'SUPERVISOR')

  assert.deepEqual(parts.map(({ lotStart, lotEnd }) => [lotStart, lotEnd]), [[1, 5], [6, 9]])
  assert.deepEqual(parts.map((part) => [part.date, part.note, part.dateOwner]), [
    ['', '', 'SUPERVISOR'],
    ['', '', 'SUPERVISOR'],
  ])

  // A division added later starts blank too, and is not tied to a saved schedule.
  const withDates = parts.map((part) => ({ ...part, date: '2026-07-21', note: 'x', scheduleId: 9 }))
  const added = addSplitDivision(withDates)
  const newest = added.find((part) => !withDates.some((old) => old.id === part.id))
  assert.equal(newest.date, '')
  assert.equal(newest.note, '')
  assert.equal(newest.scheduleId, undefined)
})

test('saving a split without its dates asks for them', () => {
  const split = createDefaultSplitParts({ lotStart: 1, lotEnd: 4 }, 'SUPERVISOR')
  const result = calendarEventSchema.safeParse({
    ...validActivity,
    lotStart: 1,
    lotEnd: 4,
    dmSplitPhase: true,
    dmSplitParts: split,
  })

  assert.equal(result.success, false)
  assert.ok(result.error.issues.some((issue) => issue.message === 'Enter the date of every division.'))

  const filled = calendarEventSchema.safeParse({
    ...validActivity,
    lotStart: 1,
    lotEnd: 4,
    dmSplitPhase: true,
    dmSplitParts: split.map((part) => ({ ...part, date: '2026-07-21' })),
  })
  assert.equal(filled.success, true)
})

test('a production activity can be scheduled for a phase without a building', () => {
  const { building: _building, ...withoutBuilding } = validActivity
  const result = calendarEventSchema.safeParse({ ...withoutBuilding })
  assert.equal(result.success, true)
  assert.equal(result.data.building, '')

  const blank = calendarEventSchema.safeParse({ ...validActivity, building: '  ' })
  assert.equal(blank.success, true)
  assert.equal(blank.data.building, '')
})

test('the calendar names a phase with or without its building', () => {
  assert.equal(formatBuilding(''), '')
  assert.equal(formatBuilding(null), '')
  assert.equal(formatBuilding(undefined), '')
  assert.equal(formatBuilding('15'), 'Building 15')
  assert.equal(formatBuilding('Building 15'), 'Building 15')
  assert.equal(formatPhaseBuilding('2', '15'), 'Phase 2 · Building 15')
  assert.equal(formatPhaseBuilding('2', ''), 'Phase 2')
  assert.equal(formatPhaseBuilding('2', '15', ' / '), 'Phase 2 / Building 15')

  const props = { ...validActivity, phase: 'Phase 2', building: '', lotNumbers: [4], lotStart: 4, lotEnd: 4 }
  assert.equal(
    getMonthEventLabel({ ...props, activityType: 'HW', variant: 'install-only' }).includes('B undefined'),
    false,
  )
})

test('DM baseboard install requires its separate date and owner defaults to Tentative', () => {
  const missingDate = calendarEventSchema.safeParse({
    ...validActivity,
    dmBaseboardInstall: true,
  })
  assert.equal(missingDate.success, false)
  assert.equal(missingDate.error.issues[0].path[0], 'dmBaseboardInstallDate')

  const result = calendarEventSchema.parse({
    ...validActivity,
    dmBaseboardInstall: true,
    dmBaseboardInstallDate: '2026-08-20',
    dmBaseboardInstallDateOwner: '',
  })
  assert.equal(result.dmBaseboardInstallDateOwner, 'TENTATIVE')

  // Off by default, like the other extra events.
  assert.equal(calendarEventSchema.parse(validActivity).dmBaseboardInstall, false)
})

test('the DM baseboard install option creates a separate event', () => {
  const values = calendarEventSchema.parse({
    ...validActivity,
    dmBaseboardInstall: true,
    dmBaseboardInstallDate: '2026-08-20',
    dmBaseboardInstallDateOwner: 'SUPERVISOR',
    dmBaseboardInstallDateNote: 'After paint.',
  })
  const events = createProductionCalendarEvents(values, 'production-baseboard', 130)
  const baseboard = events.find((event) => event.extendedProps.variant === 'baseboard-install')

  assert.ok(baseboard)
  assert.equal(baseboard.start, '2026-08-20')
  assert.equal(baseboard.title.startsWith('DM BASEBOARD INSTALL'), true)
  assert.equal(baseboard.extendedProps.activityType, 'DM')
  assert.equal(baseboard.extendedProps.dateOwner, 'SUPERVISOR')
  assert.equal(baseboard.extendedProps.dateNote, 'After paint.')
  assert.deepEqual(baseboard.extendedProps.lotNumbers, values.lotNumbers)
  // The DM event itself is still there, marked as having the extra event.
  const dm = events.find((event) => event.extendedProps.variant === 'base' && event.extendedProps.activityType === 'DM')
  assert.equal(dm.extendedProps.baseboardInstall, true)
  assert.equal(getMonthEventLabel(baseboard.extendedProps).endsWith('DM BASEBOARD INSTALL'), true)

  // Without the option there is no such event.
  const plain = createProductionCalendarEvents(calendarEventSchema.parse(validActivity), 'production-plain', 131)
  assert.equal(plain.some((event) => event.extendedProps.variant === 'baseboard-install'), false)
})
