import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultBillingSettings,
  invoiceLineFormatOptions,
  submissionMethodOptions,
} from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import {
  createBuilderDrawScheduleSchema,
  percentageFromFraction,
} from '../src/features/builder-draw-schedules/schemas/builderDrawScheduleSchema.js'

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
    { value: 'BUILDING_SCOPE', label: 'One line per building and scope' },
    { value: 'LOT_SCOPE', label: 'One line per lot and scope' },
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

test('Builder Draw Schedule supports Portal, Email, Mail, Supply Pro, Textura, KB IE and KB LA submission', () => {
  assert.deepEqual(submissionMethodOptions, [
    { value: 'PORTAL', label: 'Portal' },
    { value: 'EMAIL', label: 'Email' },
    { value: 'MAIL', label: 'Mail' },
    { value: 'SUPPLY_PRO', label: 'Supply Pro' },
    { value: 'TEXTURA', label: 'Textura' },
    { value: 'KB_IE', label: 'KB IE' },
    { value: 'KB_LA', label: 'KB LA' },
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

test('Builder Draw Schedule allocates Separate Hardware across Draw events', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 20, DM: 30, HW: 50 },
  }))

  assert.equal(result.separateHardwarePrice, true)
  assert.equal(result.hardwareBillingMode, 'BY_EVENT')
  assert.deepEqual(result.hardwareEventPercentages, { EXT: 20, DM: 30, HW: 50 })
  assert.equal('hardwareBillingDrawIndex' in result, false)
})

test('Separate Hardware requires 100 percent but does not require matching Draw events', () => {
  const schema = createBuilderDrawScheduleSchema([], null)
  const incomplete = schema.safeParse(validSetup({
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 20, DM: 30, HW: 40 },
  }))
  const missingEvent = schema.safeParse(validSetup({
    draws: [
      { percentage: 50, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
    ],
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 50, DM: 25, HW: 25 },
  }))

  assert.equal(incomplete.success, false)
  assert.equal(missingEvent.success, true)
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
    finalReleaseScope: 'PHASE',
    requiresBackup: false,
    submissionMethod: 'PORTAL',
    submissionDestination: ' Textura ',
  }))

  assert.equal(result.retentionPercentage, 10.5)
  assert.equal(result.retentionReleaseScope, 'JOB')
  assert.equal(result.ocipWrapPercentage, 1.25)
  assert.equal(result.requiresPo, true)
  assert.equal(result.requiresPaymentSchedule, true)
  assert.equal(result.requiresRelease, true)
  assert.equal(result.submissionMethod, 'PORTAL')
  assert.equal(result.submissionDestination, 'Textura')
})

test('Supply Pro, Textura, KB IE and KB LA are accepted without a destination', () => {
  for (const submissionMethod of ['SUPPLY_PRO', 'TEXTURA', 'KB_IE', 'KB_LA']) {
    const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
      submissionMethod,
      submissionDestination: '',
    }))

    assert.equal(result.success, true, submissionMethod)
    assert.equal(result.data.submissionMethod, submissionMethod)
  }

  const unknown = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    submissionMethod: 'FAX',
  }))
  assert.equal(unknown.success, false)
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
    retentionPercentage: 100,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 1,
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

test('A required Release needs the Conditional Final scope', () => {
  const schema = createBuilderDrawScheduleSchema([], null)

  const missing = schema.safeParse(validSetup({ requiresRelease: true }))
  assert.equal(missing.success, false)
  assert.deepEqual(missing.error.issues[0].path, ['finalReleaseScope'])

  for (const scope of ['PHASE', 'BUILDING', 'PROJECT']) {
    const result = schema.parse(validSetup({
      requiresRelease: true,
      finalReleaseScope: scope,
    }))
    assert.equal(result.finalReleaseScope, scope)
  }

  assert.equal(schema.safeParse(validSetup()).success, true)
})

test('retention reads a fraction as the same percentage', () => {
  const schema = createBuilderDrawScheduleSchema([], null)
  const parse = (retention) => schema.parse(validSetup({
    retentionEnabled: true,
    retentionPercentage: retention,
  })).retentionPercentage

  assert.equal(parse('0.0833'), 8.33)
  assert.equal(parse('8.33'), 8.33)
  // More decimals than the database keeps are rounded, not rejected.
  assert.equal(parse('0.08333'), 8.33)
  // 1 is one percent, not a whole; typing a number over 1 is never a fraction.
  assert.equal(parse('1'), 1)
  assert.equal(parse(0.1), 10)
})

test('OCIP / WRAP accepts from 0.001 percent up to 10 percent, typed as a percentage', () => {
  const schema = createBuilderDrawScheduleSchema([], null)
  const parse = (wrap) => schema.safeParse(validSetup({
    ocipWrapEnabled: true,
    ocipWrapPercentage: wrap,
  }))

  for (const [typed, stored] of [
    ['0.001', 0.001], ['0.05', 0.05], [0.5, 0.5], ['1.25', 1.25], ['9.999', 9.999], [10, 10],
  ]) {
    const result = parse(typed)
    assert.equal(result.success, true, `${typed} should be accepted`)
    assert.equal(result.data.ocipWrapPercentage, stored)
  }
})

test('OCIP / WRAP rejects what is under 0.001, over 10 or has more than three decimals', () => {
  const schema = createBuilderDrawScheduleSchema([], null)

  for (const wrap of ['0.0005', '0.0001', '10.001', 11, 50, '1.2345', -1]) {
    const result = schema.safeParse(validSetup({
      ocipWrapEnabled: true,
      ocipWrapPercentage: wrap,
    }))
    assert.equal(result.success, false, `${wrap} should be rejected`)
    assert.ok(result.error.flatten().fieldErrors.ocipWrapPercentage.length > 0)
  }
})

test('a fraction too small to be a percentage of at least 1 is still rejected', () => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(validSetup({
    retentionEnabled: true,
    retentionPercentage: '0.005',
  }))

  assert.equal(result.success, false)
  assert.equal(result.error.flatten().fieldErrors.retentionPercentage.length > 0, true)
})

test('percentageFromFraction only answers for values above 0 and under 1', () => {
  assert.equal(percentageFromFraction('0.0833'), 8.33)
  assert.equal(percentageFromFraction(0.5), 50)
  for (const value of ['', null, undefined, 0, '0', 1, '8.33', 100, -0.2, 'abc']) {
    assert.equal(percentageFromFraction(value), null)
  }
})
