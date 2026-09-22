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
