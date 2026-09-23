import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateBusinessDueDate,
  createPersistedCustomerServiceSchema,
} from '../src/features/customer-service/schemas/persistedCustomerServiceSchema.js'
import {
  calculateDistanceMiles,
  toCustomerServiceRequest,
  toCustomerServiceRpcPayload,
  toZonedDateTimeInput,
  zonedDateTimeToIso,
} from '../src/features/customer-service/services/customerServiceRecord.js'
import { suggestServiceWorkdays } from '../src/features/customer-service/utils/suggestedServiceWindows.js'

function validRequest() {
  return {
    reportedAt: '2026-09-21',
    lotNumber: '24',
    street: '123 Main Street',
    city: 'Riverside',
    state: 'ca',
    postalCode: '92507',
    plan: 'Plan 2',
    latitude: '33.986588',
    longitude: '-117.343021',
    contactName: 'Maria Lopez',
    contactPhone: '(951) 555-0123',
    contactPhoneCountry: 'US',
    contactEmail: 'MARIA@EXAMPLE.COM',
    type: 'WARRANTY',
    priority: 'MEDIUM',
    issue: 'Interior door will not close.',
    workType: 'HW_WS',
    estimatedDurationMinutes: '90',
    internalNotes: 'Call before arrival.',
    customerAvailabilityNotes: 'Mornings are preferred.',
    availability: [
      {
        availableFrom: '2026-09-22T09:00',
        availableUntil: '2026-09-22T11:00',
        notes: 'Gate is open.',
      },
    ],
  }
}

test('Customer Service counts the start weekday as day one', () => {
  assert.equal(calculateBusinessDueDate('2026-09-21', 5), '2026-09-25')
  assert.equal(calculateBusinessDueDate('2026-09-25', 5), '2026-10-01')
})

test('persisted request schema normalizes values required by the RPC', () => {
  const result = createPersistedCustomerServiceSchema(5).parse(validRequest())

  assert.equal(result.state, 'CA')
  assert.equal(result.contactEmail, 'maria@example.com')
  assert.equal(result.contactPhone, '+19515550123')
  assert.equal(result.latitude, 33.986588)
  assert.equal(result.longitude, -117.343021)
  assert.equal(result.estimatedDurationMinutes, 90)
})

test('a repair request does not need a production community', () => {
  const result = createPersistedCustomerServiceSchema(5).parse(validRequest())
  const payload = toCustomerServiceRpcPayload(result, 'America/Los_Angeles')

  assert.equal(payload.property.communityId, null)
  assert.equal(payload.property.address, '123 Main Street')
})

test('a request can be saved before the customer confirms any time window', () => {
  const form = createPersistedCustomerServiceSchema(5, {
    startDate: '2026-09-21',
    dueDate: '2026-09-25',
  }).parse({ ...validRequest(), availability: [] })
  const payload = toCustomerServiceRpcPayload(form, 'America/Los_Angeles')

  assert.deepEqual(payload.availability, [])
})

test('suggestions use the creation date in Los Angeles and skip weekends', () => {
  const result = suggestServiceWorkdays(
    '2026-09-26T03:30:00.000Z',
    {
      timeZone: 'America/Los_Angeles',
      businessDaysToComplete: 5,
      workdayStartsAt: '08:00:00',
      workdayEndsAt: '17:00:00',
    },
    new Date('2026-09-26T03:30:00.000Z'),
  )

  assert.equal(result.createdOn, '2026-09-25')
  assert.equal(result.startOn, '2026-09-28')
  assert.equal(result.dueOn, '2026-10-02')
  assert.deepEqual(result.days.map((day) => day.date), [
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
  ])
  assert.equal(result.days[0].availableFrom, '2026-09-28T08:00')
  assert.equal(result.days[0].availableUntil, '2026-09-28T17:00')
})

test('the current workday suggestion starts no earlier than the current time', () => {
  const result = suggestServiceWorkdays(
    '2026-09-23T16:00:00.000Z',
    { timeZone: 'America/Los_Angeles', businessDaysToComplete: 5 },
    new Date('2026-09-23T16:07:00.000Z'),
  )

  assert.equal(result.days[0].availableFrom, '2026-09-23T09:15')
})

