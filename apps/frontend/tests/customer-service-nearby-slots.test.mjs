import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import { applyAppointmentsToRequests, toPlanningTechnicians } from '../src/features/customer-service/utils/appointmentRecords.js'
import { californiaInstant } from '../src/features/customer-service/utils/customerServiceScheduling.js'
import {
  businessDaysLeft, deadlineLabel, earliestAvailableSlot, finalDaysSlot, insertionDetails, nearbySlotSuggestions,
  suggestionLegsToCheck, technicianSets,
} from '../src/features/customer-service/utils/nearbySlotSuggestions.js'
import {
  fitStatus, fitStatusLabels, validatePrototypeProposalDraft,
} from '../src/features/customer-service/utils/proposalDraft.js'

const roster = [
  { id: 4, name: 'Jorge Murillo', isActive: true },
  { id: 5, name: 'Helper', isActive: true },
]
const technicians = toPlanningTechnicians(roster)
const mockConfirmed = customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'CONFIRMED')
const confirmed = (id) => {
  const request = { ...mockConfirmed, id, requestNumber: `SR-${id}` }
  delete request.technicianIds
  delete request.customerWindow
  delete request.internalSlot
  return request
}
// 60 minutes, one person, medium priority.
const ready = {
  ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE'),
  id: 20, requestNumber: 'SR-20', customerUnavailableDates: [], dueOn: '2026-11-13', priority: 'MEDIUM',
  updatedAt: '2026-11-05T10:00:00Z',
}
// 30 minutes: after SR-10 the 8:00–10:00 window still leaves more than the 15-minute margin.
const quick = { ...ready, estimatedDurationMinutes: 30 }
// Friday 6 Nov 2026, 9:00 AM in California.
const now = new Date('2026-11-06T17:00:00Z')

const at = (date, time) => californiaInstant(date, time).toISOString()
const appointment = (requestId, technicianIds, date, windowStart, windowEnd, workStart, workEnd) => ({
  id: requestId, request_id: requestId, technician_ids: technicianIds,
  window_starts_at: at(date, windowStart), window_ends_at: at(date, windowEnd),
  starts_at: at(date, workStart), ends_at: at(date, workEnd), pickup_minutes: 10,
  state: 'SCHEDULED', acceptance: 'CUSTOMER_ACCEPTED_PROPOSAL', updated_at: '2026-11-05T11:00:00Z',
})
// Monday 9 Nov: Jorge has SR-10 at 8:00–8:30 and SR-11 at 10:30–11:15.
const monday = [
  appointment(10, [4], '2026-11-09', '08:00', '10:00', '08:00', '08:30'),
  appointment(11, [4], '2026-11-09', '10:00', '12:00', '10:30', '11:15'),
]
const visit = (requestId, date, start, technicianIds = ['4']) => ({
  kind: 'VISIT', requestId: String(requestId), requestNumber: `SR-${requestId}`, date, start, technicianIds,
})
const nearMonday = [visit(10, '2026-11-09', '08:00'), visit(11, '2026-11-09', '10:30')]

function plan({ request = ready, appointments = monday, extraRequests = [], candidates = nearMonday, drivingById, travelMinutes = {} }) {
  const requests = applyAppointmentsToRequests(
    [confirmed(10), confirmed(11), ...extraRequests, request], appointments, roster,
  )
  return {
    requests,
    result: nearbySlotSuggestions({ request, requests, technicians, candidates, drivingById, travelMinutes, now }),
  }
}

test('technician combinations of the crew size, in roster order', () => {
  assert.deepEqual(technicianSets(['4', '5', '6'], 1), [['4'], ['5'], ['6']])
  assert.deepEqual(technicianSets(['4', '5', '6'], 2), [['4', '5'], ['4', '6'], ['5', '6']])
  assert.deepEqual(technicianSets(['4'], 2), [])
  assert.equal(technicianSets(Array.from({ length: 12 }, (_, index) => String(index)), 3).length, 30)
})

