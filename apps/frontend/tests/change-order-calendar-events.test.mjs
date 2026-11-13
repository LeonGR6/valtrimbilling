import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OWN_EVENT,
  businessDaysLeftText,
  businessDaysText,
  evaluateLots,
  groupEvaluations,
  isCalendarEvent,
  linkedEvents,
  summarizeEvaluations,
  toLotEvent,
  groupLotsByRecord,
  lotEventChooser,
  needsCalendar,
  planEventOf,
  setLotEvents,
} from '../src/features/change-orders/utils/calendarEvents.js'

// Indigo 1295, Phase 2: three buildings, each with its own date for the event.
const row = (lotId, lot, recordId, building) => ({
  lotId: String(lotId), lot: String(lot), recordId: String(recordId), phase: 'Phase 2', building,
})
const rows = [
  row(1, 1, 10, 'Building 1'), row(2, 2, 10, 'Building 1'), row(3, 3, 10, 'Building 1'),
  row(7, 7, 11, 'Building 2'), row(8, 8, 11, 'Building 2'),
  row(14, 14, 12, 'Building 3'),
]
const event = (lotId, type, date, status, extra = {}) => ({
  lotId: String(lotId), type, date, owner: 'SUPERVISOR', status, businessDays: 0, ...extra,
})
const events = [
  event(1, 'DM', '2026-12-01', 'AVAILABLE'), event(2, 'DM', '2026-12-01', 'AVAILABLE'),
  event(3, 'DM', '2026-12-08', 'AVAILABLE'),
  event(7, 'DM', '2026-11-09', 'TOO_CLOSE', { businessDays: 2 }), event(8, 'DM', '2026-11-09', 'TOO_CLOSE', { businessDays: 2 }),
  event(14, 'DM', '2026-08-27', 'PASSED'),
  event(1, 'EXT', '2026-06-22', 'PASSED'),
]

test('the rows of the database become events with the lot id as text', () => {
  assert.deepEqual(toLotEvent({
    lot_id: 41, event_type: 'DM', event_date: '2026-09-22', date_owner: 'TENTATIVE',
    event_status: 'TOO_CLOSE', business_days: 3,
  }), { lotId: '41', type: 'DM', date: '2026-09-22', owner: 'TENTATIVE', status: 'TOO_CLOSE', businessDays: 3 })
  assert.equal(toLotEvent({ lot_id: 1, event_type: 'HW', event_date: '2026-10-09', event_status: 'PASSED' }).owner, '')
})

test('EXT, DM and HW are Calendar events; "Own CO event" is not', () => {
  for (const value of ['EXT', 'DM', 'HW']) assert.equal(isCalendarEvent(value), true, value)
  for (const value of [OWN_EVENT, 'SHUTTER', '', undefined]) assert.equal(isCalendarEvent(value), false, String(value))
  assert.equal(OWN_EVENT, 'NONE')
})

test('with "Own CO event" every lot needs an event of its own and none is tied', () => {
  const evaluations = evaluateLots(rows, { chargeEvent: OWN_EVENT, events })
  assert.equal(evaluations.length, 6)
  assert.equal(evaluations.every((item) => item.status === 'OWN' && !item.linked && item.event === OWN_EVENT), true)
  assert.deepEqual(linkedEvents(evaluations), {})
  assert.deepEqual(summarizeEvaluations(evaluations), { total: 6, linked: 0, own: 6 })
})

test('each lot is evaluated for the event chosen: far away can be charged, close or gone cannot', () => {
  const byLot = Object.fromEntries(
    evaluateLots(rows, { chargeEvent: 'DM', events }).map((item) => [item.row.lotId, item]),
  )

  assert.deepEqual([byLot[1].status, byLot[1].linked, byLot[1].date], ['AVAILABLE', true, '2026-12-01'])
  assert.deepEqual([byLot[7].status, byLot[7].linked, byLot[7].businessDays], ['TOO_CLOSE', false, 2])
  assert.deepEqual([byLot[14].status, byLot[14].linked], ['PASSED', false])
})