test('persisted request schema requires coordinates and validates confirmed availability', () => {
  const missingCoordinates = createPersistedCustomerServiceSchema(5).safeParse({
    ...validRequest(),
    latitude: '',
    longitude: '',
  })
  const lateAvailability = createPersistedCustomerServiceSchema(5).safeParse({
    ...validRequest(),
    availability: [{
      availableFrom: '2026-09-28T09:00',
      availableUntil: '2026-09-28T11:00',
      notes: '',
    }],
  })

  assert.equal(missingCoordinates.success, false)
  assert.ok(missingCoordinates.error.flatten().fieldErrors.latitude)
  assert.ok(missingCoordinates.error.flatten().fieldErrors.longitude)
  assert.equal(lateAvailability.success, false)
})

test('confirmed windows cannot precede creation even if reported on an older date', () => {
  const result = createPersistedCustomerServiceSchema(5, {
    startDate: '2026-09-23',
    dueDate: '2026-09-29',
  }).safeParse(validRequest())

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.availability)
})

test('Los Angeles wall time is converted without using the browser timezone', () => {
  const iso = zonedDateTimeToIso(
    '2026-09-22T09:00',
    'America/Los_Angeles',
  )

  assert.equal(iso, '2026-09-22T16:00:00.000Z')
  assert.equal(
    toZonedDateTimeInput(iso, 'America/Los_Angeles'),
    '2026-09-22T09:00',
  )
})

test('RPC payload keeps property, request and availability writes together', () => {
  const form = createPersistedCustomerServiceSchema(5).parse(validRequest())
  const payload = toCustomerServiceRpcPayload(form, 'America/Los_Angeles')

  assert.equal(payload.property.communityId, null)
  assert.equal(payload.request.workType, 'HW_WS')
  assert.equal(payload.request.estimatedDurationMinutes, 90)
  assert.equal(payload.availability[0].availableFrom, '2026-09-22T16:00:00.000Z')
})

test('distance is calculated in miles from stored coordinates', () => {
  const miles = calculateDistanceMiles(
    { latitude: 33.986588, longitude: -117.343021 },
    { latitude: 34.052235, longitude: -118.243683 },
  )

  assert.ok(miles > 50 && miles < 60)
})

test('database detail rows map into the catalog without mock data', () => {
  const settings = {
    businessDaysToComplete: 5,
    timeZone: 'America/Los_Angeles',
    companyLatitude: 33.986588,
    companyLongitude: -117.343021,
    distanceGreenMaxMiles: 10,
    distanceYellowMaxMiles: 20,
  }
  const request = toCustomerServiceRequest({
    id: 42,
    folio: 'SR-00000042',
    property_id: 9,
    reported_on: '2026-09-21',
    due_on: '2026-09-25',
    status: 'NEW',
    tag: 'NEW',
    priority: 'MEDIUM',
    request_type: 'WARRANTY',
    work_type: 'HW',
    estimated_duration_minutes: 60,
    homeowner_name: 'Maria Lopez',
    homeowner_email: 'maria@example.com',
    homeowner_phone: '+19515550123',
    description: 'Door adjustment',
    community_id: 3,
    builder_id: 2,
    builder_name: 'Example Builder',
    community_name: 'Example Community',
    lot_number: '24',
    address: '123 Main Street',
    latitude: '33.986588',
    longitude: '-117.343021',
    current_appointment_id: null,
    is_ready_to_schedule: true,
    is_overdue: false,
  }, [{
    id: 7,
    available_from: '2026-09-22T16:00:00.000Z',
    available_until: '2026-09-22T18:00:00.000Z',
    notes: 'Gate is open.',
  }], settings)

  assert.equal(request.requestNumber, 'SR-00000042')
  assert.equal(request.builderName, 'Example Builder')
  assert.equal(request.appointmentState, 'NOT_SCHEDULED')
  assert.equal(request.distanceBand, 'GREEN')
  assert.equal(request.availability[0].availableFrom, '2026-09-22T09:00')
})

test('unlinked repair requests display without invented builder or community names', () => {
  const request = toCustomerServiceRequest({
    id: 43,
    folio: 'SR-00000043',
    address: '456 New Street',
    community_id: null,
    builder_id: null,
    builder_name: null,
    community_name: null,
    latitude: 33.986588,
    longitude: -117.343021,
    homeowner_name: 'Maria Lopez',
    description: 'Install the missing lock part.',
  }, [], {
    timeZone: 'America/Los_Angeles',
    companyLatitude: 33.986588,
    companyLongitude: -117.343021,
    distanceGreenMaxMiles: 10,
    distanceYellowMaxMiles: 20,
  })

  assert.equal(request.street, '456 New Street')
  assert.equal(request.builderName, '')
  assert.equal(request.community, '')
  assert.equal(request.isReadyToSchedule, false)
})
