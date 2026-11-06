import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import {
  applyAppointmentsToRequests, toPlanningTechnicians, travelEstimatesToMinutes, upcomingAppointmentRequestIds,
} from '../src/features/customer-service/utils/appointmentRecords.js'
import {
  applyProposalSuggestion, buildAppointmentRegistration, suggestProposalTimes, validatePrototypeProposalDraft,
} from '../src/features/customer-service/utils/proposalDraft.js'
import { createServiceCalendarEventsFromRequests } from '../src/features/customer-service/data/serviceCalendarEvents.js'

const roster = [
  { id: 4, name: 'Jorge Murillo', isActive: true },
  { id: 5, name: 'Helper', isActive: true },
  { id: 6, name: 'Former technician', isActive: false },
]
const technicians = toPlanningTechnicians(roster)
const confirmed = { ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'CONFIRMED'), id: 10, requestNumber: 'SR-10' }
delete confirmed.technicianIds
delete confirmed.customerWindow
delete confirmed.internalSlot
const ready = {
  ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE'),
  id: 20, requestNumber: 'SR-20', customerUnavailableDates: [], dueOn: '2026-11-13', updatedAt: '2026-11-05T10:00:00Z',
}
// Monday 2026-11-09, 08:00–10:00 window (PST), work 08:00–08:30, crew of two.
const appointment = {
  id: 7, request_id: 10, technician_ids: [4, 5],
  window_starts_at: '2026-11-09T16:00:00Z', window_ends_at: '2026-11-09T18:00:00Z',
  starts_at: '2026-11-09T16:00:00Z', ends_at: '2026-11-09T16:30:00Z', pickup_minutes: 10,
  state: 'SCHEDULED', acceptance: 'CUSTOMER_ACCEPTED_PROPOSAL', updated_at: '2026-11-05T11:00:00Z',
}
const now = new Date('2026-11-06T17:00:00Z')

test('the planner uses active catalog technicians with string ids', () => {
  assert.deepEqual(technicians, [{ id: '4', name: 'Jorge Murillo' }, { id: '5', name: 'Helper' }])
})

test('a saved appointment is shown in California time on its request', () => {
  const [mapped, untouched] = applyAppointmentsToRequests([confirmed, ready], [appointment], roster)
  assert.deepEqual(mapped.customerWindow, { date: '2026-11-09', start: '08:00', end: '10:00' })
  assert.deepEqual(mapped.internalSlot, { start: '08:00', end: '08:30' })
  assert.deepEqual(mapped.technicianIds, ['4', '5'])
  assert.deepEqual(mapped.assignedTechnicians, [{ id: '4', name: 'Jorge Murillo' }, { id: '5', name: 'Helper' }])
  assert.deepEqual(mapped.appointment, { id: 7, updatedAt: '2026-11-05T11:00:00Z', acceptance: 'CUSTOMER_ACCEPTED_PROPOSAL', state: 'SCHEDULED' })
  assert.equal(untouched, ready)

  const [event] = createServiceCalendarEventsFromRequests([mapped])
  assert.equal(event.extendedProps.technician, 'Jorge Murillo, Helper')
  assert.equal(event.extendedProps.appointment.id, 7)
})

test('travel estimates are loaded only for appointments from today onward (California)', () => {
  const at = (id, requestId, windowStartsAt) => ({ ...appointment, id, request_id: requestId, window_starts_at: windowStartsAt })
  const rows = [
    at(1, 30, '2026-11-05T16:00:00Z'), // Thursday 08:00 PST: before today
    at(2, 31, '2026-11-06T16:00:00Z'), // Friday 08:00: today
    at(3, 10, '2026-11-09T16:00:00Z'), // Monday
    at(4, 31, '2026-11-10T16:00:00Z'), // same request again
  ]
  assert.deepEqual(upcomingAppointmentRequestIds(rows, now), [10, 31])
  // Friday 16:00 PST is already Saturday in UTC; California's date still decides.
  assert.deepEqual(upcomingAppointmentRequestIds(rows, new Date('2026-11-07T00:00:00Z')), [10, 31])
  assert.deepEqual(upcomingAppointmentRequestIds([], now), [])
})

test('stored travel estimates use the planner leg keys', () => {
  assert.deepEqual(travelEstimatesToMinutes([{ from_request_id: 10, to_request_id: 20, minutes: 15, source: 'MANUAL' }]), { '10>20': 15 })
})