test('a lot with no such event on the Calendar is "not scheduled" and is not tied', () => {
  // Only Lot 1 has an EXT event, and it has passed; the rest have none.
  const byLot = Object.fromEntries(
    evaluateLots(rows, { chargeEvent: 'EXT', events }).map((item) => [item.row.lotId, item]),
  )

  assert.deepEqual([byLot[1].status, byLot[1].linked], ['PASSED', false])
  assert.deepEqual([byLot[2].status, byLot[2].linked, byLot[2].date], ['NOT_SCHEDULED', false, ''])
  assert.equal(evaluateLots(rows, { chargeEvent: 'HW', events }).every((item) => item.status === 'NOT_SCHEDULED'), true)
})

test('only the lots that are far enough are sent as charged with the event', () => {
  const evaluations = evaluateLots(rows, { chargeEvent: 'DM', events })

  assert.deepEqual(linkedEvents(evaluations), { 1: 'DM', 2: 'DM', 3: 'DM' })
  assert.deepEqual(summarizeEvaluations(evaluations), { total: 6, linked: 3, own: 3 })
})

test('a tie saved before is kept when its date has since moved close or gone, and is sent again', () => {
  const savedLinks = {
    7: { event: 'DM', date: '2026-11-20' },
    14: { event: 'DM', date: '2026-08-27' },
    8: { event: 'HW', date: '2026-11-20' },
  }
  const byLot = Object.fromEntries(
    evaluateLots(rows, { chargeEvent: 'DM', events, savedLinks }).map((item) => [item.row.lotId, item]),
  )

  assert.deepEqual([byLot[7].linked, byLot[7].kept, byLot[7].status], [true, true, 'TOO_CLOSE'])
  assert.deepEqual([byLot[14].linked, byLot[14].kept, byLot[14].status], [true, true, 'PASSED'])
  // A tie to another event is not a tie to this one.
  assert.deepEqual([byLot[8].linked, byLot[8].kept], [false, false])
  // A lot that can be charged is not "kept": it is just available.
  assert.deepEqual([byLot[1].linked, byLot[1].kept], [true, false])
})

test('a saved tie whose event left the Calendar is kept with the date it had', () => {
  const [lot] = evaluateLots([row(5, 5, 10, 'Building 1')], {
    chargeEvent: 'DM',
    events,
    savedLinks: { 5: { event: 'DM', date: '2026-09-22' } },
  })

  assert.deepEqual([lot.status, lot.linked, lot.kept, lot.date], ['NOT_SCHEDULED', true, true, '2026-09-22'])
})

test('lots are grouped by Phase / Building, and by date inside it, with their ranges', () => {
  const groups = groupEvaluations(evaluateLots(rows, { chargeEvent: 'DM', events }))

  assert.deepEqual(groups.map((group) => group.label), [
    'Phase 2, Building 1', 'Phase 2, Building 2', 'Phase 2, Building 3',
  ])
  // Building 1 has the event on two dates: each with its own lots, earliest first.
  assert.deepEqual(groups[0].parts.map((part) => [part.date, part.lotText, part.status]), [
    ['2026-12-01', '1, 2', 'AVAILABLE'],
    ['2026-12-08', '3', 'AVAILABLE'],
  ])
  assert.deepEqual(groups[1].parts.map((part) => [part.lotText, part.status, part.businessDays]), [['7, 8', 'TOO_CLOSE', 2]])
  assert.deepEqual(groups[2].parts.map((part) => [part.lotText, part.status]), [['14', 'PASSED']])
})

test('three or more whole lots in a row read as a range, and lots with no date come last', () => {
  const many = Array.from({ length: 6 }, (_, index) => row(index + 1, index + 1, 10, 'Building 1'))
  const manyEvents = [1, 2, 3, 4].map((id) => event(id, 'DM', '2026-12-01', 'AVAILABLE'))
  const [group] = groupEvaluations(evaluateLots(many, { chargeEvent: 'DM', events: manyEvents }))

  assert.deepEqual(group.parts.map((part) => [part.lotText, part.status, part.count]), [
    ['1–4', 'AVAILABLE', 4],
    ['5, 6', 'NOT_SCHEDULED', 2],
  ])
})

