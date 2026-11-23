import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import {
  applyAppointmentsToRequests, toPlanningTechnicians, travelEstimatesToMinutes, upcomingAppointmentRequestIds,
} from '../src/features/customer-service/utils/appointmentRecords.js'
import {
  buildAppointmentRegistration, getPrototypeTechnicianAgenda, registrationNotice, suggestProposalTimes,
  validatePrototypeProposalDraft,
} from '../src/features/customer-service/utils/proposalDraft.js'
import {
  confirmationEmail, defaultConfirmationText, mailingAddress,
} from '../src/features/customer-service/utils/customerServiceEmailTemplates.js'
import {
  createServiceCalendarEventsFromRequests, proposedServiceCalendarEvent, serviceCalendarEventForRequest,
} from '../src/features/customer-service/data/serviceCalendarEvents.js'

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

test('a visit picked in the Proposal Workspace agenda opens its request as in Calendar', () => {
  const requests = applyAppointmentsToRequests([confirmed, ready], [appointment], roster)
  // The agenda carries string request ids.
  const event = serviceCalendarEventForRequest(requests, '10')
  assert.equal(event.extendedProps.requestNumber, 'SR-10')
  assert.equal(event.extendedProps.technician, 'Jorge Murillo, Helper')
  assert.equal(event.start, '2026-11-09T08:00:00')
  assert.deepEqual(event.extendedProps.internalSlot, { start: '08:00', end: '08:30' })
  assert.equal(serviceCalendarEventForRequest(requests, '99'), null)
})

// SR-30 has a proposal waiting for the customer: Monday 10:00–12:00 (work 10:00–10:45) and
// Tuesday 08:00–10:00 (work 08:00–08:45), both with Jorge.
const awaiting = { ...ready, id: 30, requestNumber: 'SR-30', workflowStage: 'AWAITING_CUSTOMER' }
const hold = (optionId, optionNumber, windowStartsAt, startsAt, endsAt) => ({
  option_id: optionId, option_number: optionNumber, proposal_id: 3, request_id: 30, sent_at: '2026-11-06T16:00:00Z',
  technician_ids: [4], window_starts_at: windowStartsAt,
  window_ends_at: new Date(Date.parse(windowStartsAt) + 2 * 3600_000).toISOString(),
  starts_at: startsAt, ends_at: endsAt, pickup_minutes: 10,
})
const holds = [
  hold(42, 2, '2026-11-10T16:00:00Z', '2026-11-10T16:00:00Z', '2026-11-10T16:45:00Z'),
  hold(41, 1, '2026-11-09T18:00:00Z', '2026-11-09T18:00:00Z', '2026-11-09T18:45:00Z'),
]

test('a sent proposal shows the days it holds on its request, in California time', () => {
  const [, untouched, held] = applyAppointmentsToRequests([confirmed, ready, awaiting], [appointment], roster, holds)
  assert.equal(untouched, ready)
  assert.deepEqual(held.proposalHolds, [
    {
      optionId: 41, optionNumber: 1, proposalId: 3, sentAt: '2026-11-06T16:00:00Z', date: '2026-11-09',
      windowStart: '10:00', windowEnd: '12:00', start: '10:00', end: '10:45', pickupMinutes: 10, technicianIds: ['4'],
    },
    {
      optionId: 42, optionNumber: 2, proposalId: 3, sentAt: '2026-11-06T16:00:00Z', date: '2026-11-10',
      windowStart: '08:00', windowEnd: '10:00', start: '08:00', end: '08:45', pickupMinutes: 10, technicianIds: ['4'],
    },
  ])
  // A held request is not a Calendar visit yet.
  assert.deepEqual(createServiceCalendarEventsFromRequests([held]), [])
})

test('each held day occupies its technicians like an appointment until the customer answers', () => {
  const requests = applyAppointmentsToRequests([confirmed, ready, awaiting], [appointment], roster, holds)
  const monday = getPrototypeTechnicianAgenda(requests, ['4'], '2026-11-09', technicians)
  const mondayHold = monday.find((entry) => entry.requestId === 30)
  assert.equal(mondayHold.start, '10:00')
  assert.equal(mondayHold.end, '10:55')
  assert.equal(mondayHold.blocksAvailability, true)
  assert.equal(mondayHold.proposalOption, 1)
  assert.equal(mondayHold.stage, 'AWAITING_CUSTOMER')
  const tuesday = getPrototypeTechnicianAgenda(requests, ['4'], '2026-11-10', technicians)
  assert.deepEqual(tuesday.map((entry) => [entry.requestNumber, entry.proposalOption, entry.start]), [['SR-30', 2, '08:00']])
  // Helper is not in the proposal, so nothing is held for him.
  assert.equal(getPrototypeTechnicianAgenda(requests, ['5'], '2026-11-10', technicians).length, 0)

  const values = { technicianIds: ['4'], date: '2026-11-09', windowStart: '10:00', internalStart: '10:00', travelMinutes: {} }
  const result = validatePrototypeProposalDraft({ requestId: 20, values, requests, technicians, now })
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((error) => error.message.includes('is already busy with SR-30')))
})

