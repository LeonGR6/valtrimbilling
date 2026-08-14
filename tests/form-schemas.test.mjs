import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuilderSchema } from '../src/features/builders/schemas/builderSchema.js'
import { createPlanTypeSchema } from '../src/features/plan-types/schemas/planTypeSchema.js'
import { createJobSchema } from '../src/features/jobs/schemas/jobSchema.js'
import { personSchema } from '../src/features/people/schemas/personSchema.js'

test('builder schema normalizes values before saving', () => {
  const result = createBuilderSchema([], null).parse({
    code: ' cv ',
    name: ' City Ventures ',
    description: ' Residential builder ',
    address: ' Main Street ',
    contactName: ' María López ',
    contactEmail: ' CONTACT@EXAMPLE.COM ',
    contactPhone: ' (415) 555-0128 ',
    isActive: true,
  })

  assert.deepEqual(result, {
    code: 'CV',
    name: 'City Ventures',
    description: 'Residential builder',
    address: 'Main Street',
    contactName: 'María López',
    contactEmail: 'contact@example.com',
    contactPhone: '(415) 555-0128',
    isActive: true,
  })
})

test('builder schema rejects an existing code', () => {
  const result = createBuilderSchema([{ id: 1, code: 'CV' }], null).safeParse({
    code: 'cv',
    name: 'Builder',
    description: '',
    address: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    isActive: true,
  })

  assert.equal(result.success, false)
  assert.deepEqual(result.error.flatten().fieldErrors.code, [
    'This builder code already exists.',
  ])
})

test('builder schema rejects invalid optional contact data when provided', () => {
  const result = createBuilderSchema([], null).safeParse({
    code: 'NEW',
    name: 'Builder',
    description: '',
    address: '',
    contactName: '',
    contactEmail: 'not-an-email',
    contactPhone: 'call me',
    isActive: true,
  })

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.contactEmail)
  assert.ok(result.error.flatten().fieldErrors.contactPhone)
})

test('plan type code must be unique within its builder', () => {
  const schema = createPlanTypeSchema(
    [{ id: 1, builder: 'City Ventures', code: '1A' }],
    null,
  )
  const duplicate = schema.safeParse({
    builder: 'City Ventures',
    code: ' 1a ',
    name: 'Plan 1A',
    planPrice: '$2,621',
    isActive: true,
  })
  const otherBuilder = schema.safeParse({
    builder: 'Trumark Homes',
    code: ' 1a ',
    name: 'Plan 1A',
    planPrice: '$2,621',
    isActive: true,
  })

  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error.flatten().fieldErrors.code, [
    'This code already exists for the selected builder.',
  ])
  assert.equal(otherBuilder.success, true)
  assert.equal(otherBuilder.data.code, '1A')
})

test('job schema normalizes hierarchy values and accepts a lot range', () => {
  const result = createJobSchema([], null).parse({
    builder: ' KB Home ',
    community: ' Andara ',
    phase: ' 1 ',
    building: ' 3 ',
    lotFrom: ' 6 ',
    lotTo: ' 12 ',
  })

  assert.deepEqual(result, {
    builder: 'KB Home',
    community: 'Andara',
    phase: '1',
    building: '3',
    lotFrom: '6',
    lotTo: '12',
  })
})

test('job schema rejects inverted and overlapping lot ranges', () => {
  const existingJob = {
    id: 1,
    builder: 'KB Home',
    community: 'Andara',
    phase: '1',
    building: '3',
    lotFrom: '6',
    lotTo: '12',
  }
  const schema = createJobSchema([existingJob], null)

  const inverted = schema.safeParse({
    builder: 'KB Home',
    community: 'Andara',
    phase: '2',
    building: '',
    lotFrom: '12',
    lotTo: '6',
  })
  const overlapping = schema.safeParse({
    builder: ' kb home ',
    community: 'andara',
    phase: '1',
    building: '3',
    lotFrom: '10',
    lotTo: '15',
  })

  assert.equal(inverted.success, false)
  assert.ok(inverted.error.flatten().fieldErrors.lotTo)
  assert.equal(overlapping.success, false)
  assert.ok(overlapping.error.flatten().fieldErrors.lotFrom)
})

test('person schema normalizes contact information and supports multiple types', () => {
  const result = personSchema.parse({
    name: ' María López ',
    phone: ' (951) 555-0184 ',
    officePhone: '',
    email: ' MARIA.LOPEZ@EXAMPLE.COM ',
    types: ['JOBSITE_SUPERINTENDENT', 'AP_CONTACT'],
  })

  assert.deepEqual(result, {
    name: 'María López',
    phone: '(951) 555-0184',
    officePhone: '',
    email: 'maria.lopez@example.com',
    types: ['JOBSITE_SUPERINTENDENT', 'AP_CONTACT'],
  })
})

test('person schema requires an email and at least one person type', () => {
  const result = personSchema.safeParse({
    name: 'Person',
    phone: '',
    officePhone: '',
    email: '',
    types: [],
  })

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.email)
  assert.ok(result.error.flatten().fieldErrors.types)
})