test('business days are said in singular and plural', () => {
  assert.equal(businessDaysText(1), '1 business day')
  assert.equal(businessDaysText(3), '3 business days')
  assert.equal(businessDaysText(0), '0 business days')
})

test('what is left before a close event is said in business days', () => {
  assert.equal(businessDaysLeftText(3), '3 business days left')
  assert.equal(businessDaysLeftText(1), '1 business day left')
  assert.equal(businessDaysLeftText(0), 'No business days left')
})

test('a Lot follows its own event, else its Plan (Specific Plan Types only), else the one for every Lot', () => {
  const planRows = [
    { lotId: '1', planId: '7' }, { lotId: '2', planId: '7' }, { lotId: '3', planId: '8' }, { lotId: '4', planId: null },
  ]
  const values = {
    chargeEvent: 'DM',
    eventByLot: { 2: 'HW' },
    planRules: { 7: { scope: 'x', amount: '1', event: 'EXT' }, 8: { scope: 'y', amount: '1' } },
  }
  const byPlan = lotEventChooser({ ...values, coverageMode: 'plans' })
  assert.deepEqual(planRows.map(byPlan), ['EXT', 'HW', 'DM', 'DM'])
  // The Plans only count with Specific Plan Types.
  const byLot = lotEventChooser({ ...values, coverageMode: 'lots' })
  assert.deepEqual(planRows.map(byLot), ['DM', 'HW', 'DM', 'DM'])
  assert.equal(lotEventChooser()(planRows[0]), OWN_EVENT)
  assert.equal(planEventOf(values.planRules, '7', 'DM'), 'EXT')
  assert.equal(planEventOf(values.planRules, '8', 'DM'), 'DM')
})

test('each lot is evaluated with its own event, and mixed choices are sent each with its event', () => {
  const chosen = { 1: 'DM', 2: OWN_EVENT, 7: 'DM', 14: 'EXT' }
  const evaluations = evaluateLots(rows, { eventOf: (row) => chosen[row.lotId] ?? OWN_EVENT, events })
  const byLot = Object.fromEntries(evaluations.map((item) => [item.row.lotId, item]))

  assert.deepEqual([byLot[1].event, byLot[1].status, byLot[1].linked], ['DM', 'AVAILABLE', true])
  assert.deepEqual([byLot[2].event, byLot[2].status, byLot[2].linked], [OWN_EVENT, 'OWN', false])
  assert.deepEqual([byLot[7].status, byLot[7].linked], ['TOO_CLOSE', false])
  // Lot 14 has no EXT event: its PASSED DM does not count for EXT.
  assert.deepEqual([byLot[14].event, byLot[14].status], ['EXT', 'NOT_SCHEDULED'])
  assert.deepEqual(linkedEvents(evaluations), { 1: 'DM' })
  assert.equal(needsCalendar(rows, (row) => chosen[row.lotId] ?? OWN_EVENT), true)
  assert.equal(needsCalendar(rows, () => OWN_EVENT), false)
})

test('a Lot set to what it follows anyway keeps nothing of its own', () => {
  const followed = () => 'DM'
  assert.deepEqual(setLotEvents({ 1: 'HW', 2: 'EXT' }, ['1', '3'], 'DM', followed), { 2: 'EXT' })
  assert.deepEqual(setLotEvents({}, ['1', '3'], OWN_EVENT, followed), { 1: OWN_EVENT, 3: OWN_EVENT })
})

test('lots are listed one by one by Phase / Building, with the event they all share or none', () => {
  const evaluations = evaluateLots(rows, { eventOf: (row) => (row.lotId === '8' ? OWN_EVENT : 'DM'), events })
  const groups = groupLotsByRecord(evaluations)
  assert.deepEqual(groups.map((group) => [group.label, group.items.length, group.event]), [
    ['Phase 2, Building 1', 3, 'DM'],
    ['Phase 2, Building 2', 2, ''],
    ['Phase 2, Building 3', 1, 'DM'],
  ])
})
