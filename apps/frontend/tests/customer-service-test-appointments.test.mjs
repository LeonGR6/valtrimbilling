import test from 'node:test'
import assert from 'node:assert/strict'
import customerServiceMockDatabase from '../src/features/customer-service/data/customerServiceMockDatabase.js'
import { createCustomerServiceTestAppointments } from '../src/features/customer-service/data/customerServiceTestAppointments.js'
import { createServiceCalendarEventsFromRequests } from '../src/features/customer-service/data/serviceCalendarEvents.js'
import { canEditRequestInView } from '../src/features/customer-service/utils/requestInbox.js'
import { validatePrototypeProposalDraft } from '../src/features/customer-service/utils/proposalDraft.js'

const jorge = 'prototype-Jorge Murillo'

test('two read-only TEST appointments are confirmed for Jorge on the next business day', () => {
  // Friday 2026-11-06, 9 AM California → next business day is Monday 2026-11-09.
  const appointments = createCustomerServiceTestAppointments(new Date('2026-11-06T17:00:00Z'))
  assert.deepEqual(appointments.map((entry) => entry.requestNumber), ['TEST-1', 'TEST-2'])
  for (const entry of appointments) {
    assert.equal(entry.workflowStage, 'CONFIRMED')
    assert.equal(entry.testFixture, true)
    assert.deepEqual(entry.technicianIds, [jorge])
    assert.equal(entry.customerWindow.date, '2026-11-09')
    for (const view of ['REQUESTS', 'PROPOSALS', 'CALENDAR']) assert.equal(canEditRequestInView(entry, view), false, view)
  }
  assert.deepEqual(appointments.map((entry) => entry.internalSlot), [{ start: '08:00', end: '08:30' }, { start: '12:00', end: '12:45' }])
  assert.equal(createServiceCalendarEventsFromRequests(appointments).length, 2)
})

test('a visit planned between the TEST appointments needs both travel legs', () => {
  const appointments = createCustomerServiceTestAppointments(new Date('2026-11-06T17:00:00Z'))
  const ready = {
    ...customerServiceMockDatabase.requests.find((request) => request.workflowStage === 'READY_TO_PROPOSE'),
    customerUnavailableDates: [], dueOn: '2026-11-13',
  }
  const result = validatePrototypeProposalDraft({
    requestId: ready.id, requests: [ready, ...appointments], now: new Date('2026-11-06T17:00:00Z'),
    values: { technicianIds: [jorge], date: '2026-11-09', windowStart: '10:00', internalStart: '10:00' },
  })
  assert.equal(result.isValid, true)
  assert.deepEqual(result.travelLegs.map((leg) => leg.key), [
    `test-appointment-1>${ready.id}`, `${ready.id}>test-appointment-2`,
  ])
  assert.equal(result.warnings.filter((warning) => warning.message.includes('Travel time pending')).length, 2)
})
