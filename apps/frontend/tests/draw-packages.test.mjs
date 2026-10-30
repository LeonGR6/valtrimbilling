import assert from 'node:assert/strict'
import test from 'node:test'
import { initialBuilderDrawSchedules } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import {
  buildBilledUtilityRows,
  buildBilledUtilityCharges,
  buildBilledHardwareCharges,
  buildBilledHardwareLots,
  buildOptionChargeContext,
  buildPackageOptionHistory,
  buildUsedDrawSelections,
  describeRetentionSource,
  drawSelectionKey,
  hardwareChargeKey,
  formatLotRange,
  formatPackageScopeEventTypes,
  makePackageSelections,
  optionSelectionKey,
  summarizeDrawPackage,
  summarizeRetentionSource,
  summarizeSelectedDrawCells,
  utilityChargeKey,
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

test('persisted package exposes only the Draw cells that charged Hardware', () => {
  const record = {
    selections: [
      { phaseId: 3, lotId: 1, drawIndex: 0 },
      { phaseId: 3, lotId: 2, drawIndex: 1 },
    ],
    separateHardwarePrice: true,
    persistedInvoice: {
      grossAmount: 3100,
      retentionAmount: 0,
      wrapAmount: 0,
      netAmount: 3100,
    },
    persistedDrawLines: [
      {
        phaseId: 3,
        phaseCode: '5',
        building: '9',
        lotId: 1,
        lotNumber: '10',
        planCode: 'A',
        drawIndex: 0,
        drawName: 'Exterior',
        hardwareAmount: 0,
      },
      {
        phaseId: 3,
        phaseCode: '5',
        building: '9',
        lotId: 2,
        lotNumber: '11',
        planCode: 'B',
        drawIndex: 1,
        drawName: 'Hardware',
        hardwareAmount: 600,
      },
    ],
    persistedOptionLines: [],
  }

  const summary = summarizeDrawPackage(
    record,
    { sequenceSheet: { plans: [] } },
    { id: 3, name: '5', building: '9', lots: [] },
    { draws: [{ percentage: 50 }, { percentage: 50 }] },
  )

  assert.equal(summary.hardwareIsDue, true)
  assert.equal(summary.hardwareTotal, 600)
  assert.deepEqual(summary.hardwareRows, [record.persistedDrawLines[1]])
})

test('persisted hardware amounts remain visible when setup metadata is stale', () => {
  const hardwareLine = {
    phaseId: 3,
    phaseCode: '5',
    building: '9',
    lotId: 2,
    lotNumber: '11',
    planCode: 'B',
    drawIndex: 2,
    drawName: 'Hardware',
    hardwareAmount: 600,
  }
  const summary = summarizeDrawPackage(
    {
      selections: [{ phaseId: 3, lotId: 2, drawIndex: 2 }],
      separateHardwarePrice: false,
      persistedInvoice: {
        grossAmount: 600,
        retentionAmount: 0,
        wrapAmount: 0,
        netAmount: 600,
      },
      persistedDrawLines: [hardwareLine],
      persistedOptionLines: [],
    },
    { sequenceSheet: { plans: [] } },
    { id: 3, name: '5', building: '9', lots: [] },
    { draws: [{ percentage: 40 }, { percentage: 60 }] },
  )

  assert.equal(summary.separateHardwarePrice, true)
  assert.equal(summary.hardwareIsDue, true)
  assert.equal(summary.hardwareTotal, 600)
  assert.deepEqual(summary.hardwareRows, [hardwareLine])
})

test('persisted package hides Draw cells that did not charge Hardware', () => {
  const summary = summarizeDrawPackage(
    {
      selections: [{ phaseId: 3, lotId: 1, drawIndex: 0 }],
      separateHardwarePrice: true,
      persistedInvoice: {
        grossAmount: 850,
        retentionAmount: 0,
        wrapAmount: 0,
        netAmount: 850,
      },
      persistedDrawLines: [{
        phaseId: 3,
        phaseCode: '5',
        building: '9',
        lotId: 1,
        lotNumber: '10',
        planCode: 'A',
        drawIndex: 0,
        drawName: 'Exterior',
        hardwareAmount: 0,
      }],
      persistedOptionLines: [],
    },
    { sequenceSheet: { plans: [] } },
    { id: 3, name: '5', building: '9', lots: [] },
    { draws: [{ percentage: 85 }, { percentage: 15 }] },
  )

  assert.equal(summary.hardwareIsDue, false)
  assert.equal(summary.hardwareTotal, 0)
  assert.deepEqual(summary.hardwareRows, [])
})

test('Package estimates include separated hardware only on checked Draw cells', () => {
  const job = {
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 3000, hardwarePrice: 1000 }],
    },
  }
  const phase = {
    id: 3,
    lots: [{ id: 1, lotNumber: '1', planId: 1, optionIds: [] }],
  }
  const schedule = {
    separateHardwarePrice: true,
    draws: [{ percentage: 85 }, { percentage: 15 }],
  }

  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 1 }],
    hardwareSelectionKeys: ['3:1:1'],
  }, job, phase, schedule)

  assert.equal(summary.currentDraw, 1450)
  assert.equal(summary.invoiceAmount, 1450)
  assert.equal(summary.hardwareIsDue, true)
  assert.equal(summary.hardwareTotal, 1000)
  assert.deepEqual(summary.hardwareRows, [{
    selectionKey: '3:1:1',
    phaseId: 3,
    phaseCode: null,
    building: null,
    lotId: 1,
    lotNumber: '1',
    planCode: 'A',
    drawIndex: 1,
    drawName: '',
    eventType: null,
    hardwareBillingMode: 'FULL',
    hardwareEventType: null,
    hardwarePercentage: 100,
    hardwareAmount: 1000,
    chargeHardware: true,
  }])
})