test('the request goes right after the nearby visit with its technician and the extra driving it adds', () => {
  const { requests, result } = plan({
    request: quick,
    drivingById: { 10: { drivingMiles: 2, band: 'GREEN' }, 11: { drivingMiles: 12, band: 'ORANGE' } },
    // SR-10 → SR-20 5 min, SR-20 → SR-11 15 min, and SR-10 → SR-11 was 12 min.
    travelMinutes: { '10>20': 5, '20>11': 15, '10>11': 12 },
  })
  // Only Near or Medium visits are used: SR-11 is Far.
  assert.equal(result.suggestions.length, 1)
  const [slot] = result.suggestions
  assert.deepEqual(
    [slot.anchor.requestNumber, slot.fits, slot.date, slot.windowStart, slot.internalStart, slot.internalEnd, slot.pickupEnd],
    ['SR-10', true, '2026-11-09', '08:00', '08:45', '09:15', '09:25'],
  )
  assert.deepEqual(slot.technicianNames, ['Jorge Murillo'])
  assert.equal(slot.extraMinutes, 8) // 5 + 15 − 12
  // It can start 35 min late: work and pickup until 9:25, and the 10:00 window closes.
  assert.equal(slot.margin, 35)
  assert.equal(slot.travelPending, false)
  assert.equal(slot.warning, null)
  assert.deepEqual(slot.travelLegs.map((leg) => leg.key), ['10>20', '20>11'])

  // Using it is a normal valid draft for the same rules the server applies.
  const values = {
    technicianIds: slot.technicianIds, date: slot.date, windowStart: slot.windowStart, internalStart: slot.internalStart,
    travelMinutes: { '10>20': 5, '20>11': 15 },
  }
  assert.equal(validatePrototypeProposalDraft({ requestId: 20, values, requests, technicians, now }).isValid, true)

  // The earliest slot is always shown too: Friday 9:05 (it is 9:00) with the first free technician.
  assert.deepEqual(
    [result.earliest.date, result.earliest.internalStart, result.earliest.technicianNames],
    ['2026-11-06', '09:05', ['Jorge Murillo']],
  )
})

test('a slot whose travel is still unknown fits with pending travel and no extra minutes yet', () => {
  const { result } = plan({ request: quick, drivingById: { 10: { drivingMiles: 0, band: 'GREEN' } } })
  const [slot] = result.suggestions
  assert.equal(slot.fits, true)
  // Right when SR-10's pickup ends; the leg is still unknown.
  assert.equal(slot.internalStart, '08:40')
  assert.equal(slot.travelPending, true)
  assert.equal(slot.extraMinutes, null)
  assert.equal(slot.margin, null)
})

test('a drive that leaves no room next to the nearby visit does not fit', () => {
  const { result } = plan({
    drivingById: { 10: { drivingMiles: 9, band: 'YELLOW' } },
    travelMinutes: { '10>20': 25, '20>11': 15, '10>11': 12 },
  })
  // Leaves SR-10 at 8:40, 25 min of driving: 9:05, but work plus pickup must end by 10:00.
  assert.equal(result.suggestions[0].fits, false)
})

test('a slot with less than 15 minutes of margin is not offered, and the row says how tight it was', () => {
  // 60 minutes after SR-10: 8:45–9:45, pickup until 9:55, and the window closes at 10:00.
  const { requests, result } = plan({
    drivingById: { 10: { drivingMiles: 2, band: 'GREEN' } },
    travelMinutes: { '10>20': 5, '20>11': 15, '10>11': 12 },
  })
  const [slot] = result.suggestions
  assert.deepEqual([slot.fits, slot.tightMargin], [false, 5])

  // Typed by hand it is still a valid draft, with a warning that does not block.
  const values = { technicianIds: ['4'], date: '2026-11-09', windowStart: '08:00', internalStart: '08:45', travelMinutes: { '10>20': 5, '20>11': 15 } }
  const draft = validatePrototypeProposalDraft({ requestId: 20, values, requests, technicians, now })
  assert.equal(draft.isValid, true)
  assert.equal(draft.delay.margin, 5)
  assert.deepEqual(draft.warnings.filter((warning) => warning.field === 'margin').map((warning) => warning.message), [
    'This visit can start only 5 min late before it or a later visit leaves its customer window. Suggestions keep at least 15 min.',
  ])
})

