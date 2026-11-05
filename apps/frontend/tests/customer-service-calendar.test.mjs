import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialServiceCalendarEvents,
  createServiceCalendarEventsFromRequests,
  createServiceCalendarEvent,
  filterServiceCalendarEvents,
  formatWorkTypes,
  getServiceCalendarEventDisplayMode,
  getServiceCalendarViewDescription,
  getServiceEventTone,
  getServiceWorkTypeFilterOptions,
  resolveServiceCustomerWindow,
  serviceCalendarViewOptions,
  serviceCustomerWindowOptions,
  serviceWorkTypeOptions,
} from '../src/features/customer-service/data/serviceCalendarEvents.js'
import { normalizeServiceWorkTypes } from '../src/features/customer-service/data/workTypes.js'
import { prototypeWorkTypeOptions } from '../src/features/customer-service/utils/newRequestPrototype.js'

test('service work types render single and combined labels', () => {
  assert.equal(formatWorkTypes(['HW']), 'Hardware')
  assert.equal(formatWorkTypes(['HW', 'WS']), 'Hardware & Woodwork')
  assert.equal(formatWorkTypes(['Exterior Frames', 'Shelving']), 'Exterior Frames & Shelving')
  assert.equal(formatWorkTypes([]), 'Work type pending')
})

test('mock service visits stay in the reference week and use two-hour customer windows', () => {
  const events = createInitialServiceCalendarEvents(new Date(2026, 8, 17))
  const combinedVisit = events.find((event) => event.id === 'service-cs-1045')

  assert.equal(combinedVisit.start, '2026-09-14T08:00:00')
  assert.equal(combinedVisit.end, '2026-09-14T10:00:00')
  assert.deepEqual(combinedVisit.extendedProps.workTypes, ['Hardware', 'Woodwork'])
  assert.deepEqual(combinedVisit.extendedProps.lastVisit.workTypes, ['Hardware'])
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

  assert.equal(event.start, '2026-09-24T08:00:00')
  assert.equal(event.end, '2026-09-24T10:00:00')
  assert.deepEqual(event.extendedProps.internalSlot, { start: '09:00', end: '11:00' })
  assert.equal(event.extendedProps.calendarType, 'CUSTOMER_SERVICE')
  assert.equal(event.extendedProps.requestNumber, 'CS-1099')
  assert.deepEqual(event.extendedProps.workTypes, ['Hardware', 'Woodwork'])
})

test('persisted appointments map into calendar events after reload', () => {
  const [event] = createServiceCalendarEventsFromRequests([{
    id: 19,
    currentAppointmentId: 81,
    requestNumber: 'SR-00000019',
    appointmentDate: '2026-09-24',
    appointmentStart: '09:00',
    appointmentEnd: '10:30',
    appointmentState: 'SCHEDULED',
    confirmationStatus: 'CONFIRMED',
    workType: 'HW_WS',
    technicianId: 3,
    technicianName: 'Mike Rodriguez',
    contactName: 'Leon Test',
    community: 'Cedar Grove',
    lotNumber: '18',
    street: '18 Test Street',
    city: 'Temecula',
    state: 'CA',
    postalCode: '92592',
    issue: 'Hardware adjustment',
    internalNotes: 'Call first.',
  }])

  assert.equal(event.id, 'service-81')
  assert.equal(event.start, '2026-09-24T08:00:00')
  assert.equal(event.end, '2026-09-24T10:00:00')
  assert.deepEqual(event.extendedProps.internalSlot, { start: '09:00', end: '10:30' })
  assert.equal(event.extendedProps.status, 'CONFIRMED')
  assert.deepEqual(event.extendedProps.workTypes, ['Hardware', 'Woodwork'])
})