test('Package estimates leave Hardware optional when no Draw is checked', () => {
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 1 }],
    hardwareSelectionKeys: [],
  }, {
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 3000, hardwarePrice: 1000 }],
    },
  }, {
    id: 3,
    lots: [{ id: 1, lotNumber: '1', planId: 1, optionIds: [] }],
  }, {
    separateHardwarePrice: true,
    draws: [{ percentage: 85 }, { percentage: 15 }],
  })

  assert.equal(summary.currentDraw, 450)
  assert.equal(summary.hardwareIsDue, false)
  assert.equal(summary.hardwareTotal, 0)
  assert.equal(summary.hardwareRows[0].chargeHardware, false)
})

test('Utility Building charges the full Plan price once on the selected Draw', () => {
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 101, drawIndex: 1 }],
    hardwareSelectionKeys: ['3:101:1'],
  }, {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'CLUB',
        price: 12500,
        hardwarePrice: 2500,
        options: [{ id: 10, code: 'OPT', price: 500 }],
      }],
    },
  }, {
    id: 3,
    name: 'UTILITY',
    building: 'CLUBHOUSE',
    lots: [{
      id: 101,
      lotNumber: 'UTILITY-1',
      utilityName: 'Clubhouse',
      planId: 1,
      optionIds: [10],
      isUtilityBuilding: true,
    }],
  }, {
    utilityBuilding: true,
    separateHardwarePrice: true,
    optionsBillingDrawIndex: 1,
    draws: [{ percentage: 85 }, { percentage: 15 }],
  })

  assert.equal(summary.currentDraw, 12500)
  assert.equal(summary.grossAmount, 12500)
  assert.equal(summary.invoiceAmount, 12500)
  assert.equal(summary.lotCount, 0)
  assert.equal(summary.lotRange, '—')
  assert.equal(summary.utilityCount, 1)
  assert.equal(summary.utilityTotal, 12500)
  assert.equal(summary.utilityRows[0].utilityLabel, 'Clubhouse')
  assert.equal(summary.hardwareTotal, 0)
  assert.equal(summary.optionsTotal, 0)
  assert.equal(summary.utilityRows[0].drawIndex, 1)
})

