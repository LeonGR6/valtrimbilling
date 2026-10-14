import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPackageSuggestions,
  countBusinessDaysThroughCutoff,
  resolveJobBillingSchedule,
  selectUpcomingCutoffSuggestions,
} from '../src/features/draw-invoice/utils/packageSuggestions.js'

function buildSchedule(overrides = {}) {
  return {
    id: 501,
    builderId: 7,
    frequency: 'MONTHLY',
    anyDate: false,
    cutoffDay: 10,
    cutoffDays: [],
    cutoffWeekday: 1,
    draws: [{ name: 'Draw 1', percentage: 100, eventType: 'EXT' }],
    separateHardwarePrice: false,
    utilityBuilding: false,
    utilityBillingMode: 'FULL',
    utilityEventPercentages: { EXT: 0, DM: 0, HW: 0 },
    optionsBillingDrawIndex: null,
    retentionEnabled: false,
    retentionPercentage: 0,
    ocipWrapEnabled: false,
    ocipWrapPercentage: 0,
    ...overrides,
  }
}

function buildJob(overrides = {}) {
  return {
    id: 11,
    code: '1427',
    builderId: 7,
    builder: 'Acme Builder',
    community: 'Stone Creek',
    billingSetupVersionId: 501,
    isActive: true,
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 1000, options: [] }],
      phases: [{
        id: 21,
        name: '1',
        building: 'A',
        lots: [{
          id: 101,
          lotNumber: '101',
          planId: 1,
          optionIds: [],
        }],
      }],
    },
    ...overrides,
  }
}

function buildActivity(overrides = {}) {
  return {
    id: 91,
    jobId: 11,
    phaseId: 21,
    status: 'ACTIVE',
    stages: [{
      id: 92,
      type: 'EXT',
      isEnabled: true,
      schedules: [{
        id: 93,
        date: '2026-10-05',
        lotIds: [101],
        isActive: true,
      }],
    }],
    ...overrides,
  }
}

test('business-day countdown includes today and ignores weekend cutoff dates', () => {
  assert.equal(
    countBusinessDaysThroughCutoff('2026-10-05', '2026-10-10'),
    5,
  )
  assert.equal(
    countBusinessDaysThroughCutoff('2026-10-06', '2026-10-10'),
    4,
  )
  assert.equal(
    countBusinessDaysThroughCutoff('2026-10-10', '2026-10-10'),
    0,
  )
  assert.equal(
    countBusinessDaysThroughCutoff('2026-10-11', '2026-10-10'),
    null,
  )
})

test('Job immutable Billing Setup version wins over the current Builder schedule', () => {
  const job = buildJob()
  const immutableVersion = buildSchedule({ id: 501, cutoffDay: 10 })
  const currentBuilderSchedule = buildSchedule({ id: 999, cutoffDay: 20 })

  assert.equal(
    resolveJobBillingSchedule(
      job,
      [currentBuilderSchedule],
      [immutableVersion],
    ).id,
    501,
  )
})

test('Package Suggestions expose actionable Job and Phase work inside five business days', () => {
  const suggestions = buildPackageSuggestions({
    jobs: [buildJob()],
    schedules: [buildSchedule({ id: 999, cutoffDay: 20 })],
    jobBillingSetupVersions: [buildSchedule()],
    packages: [],
    productionActivities: [buildActivity()],
    asOfDate: '2026-10-05',
  })

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].cutoffDate, '2026-10-10')
  assert.equal(suggestions[0].businessDaysRemaining, 5)
  assert.equal(suggestions[0].selectionCount, 1)
  assert.deepEqual(suggestions[0].eventTypes, ['EXT'])
  assert.deepEqual(suggestions[0].phases.map(({ id }) => id), [21])
  assert.equal(suggestions[0].initialPhaseId, 21)
  assert.equal(suggestions[0].estimatedInvoiceAmount, 1000)
  assert.equal(suggestions[0].isReady, true)
})

test('Package Suggestions expose HW Calendar work when the Builder has no HW Draw', () => {
  const job = buildJob()
  job.sequenceSheet.plans[0].hardwarePrice = 600
  const suggestions = buildPackageSuggestions({
    jobs: [job],
    jobBillingSetupVersions: [buildSchedule({
      separateHardwarePrice: true,
      hardwareBillingMode: 'BY_EVENT',
      hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
      draws: [{ name: 'Draw 1', percentage: 100, eventType: 'EXT' }],
    })],
    packages: [],
    productionActivities: [buildActivity({
      stages: [{
        id: 92,
        type: 'HW',
        isEnabled: true,
        schedules: [{
          id: 93,
          date: '2026-10-05',
          lotIds: [101],
          isActive: true,
        }],
      }],
    })],
    asOfDate: '2026-10-05',
  })

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].drawSelectionCount, 0)
  assert.equal(suggestions[0].hardwareSelectionCount, 1)
  assert.equal(suggestions[0].selectionCount, 1)
  assert.deepEqual(suggestions[0].eventTypes, ['HW'])
  assert.equal(suggestions[0].estimatedInvoiceAmount, 600)
  assert.equal(suggestions[0].isReady, true)
})

test('Package Suggestions omit fixed cutoffs outside the five-business-day window', () => {
  const suggestions = buildPackageSuggestions({
    jobs: [buildJob()],
    jobBillingSetupVersions: [buildSchedule({ cutoffDay: 20 })],
    packages: [],
    productionActivities: [buildActivity()],
    asOfDate: '2026-10-05',
  })

  assert.deepEqual(suggestions, [])
})

test('Any date work remains visible and unpriced options are marked for attention', () => {
  const job = buildJob()
  job.sequenceSheet.plans[0].options = [{
    id: 301,
    code: 'OPT-1',
    description: 'Upgrade',
    price: null,
  }]
  job.sequenceSheet.phases[0].lots[0].optionIds = [301]

  const suggestions = buildPackageSuggestions({
    jobs: [job],
    jobBillingSetupVersions: [buildSchedule({
      anyDate: true,
      cutoffDay: null,
      optionsBillingDrawIndex: 0,
    })],
    packages: [],
    productionActivities: [buildActivity()],
    asOfDate: '2026-10-05',
  })

  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].mode, 'ANY_DATE')
  assert.equal(suggestions[0].businessDaysRemaining, null)
  assert.equal(suggestions[0].unpricedOptionCount, 1)
  assert.equal(suggestions[0].isReady, false)
})

test('Home selects only the three closest fixed-cutoff Package Suggestions', () => {
  const suggestions = [
    { mode: 'ANY_DATE', cutoffDate: null, job: { code: '10', builder: 'Acme' } },
    { mode: 'CUTOFF', cutoffDate: '2026-10-09', job: { code: '20', builder: 'Acme' } },
    { mode: 'CUTOFF', cutoffDate: '2026-10-07', job: { code: '30', builder: 'Bravo' } },
    { mode: 'CUTOFF', cutoffDate: '2026-10-07', job: { code: '11', builder: 'Acme' } },
    { mode: 'CUTOFF', cutoffDate: '2026-10-08', job: { code: '40', builder: 'Acme' } },
  ]

  assert.deepEqual(
    selectUpcomingCutoffSuggestions(suggestions).map(({ job }) => job.code),
    ['11', '30', '40'],
  )
})