test('confirmed prototype requests map into calendar events while proposals stay hidden', () => {
  const events = createServiceCalendarEventsFromRequests([
    {
      id: 'mock-confirmed',
      requestNumber: 'CS-2001',
      workflowStage: 'CONFIRMED',
      workType: 'Hardware',
      customerWindow: { date: '2026-10-08', start: '10:00', end: '12:00' },
      internalSlot: { start: '10:30', end: '11:30' },
      technicianName: 'Hilario Najera',
      contactName: 'Test Customer',
      community: 'Andara',
      lotNumber: '9',
      issue: 'Door adjustment',
    },
    {
      id: 'mock-proposal',
      requestNumber: 'CS-2002',
      workflowStage: 'AWAITING_CUSTOMER',
      workType: 'Woodwork',
      customerWindow: { date: '2026-10-09', start: '08:00', end: '10:00' },
      internalSlot: { start: '09:00', end: '10:00' },
      technicianName: 'Jorge Murillo',
    },
  ])

  assert.equal(events.length, 1)
  assert.equal(events[0].id, 'service-mock-confirmed')
  assert.equal(events[0].start, '2026-10-08T10:00:00')
  assert.equal(events[0].end, '2026-10-08T12:00:00')
  assert.deepEqual(events[0].extendedProps.internalSlot, { start: '10:30', end: '11:30' })
  assert.equal(events[0].extendedProps.status, 'CONFIRMED')
  assert.deepEqual(events[0].extendedProps.workTypes, ['Hardware'])
})

test('calendar and New Request share the current work type choices', () => {
  assert.equal(serviceWorkTypeOptions, prototypeWorkTypeOptions)
  assert.deepEqual(serviceWorkTypeOptions, [
    { value: 'Exterior Frames', label: 'Exterior Frames' },
    { value: 'Doors', label: 'Doors' },
    { value: 'Moldings', label: 'Moldings' },
    { value: 'Hardware', label: 'Hardware' },
    { value: 'Weatherstripping', label: 'Weatherstripping' },
    { value: 'Shelving', label: 'Shelving' },
    { value: 'Multiple work types', label: 'Multiple work types' },
  ])
  assert.deepEqual(getServiceWorkTypeFilterOptions([]), serviceWorkTypeOptions)
})

test('a confirmed multi-technician prototype visit is shown once and filters for either assigned technician', () => {
  const technicianIds = ['prototype-Jorge Murillo', 'prototype-Hilario Najera']
  const events = createServiceCalendarEventsFromRequests([{
    id: 'crew-calendar-test', workflowStage: 'CONFIRMED', workType: 'Doors',
    technicianIds, technicianName: 'Jorge Murillo',
    customerWindow: { date: '2026-10-14', start: '08:00', end: '10:00' },
  }])
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].extendedProps.technicianIds, technicianIds)
  assert.equal(events[0].extendedProps.technician, 'Jorge Murillo, Hilario Najera')
  for (const technician of technicianIds) assert.equal(filterServiceCalendarEvents(events, { technician }).length, 1)
  assert.equal(filterServiceCalendarEvents(events, { technician: 'not-assigned' }).length, 0)
})

test('an in-progress visit stays on the calendar and visits sharing a window keep their own work times', () => {
  const shared = { workType: 'Doors', technicianIds: ['prototype-Jorge Murillo'], customerWindow: { date: '2026-10-14', start: '08:00', end: '10:00' } }
  const events = createServiceCalendarEventsFromRequests([
    { ...shared, id: 'working-visit', workflowStage: 'WORKING', internalSlot: { start: '08:00', end: '08:30' } },
    { ...shared, id: 'later-visit', workflowStage: 'CONFIRMED', internalSlot: { start: '08:50', end: '09:20' } },
    { ...shared, id: 'pending-visit', workflowStage: 'AWAITING_CUSTOMER', internalSlot: { start: '09:30', end: '09:50' } },
  ])
  assert.deepEqual(events.map((event) => event.extendedProps.status), ['WORKING', 'CONFIRMED'])
  assert.ok(events.every((event) => event.start === '2026-10-14T08:00:00' && event.end === '2026-10-14T10:00:00'))
  assert.deepEqual(events.map((event) => event.extendedProps.internalSlot), [
    { start: '08:00', end: '08:30' }, { start: '08:50', end: '09:20' },
  ])
  assert.equal(getServiceEventTone('WORKING'), 'confirmed')
  assert.equal(filterServiceCalendarEvents(events, { status: 'WORKING' }).length, 1)
})