test('Utility Building charges only the configured event portion in a Package', () => {
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 101, drawIndex: 0 }],
  }, {
    sequenceSheet: {
      plans: [{ id: 1, code: 'CLUB', price: 12000, options: [] }],
    },
  }, {
    id: 3,
    name: '1',
    building: 'A',
    lots: [{
      id: 101,
      lotNumber: 'UTILITY-1',
      utilityName: 'Clubhouse',
      planId: 1,
      optionIds: [],
      isUtilityBuilding: true,
    }],
  }, {
    utilityBuilding: true,
    utilityBillingMode: 'BY_EVENT',
    utilityEventPercentages: { EXT: 25, DM: 50, HW: 25 },
    draws: [
      { percentage: 25, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
      { percentage: 25, eventType: 'HW' },
    ],
  })

  assert.equal(summary.utilityCount, 1)
  assert.equal(summary.utilityTotal, 3000)
  assert.equal(summary.currentDraw, 3000)
  assert.equal(summary.utilityRows[0].eventType, 'EXT')
  assert.equal(summary.utilityRows[0].utilityPercentage, 25)
})

test('a mixed Phase totals Lot draw, Options and Utility rows in one Package', () => {
  const phase = {
    id: 3,
    name: '1',
    building: 'A',
    lots: [
      { id: 1, lotNumber: '10', planId: 1, optionIds: [10] },
      {
        id: 101,
        lotNumber: 'UTILITY-1',
        utilityName: 'Pool House',
        planId: 2,
        optionIds: [],
        isUtilityBuilding: true,
      },
    ],
  }
  const summary = summarizeDrawPackage({
    selections: [
      { phaseId: 3, lotId: 1, drawIndex: 1 },
      { phaseId: 3, lotId: 101, drawIndex: 1 },
    ],
  }, {
    sequenceSheet: {
      plans: [
        {
          id: 1,
          code: 'A',
          price: 10000,
          options: [{ id: 10, code: 'OPT', price: 500 }],
        },
        { id: 2, code: 'CLUB', price: 12500, options: [] },
      ],
    },
  }, phase, {
    utilityBuilding: true,
    optionsBillingDrawIndex: 1,
    draws: [{ percentage: 80 }, { percentage: 20 }],
  })

  assert.equal(summary.lotCount, 1)
  assert.equal(summary.utilityCount, 1)
  assert.equal(summary.currentDraw, 14500)
  assert.equal(summary.optionsTotal, 500)
  assert.equal(summary.grossAmount, 15000)
  assert.equal(summary.invoiceAmount, 15000)
  assert.equal(summary.phaseSummaries[0].draws[0].lotRange, '10')
  assert.equal(summary.phaseSummaries[0].draws[0].utilityCount, 1)
})

test('persisted Utility Building totals use immutable snapshots', () => {
  const utilityLine = {
    phaseId: 3,
    phaseCode: 'UTILITY',
    building: 'CLUBHOUSE',
    lotId: 101,
    lotNumber: 'UTILITY-1',
    utilityLabel: 'Clubhouse',
    isUtilityBuilding: true,
    planCode: 'CLUB',
    drawIndex: 1,
    drawName: 'Hardware',
    baseDrawAmount: 0,
    hardwareAmount: 0,
    optionsAmount: 0,
    utilityAmount: 12500,
  }
  const summary = summarizeDrawPackage({
    id: 91,
    packageNumber: 'DP-00000091',
    selections: [{ phaseId: 3, lotId: 101, drawIndex: 1 }],
    persistedInvoice: {
      grossAmount: 12500,
      retentionAmount: 0,
      wrapAmount: 0,
      netAmount: 12500,
    },
    persistedDrawLines: [utilityLine],
    persistedOptionLines: [],
  }, { sequenceSheet: { plans: [] } }, {
    id: 3,
    name: 'UTILITY',
    building: 'CLUBHOUSE',
    isUtilityBuilding: true,
    lots: [],
  }, { utilityBuilding: true, draws: [{ percentage: 85 }, { percentage: 15 }] })

  assert.equal(summary.currentDraw, 12500)
  assert.equal(summary.lotCount, 0)
  assert.equal(summary.utilityCount, 1)
  assert.equal(summary.utilityTotal, 12500)
  assert.deepEqual(summary.utilityRows, [utilityLine])
})

