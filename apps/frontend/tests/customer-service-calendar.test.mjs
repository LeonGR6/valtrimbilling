import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialServiceCalendarEvents,
  createServiceCalendarEvent,
  formatWorkTypes,
  getServiceEventTone,
} from '../src/features/customer-service/data/serviceCalendarEvents.js'

test('service work types render single and combined labels', () => {
  assert.equal(formatWorkTypes(['HW']), 'HW')
  assert.equal(formatWorkTypes(['HW', 'WS']), 'HW & WS')
  assert.equal(formatWorkTypes([]), 'Work type pending')
})

test('mock service visits stay in the reference week and keep last-visit history', () => {
  const events = createInitialServiceCalendarEvents(new Date(2026, 8, 17))
  const combinedVisit = events.find((event) => event.id === 'service-cs-1045')

  assert.equal(combinedVisit.start, '2026-09-14T09:00:00')
  assert.deepEqual(combinedVisit.extendedProps.workTypes, ['HW', 'WS'])
  assert.deepEqual(combinedVisit.extendedProps.lastVisit.workTypes, ['HW'])
})

test('a new service visit maps a request into a calendar event', () => {
  const event = createServiceCalendarEvent({
    request: {
      id: 19,
      requestNumber: 'CS-1099',
      contactName: 'Leon Test',
      community: 'Cedar Grove',
      lotNumber: '18',
      street: '18 Test Street',
      city: 'Temecula',
      state: 'CA',
      postalCode: '92592',
      issue: 'Hardware adjustment',
    },
    date: '2026-09-24',
    start: '09:00',
    end: '11:00',
    status: 'SCHEDULED',
    workTypes: ['HW', 'WS'],
    technicianId: 3,
    technician: 'Mike Rodriguez',
    notes: 'Call first.',
  })

  assert.equal(event.start, '2026-09-24T09:00:00')
  assert.equal(event.end, '2026-09-24T11:00:00')
  assert.equal(event.extendedProps.calendarType, 'CUSTOMER_SERVICE')
  assert.equal(event.extendedProps.requestNumber, 'CS-1099')
  assert.deepEqual(event.extendedProps.workTypes, ['HW', 'WS'])
})

test('service appointment statuses map to distinct visual tones', () => {
  assert.equal(getServiceEventTone('SCHEDULED'), 'scheduled')
  assert.equal(getServiceEventTone('CONFIRMED'), 'confirmed')
  assert.equal(getServiceEventTone('OVERDUE'), 'overdue')
  assert.equal(getServiceEventTone('COMPLETED'), 'completed')
  assert.equal(getServiceEventTone('CANCELLED'), 'cancelled')
})