test('between two slots with the same extra driving, a tight one gives way to one with margin', () => {
  // Like CS-2497 on Thursday: SR-10 is 10:00–10:45 in the 10:00–12:00 window, 8 min away.
  const { result } = plan({
    request: quick,
    appointments: [appointment(10, [4], '2026-11-09', '10:00', '12:00', '10:00', '10:45')],
    candidates: [visit(10, '2026-11-09', '10:00')],
    drivingById: { 10: { drivingMiles: 3, band: 'GREEN' } },
    travelMinutes: { '10>20': 8 },
  })
  // It arrives at 11:03. With starts every 5 minutes (P3, 12 Nov 2026) 11:05 keeps exactly
  // 15 min of margin and is offered; 11:15 would keep only 5 and is not.
  const [slot] = result.suggestions
  assert.deepEqual([slot.fits, slot.windowStart, slot.internalStart, slot.extraMinutes, slot.margin], [true, '10:00', '11:05', 8, 15])
})

test('the margins of the day and how much extra driving each leg absorbs', () => {
  const requests = applyAppointmentsToRequests([confirmed(10), confirmed(11), quick], monday, roster)
  const values = { technicianIds: ['4'], date: '2026-11-09', windowStart: '08:00', internalStart: '08:45', travelMinutes: { '10>20': 5, '20>11': 15 } }
  const { delay } = validatePrototypeProposalDraft({ requestId: 20, values, requests, technicians, now })
  // SR-20 ends with pickup at 9:25 (35 min before 10:00); SR-11 ends at 11:25 (35 before 12:00).
  assert.deepEqual(delay, {
    margin: 35,
    ownSlack: 35,
    entryMargins: { '10-4': 35, '11-4': 35 },
    legAbsorbs: { '10>20': 35, '20>11': 85 },
  })
  // Without the leg to SR-11 the margin is unknown; the own slack still bounds it.
  const pending = validatePrototypeProposalDraft({
    requestId: 20, values: { ...values, travelMinutes: { '10>20': 5 } }, requests, technicians, now,
  })
  assert.deepEqual([pending.delay.margin, pending.delay.ownSlack], [null, 35])
})

test('the three nearest Near or Medium visits are used, nearest first', () => {
  const candidates = [
    visit(10, '2026-11-09', '08:00'), visit(11, '2026-11-09', '10:30'),
    visit(12, '2026-11-10', '08:00'), visit(13, '2026-11-11', '08:00'),
  ]
  const { result } = plan({
    candidates,
    drivingById: {
      10: { drivingMiles: 4, band: 'GREEN' }, 11: { drivingMiles: 9, band: 'YELLOW' },
      12: { drivingMiles: 1, band: 'GREEN' }, 13: { drivingMiles: 3, band: 'GREEN' },
    },
  })
  assert.deepEqual(result.suggestions.map((slot) => slot.anchor.requestNumber), ['SR-12', 'SR-13', 'SR-10'])
})

test('a crew of two adds a free technician with a warning, and nobody free means no suggestion', () => {
  const pair = { ...quick, crewSize: 2 }
  const { result } = plan({ request: pair, drivingById: { 10: { drivingMiles: 2, band: 'GREEN' } } })
  const [slot] = result.suggestions
  assert.equal(slot.fits, true)
  assert.deepEqual(slot.technicianNames, ['Jorge Murillo', 'Helper'])
  assert.equal(slot.warning, 'Needs a second technician: Helper is available that day.')

  // Helper is busy all Monday morning: no second person, no suggestion.
  const busy = plan({
    request: pair,
    extraRequests: [confirmed(14)],
    appointments: [...monday, appointment(14, [5], '2026-11-09', '08:00', '10:00', '08:00', '09:50')],
    drivingById: { 10: { drivingMiles: 2, band: 'GREEN' } },
  })
  assert.equal(busy.result.suggestions[0].fits, false)
})

test('a high priority request follows the same rules as any other request (D3, 10 Nov 2026)', () => {
  const urgent = { ...quick, priority: 'HIGH' }
  const { result } = plan({ request: urgent, drivingById: { 10: { drivingMiles: 2, band: 'GREEN' } } })
  // Friday is free, but it still groups next to the nearby visit on Monday.
  assert.equal(result.earliest.date, '2026-11-06')
  const [slot] = result.suggestions
  assert.deepEqual([slot.fits, slot.date, slot.internalStart], [true, '2026-11-09', '08:40'])
  // And its final days are the due date, Friday 13.
  assert.equal(result.finalDays.date, '2026-11-13')
})

