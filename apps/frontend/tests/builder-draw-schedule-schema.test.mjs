import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBillingSettings } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import { createBuilderDrawScheduleSchema } from '../src/features/builder-draw-schedules/schemas/builderDrawScheduleSchema.js'

function validSetup(overrides = {}) {
  return {
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
}

test('Builder Draw Schedule accepts 3 draws totaling 100 percent', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup())

  assert.equal(result.builderId, 2)
  assert.equal(result.draws.length, 3)
  assert.equal(result.separateHardwarePrice, false)
})

test('Builder Draw Schedule can separate hardware at 100 percent', () => {
  const result = createBuilderDrawScheduleSchema([], null).parse(validSetup({
    separateHardwarePrice: true,
  }))

  assert.equal(result.separateHardwarePrice, true)
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
    portalName: ' Textura ',
  }))

  assert.equal(result.retentionPercentage, 10.5)
  assert.equal(result.ocipWrapPercentage, 1.25)
  assert.equal(result.requiresPo, true)
  assert.equal(result.requiresPaymentSchedule, true)
  assert.equal(result.requiresRelease, true)
  assert.equal(result.portalName, 'Textura')
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