test('work categories normalize current names and historical codes without guessing', () => {
  assert.deepEqual(normalizeServiceWorkTypes(' hardware '), ['Hardware'])
  assert.deepEqual(normalizeServiceWorkTypes('WS'), ['Woodwork'])
  assert.deepEqual(normalizeServiceWorkTypes('HW_WS'), ['Hardware', 'Woodwork'])
  assert.deepEqual(
    normalizeServiceWorkTypes(['HW', 'Hardware', 'ws', 'Woodwork', ' doors ', 'Unknown category', '', null, 7]),
    ['Hardware', 'Woodwork', 'Doors', 'Unknown category'],
  )
  assert.deepEqual(normalizeServiceWorkTypes(null), [])
  assert.deepEqual(normalizeServiceWorkTypes(undefined), [])
  for (const { value } of serviceWorkTypeOptions) {
    assert.deepEqual(normalizeServiceWorkTypes(value), [value])
  }
})

function confirmedRequestsForEveryCategory() {
  return serviceWorkTypeOptions.map(({ value }, index) => ({
    id: `category-${index}`,
    requestNumber: `CS-${3000 + index}`,
    workflowStage: 'CONFIRMED',
    workType: value,
    customerWindow: { date: '2026-10-12', start: '08:00', end: '10:00' },
    technicianId: index % 2 + 1,
    technicianName: `Technician ${index % 2 + 1}`,
  }))
}

test('confirmed requests of every work type choice appear and filter individually', () => {
  const requests = confirmedRequestsForEveryCategory()
  const originalRequests = structuredClone(requests)
  const events = createServiceCalendarEventsFromRequests(requests)

  assert.equal(events.length, serviceWorkTypeOptions.length)
  assert.deepEqual(filterServiceCalendarEvents(events), events)
  assert.deepEqual(getServiceWorkTypeFilterOptions(events), serviceWorkTypeOptions)
  for (const [index, { value }] of serviceWorkTypeOptions.entries()) {
    const filtered = filterServiceCalendarEvents(events, { workType: value })
    assert.equal(filtered.length, 1, `${value} must be selectable and visible`)
    assert.equal(filtered[0].extendedProps.requestId, requests[index].id)
    assert.deepEqual(filtered[0].extendedProps.workTypes, [value])
    assert.equal(filtered[0].title, `CS · ${value}`)
  }
  assert.deepEqual(requests, originalRequests, 'mapping must not change request data')
})

test('appointment-backed requests retain each current category in the calendar', () => {
  const requests = confirmedRequestsForEveryCategory().map((request, index) => ({
    ...request,
    currentAppointmentId: 100 + index,
    appointmentDate: '2026-10-12',
    appointmentStart: '08:30',
    appointmentEnd: '09:00',
    appointmentState: 'SCHEDULED',
    confirmationStatus: 'CONFIRMED',
  }))
  const events = createServiceCalendarEventsFromRequests(requests)

  assert.equal(filterServiceCalendarEvents(events).length, serviceWorkTypeOptions.length)
  for (const [index, { value }] of serviceWorkTypeOptions.entries()) {
    const filtered = filterServiceCalendarEvents(events, { workType: value })
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].id, `service-${100 + index}`)
    assert.equal(filtered[0].extendedProps.status, 'CONFIRMED')
  }
})

test('combined historical categories match either category and remain visible by default', () => {
  const [request] = confirmedRequestsForEveryCategory()
  const events = createServiceCalendarEventsFromRequests([{ ...request, workType: 'HW_WS' }])
  const options = getServiceWorkTypeFilterOptions(events)

  assert.equal(filterServiceCalendarEvents(events).length, 1)
  assert.equal(filterServiceCalendarEvents(events, { workType: 'Hardware' }).length, 1)
  assert.equal(filterServiceCalendarEvents(events, { workType: 'Woodwork' }).length, 1)
  assert.equal(filterServiceCalendarEvents(events, { workType: 'Weatherstripping' }).length, 0)
  assert.equal(filterServiceCalendarEvents(events, { workType: 'Shelving' }).length, 0)
  assert.deepEqual(options.at(-1), { value: 'Woodwork', label: 'Woodwork (legacy)' })
})

