import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateBusinessDueDate,
  createPersistedCustomerServiceSchema,
} from '../src/features/customer-service/schemas/persistedCustomerServiceSchema.js'
import {
  calculateDistanceMiles,
  getSchedulingReadinessReasons,
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
    city: 'Riverside',
    state: 'ca',
    postalCode: '92507',
    plan: 'Plan 2',
    coordinates: '33.986588, -117.343021',
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
    customerUnavailableDates: [{ date: '2026-09-23' }],
    customerNeedsContact: true,
    customerAvailabilityNotes: 'Call before sending another proposal.',
  }
}

test('the reported day does not count toward the business-day deadline', () => {
  // Same results as valtrim.calculate_business_due_date.
  assert.equal(calculateBusinessDueDate('2026-09-21', 5), '2026-09-28') // Monday → next Monday
  assert.equal(calculateBusinessDueDate('2026-09-25', 5), '2026-10-02') // Friday → next Friday
  assert.equal(calculateBusinessDueDate('2026-09-26', 5), '2026-10-02') // Saturday → Friday
  assert.equal(calculateBusinessDueDate('2026-09-27', 5), '2026-10-02') // Sunday → Friday
  assert.equal(calculateBusinessDueDate('2026-09-21', 7), '2026-09-30') // seven days: Monday → Wednesday
})

test('suggestions on a Monday within hours are due the following Monday', () => {
  const result = suggestServiceWorkdays(
    '2026-09-21T16:00:00.000Z',
    { timeZone: 'America/Los_Angeles', businessDaysToComplete: 5 },
    new Date('2026-09-21T16:00:00.000Z'),
  )

  assert.equal(result.startOn, '2026-09-21')
  assert.equal(result.dueOn, '2026-09-28')
  assert.equal(result.days.at(-1).date, '2026-09-28')
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

test('a repair request uses coordinates instead of requiring an address field', () => {
  const result = createPersistedCustomerServiceSchema(5).parse(validRequest())
  const payload = toCustomerServiceRpcPayload(result, 'America/Los_Angeles')

  assert.equal(payload.property.communityId, null)
  assert.equal(payload.property.address, '33.986588, -117.343021')
})

test('a request can be saved without scheduling restrictions', () => {
  const form = createPersistedCustomerServiceSchema(5, {
    startDate: '2026-09-21',
    dueDate: '2026-09-25',
  }).parse({
    ...validRequest(),
    customerUnavailableDates: [],
    customerNeedsContact: false,
    customerAvailabilityNotes: '',
  })
  const payload = toCustomerServiceRpcPayload(form, 'America/Los_Angeles')

  assert.deepEqual(payload.availability, [])
  assert.deepEqual(payload.request.customerUnavailableDates, [])
  assert.equal(payload.request.customerNeedsContact, false)
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

test('pasted coordinates are split into latitude and longitude', () => {
  const result = createPersistedCustomerServiceSchema(5).parse({
    ...validRequest(),
    coordinates: '33.97788205770745, -117.34520765941319',
  })

  assert.equal(result.latitude, 33.97788205770745)
  assert.equal(result.longitude, -117.34520765941319)
  assert.equal('coordinates' in result, false)
})

test('persisted request schema validates coordinates and unavailable days', () => {
  const missingCoordinates = createPersistedCustomerServiceSchema(5).safeParse({
    ...validRequest(),
    coordinates: '',
  })
  const invalidCoordinates = createPersistedCustomerServiceSchema(5).safeParse({
    ...validRequest(),
    coordinates: '117.34520765941319, -233.97788205770745',
  })
  const invalidUnavailableDate = createPersistedCustomerServiceSchema(5).safeParse({
    ...validRequest(),
    // Reported Monday 2026-09-21, due Monday 2026-09-28: Tuesday is outside the window.
    customerUnavailableDates: [{ date: '2026-09-29' }],
  })
  const dueDayIsAllowed = createPersistedCustomerServiceSchema(5).safeParse({
    ...validRequest(),
    customerUnavailableDates: [{ date: '2026-09-28' }],
  })

  assert.equal(dueDayIsAllowed.success, true)
  assert.equal(missingCoordinates.success, false)
  assert.ok(missingCoordinates.error.flatten().fieldErrors.coordinates)
  assert.equal(invalidCoordinates.success, false)
  assert.ok(invalidCoordinates.error.flatten().fieldErrors.coordinates)
  assert.equal(invalidUnavailableDate.success, false)
  assert.ok(invalidUnavailableDate.error.flatten().fieldErrors.customerUnavailableDates)
})

test('unavailable days cannot precede the scheduling window', () => {
  const result = createPersistedCustomerServiceSchema(5, {
    startDate: '2026-09-23',
    dueDate: '2026-09-29',
  }).safeParse({
    ...validRequest(),
    customerUnavailableDates: [{ date: '2026-09-22' }],
  })

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.customerUnavailableDates)
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

test('RPC payload keeps property and scheduling restrictions together', () => {
  const form = createPersistedCustomerServiceSchema(5).parse(validRequest())
  const payload = toCustomerServiceRpcPayload(form, 'America/Los_Angeles')

  assert.equal(payload.property.communityId, null)
  assert.equal(payload.request.workType, 'HW_WS')
  assert.equal(payload.request.estimatedDurationMinutes, 90)
  assert.deepEqual(payload.request.customerUnavailableDates, ['2026-09-23'])
  assert.equal(payload.request.customerNeedsContact, true)
  assert.deepEqual(payload.availability, [])
})

test('distance is calculated in miles from stored coordinates', () => {
  const miles = calculateDistanceMiles(
    { latitude: 33.986588, longitude: -117.343021 },
    { latitude: 34.052235, longitude: -118.243683 },
  )

  assert.ok(miles > 50 && miles < 60)
})

test('proposal readiness explains missing data and requires an operational technician', () => {
  const reasons = getSchedulingReadinessReasons({
    status: 'NEW',
    latitude: 33.986588,
    longitude: -117.343021,
    estimatedDurationMinutes: 60,
    workType: 'HW',
    priority: 'MEDIUM',
    dueOn: '2026-09-25',
    availability: [],
  }, { hasOperationalTechnician: false })

  assert.deepEqual(reasons, [
    'No scheduling day remains after customer restrictions.',
    'No active technician has complete work hours and start coordinates.',
  ])
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
    customer_unavailable_dates: ['2026-09-23'],
    customer_needs_contact: true,
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
  assert.deepEqual(request.customerUnavailableDates, ['2026-09-23'])
  assert.equal(request.customerNeedsContact, true)
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