test('Utility Building charge history ignores cancelled Packages', () => {
  const billed = buildBilledUtilityRows([
    {
      id: 10,
      packageNumber: 'DP-00000010',
      jobId: 7,
      status: 'DRAFT',
      persistedDrawLines: [{
        lotId: 101,
        drawIndex: 1,
        isUtilityBuilding: true,
        utilityAmount: 12500,
      }],
    },
    {
      id: 11,
      packageNumber: 'DP-00000011',
      jobId: 7,
      status: 'CANCELLED',
      persistedDrawLines: [{
        lotId: 102,
        drawIndex: 0,
        isUtilityBuilding: true,
        utilityAmount: 8000,
      }],
    },
  ], 7)

  assert.deepEqual(billed.get('101'), {
    lotId: 101,
    drawIndex: 1,
    packageId: 10,
    packageNumber: 'DP-00000010',
    utilityAmount: 12500,
  })
  assert.equal(billed.has('102'), false)
})

test('Utility Building split history tracks each event portion independently', () => {
  const billed = buildBilledUtilityCharges([{
    id: 10,
    packageNumber: 'DP-00000010',
    jobId: 7,
    status: 'DRAFT',
    persistedDrawLines: [{
      lotId: 101,
      drawIndex: 0,
      eventType: 'EXT',
      utilityBillingMode: 'BY_EVENT',
      utilityEventType: 'EXT',
      isUtilityBuilding: true,
      utilityAmount: 3000,
    }],
  }], 7)

  assert.equal(billed.has(utilityChargeKey(101, 'BY_EVENT', 'EXT')), true)
  assert.equal(billed.has(utilityChargeKey(101, 'BY_EVENT', 'DM')), false)
  assert.equal(billed.has(utilityChargeKey(101, 'FULL')), false)
})

test('Hardware charge history ignores cancelled Packages and identifies billed Lots', () => {
  const billed = buildBilledHardwareLots([
    {
      id: 10,
      packageNumber: 'DP-00000010',
      jobId: 7,
      status: 'DRAFT',
      persistedDrawLines: [
        { lotId: 101, drawIndex: 1, hardwareAmount: 600 },
        { lotId: 102, drawIndex: 1, hardwareAmount: 0 },
      ],
    },
    {
      id: 11,
      packageNumber: 'DP-00000011',
      jobId: 7,
      status: 'CANCELLED',
      persistedDrawLines: [{ lotId: 103, drawIndex: 2, hardwareAmount: 500 }],
    },
  ], 7)

  assert.deepEqual(billed.get('101'), {
    lotId: 101,
    drawIndex: 1,
    billingMode: 'FULL',
    eventType: null,
    packageId: 10,
    packageNumber: 'DP-00000010',
    hardwareAmount: 600,
  })
  assert.equal(billed.has('102'), false)
  assert.equal(billed.has('103'), false)
})

test('Hardware charge history tracks each Event Type portion independently', () => {
  const billed = buildBilledHardwareCharges([{
    id: 10,
    packageNumber: 'DP-00000010',
    jobId: 7,
    status: 'AWAITING_PAYMENT',
    persistedDrawLines: [
      {
        lotId: 101,
        drawIndex: 0,
        eventType: 'EXT',
        hardwareBillingMode: 'BY_EVENT',
        hardwareEventType: 'EXT',
        hardwarePercentage: 20,
        hardwareAmount: 200,
      },
      {
        lotId: 101,
        drawIndex: 1,
        eventType: 'DM',
        hardwareBillingMode: 'BY_EVENT',
        hardwareEventType: 'DM',
        hardwarePercentage: 30,
        hardwareAmount: 300,
      },
    ],
  }], 7)

  assert.equal(billed.has(hardwareChargeKey(101, 'BY_EVENT', 'EXT')), true)
  assert.equal(billed.has(hardwareChargeKey(101, 'BY_EVENT', 'DM')), true)
  assert.equal(billed.has(hardwareChargeKey(101, 'BY_EVENT', 'HW')), false)
})

