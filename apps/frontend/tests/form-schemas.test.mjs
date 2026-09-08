import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuilderSchema } from '../src/features/builders/schemas/builderSchema.js'
import { createJobSchema } from '../src/features/jobs/schemas/jobSchema.js'
import {
  getJobOptionCount,
  getJobPlanCount,
  getJobSequenceColumnCount,
  getJobUnitCount,
  getOptionLotDependencies,
  getPlanLotDependencies,
  initialJobs,
} from '../src/features/jobs/data/jobs.js'
import {
  createJobPlanSchema,
  planOptionSchema,
} from '../src/features/jobs/schemas/jobSequenceSheetSchema.js'
import { createPhaseByLotSchema } from '../src/features/sequence-sheets/schemas/phaseByLotSchema.js'
import {
  formatBuilding,
  formatPhase,
  normalizeBuildingCode,
  normalizePhaseCode,
} from '../src/features/sequence-sheets/utils/phaseBuildingCodes.js'
import { parseLotRange } from '../src/features/sequence-sheets/utils/lotRange.js'
import { initialContacts } from '../src/features/builder-contacts/data/builderContacts.js'
import { createBuilderContactSchema } from '../src/features/builder-contacts/schemas/builderContactSchema.js'
import { initialPeople } from '../src/features/people/data/people.js'
import { personSchema } from '../src/features/people/schemas/personSchema.js'
import { priceSchema } from '../src/features/plan-pricing/schemas/priceSchema.js'

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
    contactPhone: '+14155550128',
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

test('job schema normalizes the fields used to create a job', () => {
  const result = createJobSchema([], null).parse({
    code: ' job-1005 ',
    builder: ' KB Home ',
    community: ' Andara ',
    supervisorId: 2,
    superintendentId: 5,
  })

  assert.deepEqual(result, {
    code: 'JOB-1005',
    builder: 'KB Home',
    community: 'Andara',
    supervisorId: 2,
    superintendentId: 5,
  })
})

test('job schema requires a supervisor and a superintendent to be picked', () => {
  const schema = createJobSchema([], null)
  const base = {
    code: 'JOB-2001',
    builder: 'KB Home',
    community: 'Andara',
    supervisorId: 2,
    superintendentId: 5,
  }

  for (const field of ['supervisorId', 'superintendentId']) {
    const missing = schema.safeParse({ ...base, [field]: null })
    assert.equal(missing.success, false, `${field} should be required`)

    const asText = schema.safeParse({ ...base, [field]: 'Lauren Mitchell' })
    assert.equal(asText.success, false, `${field} should reject a loose name`)
  }
})

test('job schema rejects a duplicate job number', () => {
  const existingJob = {
    id: 1,
    code: 'JOB-1005',
    builder: 'KB Home',
    community: 'Andara',
    supervisorId: 2,
    superintendentId: 5,
  }
  const schema = createJobSchema([existingJob], null)

  const duplicate = schema.safeParse({
    code: ' job-1005 ',
    builder: ' kb home ',
    community: 'andara',
    supervisorId: 2,
    superintendentId: 5,
  })

  assert.equal(duplicate.success, false)
  assert.ok(duplicate.error.flatten().fieldErrors.code)
})

test('job total lots are calculated from all phase lots', () => {
  assert.equal(
    getJobUnitCount({
      sequenceSheet: {
        phases: [
          { lots: [{ id: 1 }, { id: 2 }] },
          { lots: [{ id: 3 }] },
        ],
      },
    }),
    3,
  )
  assert.equal(getJobUnitCount({ sequenceSheet: { phases: [] } }), 0)
  assert.equal(getJobUnitCount({}), 0)
})

test('job total lots follow phase edits and deletions', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const editedJob = {
    ...job,
    sequenceSheet: {
      ...job.sequenceSheet,
      phases: job.sequenceSheet.phases.map((phase) => ({
        ...phase,
        lots: phase.id === 2101
          ? [
              ...phase.lots,
              {
                id: 3103,
                lotNumber: '3',
                planId: 1103,
                reverse: false,
                optionIds: [],
              },
            ]
          : phase.lots,
      })),
    },
  }
  const jobWithoutPhases = {
    ...editedJob,
    sequenceSheet: { ...editedJob.sequenceSheet, phases: [] },
  }

  assert.equal(getJobUnitCount(editedJob), 8)
  assert.equal(getJobUnitCount(jobWithoutPhases), 0)
})

