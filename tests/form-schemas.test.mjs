import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuilderSchema } from '../src/features/builders/schemas/builderSchema.js'
import { createPlanTypeSchema } from '../src/features/plan-types/schemas/planTypeSchema.js'
import { createJobSchema } from '../src/features/jobs/schemas/jobSchema.js'
import {
  getJobOptionCount,
  getJobPlanCount,
  getJobSequenceColumnCount,
  getJobUnitCount,
  initialJobs,
} from '../src/features/jobs/data/jobs.js'
import {
  createJobPlanSchema,
  planOptionSchema,
} from '../src/features/jobs/schemas/jobSequenceSheetSchema.js'
import { createPhaseByLotSchema } from '../src/features/sequence-sheets/schemas/phaseByLotSchema.js'
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

test('job schema normalizes the fields used to create a job', () => {
  const result = createJobSchema([], null).parse({
    code: ' job-1005 ',
    builder: ' KB Home ',
    community: ' Andara ',
    totalLots: '24',
    supervisor: ' Lauren Mitchell ',
    jobsiteSuperintendent: ' Daniel Torres ',
  })

  assert.deepEqual(result, {
    code: 'JOB-1005',
    builder: 'KB Home',
    community: 'Andara',
    totalLots: 24,
    supervisor: 'Lauren Mitchell',
    jobsiteSuperintendent: 'Daniel Torres',
  })
})

test('job schema rejects a duplicate job number', () => {
  const existingJob = {
    id: 1,
    code: 'JOB-1005',
    builder: 'KB Home',
    community: 'Andara',
    totalLots: 24,
    supervisor: 'Lauren Mitchell',
    jobsiteSuperintendent: 'Daniel Torres',
  }
  const schema = createJobSchema([existingJob], null)

  const duplicate = schema.safeParse({
    code: ' job-1005 ',
    builder: ' kb home ',
    community: 'andara',
    totalLots: '24',
    supervisor: ' Lauren Mitchell ',
    jobsiteSuperintendent: ' Daniel Torres ',
  })

  assert.equal(duplicate.success, false)
  assert.ok(duplicate.error.flatten().fieldErrors.code)
})

test('job total lots are stored directly on the Job header', () => {
  assert.equal(getJobUnitCount({ totalLots: 24 }), 24)
  assert.equal(getJobUnitCount({ totalLots: '8' }), 8)
  assert.equal(getJobUnitCount({ totalLots: -1 }), 0)
})

test('job plan schema normalizes codes and prevents duplicates in the sheet', () => {
  const plans = [{ id: 1, code: '2', name: 'Plan 2' }]
  const normalized = createJobPlanSchema(plans, null).parse({
    code: ' 3-w/uti ',
    name: ' Utility plan ',
  })
  const duplicate = createJobPlanSchema(plans, null).safeParse({
    code: ' 2 ',
    name: '',
  })

  assert.deepEqual(normalized, { code: '3-W/UTI', name: 'Utility plan' })
  assert.equal(duplicate.success, false)
  assert.ok(duplicate.error.flatten().fieldErrors.code)
})

test('plan option schema allows repeated codes but requires a description', () => {
  const first = planOptionSchema.parse({
    code: ' 2-opt ',
    description: ' Door at Primary Bath ',
  })
  const second = planOptionSchema.parse({
    code: ' 2-opt ',
    description: ' FLEX ROOM ',
  })

  assert.deepEqual(first, {
    code: '2-OPT',
    description: 'Door at Primary Bath',
  })
  assert.equal(second.code, first.code)
  assert.equal(second.description, 'FLEX ROOM')
})

test('Job 1307 sequence sheet counts plans, options and visible columns', () => {
  const job = initialJobs.find((item) => item.code === '1307')

  assert.equal(getJobPlanCount(job), 3)
  assert.equal(getJobOptionCount(job), 11)
  assert.equal(getJobSequenceColumnCount(job), 14)
})

test('phase by lot schema normalizes lots and accepts selected plan options', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).parse({
    phaseName: ' Phase 11 ',
    building: ' b5 ',
    lots: [
      {
        lotNumber: ' 12a ',
        planId: '1102',
        reverse: true,
        optionIds: ['110201', '110202'],
      },
    ],
  })

  assert.deepEqual(result, {
    phaseName: 'Phase 11',
    building: 'B5',
    lots: [
      {
        lotNumber: '12A',
        planId: 1102,
        reverse: true,
        optionIds: [110201, 110202],
      },
    ],
  })
})

test('phase by lot schema rejects duplicate phase names and lot numbers', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).safeParse({
    phaseName: ' phase 10 ',
    building: 'B4',
    lots: [
      { lotNumber: '1', planId: 1101, reverse: false, optionIds: [] },
      { lotNumber: ' 1 ', planId: 1101, reverse: false, optionIds: [] },
    ],
  })

  assert.equal(result.success, false)
  const messages = result.error.issues.map((issue) => issue.message)
  assert.ok(messages.includes('This phase already exists for the selected Job.'))
  assert.ok(messages.includes('Each lot can only appear once in the phase.'))
})

test('phase by lot schema rejects options from another plan', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).safeParse({
    phaseName: 'Phase 12',
    building: 'B6',
    lots: [
      {
        lotNumber: '3',
        planId: 1101,
        reverse: false,
        optionIds: [110201],
      },
    ],
  })

  assert.equal(result.success, false)
  assert.ok(
    result.error.issues.some(
      (issue) => issue.message === 'An option does not belong to the selected plan.',
    ),
  )
})

test('phase by lot schema requires a building', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).safeParse({
    phaseName: 'Phase 13',
    building: ' ',
    lots: [
      { lotNumber: '4', planId: 1101, reverse: false, optionIds: [] },
    ],
  })

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.building)
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