test('Package estimates suggest Separate Hardware portions by selected Event Type', () => {
  const schedule = {
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 20, DM: 30, HW: 50 },
    draws: [
      { percentage: 25, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
      { percentage: 25, eventType: 'HW' },
    ],
  }
  const summary = summarizeDrawPackage({
    selections: [
      { phaseId: 3, lotId: 1, drawIndex: 0 },
      { phaseId: 3, lotId: 1, drawIndex: 2 },
    ],
    hardwareSelections: [
      { phaseId: 3, lotId: 1, eventType: 'EXT' },
      { phaseId: 3, lotId: 1, eventType: 'HW' },
    ],
  }, {
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 3000, hardwarePrice: 1000 }],
    },
  }, {
    id: 3,
    lots: [{ id: 1, lotNumber: '1', planId: 1, optionIds: [] }],
  }, schedule)

  assert.deepEqual(summary.hardwareRows.map((row) => ({
    eventType: row.hardwareEventType,
    percentage: row.hardwarePercentage,
    amount: row.hardwareAmount,
    selected: row.chargeHardware,
  })), [
    { eventType: 'EXT', percentage: 20, amount: 200, selected: true },
    { eventType: 'HW', percentage: 50, amount: 500, selected: true },
  ])
  assert.equal(summary.hardwareTotal, 700)
})

test('Package estimates expose unselected Separate Hardware portions for manual billing', () => {
  const summary = summarizeDrawPackage({
    selections: [],
    hardwareSelections: [
      {
        phaseId: 3,
        lotId: 1,
        eventType: 'HW',
        chargeHardware: false,
        isCalendarSuggested: false,
      },
      {
        phaseId: 3,
        lotId: 2,
        eventType: 'HW',
        chargeHardware: true,
        isCalendarSuggested: true,
      },
    ],
  }, {
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 3000, hardwarePrice: 600 }],
    },
  }, {
    id: 3,
    lots: [
      { id: 1, lotNumber: '1', planId: 1, optionIds: [] },
      { id: 2, lotNumber: '2', planId: 1, optionIds: [] },
    ],
  }, {
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
    draws: [{ percentage: 100, eventType: 'EXT' }],
  })

  assert.deepEqual(summary.hardwareRows.map((row) => ({
    lotId: row.lotId,
    selected: row.chargeHardware,
    suggested: row.isCalendarSuggested,
  })), [
    { lotId: 1, selected: false, suggested: false },
    { lotId: 2, selected: true, suggested: true },
  ])
  assert.equal(summary.lotCount, 1)
  assert.equal(summary.hardwareTotal, 600)
})

test('a negative Option price is a credit subtracted from the Draw it is billed with', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [
          { id: 10, code: 'OPT-10', description: 'Door upgrade', price: 300 },
          { id: 11, code: 'OPT-11', description: 'Builder credit', price: -120.5 },
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
    optionsBillingDrawIndex: 0,
    retentionEnabled: true,
    retentionPercentage: 10,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 5,
  }
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 0 }],
  }, job, phase, schedule)

  assert.equal(summary.unpricedOptionCount, 0)
  assert.equal(summary.selectedOptionRows.every(({ issue }) => issue === null), true)
  // 300 - 120.50
  assert.equal(summary.optionsTotal, 179.5)
  // Draw 500 + options 179.50
  assert.equal(summary.grossAmount, 679.5)
  // Retention and WRAP come out of the reduced amount, not the full one.
  assert.equal(summary.retention, 67.95)
  assert.equal(summary.wrapInsurance, 33.98)
  assert.equal(summary.invoiceAmount, 577.57)
})

test('an Option priced NA stays on the Lot but adds and subtracts nothing', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [
          { id: 10, code: 'OPT-10', description: 'Door upgrade', price: 300, priceNotApplicable: false },
          { id: 11, code: 'OPT-11', description: 'Included at no charge', price: 0, priceNotApplicable: true },
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
    optionsBillingDrawIndex: 0,
    retentionEnabled: true,
    retentionPercentage: 10,
  }
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 0 }],
  }, job, phase, schedule)

  // Both Options are listed and billable; the NA one is not "price missing".
  assert.equal(summary.selectedOptionRows.length, 2)
  assert.equal(summary.unpricedOptionCount, 0)
  const na = summary.selectedOptionRows.find(({ optionId }) => optionId === 11)
  assert.equal(na.priceNotApplicable, true)
  assert.equal(na.issue, null)
  assert.equal(summary.selectedOptionRows.find(({ optionId }) => optionId === 10).priceNotApplicable, false)
  // Only the priced Option counts, so the totals are as if the NA one were not there.
  assert.equal(summary.optionsTotal, 300)
  assert.equal(summary.grossAmount, 800)
  assert.equal(summary.retention, 80)
  assert.equal(summary.invoiceAmount, 720)
})

