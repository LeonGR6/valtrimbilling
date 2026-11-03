import assert from 'node:assert/strict'
import test from 'node:test'
import {
  schedulingSettingsSchema,
  technicianSchema,
} from '../src/features/customer-service/schemas/technicianSchema.js'

function technician(overrides = {}) {
  return {
    name: 'Juan Sánchez',
    email: 'juan@example.com',
    phone: '951 555 0135',
    phoneCountry: 'US',
    workdayStartsAt: '08:00',
    workdayEndsAt: '17:00',
    coordinates: '33.986588, -117.343021',
    ...overrides,
  }
}

test('technician registration normalizes email and selected-country phone', () => {
  const value = technicianSchema.parse(technician({
    name: ' Juan Sánchez ',
    email: ' JUAN@EXAMPLE.COM ',
  }))

  assert.deepEqual(value, {
    name: 'Juan Sánchez',
    email: 'juan@example.com',
    phone: '+19515550135',
    workdayStartsAt: '08:00',
    workdayEndsAt: '17:00',
    latitude: 33.986588,
    longitude: -117.343021,
  })
})

test('technician registration validates optional contacts and operational data', () => {
  assert.equal(technicianSchema.safeParse(technician({ email: '', phone: '' })).success, true)
  assert.equal(technicianSchema.safeParse(technician({ email: 'not-an-email' })).success, false)
  assert.equal(technicianSchema.safeParse(technician({ phone: '123' })).success, false)
  assert.equal(technicianSchema.safeParse(technician({ workdayEndsAt: '07:59' })).success, false)
  assert.equal(technicianSchema.safeParse(technician({ coordinates: '' })).success, false)
})

test('scheduling settings keep five-day inputs small and reject inverted ranges', () => {
  const valid = {
    companyAddress: '1526 Seventh St, Riverside, CA 92507',
    coordinates: '33.986588, -117.343021',
    workdayStartsAt: '08:00',
    workdayEndsAt: '17:00',
    timeZone: 'America/Los_Angeles',
    travelBufferMinutes: '15',
    defaultDurationMinutes: '60',
    distanceGreenMaxMiles: '10',
    distanceYellowMaxMiles: '20',
    requiresDispatcherApproval: true,
  }

  const result = schedulingSettingsSchema.parse(valid)
  assert.equal(result.latitude, 33.986588)
  assert.equal(result.defaultDurationMinutes, 60)
  assert.equal(schedulingSettingsSchema.safeParse({
    ...valid,
    distanceYellowMaxMiles: '5',
  }).success, false)
})
