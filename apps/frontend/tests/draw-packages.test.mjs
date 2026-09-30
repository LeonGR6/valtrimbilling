import assert from 'node:assert/strict'
import test from 'node:test'
import { initialBuilderDrawSchedules } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import {
  buildOptionChargeContext,
  buildPackageOptionHistory,
  buildUsedDrawSelections,
  drawSelectionKey,
  formatLotRange,
  formatPackageScopeEventTypes,
  makePackageSelections,
  optionSelectionKey,
  summarizeDrawPackage,
} from '../src/features/draw-invoice/utils/drawPackages.js'
import { testJobs } from './fixtures/jobs.mjs'

const persistedPackageFixture = {
  id: 1,
  packageNumber: 'DP-00000001',
  jobId: 1,
  phaseId: 2102,
  lotIds: [3201, 3202, 3203, 3204, 3205],
  drawIndexes: [0],
  selections: [3201, 3202, 3203, 3204, 3205].map((lotId) => ({
    lotId,
    drawIndex: 0,
  })),
  status: 'AWAITING_PAYMENT',
}

test('the uniform-selection helper expands lots and draws into cells', () => {
  assert.deepEqual(makePackageSelections([18, 19, 20], [0, 2]), [
    { lotId: 18, drawIndex: 0 },
    { lotId: 18, drawIndex: 2 },
    { lotId: 19, drawIndex: 0 },
    { lotId: 19, drawIndex: 2 },
    { lotId: 20, drawIndex: 0 },
    { lotId: 20, drawIndex: 2 },
  ])
})

test('a Package can mix different Draws for different Lots', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const phase = job.sequenceSheet.phases.find((item) => item.id === 2101)
  const schedule = initialBuilderDrawSchedules.find(
    (item) => item.builderId === job.builderId,
  )
  const firstPackage = {
    id: 90,
    jobId: job.id,
    phaseId: phase.id,
    selections: makePackageSelections([3101, 3102, 3103], [0]),
  }
  const selections = [
    { lotId: 3104, drawIndex: 0 },
    { lotId: 3105, drawIndex: 0 },
    { lotId: 3101, drawIndex: 1 },
    { lotId: 3102, drawIndex: 1 },
    { lotId: 3103, drawIndex: 1 },
  ]
  const used = buildUsedDrawSelections([firstPackage])
  const summary = summarizeDrawPackage({
    lotIds: [3101, 3102, 3103, 3104, 3105],
    drawIndexes: [0, 1],
    selections,
  }, job, phase, schedule)

  assert.equal(
    selections.every(({ lotId, drawIndex }) => (
      !used.has(drawSelectionKey(job.id, phase.id, lotId, drawIndex))
    )),
    true,
  )
  assert.equal(summary.lotCount, 5)
  assert.equal(summary.scopeCount, 5)
})

test('a Package can combine Draw selections from multiple Phases of one Job', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const phases = job.sequenceSheet.phases
  const schedule = initialBuilderDrawSchedules.find(
    (item) => item.builderId === job.builderId,
  )
  const record = {
    jobId: job.id,
    selections: [
      { phaseId: 2101, lotId: 3101, drawIndex: 2 },
      { phaseId: 2101, lotId: 3102, drawIndex: 2 },
      { phaseId: 2102, lotId: 3201, drawIndex: 1 },
      { phaseId: 2102, lotId: 3202, drawIndex: 1 },
    ],
  }

  const summary = summarizeDrawPackage(record, job, phases, schedule)

  assert.equal(summary.phaseCount, 2)
  assert.equal(summary.lotCount, 4)
  assert.equal(summary.scopeCount, 4)
  assert.deepEqual(summary.scopeEventTypes, ['DM', 'HW'])
  assert.deepEqual(summary.phaseSummaries.map((scope) => ({
    phaseId: scope.phaseId,
    draw: scope.draws[0].drawIndex,
    lots: scope.draws[0].lotRange,
  })), [
    { phaseId: 2102, draw: 1, lots: '66–67' },
    { phaseId: 2101, draw: 2, lots: '18–19' },
  ])
})

test('lot ranges remain compact without hiding unselected lots', () => {
  assert.equal(formatLotRange(['22', '18', '19', '20']), '18–20, 22')
  assert.equal(formatLotRange(['66', '67', '68', '69', '70']), '66–70')
  assert.equal(formatLotRange(['A2', 'A1']), 'A1, A2')
  assert.equal(formatLotRange([]), '—')
})

test('Package scopes list unique billing events separated by slashes', () => {
  assert.equal(
    formatPackageScopeEventTypes(['EXT', 'DM', 'HW', 'HW']),
    'EXT / DM / HW',
  )
  assert.equal(formatPackageScopeEventTypes([]), '—')
})

