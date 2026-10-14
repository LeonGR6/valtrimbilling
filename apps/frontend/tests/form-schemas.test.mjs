import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuilderSchema } from '../src/features/builders/schemas/builderSchema.js'
import { formatBuilderAddress } from '../src/features/builders/data/builders.js'
import { createJobSchema } from '../src/features/jobs/schemas/jobSchema.js'
import {
  getJobOptionCount,
  getJobPlanCount,
  getJobSequenceColumnCount,
  getJobUnitCount,
  getOptionLotDependencies,
  getPlanLotDependencies,
} from '../src/features/jobs/data/jobs.js'
import { testJobs } from './fixtures/jobs.mjs'
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
    addressLine1: ' 1234 Main St ',
    addressLine2: ' Apt 5B ',
    city: ' Austin ',
    state: ' tx ',
    zipCode: ' 78701 ',
    country: 'US',
    contactName: ' María López ',
    contactEmail: ' CONTACT@EXAMPLE.COM ',
    contactPhone: ' (415) 555-0128 ',
    isActive: true,
  })

  assert.deepEqual(result, {
    code: 'CV',
    name: 'City Ventures',
    description: 'Residential builder',
    addressLine1: '1234 Main St',
    addressLine2: 'Apt 5B',
    city: 'Austin',
    state: 'TX',
    zipCode: '78701',
    country: 'US',
    contactName: 'María López',
    contactEmail: 'contact@example.com',
    contactPhone: '+14155550128',
    isActive: true,
    contacts: [],
  })
})

test('a builder name may have numbers, but not symbols', () => {
  const schema = createBuilderSchema([], null)
  const base = {
    code: 'G3',
    description: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    isActive: true,
  }

  assert.equal(schema.parse({ ...base, name: ' G3 URBAN HOMES ' }).name, 'G3 URBAN HOMES')
  assert.equal(schema.safeParse({ ...base, name: '3 Pines' }).success, true)

  const symbols = schema.safeParse({ ...base, name: 'G3 <Urban> Homes' })
  assert.equal(symbols.success, false)
  assert.deepEqual(symbols.error.flatten().fieldErrors.name, [
    'Only letters and numbers are allowed.',
  ])

  // The contact person's name still takes letters only.
  assert.equal(schema.safeParse({ ...base, name: 'G3', contactName: 'Jo 3' }).success, false)
})

test('a builder address is saved in parts, all optional, and checked', () => {
  const schema = createBuilderSchema([], null)
  const base = {
    code: 'ADDR',
    name: 'Address Builder',
    description: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    isActive: true,
  }

  assert.equal(schema.safeParse(base).success, true)
  assert.equal(schema.parse({ ...base, zipCode: '78701-1234' }).zipCode, '78701-1234')

  const wrong = schema.safeParse({ ...base, state: 'Texas', zipCode: '787', country: 'FR' })
  assert.equal(wrong.success, false)
  const errors = wrong.error.flatten().fieldErrors
  assert.deepEqual(errors.state, ['Use the two-letter state code.'])
  assert.deepEqual(errors.zipCode, ['Enter a five-digit ZIP code.'])
  assert.ok(errors.country)
})

test('builder schema rejects an existing code', () => {
  const result = createBuilderSchema([{ id: 1, code: 'CV' }], null).safeParse({
    code: 'cv',
    name: 'Builder',
    description: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
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
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
    contactName: '',
    contactEmail: 'not-an-email',
    contactPhone: 'call me',
    isActive: true,
  })

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.contactEmail)
  assert.ok(result.error.flatten().fieldErrors.contactPhone)
})

const jobContacts = {
  superintendentId: 5,
  estimatorId: 6,
  jobCoordinatorId: 7,
  purchasingId: 8,
  schedulingId: 9,
  optionsCoordinatorId: 10,
}

test('job schema normalizes the fields used to create a job', () => {
  const result = createJobSchema([], null).parse({
    code: ' job-1005 ',
    builder: ' KB Home ',
    community: ' Andara ',
    supervisorId: 2,
    ...jobContacts,
  })

  assert.deepEqual(result, {
    code: 'JOB-1005',
    builder: 'KB Home',
    community: 'Andara',
    supervisorId: 2,
    ...jobContacts,
  })
})

