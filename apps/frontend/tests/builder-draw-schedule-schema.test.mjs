import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultBillingSettings,
  invoiceLineFormatOptions,
  submissionMethodOptions,
} from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import { createBuilderDrawScheduleSchema } from '../src/features/builder-draw-schedules/schemas/builderDrawScheduleSchema.js'

function validSetup(overrides = {}) {
  const setup = {
    ...defaultBillingSettings,
    cutoffDays: [...defaultBillingSettings.cutoffDays],
    builderId: 2,
    draws: [
      { percentage: 10 },
      { percentage: 75 },
      { percentage: 15 },
    ],
    ...overrides,
  }

  return {
    ...setup,
    draws: setup.draws.map((draw, index) => ({
      ...draw,
      eventType: draw.eventType ?? ['EXT', 'DM', 'HW'][Math.min(index, 2)],
    })),
  }
}

test('Builder Draw Schedule accepts 3 draws totaling 100 percent', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup())

  assert.equal(result.builderId, 2)
  assert.equal(result.draws.length, 3)
  assert.deepEqual(result.draws.map((draw) => draw.eventType), ['EXT', 'DM', 'HW'])
  assert.equal(result.separateHardwarePrice, false)
  assert.equal(result.utilityBuilding, false)
})

test('Utility Building defaults to one selectable 100 percent charge', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    utilityBuilding: true,
  }))

  assert.equal(result.utilityBuilding, true)
  assert.equal(result.utilityBillingMode, 'FULL')
  assert.deepEqual(result.utilityEventPercentages, { EXT: 0, DM: 0, HW: 0 })
})

test('Utility Building can split 100 percent across configured Draw events', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    utilityBuilding: true,
    utilityBillingMode: 'BY_EVENT',
    utilityEventPercentages: { EXT: 25, DM: 50, HW: 25 },
  }))

  assert.equal(result.utilityBillingMode, 'BY_EVENT')
  assert.deepEqual(result.utilityEventPercentages, { EXT: 25, DM: 50, HW: 25 })
})

test('Utility event split supports two events and rejects missing or incomplete allocation', () => {
  const schema = createBuilderDrawScheduleSchema([], null)
  const twoEvents = schema.safeParse(validSetup({
    draws: [
      { percentage: 50, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
    ],
    utilityBuilding: true,
    utilityBillingMode: 'BY_EVENT',
    utilityEventPercentages: { EXT: 50, DM: 50, HW: 0 },
  }))
  const missingEvent = schema.safeParse(validSetup({
    draws: [
      { percentage: 50, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
    ],
    utilityBuilding: true,
    utilityBillingMode: 'BY_EVENT',
    utilityEventPercentages: { EXT: 25, DM: 50, HW: 25 },
  }))
  const incomplete = schema.safeParse(validSetup({
    utilityBuilding: true,
    utilityBillingMode: 'BY_EVENT',
    utilityEventPercentages: { EXT: 25, DM: 50, HW: 0 },
  }))

  assert.equal(twoEvents.success, true)
  assert.equal(missingEvent.success, false)
  assert.equal(incomplete.success, false)
})

test('Builder Draw Schedule supports only the two invoice line formats', () => {
  assert.deepEqual(invoiceLineFormatOptions, [
    { value: 'LOT_SCOPE', label: 'One line per lot and scope' },
    { value: 'BUILDING_SCOPE', label: 'One line per building and scope' },
  ])

  for (const invoiceLineFormat of ['LOT_SCOPE', 'BUILDING_SCOPE']) {
    const result = createBuilderDrawScheduleSchema([], null).safeParse(
      validSetup({ invoiceLineFormat }),
    )

    assert.equal(result.success, true)
  }

  for (const invoiceLineFormat of ['LOT', 'SCOPE', 'SINGLE']) {
    const result = createBuilderDrawScheduleSchema([], null).safeParse(
      validSetup({ invoiceLineFormat }),
    )

    assert.equal(result.success, false)
  }
})

test('Builder Draw Schedule supports Portal, Email and Mail submission', () => {
  assert.deepEqual(submissionMethodOptions, [
    { value: 'PORTAL', label: 'Portal' },
    { value: 'EMAIL', label: 'Email' },
    { value: 'MAIL', label: 'Mail' },
  ])

  const portal = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    submissionMethod: 'PORTAL',
    submissionDestination: ' Textura ',
  }))
  const email = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    submissionMethod: 'EMAIL',
    submissionDestination: ' billing@example.com ',
  }))
  const mail = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    submissionMethod: 'MAIL',
    submissionDestination: ' 100 Main St, Austin, TX 78701 ',
  }))

  assert.equal(portal.submissionDestination, 'Textura')
  assert.equal(email.submissionDestination, 'billing@example.com')
  assert.equal(mail.submissionDestination, '100 Main St, Austin, TX 78701')
})

