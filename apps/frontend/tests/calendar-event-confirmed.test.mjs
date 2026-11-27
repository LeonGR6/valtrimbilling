import test from 'node:test'
import assert from 'node:assert/strict'
import {
  confirmedMark,
  createDraftFromProductionEvent,
  createEmptyProductionDraft,
  createProductionCalendarEvents,
  getMonthEventLabel,
} from '../src/features/calendar/data/calendarEvents.js'
import { toProductionActivityRpc } from '../src/features/calendar/services/productionActivityRecord.js'
import { removeExtraEventFromDraft } from '../src/features/calendar/utils/calendarExtraEvents.js'
import {
  confirmedChanged,
  toCalendarEvent,
  toChangeOrderEvent,
} from '../src/features/change-orders/services/changeOrderEventRecord.js'

function draft(overrides = {}) {
  return {
    ...createEmptyProductionDraft('2026-09-10'),
    activityId: 7,
    jobId: 9,
    phaseId: 21,
    jobCode: '1319',
    builder: 'G3',
    community: 'EL MONTE',
    phase: 'Phase 1',
    building: 'Building 2',
    lotStart: 1,
    lotEnd: 2,
    lotNumbers: ['1', '2'],
    lotIds: [101, 102],
    dmDate: '2026-10-08',
    hwDate: '2026-10-15',
    ...overrides,
  }
}

const stageSchedules = (payload, type) => payload.p_stages.find((stage) => stage.type === type).schedules

test('a confirmed event has "* " before its name; any other has nothing', () => {
  assert.equal(confirmedMark({ confirmed: true }), '* ')
  assert.equal(confirmedMark({ confirmed: false }), '')
  assert.equal(confirmedMark(undefined), '')
})

test('the Month label starts with "* " for a confirmed Production or Extra / CO event', () => {
  const props = {
    activityType: 'HW', community: 'EL MONTE', phase: 'Phase 1', building: 'Building 2',
    lotStart: 1, lotEnd: 2, lotNumbers: ['1', '2'], variant: 'base',
  }
  assert.match(getMonthEventLabel({ ...props, confirmed: true }), /^\* EL MONTE · /)
  assert.match(getMonthEventLabel(props), /^EL MONTE · /)

  const co = { activityType: 'CHANGE_ORDER', community: 'EL MONTE', lotsText: 'Lots 1–2', changeOrderNumber: 'CO-0001' }
  assert.equal(getMonthEventLabel({ ...co, confirmed: true }), '* EL MONTE · Lots 1–2 · CO-0001')
})

test('each event is sent with its own Confirmed, the extra events and divisions too', () => {
  const payload = toProductionActivityRpc(draft({
    extConfirmed: true,
    hwLockUp: true,
    hwLockUpDate: '2026-10-16',
    hwLockUpConfirmed: true,
    dmSplitPhase: true,
    dmSplitParts: [
      { id: 'a', lotStart: 1, lotEnd: 1, date: '2026-10-08', dateOwner: '', note: '', confirmed: true },
      { id: 'b', lotStart: 2, lotEnd: 2, date: '2026-10-09', dateOwner: '', note: '' },
    ],
  }))

  assert.deepEqual(stageSchedules(payload, 'EXT').map((item) => item.confirmed), [true])
  assert.deepEqual(stageSchedules(payload, 'DM').map((item) => item.confirmed), [true, false])
  assert.deepEqual(
    stageSchedules(payload, 'HW').map((item) => [item.variant, item.confirmed]),
    [['BASE', false], ['LOCK_UP', true]],
  )
})

test('each Calendar event carries its own Confirmed, and opening one keeps them all', () => {
  const values = draft({ hwConfirmed: true, hwWeatherstripping: true, hwWeatherstrippingDate: '2026-10-19' })
  const events = createProductionCalendarEvents(values, 'group-1', 1)
  const byTitle = Object.fromEntries(events.map((event) => [event.title.split(' •')[0], event.extendedProps.confirmed]))

  assert.equal(byTitle['Hardware'], true)
  assert.equal(byTitle['Hardware WEATHERSTRIPPING'], false)
  assert.equal(byTitle['EXT FRAMES'], false)

  const reopened = createDraftFromProductionEvent(events[0])
  assert.equal(reopened.hwConfirmed, true)
  assert.equal(reopened.hwWeatherstrippingConfirmed, false)
})

test('taking an extra event off clears its Confirmed', () => {
  const next = removeExtraEventFromDraft(
    draft({ hwLockUp: true, hwLockUpDate: '2026-10-16', hwLockUpConfirmed: true }),
    'lock-up',
    'HW',
  )
  assert.equal(next.hwLockUpConfirmed, false)
})

test('an Extra / CO event reads its Confirmed and shows it on the Calendar', () => {
  const event = toChangeOrderEvent({
    id: 4, change_order_id: 2, change_order_number: 'CO-0001', job_id: 9, job_code: '1319',
    scheduled_date: '2026-12-01', is_confirmed: true, lots: [],
  })
  assert.equal(event.confirmed, true)
  assert.equal(toCalendarEvent(event).extendedProps.confirmed, true)

  assert.equal(confirmedChanged(null, false), false)
  assert.equal(confirmedChanged(null, true), true)
  assert.equal(confirmedChanged(event, true), false)
  assert.equal(confirmedChanged(event, false), true)
})