test('job schema requires a supervisor and every builder contact to be picked', () => {
  const schema = createJobSchema([], null)
  const base = {
    code: 'JOB-2001',
    builder: 'KB Home',
    community: 'Andara',
    supervisorId: 2,
    ...jobContacts,
  }

  for (const field of ['supervisorId', ...Object.keys(jobContacts)]) {
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
    ...jobContacts,
  }
  const schema = createJobSchema([existingJob], null)

  const duplicate = schema.safeParse({
    code: ' job-1005 ',
    builder: ' kb home ',
    community: 'andara',
    supervisorId: 2,
    ...jobContacts,
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

test('Utility Building rows do not count as Job lots', () => {
  assert.equal(getJobUnitCount({
    sequenceSheet: {
      phases: [
        { lots: [{ id: 1 }, { id: 2 }] },
        {
          lots: [
            { id: 101, isUtilityBuilding: true },
            { id: 102, isUtilityBuilding: true },
            { id: 103, isUtilityBuilding: true },
          ],
        },
      ],
    },
  }), 2)
})

test('job total lots follow phase edits and deletions', () => {
  const job = testJobs.find((item) => item.code === '1307')
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

  assert.equal(getJobUnitCount(editedJob), 11)
  assert.equal(getJobUnitCount(jobWithoutPhases), 0)
})

test('plans and options report the lots that prevent their deletion', () => {
  const job = testJobs.find((item) => item.code === '1307')

  assert.deepEqual(
    getPlanLotDependencies(job, 1101).map((dependency) => dependency.lotNumber),
    ['67', '19', '21'],
  )
  assert.deepEqual(
    getPlanLotDependencies(job, 1102).map((dependency) => dependency.lotNumber),
    ['68', '69', '20'],
  )
  assert.deepEqual(
    getPlanLotDependencies(job, 1103).map((dependency) => dependency.lotNumber),
    ['66', '18', '22'],
  )
  assert.deepEqual(
    getOptionLotDependencies(job, 110201).map(
      (dependency) => dependency.lotNumber,
    ),
    ['20'],
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
  const job = testJobs.find((item) => item.code === '1307')

  assert.equal(getJobPlanCount(job), 4)
  assert.equal(getJobOptionCount(job), 11)
  assert.equal(getJobSequenceColumnCount(job), 15)
})

test('phase by lot schema normalizes lots and accepts selected plan options', () => {
  const job = testJobs.find((item) => item.code === '1307')
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
        isUtilityBuilding: false,
      },
    ],
  })
})

test('phase by lot schema supports editing the current phase and preserves lot ids', () => {
  const job = testJobs.find((item) => item.code === '1307')
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
        isUtilityBuilding: false,
      },
    ],
  })
})

test('a Utility-enabled Job accepts a Phase with a named Utility Building row', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job, undefined, true).parse({
    phaseName: ' Utility ',
    building: ' Clubhouse ',
    lots: [
      {
        lotNumber: '10',
        planId: 1102,
        reverse: false,
        optionIds: [],
        isUtilityBuilding: false,
      },
      {
        lotNumber: '',
        utilityName: ' Clubhouse ',
        planId: 1101,
        reverse: true,
        optionIds: [],
        isUtilityBuilding: true,
      },
    ],
  })

  assert.deepEqual(result, {
    phaseName: 'UTILITY',
    building: 'CLUBHOUSE',
    lots: [
      {
        lotNumber: '10',
        planId: 1102,
        reverse: false,
        optionIds: [],
        isUtilityBuilding: false,
      },
      {
        lotNumber: '',
        utilityName: 'Clubhouse',
        planId: 1101,
        reverse: true,
        optionIds: [],
        isUtilityBuilding: true,
      },
    ],
  })
})

test('a Utility-enabled Job rejects a Phase without a Utility Building row', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job, undefined, true).safeParse({
    phaseName: 'Phase 14',
    building: 'B7',
    lots: [{
      lotNumber: '5',
      planId: 1101,
      reverse: false,
      optionIds: [],
      isUtilityBuilding: false,
    }],
  })

  assert.equal(result.success, false)
  assert.ok(
    result.error.issues.some(
      (issue) => issue.message === 'Add at least one Utility Building row to this phase.',
    ),
  )
})

test('Utility Building rows allow Reverse but still reject Options', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).safeParse({
    phaseName: 'Utility',
    building: 'Clubhouse',
    lots: [{
      lotNumber: '',
      utilityName: 'Clubhouse',
      planId: 1102,
      reverse: true,
      optionIds: [110201],
      isUtilityBuilding: true,
    }],
  })

  assert.equal(result.success, false)
})

test('Utility Building rows require a user-defined name', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).safeParse({
    phaseName: 'Utility',
    building: 'Clubhouse',
    lots: [{
      lotNumber: '',
      utilityName: '   ',
      planId: 1102,
      reverse: false,
      optionIds: [],
      isUtilityBuilding: true,
    }],
  })

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.lots)
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

  assert.deepEqual(parseLotRange('9-14, 20-25'), {
    success: true,
    lotNumbers: ['9', '10', '11', '12', '13', '14', '20', '21', '22', '23', '24', '25'],
  })
})