test('Email and Mail submissions require a valid destination', () => {
  const missingEmail = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    submissionMethod: 'EMAIL',
    submissionDestination: '',
  }))
  const invalidEmail = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    submissionMethod: 'EMAIL',
    submissionDestination: 'not-an-email',
  }))
  const missingAddress = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    submissionMethod: 'MAIL',
    submissionDestination: '   ',
  }))
  const optionalPortal = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    submissionMethod: 'PORTAL',
    submissionDestination: '',
  }))

  assert.equal(missingEmail.success, false)
  assert.equal(invalidEmail.success, false)
  assert.equal(missingAddress.success, false)
  assert.equal(optionalPortal.success, true)
})

test('Builder Draw Schedule requires EXT, DM or HW for every Draw', () => {
  const missing = createBuilderDrawScheduleSchema([], null).safeParse({
    ...validSetup(),
    draws: [
      { percentage: 25, eventType: 'EXT' },
      { percentage: 75, eventType: '' },
    ],
  })
  const unsupported = createBuilderDrawScheduleSchema([], null).safeParse({
    ...validSetup(),
    draws: [
      { percentage: 25, eventType: 'SHUTTER' },
      { percentage: 75, eventType: 'DM' },
    ],
  })

  assert.equal(missing.success, false)
  assert.equal(unsupported.success, false)
})

test('Builder Draw Schedule allows the same event on multiple Draws', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    draws: [
      { percentage: 25, eventType: 'EXT' },
      { percentage: 25, eventType: 'DM' },
      { percentage: 25, eventType: 'HW' },
      { percentage: 25, eventType: 'HW' },
    ],
  }))

  assert.deepEqual(result.draws.map((draw) => draw.eventType), [
    'EXT', 'DM', 'HW', 'HW',
  ])
})

test('Builder Draw Schedule enables separate hardware without a fixed billing Draw', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    separateHardwarePrice: true,
  }))

  assert.equal(result.separateHardwarePrice, true)
  assert.equal('hardwareBillingDrawIndex' in result, false)
})

test('Builder Draw Schedule stores the draw used to bill selected options', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    optionsBillingDrawIndex: '2',
  }))

  assert.equal(result.optionsBillingDrawIndex, 2)
})

test('options billing draw must point to a configured draw', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    optionsBillingDrawIndex: 3,
  }))

  assert.equal(result.success, false)
  assert.deepEqual(result.error.flatten().fieldErrors.optionsBillingDrawIndex, [
    'Select one of the configured draws.',
  ])
})

test('Builder Draw Schedule stores and trims optional draw names', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    draws: [
      { name: ' Trim Complete ', percentage: 10 },
      { name: '', percentage: 75 },
      { percentage: 15 },
    ],
  }))

  assert.equal(result.draws[0].name, 'Trim Complete')
  assert.equal(result.draws[1].name, '')
  assert.equal(result.draws[2].name, '')
})

test('Builder Draw Schedule limits draw names to 80 characters', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    draws: [
      { name: 'x'.repeat(81), percentage: 10 },
      { percentage: 75 },
      { percentage: 15 },
    ],
  }))

  assert.equal(result.success, false)
  assert.equal(
    result.error.issues.some((issue) => issue.path.join('.') === 'draws.0.name'),
    true,
  )
})