test('plans and options report the lots that prevent their deletion', () => {
  const job = initialJobs.find((item) => item.code === '1307')

  assert.deepEqual(
    getPlanLotDependencies(job, 1101).map((dependency) => dependency.lotNumber),
    ['67', '2'],
  )
  assert.deepEqual(
    getPlanLotDependencies(job, 1102).map((dependency) => dependency.lotNumber),
    ['68', '69', '1'],
  )
  assert.deepEqual(
    getPlanLotDependencies(job, 1103).map((dependency) => dependency.lotNumber),
    ['66'],
  )
  assert.deepEqual(
    getOptionLotDependencies(job, 110201).map(
      (dependency) => dependency.lotNumber,
    ),
    ['1'],
  )
  assert.equal(getOptionLotDependencies(job, 110203).length, 0)
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

test('pricing accepts USD amounts with up to two decimal places', () => {
  assert.deepEqual(priceSchema.parse({ amount: ' 2621.50 ' }), {
    amount: 2621.5,
  })
  assert.equal(priceSchema.safeParse({ amount: '-1' }).success, false)
  assert.equal(priceSchema.safeParse({ amount: '10.999' }).success, false)
  assert.equal(priceSchema.safeParse({ amount: '' }).success, false)
})

test('Job 1307 sequence sheet counts plans, options and visible columns', () => {
  const job = initialJobs.find((item) => item.code === '1307')

  assert.equal(getJobPlanCount(job), 4)
  assert.equal(getJobOptionCount(job), 11)
  assert.equal(getJobSequenceColumnCount(job), 15)
})

test('phase by lot schema normalizes lots and accepts selected plan options', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).parse({
    phaseName: ' 11 ',
    building: ' c5 ',
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
    phaseName: '11',
    building: 'C5',
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

test('phase by lot schema supports editing the current phase and preserves lot ids', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const phase = job.sequenceSheet.phases.find((item) => item.id === 2101)
  const result = createPhaseByLotSchema(job, phase.id).parse({
    phaseName: ' Phase 10 ',
    building: ' B5 ',
    lots: [
      {
        id: phase.lots[0].id,
        lotNumber: ' 1A ',
        planId: 1102,
        reverse: true,
        optionIds: [110201],
      },
    ],
  })

  assert.deepEqual(result, {
    phaseName: '10',
    building: '5',
    lots: [
      {
        id: 3101,
        lotNumber: '1A',
        planId: 1102,
        reverse: true,
        optionIds: [110201],
      },
    ],
  })
})

test('phase and building codes support long and abbreviated labels', () => {
  assert.equal(normalizePhaseCode(' Phase 10 '), '10')
  assert.equal(normalizePhaseCode('P10'), '10')
  assert.equal(normalizeBuildingCode(' Building 4 '), '4')
  assert.equal(normalizeBuildingCode('B4'), '4')
  assert.equal(normalizeBuildingCode('C5'), 'C5')
  assert.equal(formatPhase('1'), 'Phase 1')
  assert.equal(formatPhase('1', 'short'), 'P1')
  assert.equal(formatBuilding('3'), 'Building 3')
  assert.equal(formatBuilding('3', 'short'), 'B3')
  assert.equal(formatBuilding('C5'), 'Building C5')
})

test('lot ranges generate every consecutive lot inclusively', () => {
  assert.deepEqual(parseLotRange(' 9 - 14 '), {
    success: true,
    lotNumbers: ['9', '10', '11', '12', '13', '14'],
  })
})

test('lot ranges reject invalid, reversed and oversized ranges', () => {
  assert.equal(parseLotRange('9 to 14').success, false)
  assert.equal(parseLotRange('14-9').success, false)
  assert.equal(parseLotRange('1-501').success, false)
})

test('phase by lot schema rejects duplicate phase names and lot numbers', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).safeParse({
    phaseName: ' p10 ',
    building: '4',
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

test('person schema normalizes contact information', () => {
  const result = personSchema.parse({
    name: ' María López ',
    phone: ' (951) 555-0184 ',
    officePhone: '',
    email: ' MARIA.LOPEZ@EXAMPLE.COM ',
    types: ['SUPERVISOR'],
    territory: ' Inland Empire ',
  })

  assert.deepEqual(result, {
    name: 'María López',
    phone: '+19515550184',
    officePhone: '',
    email: 'maria.lopez@example.com',
    types: ['SUPERVISOR'],
    territory: 'Inland Empire',
    isActive: true,
  })
})

test('person schema stores Mexico numbers in E.164 format', () => {
  const result = personSchema.parse({
    name: 'María López',
    phone: '55 1234 5678',
    phoneCountry: 'MX',
    officePhone: '+1 (714) 555-0100',
    officePhoneCountry: 'MX',
    email: 'maria@example.com',
    types: ['SUPERVISOR'],
    territory: 'México',
  })

  assert.equal(result.phone, '+525512345678')
  assert.equal(result.officePhone, '+17145550100')
  assert.equal('phoneCountry' in result, false)
})

test('builder contact schema stores selected phone country without guessing', () => {
  const result = createBuilderContactSchema([], null).parse({
    name: 'Daniel Torres',
    type: 'JOBSITE_SUPERINTENDENT',
    builder: 'TRUMARK',
    email: 'daniel@example.com',
    phone: '55 1234 5678',
    phoneCountry: 'MX',
    officePhone: '',
    officePhoneCountry: 'US',
    notes: '',
  })

  assert.equal(result.phone, '+525512345678')
  assert.equal(result.officePhone, '')
})

test('person schema requires and normalizes a territory for Valtrim supervisors', () => {
  const supervisor = personSchema.parse({
    name: 'Lauren Mitchell',
    phone: '',
    officePhone: '',
    email: 'lauren.mitchell@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: '  Inland Empire  ',
  })
  const missingTerritory = personSchema.safeParse({
    name: 'Lauren Mitchell',
    phone: '',
    officePhone: '',
    email: 'lauren.mitchell@valtriminc.com',
    types: ['SUPERVISOR'],
    territory: ' ',
  })

  assert.equal(supervisor.territory, 'Inland Empire')
  assert.equal(missingTerritory.success, false)
  assert.ok(missingTerritory.error.flatten().fieldErrors.territory)
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

test('saved job assignment catalogs keep Valtrim supervisors separate from builder contacts', () => {
  assert.equal(new Set(initialPeople.map((person) => person.id)).size, initialPeople.length)
  assert.ok(
    initialPeople.every(
      (person) => person.types.length === 1 && person.types[0] === 'SUPERVISOR',
    ),
  )
  assert.ok(
    initialContacts.every((contact) =>
      ['JOBSITE_SUPERINTENDENT', 'AP_CONTACT'].includes(contact.type),
    ),
  )
})