test('lot ranges reject invalid, reversed and oversized ranges', () => {
  assert.equal(parseLotRange('9 to 14').success, false)
  assert.equal(parseLotRange('14-9').success, false)
  assert.equal(parseLotRange('1-501').success, false)
  assert.equal(parseLotRange('9-14,').success, false)
  assert.equal(parseLotRange('9-14, 14-20').success, false)
  assert.equal(parseLotRange('1-300, 400-600').success, false)
})

test('phase by lot schema rejects a repeated phase and building and repeated lot numbers', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const result = createPhaseByLotSchema(job).safeParse({
    phaseName: ' p2 ',
    building: ' b15 ',
    lots: [
      { lotNumber: '1', planId: 1101, reverse: false, optionIds: [] },
      { lotNumber: ' 1 ', planId: 1101, reverse: false, optionIds: [] },
    ],
  })

  assert.equal(result.success, false)
  const messages = result.error.issues.map((issue) => issue.message)
  assert.ok(messages.includes('This phase and building already exist for the selected Job.'))
  assert.ok(messages.includes('Each lot can only appear once in the phase.'))
})

test('the same phase can be created in another building of the job', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const lots = [{ lotNumber: '1', planId: 1101, reverse: false, optionIds: [] }]

  // Phase 2 already exists in Building 15: Building 16 is a different Phase.
  assert.equal(
    createPhaseByLotSchema(job).safeParse({ phaseName: '2', building: '16', lots }).success,
    true,
  )
  // Editing a phase does not clash with itself.
  assert.equal(
    createPhaseByLotSchema(job, 2102).safeParse({ phaseName: '2', building: '15', lots }).success,
    true,
  )
})

test('phase by lot schema rejects options from another plan', () => {
  const job = testJobs.find((item) => item.code === '1307')
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
  const job = testJobs.find((item) => item.code === '1307')
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
    typeName: 'Jobsite Superintendent',
    builderId: 2,
    email: 'daniel@example.com',
    phone: '55 1234 5678',
    phoneCountry: 'MX',
    officePhone: '',
    officePhoneCountry: 'US',
    notes: '',
  })

  assert.equal(result.phone, '+525512345678')
  assert.equal(result.officePhone, '')
  assert.equal(result.builderId, 2)
  assert.equal(result.isActive, true)
})

test('builder contact schema takes the fixed types and any typed one', () => {
  const schema = createBuilderContactSchema([], null)
  const base = {
    name: 'Daniel Torres',
    builderId: 2,
    email: 'daniel@example.com',
    phone: '',
    officePhone: '',
    notes: '',
  }

  for (const typeName of ['Jobsite Superintendent', 'AP Contact', ' Land   Manager ', 'Coordinator']) {
    assert.equal(schema.safeParse({ ...base, typeName }).success, true, typeName)
  }
  assert.equal(schema.parse({ ...base, typeName: ' Land   Manager ' }).typeName, 'Land Manager')

  assert.equal(schema.safeParse({ ...base, typeName: '  ' }).success, false)
  assert.equal(schema.safeParse({ ...base, typeName: '<script>' }).success, false)
  assert.equal(schema.safeParse({ ...base, typeName: 'x'.repeat(61) }).success, false)
})

test('a builder can be created with other contacts that carry a typed type', () => {
  const schema = createBuilderSchema([], null, ['taken@example.com'])
  const base = {
    code: 'NEW',
    name: 'New Builder',
    description: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    isActive: true,
  }
  const contact = {
    name: 'Sam Rivera',
    typeName: ' Coordinator ',
    email: ' SAM@EXAMPLE.COM ',
    phone: '(415) 555-0128',
    phoneCountry: 'US',
    officePhone: '',
    officePhoneCountry: 'US',
  }

  assert.deepEqual(schema.parse(base).contacts, [])
  assert.deepEqual(schema.parse({ ...base, contacts: [contact] }).contacts, [{
    name: 'Sam Rivera',
    typeName: 'Coordinator',
    email: 'sam@example.com',
    phone: '+14155550128',
    officePhone: '',
  }])

  const clashes = schema.safeParse({
    ...base,
    contacts: [
      { ...contact, email: 'taken@example.com' },
      contact,
      { ...contact, name: 'Pat Doe' },
    ],
  })
  assert.equal(clashes.success, false)
  const emailPaths = clashes.error.issues.map((issue) => issue.path.join('.'))
  assert.deepEqual(emailPaths.filter((path) => path.endsWith('email')), [
    'contacts.0.email',
    'contacts.2.email',
  ])
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

test('a builder address is shown as street lines and then city, state and ZIP', () => {
  assert.equal(
    formatBuilderAddress({
      addressLine1: '1234 Main St',
      addressLine2: 'Apt 5B',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
    }),
    '1234 Main St\nApt 5B\nAustin, TX 78701',
  )
  assert.equal(formatBuilderAddress({ city: 'Austin' }), 'Austin')
  assert.equal(formatBuilderAddress({}), '')
})