test('the earliest slot considers every technician of the crew size', () => {
  // Jorge is busy Friday 10:00–10:30; Helper is free at 10:00.
  const requests = applyAppointmentsToRequests(
    [confirmed(12), ready], [appointment(12, [4], '2026-11-06', '10:00', '12:00', '10:00', '10:30')], roster,
  )
  const earliest = earliestAvailableSlot({ request: ready, requests, technicians, now })
  assert.deepEqual([earliest.date, earliest.internalStart, earliest.technicianNames], ['2026-11-06', '10:00', ['Helper']])
})

test('the extra driving compares with the direct drive it replaces, at the same departure', () => {
  // SR-10 → SR-20 → SR-11 for Jorge, leaving SR-10 at 8:40 AM on Monday 9 Nov.
  const departure = at('2026-11-09', '08:40')
  const validation = {
    travelLegs: [
      { key: '10>20', fromRequestId: '10', toRequestId: '20', fromLabel: 'SR-10', toLabel: 'SR-20', minutes: 5, technicianNames: ['Jorge Murillo'], departureAt: departure },
      { key: '20>11', fromRequestId: '20', toRequestId: '11', fromLabel: 'SR-20', toLabel: 'SR-11', minutes: 15, technicianNames: ['Jorge Murillo'], departureAt: at('2026-11-09', '09:25') },
    ],
  }
  const details = (travelMinutes) => insertionDetails({
    validation, requestId: '20', anchorId: '10', technicianName: 'Jorge Murillo', travelMinutes,
  })
  // The direct drive SR-10 → SR-11 leaves at the same 8:40 AM as SR-10 → SR-20.
  const saved = details({ '10>11': 12 })
  assert.deepEqual(saved.baselineLeg, {
    key: '10>11', fromRequestId: '10', toRequestId: '11', fromLabel: 'SR-10', toLabel: 'SR-11',
    technicianNames: ['Jorge Murillo'], minutes: 12, departureAt: departure,
  })
  assert.equal(saved.extraMinutes, 8) // 5 + 15 − 12
  // With traffic at 8:40 the direct drive takes 18: the visit adds only 2 minutes.
  assert.equal(details({ '10>11': 18 }).extraMinutes, 2)
  // Unknown direct drive: unknown extra minutes, never a guess.
  const unknown = details({})
  assert.deepEqual([unknown.extraMinutes, unknown.baselineLeg.minutes], [null, null])
  // At the end of the day there is no direct drive to replace.
  const last = insertionDetails({
    validation: { travelLegs: [validation.travelLegs[0]] }, requestId: '20', anchorId: '10', technicianName: 'Jorge Murillo',
  })
  assert.deepEqual([last.extraMinutes, last.baselineLeg], [5, null])
})

test('the suggestion legs, the direct drive and the earliest slot legs are checked once each', () => {
  const { result } = plan({
    request: quick,
    drivingById: { 10: { drivingMiles: 2, band: 'GREEN' } },
    travelMinutes: { '10>20': 5, '20>11': 15, '10>11': 12 },
  })
  const [slot] = result.suggestions
  assert.equal(slot.baselineLeg.key, '10>11')
  assert.equal(slot.baselineLeg.departureAt, at('2026-11-09', '08:40'))
  assert.deepEqual(suggestionLegsToCheck(result).map((leg) => leg.key), ['10>20', '20>11', '10>11'])

  // A slot that does not fit asks for nothing; the earliest slot's legs are added last.
  const earliest = { travelLegs: [{ key: '20>12' }, { key: '10>20' }] }
  assert.deepEqual(
    suggestionLegsToCheck({ earliest, suggestions: [{ fits: false }, slot] }).map((leg) => leg.key),
    ['10>20', '20>11', '10>11', '20>12'],
  )
})

test('the earliest slot brings its travel legs so their traffic can be checked', () => {
  // Only Jorge: Friday 9:05–9:35, pickup until 9:45, before SR-12 at 10:00.
  const requests = applyAppointmentsToRequests(
    [confirmed(12), quick], [appointment(12, [4], '2026-11-06', '10:00', '12:00', '10:00', '10:30')], roster,
  )
  const earliest = earliestAvailableSlot({ request: quick, requests, technicians: [technicians[0]], now })
  assert.deepEqual([earliest.date, earliest.internalStart, earliest.travelPending], ['2026-11-06', '09:05', true])
  assert.deepEqual(earliest.travelLegs.map((leg) => [leg.key, leg.minutes, leg.departureAt]), [
    ['20>12', null, at('2026-11-06', '09:45')],
  ])
  // Once Google gives 3 minutes it fits without pending travel.
  const known = earliestAvailableSlot({ request: quick, requests, technicians: [technicians[0]], travelMinutes: { '20>12': 3 }, now })
  assert.deepEqual([known.internalStart, known.travelPending], ['09:05', false])
})

