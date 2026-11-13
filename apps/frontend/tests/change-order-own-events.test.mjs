import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calendarEventId,
  calendarEventPath,
  canScheduleChangeOrderEvents,
  describeEventLots,
  eventCreatedNotice,
  eventProblems,
  isSchedulable,
  linesNeedingEvent,
  lotsByPlace,
  parseCalendarEventParam,
  toCalendarEvent,
  toChangeOrderEvent,
  toCreateEventRpc,
  toUpdateEventRpc,
  todayKey,
} from '../src/features/change-orders/services/changeOrderEventRecord.js'

const overviewRow = (extra = {}) => ({
  id: 9,
  change_order_id: 5,
  change_order_number: 'CO-0005',
  po_co_number: '1277447-000',
  change_order_status: 'APPROVED',
  job_id: 3,
  job_code: '1295',
  community: 'Indigo',
  builder_id: 2,
  builder_name: 'Olson',
  scheduled_date: '2026-11-26',
  note: 'Bring the ladder',
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
  lots: [
    { line_id: 101, lot_id: 11, phase_code: '2', building: '1', lot_number: '1', plan_code: 'A', scope_of_work: 'Attic ladder' },
    { line_id: 102, lot_id: 12, phase_code: '2', building: '1', lot_number: '2', plan_code: 'A', scope_of_work: 'Attic ladder' },
    { line_id: 103, lot_id: 13, phase_code: '2', building: '1', lot_number: '3', plan_code: 'B', scope_of_work: 'Attic ladder' },
  ],
  ...extra,
})

test('only Admin, Project Management and Scheduling schedule, and only an approved Extra / CO', () => {
  for (const role of ['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING']) assert.equal(canScheduleChangeOrderEvents(role), true, role)
  for (const role of ['ACCOUNTING', 'DRAW_INVOICE', 'READ_ONLY', 'FIELD', undefined]) {
    assert.equal(canScheduleChangeOrderEvents(role), false, String(role))
  }
  assert.equal(isSchedulable('APPROVED'), true)
  for (const status of ['DRAFT', 'PENDING', 'CANCELLED']) assert.equal(isSchedulable(status), false, status)
})

test('a row of the overview is read with its Lots', () => {
  const event = toChangeOrderEvent(overviewRow())
  assert.equal(event.changeOrderNumber, 'CO-0005')
  assert.equal(event.date, '2026-11-26')
  assert.deepEqual(event.lots[0], { lineId: 101, lotId: 11, phase: '2', building: '1', lot: '1', plan: 'A', scope: 'Attic ladder' })
  assert.equal(toChangeOrderEvent(overviewRow({ note: null, lots: null })).note, '')
  assert.deepEqual(toChangeOrderEvent(overviewRow({ lots: null })).lots, [])
})

test('the Lots read by Phase / Building, with their ranges', () => {
  const event = toChangeOrderEvent(overviewRow())
  assert.equal(describeEventLots(event.lots), 'Phase 2, Building 1: Lots 1–3')
  const mixed = [...event.lots, { phase: '3', building: '', lot: '7' }]
  assert.deepEqual(lotsByPlace(mixed), [
    { place: 'Phase 2, Building 1', lots: '1–3', count: 3 },
    { place: 'Phase 3', lots: '7', count: 1 },
  ])
  assert.equal(describeEventLots(mixed), 'Phase 2, Building 1: Lots 1–3 · Phase 3: Lot 7')
})

test('a Lot needs an event of its own when it is not tied to EXT, DM or HW and is in no event yet', () => {
  const lines = [
    { id: 101, isPlace: false, lot: '1', billingEvent: null },
    { id: 102, isPlace: false, lot: '2', billingEvent: 'DM' },
    { id: 103, isPlace: false, lot: '3', billingEvent: null },
    { id: 104, isPlace: true, lot: '', billingEvent: null },
  ]
  const events = [{ lots: [{ lineId: 101 }] }]
  assert.deepEqual(linesNeedingEvent(lines, events).map((line) => line.id), [103])
  assert.deepEqual(linesNeedingEvent(lines, []).map((line) => line.id), [101, 103])
})

