import assert from 'node:assert/strict'
import test from 'node:test'
import { initialBuilderDrawSchedules } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import { initialJobs } from '../src/features/jobs/data/jobs.js'
import {
  allocateDrawAmounts,
  buildDrawWorksheet,
  getDrawPercentageTotal,
  isDrawScheduleValid,
} from '../src/features/draw-invoice/utils/drawWorksheet.js'

test('draw amounts allocate the full plan price using builder percentages', () => {
  const schedule = initialBuilderDrawSchedules.find((item) => item.builderId === 2)

  assert.equal(getDrawPercentageTotal(schedule.draws), 100)
  assert.equal(isDrawScheduleValid(schedule), true)
  assert.deepEqual(allocateDrawAmounts(6785, schedule.draws), [678.5, 5088.75, 1017.75])
  assert.deepEqual(allocateDrawAmounts(5912, schedule.draws), [591.2, 4434, 886.8])
  assert.deepEqual(allocateDrawAmounts(7360, schedule.draws), [736, 5520, 1104])
})

test('rounding remains inside the final draw so allocations equal the base price', () => {
  const amounts = allocateDrawAmounts(100, [
    { percentage: 33.33 },
    { percentage: 33.33 },
    { percentage: 33.34 },
  ])

  assert.deepEqual(amounts, [33.33, 33.33, 33.34])
  assert.equal(amounts.reduce((total, amount) => total + amount, 0), 100)
})

test('Job 1307 Phase 2 Building 15 produces a ready five-lot worksheet', () => {
  const job = initialJobs.find((item) => item.code === '1307')
  const phase = job.sequenceSheet.phases.find(
    (item) => item.name === '2' && item.building === '15',
  )
  const schedule = initialBuilderDrawSchedules.find(
    (item) => item.builderId === job.builderId,
  )
  const worksheet = buildDrawWorksheet(job, phase, schedule)

  assert.equal(worksheet.isReady, true)
  assert.deepEqual(
    worksheet.rows.map((row) => [row.lotNumber, row.planCode, row.basePrice]),
    [
      ['66', '3', 6785],
      ['67', '1', 5912],
      ['68', '2', 7360],
      ['69', '2', 7360],
      ['70', '2Y', 7360],
    ],
  )
  assert.equal(worksheet.totalBasePrice, 34777)
  assert.deepEqual(worksheet.drawTotals, [3477.7, 26082.75, 5216.55])
})

test('a missing plan price blocks worksheet readiness without inventing amounts', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: null }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    { draws: [{ percentage: 50 }, { percentage: 50 }] },
  )

  assert.equal(worksheet.isReady, false)
  assert.equal(worksheet.unpricedLotCount, 1)
  assert.deepEqual(worksheet.rows[0].drawAmounts, [null, null])
})

test('separate hardware is removed before draws and billed at 100 percent', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: 3000, hardwarePrice: 1000 }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    {
      separateHardwarePrice: true,
      draws: [{ percentage: 85 }, { percentage: 15 }],
    },
  )

  assert.equal(worksheet.isReady, true)
  assert.equal(worksheet.totalBasePrice, 3000)
  assert.equal(worksheet.totalDrawBasePrice, 2000)
  assert.equal(worksheet.totalHardwarePrice, 1000)
  assert.deepEqual(worksheet.rows[0].drawAmounts, [1700, 300])
})

test('hardware separation requires a hardware price for every assigned plan', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: 3000 }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    {
      separateHardwarePrice: true,
      draws: [{ percentage: 85 }, { percentage: 15 }],
    },
  )

  assert.equal(worksheet.isReady, false)
  assert.equal(worksheet.missingHardwarePriceCount, 1)
  assert.deepEqual(worksheet.rows[0].drawAmounts, [null, null])
})