test('an Option that was never priced still blocks billing, unlike NA', () => {
  const job = {
    sequenceSheet: {
      plans: [{
        id: 1,
        code: 'A',
        price: 1000,
        options: [{ id: 12, code: 'OPT-12', description: 'No price yet', price: null }],
      }],
    },
  }
  const phase = { id: 3, lots: [{ id: 1, lotNumber: '19', planId: 1, optionIds: [12] }] }
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 0 }],
  }, job, phase, { draws: [{ percentage: 50 }, { percentage: 50 }], optionsBillingDrawIndex: 0 })

  assert.equal(summary.unpricedOptionCount, 1)
  assert.equal(summary.selectedOptionRows[0].issue, 'PRICE_MISSING')
})

test('the preview amounts add up with a fractional OCIP / WRAP percentage', () => {
  const job = {
    sequenceSheet: {
      plans: [{ id: 1, code: 'A', price: 10000, options: [] }],
    },
  }
  const phase = {
    id: 3,
    lots: [{ id: 1, lotNumber: '19', planId: 1, optionIds: [] }],
  }
  const schedule = {
    draws: [{ percentage: 50 }, { percentage: 50 }],
    retentionEnabled: false,
    retentionPercentage: 0,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 0.833,
  }
  const summary = summarizeDrawPackage({
    selections: [{ phaseId: 3, lotId: 1, drawIndex: 0 }],
  }, job, phase, schedule)

  assert.equal(summary.grossAmount, 5000)
  assert.equal(summary.retention, 0)
  // 5000 x 0.833% = 41.65
  assert.equal(summary.wrapInsurance, 41.65)
  assert.equal(summary.invoiceAmount, 4958.35)
  assert.equal(
    Math.round((summary.grossAmount - summary.retention - summary.wrapInsurance) * 100) / 100,
    summary.invoiceAmount,
  )
})

test('a Retention Release counts the Lots it releases and the Options billed in those lines', () => {
  const release = {
    sourceLines: [
      { sourcePackageId: 10, sourceLotId: 101, sourceDrawId: 501 },
      { sourcePackageId: 10, sourceLotId: 101, sourceDrawId: 502 },
      { sourcePackageId: 10, sourceLotId: 102, sourceDrawId: 502 },
      { sourcePackageId: 11, sourceLotId: 103, sourceDrawId: 502 },
    ],
    sourceHardwareLines: [
      { sourcePackageId: 10, sourceLotId: 101, hardwareEventType: 'HW' },
      { sourcePackageId: 10, sourceLotId: 104, hardwareEventType: 'HW' },
    ],
  }
  const packages = [
    {
      id: 10,
      persistedOptionLines: [
        // Billed with Lot 101 in Draw 502: part of the release.
        { lotId: 101, optionId: 1, billingLotId: 101, drawId: 502 },
        { lotId: 101, optionId: 2, billingLotId: 101, drawId: 502 },
        // An Option of Lot 102 billed in the line of Lot 101 counts once, with its own Lot.
        { lotId: 102, optionId: 1, billingLotId: 101, drawId: 501 },
        // Billed in a Draw the release does not point to.
        { lotId: 101, optionId: 3, billingLotId: 101, drawId: 599 },
      ],
    },
    { id: 11, persistedOptionLines: [{ lotId: 103, optionId: 1, billingLotId: 103, drawId: 502 }] },
    // A Package the release does not come from.
    { id: 12, persistedOptionLines: [{ lotId: 105, optionId: 1, billingLotId: 105, drawId: 502 }] },
  ]

  assert.deepEqual(summarizeRetentionSource(release, packages), { lotCount: 4, optionCount: 4 })
})

