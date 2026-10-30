import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProductionCalendarEvents,
  createEmptyProductionDraft,
} from '../src/features/calendar/data/calendarEvents.js'
import {
  toCancelProductionActivityRpc,
  toProductionActivityDraft,
  toProductionActivityRpc,
} from '../src/features/calendar/services/productionActivityRecord.js'

function createPersistableDraft() {
  return {
    ...createEmptyProductionDraft('2026-09-10'),
    activityId: 77,
    phaseId: 21,
    lotNumbers: ['1', '2', '3', '4'],
    lotIds: [101, 102, 103, 104],
    extScheduleId: 1001,
    extDateOwner: 'SUPERVISOR',
    extDateNote: 'Frames confirmed.',
    extOrderMaterial: true,
    dmDate: '2026-10-08',
    dmDateOwner: 'TENTATIVE',
    dmSplitPhase: true,
    dmSplitParts: [
      {
        id: 'production-schedule-1002',
        scheduleId: 1002,
        lotStart: 1,
        lotEnd: 2,
        date: '2026-10-08',
        dateOwner: 'TENTATIVE',
        note: '',
        history: [],
      },
      {
        id: 'new-division',
        scheduleId: null,
        lotStart: 3,
        lotEnd: 4,
        date: '2026-10-09',
        dateOwner: 'JOBSITE_SUPERINTENDENT',
        note: 'Second delivery.',
        history: [],
      },
    ],
    hwDate: '2026-10-15',
    hwDateOwner: 'TENTATIVE',
    hwScheduleId: 1003,
    hwLockUp: true,
    hwLockUpDate: '2026-10-16',
    hwLockUpDateOwner: 'TENTATIVE',
    hwLockUpScheduleId: 1004,
  }
}

test('Production form values map to one atomic persisted activity payload', () => {
  const payload = toProductionActivityRpc(createPersistableDraft())
  const dm = payload.p_stages.find((stage) => stage.type === 'DM')
  const hw = payload.p_stages.find((stage) => stage.type === 'HW')

  assert.equal(payload.p_activity_id, 77)
  assert.equal(payload.p_phase_id, 21)
  assert.deepEqual(payload.p_lot_ids, [101, 102, 103, 104])
  assert.deepEqual(dm.schedules.map((schedule) => schedule.variant), [
    'DIVISION',
    'DIVISION',
  ])
  assert.deepEqual(dm.schedules[0].lotIds, [101, 102])
  assert.deepEqual(dm.schedules[1].lotIds, [103, 104])
  assert.equal(dm.schedules[0].id, 1002)
  assert.equal(dm.schedules[1].id, null)
  assert.equal(hw.schedules.at(-1).variant, 'LOCK_UP')
  assert.deepEqual(hw.schedules.at(-1).lotIds, [101, 102, 103, 104])
})

test('a split over separate groups of lots sends the lots of each group', () => {
  const payload = toProductionActivityRpc({
    ...createPersistableDraft(),
    lotNumbers: ['11', '12', '13', '14', '21', '22', '23'],
    lotIds: [111, 112, 113, 114, 121, 122, 123],
    dmSplitParts: [
      { id: 'a', scheduleId: null, lotStart: 11, lotEnd: 14, date: '2026-10-08', dateOwner: 'TENTATIVE', note: '' },
      { id: 'b', scheduleId: null, lotStart: 21, lotEnd: 23, date: '2026-10-09', dateOwner: 'TENTATIVE', note: '' },
    ],
  })
  const dm = payload.p_stages.find((stage) => stage.type === 'DM')

  assert.deepEqual(dm.schedules[0].lotIds, [111, 112, 113, 114])
  assert.deepEqual(dm.schedules[1].lotIds, [121, 122, 123])
})

test('Production deletion maps only a valid persisted activity id', () => {
  assert.deepEqual(toCancelProductionActivityRpc('77'), { p_activity_id: 77 })
  assert.throws(
    () => toCancelProductionActivityRpc('draft'),
    /persisted Production activity/,
  )
})