// Final days and grouping (docs/customer-service-proposal-fit-plan.md, section 4), with
// the decisions of 10 Nov 2026: the due date first (D1), a nearby visit within the due
// date first (D2) and HIGH like any other (D3). Monday 16 Nov 2026, 7:00 AM California.
const monday16 = new Date('2026-11-16T15:00:00Z')
const fitRequest = (id, requestNumber, dueOn, extra = {}) => ({ ...quick, id, requestNumber, dueOn, ...extra })
// CS-A arrives Monday 16 and is due Monday 23; CS-B is due Wednesday 25 (a 7-day due
// date); CS-C is due Tuesday 24.
const csA = fitRequest(31, 'CS-A', '2026-11-23')
const csB = fitRequest(32, 'CS-B', '2026-11-25')
const csC = fitRequest(33, 'CS-C', '2026-11-24')
// CS-A registered on its final day, Monday 23 at 8:00–8:30 with Jorge.
const registeredA = { ...confirmed(31), requestNumber: 'CS-A' }
const csAOnMonday = appointment(31, [4], '2026-11-23', '08:00', '10:00', '08:00', '08:30')

function finalDaysPlan({ request, appointments = [], extraRequests = [], candidates = [], drivingById = {}, travelMinutes = {} }) {
  const requests = applyAppointmentsToRequests([...extraRequests, request], appointments, roster)
  return nearbySlotSuggestions({ request, requests, technicians, candidates, drivingById, travelMinutes, now: monday16 })
}

test('business days left after a slot count only the days the customer can use', () => {
  assert.equal(businessDaysLeft({ date: '2026-11-20', dueOn: '2026-11-23' }), 1)
  assert.equal(businessDaysLeft({ date: '2026-11-23', dueOn: '2026-11-23' }), 0)
  assert.equal(businessDaysLeft({ date: '2026-11-17', dueOn: '2026-11-25' }), 6)
  assert.equal(businessDaysLeft({ date: '2026-11-20', dueOn: '2026-11-23', unavailableDates: ['2026-11-23'] }), 0)
  assert.equal(deadlineLabel({ date: '2026-11-20', request: csA, now: monday16 }), 'Due Mon, Nov 23 · 1 business day left')
  assert.equal(deadlineLabel({ date: '2026-11-23', request: csA, now: monday16 }), 'Due Mon, Nov 23 · last on-time day')
  assert.equal(deadlineLabel({ date: '2026-11-17', request: fitRequest(34, 'CS-D', '2026-11-13'), now: monday16 }), 'Overdue since Fri, Nov 13')
})

test('CS-A goes to its due date first (D1)', () => {
  const plan = finalDaysPlan({ request: csA })
  assert.deepEqual(
    [plan.finalDays.date, plan.finalDays.internalStart, plan.finalDays.technicianNames, plan.finalDays.sharesDay],
    ['2026-11-23', '08:00', ['Jorge Murillo'], false],
  )
  assert.deepEqual(plan.suggestions, [])
  // The earliest time stays visible: today, Monday 16, at 8:00.
  assert.deepEqual([plan.earliest.date, plan.earliest.internalStart], ['2026-11-16', '08:00'])
})

test('CS-B joins CS-A on Monday 23 because it is near and within its due date (D2)', () => {
  const plan = finalDaysPlan({
    request: csB, appointments: [csAOnMonday], extraRequests: [registeredA],
    candidates: [visit(31, '2026-11-23', '08:00')],
    drivingById: { 31: { drivingMiles: 4, band: 'GREEN' } },
    travelMinutes: { '31>32': 8 },
  })
  // CS-A ends with pickup at 8:40; 8 min of driving: 8:50–9:20, 30 min of margin.
  const [slot] = plan.suggestions
  assert.deepEqual(
    [slot.fits, slot.date, slot.internalStart, slot.technicianNames, slot.extraMinutes, slot.margin],
    [true, '2026-11-23', '08:50', ['Jorge Murillo'], 8, 30],
  )
  assert.equal(deadlineLabel({ date: slot.date, request: csB, now: monday16 }), 'Due Wed, Nov 25 · 2 business days left')
  // Its own final days are still shown after it: Wednesday 25.
  assert.equal(plan.finalDays.date, '2026-11-25')
})