test('an event needs Lots, a date not before today and a note up to 500 characters', () => {
  const today = '2026-11-12'
  assert.deepEqual(eventProblems({ date: '', note: '', lineIds: [] }, { today }).map((p) => p.field), ['lines', 'date'])
  assert.deepEqual(eventProblems({ date: '2026-11-11', note: '', lineIds: ['1'] }, { today }).map((p) => p.message), [
    'The date cannot be before today.',
  ])
  assert.deepEqual(eventProblems({ date: today, note: 'x'.repeat(501), lineIds: ['1'] }, { today }).map((p) => p.field), ['note'])
  assert.deepEqual(eventProblems({ date: today, note: '', lineIds: ['1'] }, { today }), [])
  // Changing one: no Lots are asked, and a date already saved may stay in the past.
  assert.deepEqual(eventProblems({ date: '2026-11-01', note: '' }, { creating: false, today, savedDate: '2026-11-01' }), [])
  assert.equal(eventProblems({ date: '2026-11-02', note: '' }, { creating: false, today, savedDate: '2026-11-01' }).length, 1)
})

test('the arguments of the database functions', () => {
  assert.deepEqual(toCreateEventRpc('5', { date: '2026-11-26', note: '  Ladder ', lineIds: ['101', '103'] }), {
    p_change_order_id: 5, p_scheduled_date: '2026-11-26', p_line_ids: [101, 103], p_note: 'Ladder',
  })
  assert.deepEqual(toUpdateEventRpc(9, { date: '2026-11-27', note: '   ' }), {
    p_event_id: 9, p_scheduled_date: '2026-11-27', p_note: null,
  })
})

test('what is said once it is created, and the link to the Calendar', () => {
  const event = toChangeOrderEvent(overviewRow())
  assert.equal(
    eventCreatedNotice(event),
    'CO event created for Phase 2, Building 1: Lots 1–3 on Thu, Nov 26, 2026. It is on the Production Calendar.',
  )
  assert.equal(calendarEventPath(9), '/calendar?coEvent=9')
  assert.equal(parseCalendarEventParam('9'), 9)
  assert.equal(parseCalendarEventParam('x9'), null)
  assert.equal(parseCalendarEventParam(null), null)
  assert.equal(todayKey(new Date(2026, 0, 5)), '2026-01-05')
})

test('on the Calendar it is a green all-day event that cannot be dragged and the filters can read', () => {
  const calendarEvent = toCalendarEvent(toChangeOrderEvent(overviewRow()))
  assert.equal(calendarEvent.id, calendarEventId(9))
  assert.equal(calendarEvent.start, '2026-11-26')
  assert.equal(calendarEvent.allDay, true)
  assert.equal(calendarEvent.startEditable, false)
  assert.deepEqual(
    [calendarEvent.extendedProps.activityType, calendarEvent.extendedProps.builder, calendarEvent.extendedProps.community,
      calendarEvent.extendedProps.jobId, calendarEvent.extendedProps.phase, calendarEvent.extendedProps.building],
    ['CHANGE_ORDER', 'Olson', 'Indigo', 3, 'Phase 2', 'Building 1'],
  )
  // Lots in several places: no single Phase / Building.
  const spread = toCalendarEvent(toChangeOrderEvent(overviewRow({
    lots: [...overviewRow().lots, { line_id: 104, lot_id: 14, phase_code: '3', building: null, lot_number: '7' }],
  })))
  assert.deepEqual([spread.extendedProps.phase, spread.extendedProps.building], ['', ''])
  assert.equal(spread.extendedProps.lotsText, 'Phase 2, Building 1: Lots 1–3 · Phase 3: Lot 7')
})