test('uncategorized and unrecognized events are not silently hidden with initial filters', () => {
  const events = [
    { id: 'legacy', extendedProps: { workTypes: ['WS', 'HW'] } },
    { id: 'unknown', extendedProps: { workTypes: ['Special category'] } },
    { id: 'pending', extendedProps: {} },
  ]
  const options = getServiceWorkTypeFilterOptions(events)

  assert.equal(filterServiceCalendarEvents(events).length, 3)
  assert.equal(options.filter(({ value }) => value === 'Hardware').length, 1)
  assert.deepEqual(options.at(-1), { value: 'Special category', label: 'Special category' })
  assert.deepEqual(filterServiceCalendarEvents(events, { workType: 'Special category' }), [events[1]])
  assert.deepEqual(filterServiceCalendarEvents(events, { workType: 'Hardware' }), [events[0]])
})

test('category filtering combines with technician and status filters and resets to all', () => {
  const events = createServiceCalendarEventsFromRequests(confirmedRequestsForEveryCategory())
  const target = events[0]
  const filters = { workType: 'Exterior Frames', technician: '1', status: 'CONFIRMED' }

  assert.deepEqual(filterServiceCalendarEvents(events, filters), [target])
  assert.deepEqual(filterServiceCalendarEvents(events, { ...filters, technician: '2' }), [])
  assert.deepEqual(filterServiceCalendarEvents(events, { ...filters, status: 'COMPLETED' }), [])
  assert.equal(
    filterServiceCalendarEvents(events, { workType: 'all' }).length,
    serviceWorkTypeOptions.length,
  )
})

test('service appointment statuses map to distinct visual tones', () => {
  assert.equal(getServiceEventTone('SCHEDULED'), 'scheduled')
  assert.equal(getServiceEventTone('CONFIRMED'), 'confirmed')
  assert.equal(getServiceEventTone('OVERDUE'), 'overdue')
  assert.equal(getServiceEventTone('COMPLETED'), 'completed')
  assert.equal(getServiceEventTone('CANCELLED'), 'cancelled')
})

test('service calendar exposes month, week, day, list and year views', () => {
  assert.deepEqual(
    serviceCalendarViewOptions.map(({ value }) => value),
    ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek', 'multiMonthYear'],
  )
})

test('calendar views select event density appropriate for their grid', () => {
  assert.equal(getServiceCalendarEventDisplayMode('dayGridMonth'), 'compact')
  assert.equal(getServiceCalendarEventDisplayMode('multiMonthYear'), 'year')
  assert.equal(getServiceCalendarEventDisplayMode('listWeek'), 'list')
  assert.equal(getServiceCalendarEventDisplayMode('timeGridDay'), 'timed')
  assert.match(getServiceCalendarViewDescription('multiMonthYear'), /Annual overview/)
  assert.match(getServiceCalendarViewDescription('timeGridWeek'), /two-hour customer window/)
})

test('customer service uses the approved two-hour proposal windows', () => {
  assert.deepEqual(
    serviceCustomerWindowOptions.map(({ start, end, exceptional }) => ({
      start,
      end,
      exceptional,
    })),
    [
      { start: '08:00', end: '10:00', exceptional: false },
      { start: '10:00', end: '12:00', exceptional: false },
      { start: '12:00', end: '14:00', exceptional: false },
    ],
  )
  assert.deepEqual(resolveServiceCustomerWindow('10:30', '11:30'), {
    start: '10:00',
    end: '12:00',
    label: '10:00 AM–12:00 PM',
    exceptional: false,
    derived: true,
  })
})