test('a Retention Release without options in its lines says zero Options', () => {
  const release = {
    sourceLines: [{ sourcePackageId: 10, sourceLotId: 101, sourceDrawId: 501 }],
    sourceHardwareLines: [],
  }

  assert.deepEqual(summarizeRetentionSource(release, [{ id: 10, persistedOptionLines: [] }]), { lotCount: 1, optionCount: 0 })
  assert.deepEqual(summarizeRetentionSource(release, []), { lotCount: 1, optionCount: 0 })
  assert.deepEqual(summarizeRetentionSource(null, []), { lotCount: 0, optionCount: 0 })
})

test('an option line without its billing Lot is read as billed in its own Lot', () => {
  const release = { sourceLines: [{ sourcePackageId: 10, sourceLotId: 101, sourceDrawId: 501 }] }
  const packages = [{ id: 10, persistedOptionLines: [{ lotId: 101, optionId: 1, drawId: 501 }] }]

  assert.equal(summarizeRetentionSource(release, packages).optionCount, 1)
})

test('the Retention Release is described by its Lots and Options', () => {
  assert.equal(describeRetentionSource({ lotCount: 28, optionCount: 0 }), '28 Lots · 0 Options')
  assert.equal(describeRetentionSource({ lotCount: 1, optionCount: 1 }), '1 Lot · 1 Option')
})

test('the ticked cells of the grid add up by Draw and in all', () => {
  const rows = [
    { id: 1, drawAmounts: [1117, 2904.2, 446.8] },
    { id: 2, drawAmounts: [1118.5, 2908.1, 447.4] },
    { id: 3, drawAmounts: [1158.75, 3012.75, 463.5] },
  ]
  const ticked = new Set(['1:0', '2:0', '1:1', '3:2'])
  const summary = summarizeSelectedDrawCells(rows, 3, (id, drawIndex) => ticked.has(`${id}:${drawIndex}`))

  assert.deepEqual(summary.draws, [
    { count: 2, total: 2235.5 },
    { count: 1, total: 2904.2 },
    { count: 1, total: 463.5 },
  ])
  assert.equal(summary.count, 4)
  assert.equal(summary.total, 5603.2)
})

test('the selected total keeps the cents exact and ignores what is not ticked or has no amount', () => {
  // 0.1 + 0.2 is not 0.3 in floating point: the sums are done in cents.
  const rows = [
    { id: 1, drawAmounts: [0.1] },
    { id: 2, drawAmounts: [0.2] },
    { id: 3, drawAmounts: [null] },
    { id: 4 },
    { id: 5, drawAmounts: [999] },
  ]
  const summary = summarizeSelectedDrawCells(rows, 1, (id) => id <= 4)

  assert.deepEqual(summary.draws, [{ count: 4, total: 0.3 }])
  assert.equal(summary.total, 0.3)
  assert.deepEqual(summarizeSelectedDrawCells(rows, 1), { draws: [{ count: 0, total: 0 }], count: 0, total: 0 })
  assert.deepEqual(summarizeSelectedDrawCells([], 0), { draws: [], count: 0, total: 0 })
})

