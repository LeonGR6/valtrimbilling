import assert from 'node:assert/strict'
import test from 'node:test'
import { initialBuilderDrawSchedules } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import { initialDrawInvoicePackages } from '../src/features/draw-invoice/data/drawInvoicePackages.js'
import {
  buildUsedDrawSelections,
  drawSelectionKey,
  formatLotRange,
  makePackageSelections,
  summarizeDrawPackage,
} from '../src/features/draw-invoice/utils/drawPackages.js'
import { initialJobs } from '../src/features/jobs/data/jobs.js'

test('a package uses the cross product of its selected lots and draws', () => {
  assert.deepEqual(makePackageSelections([18, 19, 20], [0, 2]), [
    { lotId: 18, drawIndex: 0 },
    { lotId: 18, drawIndex: 2 },
    { lotId: 19, drawIndex: 0 },
    { lotId: 19, drawIndex: 2 },
    { lotId: 20, drawIndex: 0 },
    { lotId: 20, drawIndex: 2 },
  ])
})

test('lot ranges remain compact without hiding unselected lots', () => {
  assert.equal(formatLotRange(['22', '18', '19', '20']), '18–20, 22')
  assert.equal(formatLotRange(['66', '67', '68', '69', '70']), '66–70')
  assert.equal(formatLotRange(['A2', 'A1']), 'A1, A2')
  assert.equal(formatLotRange([]), '—')
})

test('used lot and draw combinations point back to their package', () => {
  const used = buildUsedDrawSelections(initialDrawInvoicePackages)
  const record = initialDrawInvoicePackages[0]

  assert.equal(
    used.get(drawSelectionKey(1, 2102, 3201, 0)),
    record,
  )
  assert.equal(used.has(drawSelectionKey(1, 2102, 3201, 1)), false)
})

test('voided packages preserve the historical lot and draw usage', () => {
  const record = {
    ...initialDrawInvoicePackages[0],
    status: 'VOIDED',
  }

  assert.equal(buildUsedDrawSelections([record]).size, 5)
})

test('package totals include only selected lots and draws', () => {
  const job = initialJobs.find((item) => item.code === '1307')
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
  assert.equal(summary.retention, 0)
  assert.equal(summary.wrapInsurance, 0)
  assert.equal(summary.invoiceAmount, 15042.75)
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