test('used lot and draw combinations point back to their package', () => {
  const used = buildUsedDrawSelections([persistedPackageFixture])
  const record = persistedPackageFixture

  assert.equal(
    used.get(drawSelectionKey(1, 2102, 3201, 0)),
    record,
  )
  assert.equal(used.has(drawSelectionKey(1, 2102, 3201, 1)), false)
})

test('paid and closed packages preserve the historical lot and draw usage', () => {
  const record = {
    ...persistedPackageFixture,
    status: 'PAID_CLOSED',
  }

  assert.equal(buildUsedDrawSelections([record]).size, 5)
})

test('package totals include only selected lots and draws', () => {
  const job = testJobs.find((item) => item.code === '1307')
  const phase = job.sequenceSheet.phases.find((item) => item.id === 2101)
  const schedule = initialBuilderDrawSchedules.find(
    (item) => item.builderId === job.builderId,
  )
  const record = {
    lotIds: [3101, 3102, 3103],
    drawIndexes: [1],
    selections: makePackageSelections([3101, 3102, 3103], [1]),
  }
  const summary = summarizeDrawPackage(record, job, phase, schedule)

  assert.equal(summary.lotCount, 3)
  assert.equal(summary.lotRange, '18–20')
  assert.equal(summary.scopeCount, 3)
  assert.equal(summary.currentDraw, 15042.75)
  assert.equal(summary.retention, 752.14)
  assert.equal(summary.wrapInsurance, 376.07)
  assert.equal(summary.invoiceAmount, 13914.54)
})

test('options are added once when the package includes the builder billing draw', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{ id: 10, code: 'OPT-10', description: 'Door upgrade', price: 100 }],
      }],
    },
  }
  const phase = {
    lots: [{ id: 1, lotNumber: '19', planId: 1, optionIds: [10] }],
  }
  const schedule = {
    draws: [{ percentage: 50 }, { percentage: 50 }],
    optionsBillingDrawIndex: 1,
    retentionEnabled: true,
    retentionPercentage: 10,
  }
  const firstDraw = {
    lotIds: [1],
    drawIndexes: [0],
    selections: makePackageSelections([1], [0]),
  }
  const secondDraw = {
    lotIds: [1],
    drawIndexes: [1],
    selections: makePackageSelections([1], [1]),
  }

  const firstSummary = summarizeDrawPackage(firstDraw, job, phase, schedule)
  const secondSummary = summarizeDrawPackage(secondDraw, job, phase, schedule)

  assert.equal(firstSummary.optionsAreDue, false)
  assert.equal(firstSummary.optionsTotal, 0)
  assert.equal(firstSummary.invoiceAmount, 450)
  assert.equal(secondSummary.optionsAreDue, true)
  assert.equal(secondSummary.optionRows.length, 1)
  assert.equal(secondSummary.optionsTotal, 100)
  assert.equal(secondSummary.grossAmount, 600)
  assert.equal(secondSummary.retention, 60)
  assert.equal(secondSummary.invoiceAmount, 540)
})

test('pending options can be charged on any Draw after the configured Draw', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{ id: 10, code: 'OPT-10', description: 'Door upgrade', price: 100 }],
      }],
    },
  }
  const phase = {
    id: 3,
    lots: [{ id: 1, lotNumber: '19', planId: 1, optionIds: [10] }],
  }
  const schedule = {
    draws: [{ percentage: 30 }, { percentage: 30 }, { percentage: 40 }],
    optionsBillingDrawIndex: 1,
  }
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 2 }],
  }, job, phase, schedule)

  assert.equal(summary.optionsAreDue, true)
  assert.equal(summary.optionChargeDrawIndex, 2)
  assert.equal(summary.selectedOptionRows.length, 1)
  assert.equal(summary.optionsTotal, 100)
  assert.equal(summary.grossAmount, 500)
})

test('options apply only to Lots selected at or after the configured billing Draw', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{ id: 10, code: 'OPT-10', description: 'Door upgrade', price: 100 }],
      }],
    },
  }
  const phase = {
    lots: [
      { id: 1, lotNumber: '19', planId: 1, optionIds: [10] },
      { id: 2, lotNumber: '20', planId: 1, optionIds: [10] },
    ],
  }
  const schedule = {
    draws: [{ percentage: 30 }, { percentage: 30 }, { percentage: 40 }],
    optionsBillingDrawIndex: 1,
  }
  const summary = summarizeDrawPackage({
    lotIds: [1, 2],
    drawIndexes: [0, 1],
    selections: [
      { lotId: 1, drawIndex: 1 },
      { lotId: 2, drawIndex: 0 },
    ],
  }, job, phase, schedule)

  assert.equal(summary.scopeCount, 2)
  assert.equal(summary.optionsAreDue, true)
  assert.equal(summary.selectedOptionRows.length, 1)
  assert.equal(summary.selectedOptionRows[0].lotId, 1)
  assert.equal(summary.optionsTotal, 100)
})