test('a held day picked in the agenda opens as sent and held', () => {
  const event = proposedServiceCalendarEvent(awaiting, {
    date: '2026-11-09', windowStart: '10:00', start: '10:00', end: '10:45', technicianNames: ['Jorge Murillo'],
  }, 'AWAITING_CUSTOMER')
  assert.equal(event.extendedProps.status, 'AWAITING_CUSTOMER')
  assert.equal(event.extendedProps.requestNumber, 'SR-30')
  assert.equal(event.extendedProps.technician, 'Jorge Murillo')
  assert.equal(event.start, '2026-11-09T10:00:00')
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
  assert.ok(conflict.errors.some((error) => error.message.startsWith('Jorge Murillo is already busy with SR-10 from 8:00 AM to 8:40 AM')))

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
  assert.ok(late.warnings.some((warning) => warning.message.startsWith('This date is after the due date (Fri, Nov 6).')))

  // Already overdue: only the late warning, registration stays possible.
  const overdue = validate('2026-09-04')
  assert.equal(overdue.pastDue, false)
  assert.ok(overdue.warnings.some((warning) => warning.message === 'This request was due on Fri, Sep 4. The work will be completed late.'))
})

test('the earliest viable start per window (used by Earliest available) only describes values', () => {
  const requests = applyAppointmentsToRequests([confirmed, ready], [appointment], roster)
  const values = { technicianIds: ['4'], date: '2026-11-06', windowStart: '', internalStart: '', travelMinutes: {} }
  const snapshot = JSON.stringify({ requests, values })

  const { suggestions } = suggestProposalTimes({ requestId: 20, values, requests, technicians, now })
  // Friday 09:00 is now: the 08:00 window cannot fit 60 min + pickup anymore. Monday 08:00–08:40
  // is SR-10 for Jorge, so the first free start is 08:40 (its travel leg is still unknown).
  assert.deepEqual(suggestions.map(({ date, windowStart, internalStart, travelPending }) => (
    [date, windowStart, internalStart, travelPending]
  )), [
    ['2026-11-06', '10:00', '10:00', false],
    ['2026-11-06', '12:00', '12:00', false],
    ['2026-11-09', '08:00', '08:40', true],
  ])
  assert.equal(suggestions[2].pickupEnd, '09:50')

  // Suggesting changes nothing: not the requests, not their appointments, not the form.
  assert.equal(JSON.stringify({ requests, values }), snapshot)
  assert.equal(requests[0].appointment.id, 7)

  // Its date, window and start make a normal valid draft.
  const [first] = suggestions
  const used = { ...values, date: first.date, windowStart: first.windowStart, internalStart: first.internalStart }
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

test('planner messages use one date and time format and say what is wrong', async () => {
  const { formatServiceDate, formatServiceTime } = await import('../src/features/customer-service/utils/customerServiceScheduling.js')
  assert.equal(formatServiceDate('2026-11-17'), 'Tue, Nov 17')
  assert.equal(formatServiceDate('not a date'), 'not a date')
  assert.deepEqual(['08:00', '12:00', '13:05', '00:30'].map(formatServiceTime), ['8:00 AM', '12:00 PM', '1:05 PM', '12:30 AM'])

  const requests = applyAppointmentsToRequests([confirmed, ready], [appointment], roster)
  const validate = (internalStart, travelMinutes) => validatePrototypeProposalDraft({
    requestId: 20, requests, technicians, now,
    values: { technicianIds: ['4'], date: '2026-11-09', windowStart: '08:00', internalStart, travelMinutes },
  })
  // SR-10 keeps Jorge busy until 8:40 (work until 8:30 plus pickup).
  assert.ok(validate('08:45', { '10>20': 15 }).errors.some((error) => error.message
    === 'Jorge Murillo cannot reach this visit in time from SR-10: leaving at 8:40 AM with 15 min of travel, they arrive at 8:55 AM.'))
  assert.ok(validate('08:45', {}).warnings.some((warning) => warning.message
    === 'Travel time from SR-10 to this visit is missing for Jorge Murillo. Calculate it with Google Maps or type it.'))
})

test('the planned visit opens like a Calendar visit, marked as proposed, with the property coordinates', () => {
  const planned = { ...ready, latitude: 33.63717377010304, longitude: -117.89873154408701 }
  const event = proposedServiceCalendarEvent(planned, {
    date: '2026-11-19', windowStart: '08:00', start: '08:00', end: '09:00', technicianNames: ['Jorge Murillo'],
  })
  assert.equal(event.start, '2026-11-19T08:00:00')
  assert.equal(event.end, '2026-11-19T10:00:00')
  assert.deepEqual(
    [event.extendedProps.status, event.extendedProps.requestNumber, event.extendedProps.technician, event.extendedProps.appointment],
    ['PROPOSED', 'SR-20', 'Jorge Murillo', null],
  )
  assert.deepEqual(event.extendedProps.internalSlot, { start: '08:00', end: '09:00' })
  assert.deepEqual(event.extendedProps.coordinates, { latitude: 33.63717377010304, longitude: -117.89873154408701 })
  // Without a window or a request there is nothing to show; missing coordinates stay null.
  assert.equal(proposedServiceCalendarEvent(planned, { date: '2026-11-19', windowStart: '09:00' }), null)
  assert.equal(proposedServiceCalendarEvent({ ...ready, latitude: null }, {
    date: '2026-11-19', windowStart: '08:00', start: '08:00', end: '09:00',
  }).extendedProps.coordinates, null)

  // A registered visit carries its coordinates too.
  const requests = applyAppointmentsToRequests([{ ...confirmed, latitude: 33.5, longitude: -117.2 }, ready], [appointment], roster)
  assert.deepEqual(serviceCalendarEventForRequest(requests, '10').extendedProps.coordinates, { latitude: 33.5, longitude: -117.2 })
})

test('a visit shows the day its request was reported and its last on-time day', () => {
  const reported = { reportedAt: '2026-11-04', dueOn: '2026-11-13' }
  const planned = proposedServiceCalendarEvent({ ...ready, ...reported }, {
    date: '2026-11-12', windowStart: '08:00', start: '08:00', end: '09:00', technicianNames: ['Jorge Murillo'],
  })
  assert.deepEqual([planned.extendedProps.reportedOn, planned.extendedProps.dueOn], ['2026-11-04', '2026-11-13'])
  const requests = applyAppointmentsToRequests([{ ...confirmed, ...reported }, ready], [appointment], roster)
  const registered = serviceCalendarEventForRequest(requests, '10')
  assert.deepEqual([registered.extendedProps.reportedOn, registered.extendedProps.dueOn], ['2026-11-04', '2026-11-13'])
})

test('sending to the customer registers the visit and asks for a confirmation email only when chosen', () => {
  const requests = applyAppointmentsToRequests([confirmed, ready], [appointment], roster)
  const values = { technicianIds: ['4'], date: '2026-11-12', windowStart: '08:00', internalStart: '08:00', travelMinutes: {} }
  const validation = validatePrototypeProposalDraft({ requestId: ready.id, values, requests, technicians, now })
  const text = { greeting: 'Hi Ana,', message: 'Thanks for the call.' }
  const withEmail = buildAppointmentRegistration({
    request: ready, values, validation, acceptance: 'CUSTOMER_ACCEPTED_PROPOSAL', confirmationEmail: text,
  })
  assert.deepEqual(withEmail.confirmationEmail, text)
  const withoutEmail = buildAppointmentRegistration({ request: ready, values, validation, acceptance: 'CUSTOMER_ACCEPTED_PROPOSAL' })
  assert.equal('confirmationEmail' in withoutEmail, false)
})

test('the coordinator reads whether the confirmation was emailed, failed or not sent', () => {
  const registered = 'SR-20 was registered as a confirmed appointment and appears in Calendar.'
  assert.deepEqual(registrationNotice('SR-20', { appointmentId: 1, confirmation: null }), { severity: 'success', message: registered })
  assert.deepEqual(registrationNotice('SR-20', { confirmation: { status: 'SENT', to: 'tester@example.com', testMode: true } }), {
    severity: 'success', message: `${registered} The confirmation was emailed to tester@example.com (test inbox).`,
  })
  assert.deepEqual(registrationNotice('SR-20', { confirmation: { status: 'FAILED', message: 'Microsoft 365 rejected the email.' } }), {
    severity: 'warning', message: `${registered} The confirmation email failed: Microsoft 365 rejected the email.`,
  })
  assert.deepEqual(registrationNotice('SR-20', { confirmation: { status: 'NOT_SENT', message: 'This request has no customer email, so no confirmation was sent.' } }), {
    severity: 'warning', message: `${registered} This request has no customer email, so no confirmation was sent.`,
  })
})

test('the planner previews the confirmation with the same template the server sends', () => {
  assert.deepEqual(defaultConfirmationText({ homeownerName: 'Yesenia Hernandez' }), {
    greeting: 'Hi Yesenia Hernandez,',
    message: 'Thank you for confirming your service visit with Valtrim. Here are the details:',
  })
  const email = confirmationEmail({
    folio: 'CS-2031', homeownerName: 'Yesenia Hernandez', date: '2026-11-24', windowStart: '10:00',
    address: mailingAddress({ street: '12720 Azure Way-Unit 33', city: 'Hawthorne', state: 'CA', postalCode: '90250' }),
    work: 'Shelving replacement', greeting: 'Hi Yesenia,', message: 'Thanks!',
  })
  assert.equal(email.subject, 'Your Valtrim service visit is confirmed for Tue, Nov 24 (CS-2031)')
  assert.ok(email.text.includes('Arrival window: 10:00 AM–12:00 PM\nAddress: 12720 Azure Way-Unit 33, Hawthorne, CA 90250'))
})
