import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectPhoneCountry,
  formatPhoneNumber,
  getNationalPhoneNumber,
  normalizePhoneNumber,
} from '../src/utils/phoneNumbers.js'
import { createUserSchema } from '../src/features/users/schemas/userSchema.js'

test('10-digit phone numbers use the country selected by the user', () => {
  assert.equal(normalizePhoneNumber('(714) 555-0162', 'US'), '+17145550162')
  assert.equal(normalizePhoneNumber('55 1234 5678', 'MX'), '+525512345678')
})

test('an explicit +1 or +52 prefix overrides the selected country', () => {
  assert.equal(normalizePhoneNumber('+1 714 555 0162', 'MX'), '+17145550162')
  assert.equal(normalizePhoneNumber('+52 55 1234 5678', 'US'), '+525512345678')
  assert.equal(detectPhoneCountry('+52 55 1234 5678'), 'MX')
})

test('unsupported and incomplete phone numbers are rejected', () => {
  assert.equal(normalizePhoneNumber('+34 612 345 678', 'US'), null)
  assert.equal(normalizePhoneNumber('555-1234', 'US'), null)
  assert.equal(normalizePhoneNumber('call me', 'US'), null)
})

test('stored E.164 values can be displayed and edited as national numbers', () => {
  assert.equal(getNationalPhoneNumber('+17145550162'), '7145550162')
  assert.equal(getNationalPhoneNumber('+525512345678'), '5512345678')
  assert.equal(formatPhoneNumber('+17145550162'), '+1 (714) 555-0162')
  assert.equal(formatPhoneNumber('+525512345678'), '+52 55 1234 5678')
})

test('user records also save their selected country in E.164 format', () => {
  const result = createUserSchema([], null).parse({
    name: 'Scheduling User',
    email: 'scheduler@example.com',
    phone: '55 1234 5678',
    phoneCountry: 'MX',
    role: 'SCHEDULING',
    allProjects: true,
    projectAccess: [],
    isActive: true,
  })

  assert.equal(result.phone, '+525512345678')
  assert.equal('phoneCountry' in result, false)
})
