import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateBusinessDueDate,
  createPersistedCustomerServiceSchema,
} from '../src/features/customer-service/schemas/persistedCustomerServiceSchema.js'

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

test('persisted request schema normalizes values required by the RPC', () => {
  const result = createPersistedCustomerServiceSchema(5).parse(validRequest())

  assert.equal(result.state, 'CA')
  assert.equal(result.contactEmail, 'maria@example.com')
  assert.equal(result.contactPhone, '+19515550123')
  assert.equal(result.latitude, 33.986588)
  assert.equal(result.longitude, -117.343021)
  assert.equal(result.estimatedDurationMinutes, 90)
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
