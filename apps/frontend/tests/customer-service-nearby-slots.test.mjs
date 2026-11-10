import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import { applyAppointmentsToRequests, toPlanningTechnicians } from '../src/features/customer-service/utils/appointmentRecords.js'
import { californiaInstant } from '../src/features/customer-service/utils/customerServiceScheduling.js'
import {
  earliestAvailableSlot, nearbySlotSuggestions, technicianSets,
} from '../src/features/customer-service/utils/nearbySlotSuggestions.js'
import { validatePrototypeProposalDraft } from '../src/features/customer-service/utils/proposalDraft.js'

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
    drivingById: { 10: { drivingMiles: 2, band: 'GREEN' }, 11: { drivingMiles: 12, band: 'ORANGE' } },
    // SR-10 → SR-20 5 min, SR-20 → SR-11 15 min, and SR-10 → SR-11 was 12 min.
    travelMinutes: { '10>20': 5, '20>11': 15, '10>11': 12 },
  })
  // Only Near or Medium visits are used: SR-11 is Far.
  assert.equal(result.suggestions.length, 1)
  const [slot] = result.suggestions
  assert.deepEqual(
    [slot.anchor.requestNumber, slot.fits, slot.date, slot.windowStart, slot.internalStart, slot.internalEnd, slot.pickupEnd],
    ['SR-10', true, '2026-11-09', '08:00', '08:45', '09:45', '09:55'],
  )
  assert.deepEqual(slot.technicianNames, ['Jorge Murillo'])
  assert.equal(slot.extraMinutes, 8) // 5 + 15 − 12
  assert.equal(slot.travelPending, false)
  assert.equal(slot.warning, null)
  assert.deepEqual(slot.travelLegs.map((leg) => leg.key), ['10>20', '20>11'])

  // Using it is a normal valid draft for the same rules the server applies.
  const values = {
    technicianIds: slot.technicianIds, date: slot.date, windowStart: slot.windowStart, internalStart: slot.internalStart,
    travelMinutes: { '10>20': 5, '20>11': 15 },
  }
  assert.equal(validatePrototypeProposalDraft({ requestId: 20, values, requests, technicians, now }).isValid, true)

  // The earliest slot is always shown too: Friday 10:00 with the first free technician.
  assert.deepEqual(
    [result.earliest.date, result.earliest.internalStart, result.earliest.technicianNames],
    ['2026-11-06', '10:00', ['Jorge Murillo']],
  )
})

test('a slot whose travel is still unknown fits with pending travel and no extra minutes yet', () => {
  const { result } = plan({ drivingById: { 10: { drivingMiles: 0, band: 'GREEN' } } })
  const [slot] = result.suggestions
  assert.equal(slot.fits, true)
  assert.equal(slot.internalStart, '08:45')
  assert.equal(slot.travelPending, true)
  assert.equal(slot.extraMinutes, null)
})

test('a drive that leaves no room next to the nearby visit does not fit', () => {
  const { result } = plan({
    drivingById: { 10: { drivingMiles: 9, band: 'YELLOW' } },
    travelMinutes: { '10>20': 25, '20>11': 15, '10>11': 12 },
  })
  // Leaves SR-10 at 8:40, 25 min of driving: 9:05, but work plus pickup must end by 10:00.
  assert.equal(result.suggestions[0].fits, false)
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
  const pair = { ...ready, crewSize: 2 }
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

test('a high priority request only groups on its earliest available date', () => {
  const urgent = { ...ready, priority: 'HIGH' }
  // Friday 10:00 is free, so Monday's nearby visit would make it wait.
  const later = plan({ request: urgent, drivingById: { 10: { drivingMiles: 2, band: 'GREEN' } } })
  assert.equal(later.result.highPriority, true)
  assert.equal(later.result.earliest.date, '2026-11-06')
  assert.deepEqual(later.result.suggestions, [])

  // A nearby visit on that same Friday does not delay it, so it is suggested.
  const friday = plan({
    request: urgent,
    extraRequests: [confirmed(12)],
    appointments: [...monday, appointment(12, [4], '2026-11-06', '10:00', '12:00', '10:00', '10:30')],
    candidates: [visit(12, '2026-11-06', '10:00')],
    drivingById: { 12: { drivingMiles: 1, band: 'GREEN' } },
    travelMinutes: { '12>20': 5 },
  })
  assert.equal(friday.result.earliest.date, '2026-11-06')
  assert.deepEqual(
    [friday.result.suggestions[0].date, friday.result.suggestions[0].internalStart],
    ['2026-11-06', '10:45'],
  )
})

test('the earliest slot considers every technician of the crew size', () => {
  // Jorge is busy Friday 10:00–10:30; Helper is free at 10:00.
  const requests = applyAppointmentsToRequests(
    [confirmed(12), ready], [appointment(12, [4], '2026-11-06', '10:00', '12:00', '10:00', '10:30')], roster,
  )
  const earliest = earliestAvailableSlot({ request: ready, requests, technicians, now })
  assert.deepEqual([earliest.date, earliest.internalStart, earliest.technicianNames], ['2026-11-06', '10:00', ['Helper']])
})