test('an Option added to a Lot of a completed Phase is billed on a cell of another Phase', () => {
  // Phase 3 was billed in full (its Lot 21 included, and its option C9100). P65100C was added to Lot 21
  // afterwards. Phase 4 still has Lots to bill.
  const job = {
    id: 9,
    sequenceSheet: {
      plans: [{
        id: 1,
        code: '3C',
        price: 1000,
        options: [
          { id: 10, code: 'C9100', description: 'Door', price: 100 },
          { id: 11, code: 'P65100C', description: 'Paint', price: 250 },
        ],
      }],
    },
  }
  const completedPhase = { id: 3, name: 'L9-24A', lots: [{ id: 21, lotNumber: '21', planId: 1, optionIds: [10, 11] }] }
  const openPhase = { id: 4, name: 'L9-24B', lots: [{ id: 23, lotNumber: '23', planId: 1, optionIds: [] }] }
  const schedule = {
    draws: [{ percentage: 25 }, { percentage: 65 }, { percentage: 10 }],
    optionsBillingDrawIndex: 2,
  }
  const earlier = {
    id: 115,
    packageNumber: 'DP-00000115',
    jobId: 9,
    status: 'DRAFT',
    optionsBillingDrawIndex: 2,
    selections: [0, 1, 2].map((drawIndex) => ({ phaseId: 3, lotId: 21, drawIndex })),
    persistedOptionLines: [{ lotId: 21, optionId: 10, price: 100 }],
  }
  const context = buildOptionChargeContext([earlier], 9, 2)
  const summaryFor = (selections) => summarizeDrawPackage(
    { selections, optionsBillingDrawIndex: 2, ...context },
    job,
    [completedPhase, openPhase],
    schedule,
  )

  // Billing Draw 3 of the open Phase: the new option goes with it, the billed one does not.
  const carried = summaryFor([{ phaseId: 4, lotId: 23, drawIndex: 2 }])
  assert.equal(carried.optionsAreDue, true)
  assert.deepEqual(
    carried.selectedOptionRows.map((option) => [option.lotNumber, option.optionCode]),
    [['21', 'P65100C']],
  )
  assert.equal(carried.optionsTotal, 250)
  assert.equal(carried.billedOptionCount, 1)

  // Before a cell is chosen the option is not lost: it is there, waiting for one.
  const waiting = summaryFor([])
  assert.equal(waiting.optionsAreDue, false)
  assert.deepEqual(
    waiting.availableOptionRows.filter((option) => !option.isBilled).map((option) => option.optionCode),
    ['P65100C'],
  )

  // A cell before the Options billing Draw cannot carry it.
  assert.equal(summaryFor([{ phaseId: 4, lotId: 23, drawIndex: 1 }]).optionsAreDue, false)
})

test('an Options Package charges its Options and nothing else', () => {
  const optionLine = (lotId, optionId, price) => ({
    lotId, optionId, billingLotId: lotId, drawId: null, price, billingDrawIndex: null, issue: null,
  })
  const record = {
    id: 30,
    packageNumber: 'OP-00000030',
    packageType: 'OPTIONS',
    jobId: 1,
    selections: [],
    persistedInvoice: { grossAmount: 1250, retentionAmount: 62.5, wrapAmount: 18.75, netAmount: 1168.75 },
    persistedDrawLines: [],
    persistedOptionLines: [optionLine(41, 61, 1000), optionLine(42, 62, 250)],
  }

  const summary = summarizeDrawPackage(record, testJobs[0], [], null)
  assert.equal(summary.optionsAreDue, true, 'it bills Options whatever the schedule says')
  assert.equal(summary.optionsTotal, 1250)
  assert.equal(summary.lotCount, 0)
  assert.equal(summary.currentDraw, 1250)
  assert.equal(summary.retention, 62.5)
  assert.equal(summary.wrapInsurance, 18.75)
  assert.equal(summary.invoiceAmount, 1168.75)
  assert.deepEqual(summary.selectedOptionRows.map(({ optionId }) => optionId), [61, 62])
  assert.equal(summary.optionChargeDrawIndex, null)
})

test('the Options an Options Package billed count as billed, so they are not offered again', () => {
  const context = buildOptionChargeContext([
    {
      id: 30,
      jobId: 1,
      status: 'DRAFT',
      selections: [],
      persistedOptionLines: [{ lotId: 41, optionId: 61, price: 1000, billingDrawIndex: null }],
    },
    {
      id: 31,
      jobId: 1,
      status: 'CANCELLED',
      selections: [],
      persistedOptionLines: [{ lotId: 41, optionId: 62, price: 10, billingDrawIndex: null }],
    },
  ], 1, 1)

  assert.deepEqual(context.billedOptionEntries.map(({ identity }) => identity), ['41:61'])
})

test('a Retention Release counts the Options billed on a Package of their own', () => {
  const release = {
    sourceLines: [{ sourcePackageId: 10, sourceLotId: 101, sourceDrawId: 501 }],
    sourceHardwareLines: [],
    sourceOptionLines: [
      { sourcePackageId: 30, sourceLotId: 101, sourceOptionId: 7 },
      { sourcePackageId: 30, sourceLotId: 102, sourceOptionId: 8 },
    ],
  }

  assert.deepEqual(
    summarizeRetentionSource(release, [{ id: 10, persistedOptionLines: [{ lotId: 101, optionId: 1, billingLotId: 101, drawId: 501 }] }]),
    { lotCount: 1, optionCount: 3 },
  )
})