test('CS-C does not join CS-A when it is Far, and goes to its own final days', () => {
  const plan = finalDaysPlan({
    request: csC, appointments: [csAOnMonday], extraRequests: [registeredA],
    candidates: [visit(31, '2026-11-23', '08:00')],
    drivingById: { 31: { drivingMiles: 15, band: 'ORANGE' } },
  })
  assert.deepEqual(plan.suggestions, [])
  assert.deepEqual([plan.finalDays.date, plan.finalDays.internalStart], ['2026-11-24', '08:00'])

  // If the customer cannot on Tuesday 24 it steps back to Monday 23. Jorge works next to
  // the Far CS-A that day, so the free Helper is suggested instead.
  const blocked = finalDaysPlan({
    request: { ...csC, customerUnavailableDates: ['2026-11-24'] },
    appointments: [csAOnMonday], extraRequests: [registeredA],
    drivingById: { 31: { drivingMiles: 15, band: 'ORANGE' } },
  })
  assert.deepEqual(
    [blocked.finalDays.date, blocked.finalDays.internalStart, blocked.finalDays.technicianNames],
    ['2026-11-23', '08:00', ['Helper']],
  )
})

test('a final day taken by visits that are not nearby steps back one business day', () => {
  // Both technicians have a visit on Tuesday 24 that is not Near or Medium.
  const far = { ...confirmed(40), requestNumber: 'SR-40' }
  const busyTuesday = [appointment(40, [4, 5], '2026-11-24', '10:00', '12:00', '10:00', '10:30')]
  const plan = finalDaysPlan({ request: csC, extraRequests: [far], appointments: busyTuesday })
  assert.deepEqual([plan.finalDays.date, plan.finalDays.internalStart], ['2026-11-23', '08:00'])

  // When that visit is Near, the final day is used next to it with enough margin.
  const near = finalDaysPlan({
    request: csC, extraRequests: [far], appointments: busyTuesday,
    drivingById: { 40: { drivingMiles: 2, band: 'GREEN' } },
    travelMinutes: { '33>40': 5, '40>33': 5 },
  })
  assert.deepEqual(
    [near.finalDays.date, near.finalDays.internalStart, near.finalDays.sharesDay, near.finalDays.margin],
    ['2026-11-24', '08:00', true, 80],
  )
  assert.deepEqual(near.finalDays.travelLegs.map((leg) => leg.key), ['33>40'])
})

test('a customer who cannot on the due date gets the day before it', () => {
  const request = { ...csA, customerUnavailableDates: ['2026-11-23'] }
  const plan = finalDaysPlan({ request })
  assert.equal(plan.finalDays.date, '2026-11-20')
  assert.equal(deadlineLabel({ date: '2026-11-20', request, now: monday16 }), 'Due Mon, Nov 23 · last on-time day')
})

test('a high priority request also goes to its final days (D3)', () => {
  const plan = finalDaysPlan({ request: { ...csA, priority: 'HIGH' } })
  assert.equal(plan.finalDays.date, '2026-11-23')
})

test('an overdue request has no final days: the earliest time is the suggestion', () => {
  const overdue = fitRequest(34, 'CS-D', '2026-11-13')
  const plan = finalDaysPlan({ request: overdue })
  assert.deepEqual([plan.finalDays, plan.overdue], [null, true])
  assert.equal(plan.earliest.date, '2026-11-16')
  const requests = applyAppointmentsToRequests([overdue], [], roster)
  assert.equal(finalDaysSlot({ request: overdue, requests, technicians, now: monday16 }), null)
})

test('the draft and every suggestion use one of three states (block R5)', () => {
  assert.equal(fitStatus({ fits: true, travelPending: false }), 'FITS')
  assert.equal(fitStatus({ fits: true, travelPending: true }), 'TRAVEL_PENDING')
  assert.equal(fitStatus({ fits: false, travelPending: true }), 'DOESNT_FIT')
  assert.deepEqual(fitStatusLabels, { FITS: 'Fits', TRAVEL_PENDING: 'Fits · travel pending', DOESNT_FIT: "Doesn't fit" })
})