test('persisted Production rows restore stable schedule ids and date history', () => {
  const activity = {
    id: 77,
    phaseId: 21,
    jobId: 9,
    status: 'ACTIVE',
    supervisorName: 'Persisted Foreman',
    superintendentName: 'Persisted Superintendent',
    notes: 'Persisted group.',
    lotIds: [101, 102],
    stages: [
      {
        type: 'EXT',
        orderMaterial: false,
        schedules: [{
          id: 1001,
          variant: 'BASE',
          date: '2026-09-10',
          dateOwner: 'SUPERVISOR',
          note: 'Current EXT.',
          lotIds: [101, 102],
          followUpState: {
            status: 'CONFIRMED',
            confirmedForDate: '2026-09-10',
            confirmedAt: '2026-09-08T19:00:00Z',
            lastResponseAt: '2026-09-08T19:00:00Z',
            note: 'Confirmed by the Jobsite Superintendent.',
            updatedAt: '2026-09-08T19:00:00Z',
          },
          history: [{
            previousDate: '2026-09-09',
            previousOwner: 'TENTATIVE',
            previousNote: 'Previous EXT.',
            changedAt: '2026-09-08T18:00:00Z',
          }],
        }],
      },
      {
        type: 'DM',
        orderMaterial: false,
        schedules: [{
          id: 1002,
          variant: 'BASE',
          date: '2026-10-08',
          dateOwner: 'TENTATIVE',
          note: '',
          lotIds: [101, 102],
          history: [],
        }],
      },
      {
        type: 'HW',
        orderMaterial: false,
        schedules: [{
          id: 1003,
          variant: 'BASE',
          date: '2026-10-15',
          dateOwner: 'TENTATIVE',
          note: '',
          lotIds: [101, 102],
          history: [],
        }],
      },
    ],
  }
  const jobs = [{
    id: 9,
    code: '1307',
    builder: 'Builder',
    community: 'Community',
    sequenceSheet: {
      phases: [{
        id: 21,
        name: '1',
        building: 'A',
        lots: [
          { id: 101, lotNumber: '1' },
          { id: 102, lotNumber: '2' },
        ],
      }],
    },
  }]

  const draft = toProductionActivityDraft(activity, jobs)
  const events = createProductionCalendarEvents(draft, 'production-77', 77)

  assert.equal(draft.activityId, 77)
  assert.equal(draft.extScheduleId, 1001)
  assert.equal(draft.extDateHistory[0].note, 'Previous EXT.')
  assert.deepEqual(draft.lotIds, [101, 102])
  assert.deepEqual(events.map(({ id }) => id), [
    'production-schedule-1001',
    'production-schedule-1002',
    'production-schedule-1003',
  ])
  assert.equal(events[0].extendedProps.followUp.status, 'CONFIRMED')
  assert.equal(events[0].extendedProps.followUp.confirmedForDate, '2026-09-10')
})

test('a DM baseboard install maps to its own schedule and comes back from the database', () => {
  const draft = {
    ...createPersistableDraft(),
    dmSplitPhase: false,
    dmSplitParts: [],
    dmScheduleId: 1002,
    dmBaseboardInstall: true,
    dmBaseboardInstallDate: '2026-10-12',
    dmBaseboardInstallDateOwner: 'SUPERVISOR',
    dmBaseboardInstallDateNote: 'After paint.',
    dmBaseboardInstallScheduleId: 1005,
  }
  const dm = toProductionActivityRpc(draft).p_stages.find((stage) => stage.type === 'DM')
  const baseboard = dm.schedules.find((schedule) => schedule.variant === 'BASEBOARD_INSTALL')

  assert.deepEqual(dm.schedules.map((schedule) => schedule.variant), ['BASE', 'BASEBOARD_INSTALL'])
  assert.equal(baseboard.id, 1005)
  assert.equal(baseboard.date, '2026-10-12')
  assert.equal(baseboard.dateOwner, 'SUPERVISOR')
  assert.equal(baseboard.note, 'After paint.')
  // It covers every Lot of the activity, like install only does.
  assert.deepEqual(baseboard.lotIds, [101, 102, 103, 104])

  // Not asked for: no such schedule.
  const without = toProductionActivityRpc({ ...draft, dmBaseboardInstall: false })
    .p_stages.find((stage) => stage.type === 'DM')
  assert.equal(without.schedules.some((schedule) => schedule.variant === 'BASEBOARD_INSTALL'), false)

  const activity = {
    id: 77,
    phaseId: 21,
    jobId: 9,
    status: 'ACTIVE',
    lotIds: [101, 102],
    stages: [
      { type: 'EXT', schedules: [{ id: 1, variant: 'BASE', date: '2026-09-10', dateOwner: 'SUPERVISOR', note: '', lotIds: [101, 102], history: [] }] },
      {
        type: 'DM',
        schedules: [
          { id: 2, variant: 'BASE', date: '2026-10-08', dateOwner: 'TENTATIVE', note: '', lotIds: [101, 102], history: [] },
          {
            id: 5,
            variant: 'BASEBOARD_INSTALL',
            date: '2026-10-12',
            dateOwner: 'SUPERVISOR',
            note: 'After paint.',
            lotIds: [101, 102],
            history: [{ previousDate: '2026-10-10', previousOwner: 'TENTATIVE', previousNote: '', changedAt: '2026-10-01T10:00:00Z' }],
          },
        ],
      },
      { type: 'HW', schedules: [{ id: 3, variant: 'BASE', date: '2026-10-15', dateOwner: 'TENTATIVE', note: '', lotIds: [101, 102], history: [] }] },
    ],
  }
  const jobs = [{
    id: 9,
    code: '1307',
    builder: 'Builder',
    community: 'Community',
    sequenceSheet: {
      phases: [{ id: 21, name: '1', building: 'A', lots: [{ id: 101, lotNumber: '1' }, { id: 102, lotNumber: '2' }] }],
    },
  }]
  const restored = toProductionActivityDraft(activity, jobs)

  assert.equal(restored.dmBaseboardInstall, true)
  assert.equal(restored.dmBaseboardInstallDate, '2026-10-12')
  assert.equal(restored.dmBaseboardInstallDateOwner, 'SUPERVISOR')
  assert.equal(restored.dmBaseboardInstallScheduleId, 5)
  assert.equal(restored.dmBaseboardInstallDateHistory[0].date, '2026-10-10')
  // It does not turn into a division or replace the DM date.
  assert.equal(restored.dmSplitPhase, false)
  assert.equal(restored.dmDate, '2026-10-08')
  assert.equal(restored.dmInstallOnly, false)
})