test('pending Options remain available after their Lot billing Draw was used', () => {
  const job = {
    id: 8,
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{ id: 10, code: 'OPT-10', description: 'Door upgrade', price: 100 }],
      }],
    },
  }
  const phase = {
    id: 3,
    lots: [
      { id: 1, lotNumber: '19', planId: 1, optionIds: [10] },
      { id: 2, lotNumber: '20', planId: 1, optionIds: [10] },
    ],
  }
  const schedule = {
    draws: [{ percentage: 30 }, { percentage: 30 }, { percentage: 40 }],
    optionsBillingDrawIndex: 1,
  }
  const context = buildOptionChargeContext([{
    id: 90,
    packageNumber: 'DP-00000090',
    jobId: 8,
    status: 'DRAFT',
    optionsBillingDrawIndex: 1,
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 1 }],
    persistedOptionLines: [],
  }], 8, 1)
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 2, drawIndex: 2 }],
    ...context,
  }, job, phase, schedule)

  assert.deepEqual(
    summary.availableOptionRows.map((option) => option.lotId),
    [1, 2],
  )
  assert.deepEqual(
    summary.selectedOptionRows.map((option) => option.lotId),
    [1, 2],
  )
  assert.equal(summary.optionsTotal, 200)
  assert.equal(summary.optionChargeDrawIndex, 2)
})

test('previously billed Options are visible but excluded from a new Package', () => {
  const job = {
    id: 8,
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{ id: 10, code: 'OPT-10', description: 'Door upgrade', price: 125 }],
      }],
    },
  }
  const phase = {
    id: 3,
    lots: [
      { id: 1, lotNumber: '19', planId: 1, optionIds: [10] },
      { id: 2, lotNumber: '20', planId: 1, optionIds: [10] },
    ],
  }
  const schedule = {
    draws: [{ percentage: 30 }, { percentage: 30 }, { percentage: 40 }],
    optionsBillingDrawIndex: 1,
  }
  const context = buildOptionChargeContext([{
    id: 90,
    packageNumber: 'DP-00000090',
    jobId: 8,
    status: 'DRAFT',
    optionsBillingDrawIndex: 1,
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 1 }],
    persistedOptionLines: [{ lotId: 1, optionId: 10, price: 100 }],
  }], 8, 1)
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 2, drawIndex: 2 }],
    ...context,
  }, job, phase, schedule)

  assert.equal(summary.availableOptionRows.length, 2)
  assert.equal(summary.availableOptionRows[0].isBilled, true)
  assert.equal(summary.availableOptionRows[0].billedPackageNumber, 'DP-00000090')
  assert.equal(summary.availableOptionRows[0].billedPrice, 100)
  assert.deepEqual(
    summary.selectedOptionRows.map((option) => option.lotId),
    [2],
  )
  assert.equal(summary.billedOptionCount, 1)
  assert.equal(summary.optionsTotal, 125)
})

test('Package Option history includes earlier charges through the current Package', () => {
  const packages = [
    {
      id: 27,
      packageNumber: 'DP-00000027',
      jobId: 8,
      createdAt: '2026-09-29T15:00:00Z',
      status: 'DRAFT',
      persistedOptionLines: [{ id: '1:12', lotId: 1, optionId: 12 }],
    },
    {
      id: 26,
      packageNumber: 'DP-00000026',
      jobId: 8,
      createdAt: '2026-09-28T15:00:00Z',
      status: 'DRAFT',
      persistedOptionLines: [
        { id: '1:10', lotId: 1, optionId: 10 },
        { id: '1:11', lotId: 1, optionId: 11 },
      ],
    },
    {
      id: 28,
      packageNumber: 'DP-00000028',
      jobId: 8,
      createdAt: '2026-09-30T15:00:00Z',
      status: 'DRAFT',
      persistedOptionLines: [{ id: '1:13', lotId: 1, optionId: 13 }],
    },
    {
      id: 25,
      packageNumber: 'DP-00000025',
      jobId: 9,
      createdAt: '2026-09-27T15:00:00Z',
      status: 'DRAFT',
      persistedOptionLines: [{ id: '1:14', lotId: 1, optionId: 14 }],
    },
  ]

  const history = buildPackageOptionHistory(packages, packages[0])

  assert.deepEqual(history.map((option) => ({
    optionId: option.optionId,
    chargedWith: option.chargedPackageNumber,
    isCurrent: option.chargedInCurrentPackage,
  })), [
    { optionId: 10, chargedWith: 'DP-00000026', isCurrent: false },
    { optionId: 11, chargedWith: 'DP-00000026', isCurrent: false },
    { optionId: 12, chargedWith: 'DP-00000027', isCurrent: true },
  ])
})