test('Builder Draw Schedule accepts 5 draws with two-decimal percentages', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    draws: [
      { percentage: 16.67 },
      { percentage: 16.67 },
      { percentage: 16.66 },
      { percentage: 25 },
      { percentage: 25 },
    ],
  }))

  assert.equal(result.success, true)
})

test('Builder Draw Schedule rejects totals other than 100 percent', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    draws: [
      { percentage: 10 },
      { percentage: 70 },
      { percentage: 15 },
    ],
  }))

  assert.equal(result.success, false)
  assert.deepEqual(result.error.flatten().fieldErrors.draws, [
    'Draw percentages must total exactly 100%.',
  ])
})

test('Builder Draw Schedule requires between 2 and 5 draws', () => {
  const tooFew = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    draws: [{ percentage: 100 }],
  }))
  const tooMany = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    draws: Array.from({ length: 6 }, (_, index) => ({
      percentage: index === 5 ? 15 : 17,
    })),
  }))

  assert.equal(tooFew.success, false)
  assert.equal(tooMany.success, false)
})

test('a builder can only have one Builder Draw Schedule', () => {
  const schedules = [{ id: 1, builderId: 2 }]
  const duplicate = createBuilderDrawScheduleSchema(schedules, null).safeParse(validSetup())

  assert.equal(duplicate.success, false)
  assert.deepEqual(duplicate.error.flatten().fieldErrors.builderId, [
    'This builder already has a billing and draw setup.',
  ])
})

test('Builder Draw Schedule stores billing deductions and submission requirements', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    retentionEnabled: true,
    retentionPercentage: '10.5',
    ocipWrapEnabled: true,
    ocipWrapPercentage: '1.25',
    requiresPo: true,
    requiresPaymentSchedule: true,
    requiresRelease: true,
    requiresBackup: false,
    submissionMethod: 'PORTAL',
    submissionDestination: ' Textura ',
  }))

  assert.equal(result.retentionPercentage, 10.5)
  assert.equal(result.ocipWrapPercentage, 1.25)
  assert.equal(result.requiresPo, true)
  assert.equal(result.requiresPaymentSchedule, true)
  assert.equal(result.requiresRelease, true)
  assert.equal(result.submissionMethod, 'PORTAL')
  assert.equal(result.submissionDestination, 'Textura')
})

test('disabled retention and OCIP options clear hidden percentages', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    retentionEnabled: false,
    retentionPercentage: 10,
    ocipWrapEnabled: false,
    ocipWrapPercentage: 2,
  }))

  assert.equal(result.retentionPercentage, 0)
  assert.equal(result.ocipWrapPercentage, 0)
})

test('retention and OCIP / WRAP cannot exceed 100 percent combined', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    retentionEnabled: true,
    retentionPercentage: 60,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 50,
  }))

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.ocipWrapPercentage)
})

test('enabled retention and OCIP options require a percentage', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    retentionEnabled: true,
    retentionPercentage: 0,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 0,
  }))

  assert.equal(result.success, false)
  assert.ok(result.error.flatten().fieldErrors.retentionPercentage)
  assert.ok(result.error.flatten().fieldErrors.ocipWrapPercentage)
})

test('twice-monthly billing requires two different cutoff days', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    frequency: 'SEMIMONTHLY',
    cutoffDays: [15, 15],
  }))

  assert.equal(result.success, false)
  assert.deepEqual(result.error.flatten().fieldErrors.cutoffDays, [
    'The two cutoff days must be different.',
  ])
})

test('monthly Any date does not require a fixed cutoff day', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    frequency: 'MONTHLY',
    anyDate: true,
    cutoffDay: null,
  }))

  assert.equal(result.anyDate, true)
  assert.equal(result.cutoffDay, null)
})

test('monthly fixed cutoff still requires a cutoff day', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    frequency: 'MONTHLY',
    anyDate: false,
    cutoffDay: null,
  }))

  assert.equal(result.success, false)
  assert.deepEqual(result.error.flatten().fieldErrors.cutoffDay, [
    'Enter the monthly cutoff date.',
  ])
})