test('a saved appointment blocks capacity and registration waits for every travel leg', () => {
  const requests = applyAppointmentsToRequests([confirmed, ready], [appointment], roster)
  const values = { technicianIds: ['4'], date: '2026-11-09', windowStart: '08:00', internalStart: '08:15', travelMinutes: {} }
  const conflict = validatePrototypeProposalDraft({ requestId: 20, values, requests, technicians, now })
  assert.ok(conflict.errors.some((error) => error.message.startsWith('Jorge Murillo has an internal work conflict with the reserved schedule of SR-10')))

  const later = validatePrototypeProposalDraft({
    requestId: 20, values: { ...values, windowStart: '10:00', internalStart: '10:00' }, requests, technicians, now,
  })
  assert.equal(later.isValid, true)
  assert.equal(later.travelPending, true)

  const withTravel = { ...values, windowStart: '10:00', internalStart: '10:00', travelMinutes: { '10>20': 30 } }
  const complete = validatePrototypeProposalDraft({ requestId: 20, values: withTravel, requests, technicians, now })
  assert.equal(complete.travelPending, false)
  assert.equal(complete.pastDue, false)
  assert.deepEqual(buildAppointmentRegistration({
    request: ready, values: withTravel, validation: complete, acceptance: 'COUNTER_PROPOSAL_ACCEPTED',
  }), {
    requestId: 20, expectedRequestUpdatedAt: '2026-11-05T10:00:00Z', technicianIds: [4],
    date: '2026-11-09', windowStart: '10:00', workStart: '10:00',
    travelMinutes: { '10>20': 30 }, acceptance: 'COUNTER_PROPOSAL_ACCEPTED',
  })
})

test('a late date blocks registration only while the request can still be done on time', () => {
  const values = { technicianIds: ['4'], date: '2026-11-09', windowStart: '10:00', internalStart: '10:00', travelMinutes: { '10>20': 30 } }
  const validate = (dueOn) => validatePrototypeProposalDraft({
    requestId: 20, values, now, technicians,
    requests: applyAppointmentsToRequests([confirmed, { ...ready, dueOn }], [appointment], roster),
  })

  // Due today (Friday 2026-11-06): Monday is late and on-time days remain.
  const late = validate('2026-11-06')
  assert.equal(late.isValid, true)
  assert.equal(late.pastDue, true)
  assert.ok(late.warnings.some((warning) => warning.message.startsWith('This date is after the due date 2026-11-06.')))

  // Already overdue: only the late warning, registration stays possible.
  const overdue = validate('2026-09-04')
  assert.equal(overdue.pastDue, false)
  assert.ok(overdue.warnings.some((warning) => warning.message === 'This request was due on 2026-09-04. The work will be completed late.'))
})

test('suggested times are the earliest viable start per window and only describe values', () => {
  const requests = applyAppointmentsToRequests([confirmed, ready], [appointment], roster)
  const values = { technicianIds: ['4'], date: '2026-11-06', windowStart: '', internalStart: '', travelMinutes: {} }
  const snapshot = JSON.stringify({ requests, values })

  const { suggestions } = suggestProposalTimes({ requestId: 20, values, requests, technicians, now })
  // Friday 09:00 is now: the 08:00 window cannot fit 60 min + pickup anymore. Monday 08:00–08:40
  // is SR-10 for Jorge, so the first free start is 08:45 (its travel leg is still unknown).
  assert.deepEqual(suggestions.map(({ date, windowStart, internalStart, travelPending }) => (
    [date, windowStart, internalStart, travelPending]
  )), [
    ['2026-11-06', '10:00', '10:00', false],
    ['2026-11-06', '12:00', '12:00', false],
    ['2026-11-09', '08:00', '08:45', true],
  ])
  assert.equal(suggestions[2].pickupEnd, '09:55')

  // Suggesting changes nothing: not the requests, not their appointments, not the form.
  assert.equal(JSON.stringify({ requests, values }), snapshot)
  assert.equal(requests[0].appointment.id, 7)

  // Using a suggestion only fills date, window and start; it is then a normal valid draft.
  const used = applyProposalSuggestion(values, suggestions[0])
  assert.deepEqual(used, { ...values, date: '2026-11-06', windowStart: '10:00', internalStart: '10:00' })
  assert.equal(validatePrototypeProposalDraft({ requestId: 20, values: used, requests, technicians, now }).isValid, true)
})

test('suggestions stay within the due date while on time and look ahead when already overdue', () => {
  const values = { technicianIds: ['4'], date: '2026-11-06', windowStart: '', internalStart: '', travelMinutes: {} }
  const suggest = (dueOn) => suggestProposalTimes({
    requestId: 20, values, technicians, now, limit: 100,
    requests: applyAppointmentsToRequests([confirmed, { ...ready, dueOn }], [appointment], roster),
  })

  const onTime = suggest('2026-11-09')
  assert.equal(onTime.searchedThrough, '2026-11-09')
  assert.ok(onTime.suggestions.every((suggestion) => suggestion.date <= '2026-11-09'))

  const overdue = suggest('2026-09-04')
  assert.equal(overdue.searchedThrough, '2026-11-19') // ten business days from Friday 2026-11-06
  // Three windows on each of the ten days, minus today's 08:00 window (it is already 09:00).
  assert.equal(overdue.suggestions.length, 29)

  const noTechnician = suggestProposalTimes({
    requestId: 20, values: { ...values, technicianIds: [] }, technicians, now,
    requests: applyAppointmentsToRequests([confirmed, ready], [appointment], roster),
  })
  assert.deepEqual(noTechnician, { suggestions: [], searchedThrough: null })
})