test('cancelled Packages do not contribute Options to package history', () => {
  const currentPackage = {
    id: 27,
    packageNumber: 'DP-00000027',
    jobId: 8,
    createdAt: '2026-09-29T15:00:00Z',
    status: 'DRAFT',
    persistedOptionLines: [{ id: '1:12', lotId: 1, optionId: 12 }],
  }
  const history = buildPackageOptionHistory([
    {
      id: 26,
      packageNumber: 'DP-00000026',
      jobId: 8,
      createdAt: '2026-09-28T15:00:00Z',
      status: 'CANCELLED',
      persistedOptionLines: [{ id: '1:10', lotId: 1, optionId: 10 }],
    },
    currentPackage,
  ], currentPackage)

  assert.deepEqual(history.map((option) => option.optionId), [12])
})

test('Package creation can exclude individual Options from the billing Draw', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [
          { id: 10, code: 'OPT-10', description: 'Door upgrade', price: 100 },
          { id: 11, code: 'OPT-11', description: 'Window upgrade', price: 75 },
        ],
      }],
    },
  }
  const phase = {
    id: 3,
    lots: [{ id: 1, lotNumber: '19', planId: 1, optionIds: [10, 11] }],
  }
  const schedule = {
    draws: [{ percentage: 50 }, { percentage: 50 }],
    optionsBillingDrawIndex: 1,
  }
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 1 }],
    excludedOptionKeys: [optionSelectionKey(3, 1, 11)],
  }, job, phase, schedule)

  assert.equal(summary.availableOptionRows.length, 2)
  assert.deepEqual(
    summary.selectedOptionRows.map((option) => option.optionId),
    [10],
  )
  assert.equal(summary.optionsTotal, 100)
  assert.equal(summary.grossAmount, 600)
})

test('an excluded unpriced Option does not block Package creation', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{
          id: 10,
          code: 'OPT-10',
          description: 'Door upgrade',
          price: null,
        }],
      }],
    },
  }
  const phase = {
    id: 3,
    lots: [{ id: 1, lotNumber: '19', planId: 1, optionIds: [10] }],
  }
  const schedule = {
    draws: [{ percentage: 50 }, { percentage: 50 }],
    optionsBillingDrawIndex: 1,
  }
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 1 }],
    excludedOptionKeys: [optionSelectionKey(3, 1, 10)],
  }, job, phase, schedule)

  assert.equal(summary.availableOptionRows.length, 1)
  assert.equal(summary.selectedOptionRows.length, 0)
  assert.equal(summary.unpricedOptionCount, 0)
  assert.equal(summary.optionsTotal, 0)
})

test('an unpriced option is reported when its billing draw is selected', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{ id: 10, code: 'OPT-10', description: 'Door upgrade', price: null }],
      }],
    },
  }
  const phase = {
    lots: [{ id: 1, lotNumber: '19', planId: 1, optionIds: [10] }],
  }
  const schedule = {
    draws: [{ percentage: 50 }, { percentage: 50 }],
    optionsBillingDrawIndex: 1,
  }
  const record = {
    lotIds: [1],
    drawIndexes: [1],
    selections: makePackageSelections([1], [1]),
  }
  const summary = summarizeDrawPackage(record, job, phase, schedule)

  assert.equal(summary.unpricedOptionCount, 1)
  assert.equal(summary.optionsTotal, 0)
})

test('persisted package totals use immutable database snapshots', () => {
  const record = {
    lotIds: [1],
    drawIndexes: [1],
    selections: makePackageSelections([1], [1]),
    optionsBillingDrawIndex: 1,
    persistedInvoice: {
      grossAmount: 1125.5,
      retentionAmount: 56.28,
      wrapAmount: 22.51,
      netAmount: 1046.71,
    },
    persistedDrawLines: [{
      lotId: 1,
      lotNumber: '19',
      drawIndex: 1,
      eventType: 'HW',
    }],
    persistedOptionLines: [{
      id: '1:10',
      lotId: 1,
      lotNumber: '19',
      planCode: 'A',
      optionId: 10,
      optionCode: 'OPT-10',
      description: 'Door upgrade',
      price: 125,
      issue: null,
    }],
  }
  const summary = summarizeDrawPackage(
    record,
    { sequenceSheet: { plans: [] } },
    { lots: [] },
    {
      draws: [
        { percentage: 50, eventType: 'EXT' },
        { percentage: 50, eventType: 'DM' },
      ],
    },
  )

  assert.equal(summary.currentDraw, 1125.5)
  assert.equal(summary.retention, 56.28)
  assert.equal(summary.wrapInsurance, 22.51)
  assert.equal(summary.invoiceAmount, 1046.71)
  assert.equal(summary.optionsTotal, 125)
  assert.equal(summary.lotRange, '19')
  assert.deepEqual(summary.scopeEventTypes, ['HW'])
})
