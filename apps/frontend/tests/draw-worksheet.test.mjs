import assert from 'node:assert/strict'
import test from 'node:test'
import { initialBuilderDrawSchedules } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import { testJobs } from './fixtures/jobs.mjs'
import {
  allocateDrawAmounts,
  allocateHardwareAmounts,
  allocateHardwareEventAmounts,
  buildDrawWorksheet,
  calculateInvoiceAmounts,
  hasOptionPrice,
  getDrawPercentageTotal,
  isDrawScheduleValid,
} from '../src/features/draw-invoice/utils/drawWorksheet.js'

test('retention and WRAP turn a $10,000 draw into a $9,300 invoice', () => {
  const result = calculateInvoiceAmounts(10000, {
    retentionEnabled: true,
    retentionPercentage: 5,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2,
  })

  assert.deepEqual(result, {
    currentDraw: 10000,
    retention: 500,
    wrapInsurance: 200,
    invoiceAmount: 9300,
  })
})

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
  const job = testJobs.find((item) => item.code === '1307')
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

test('separate hardware is additional while draws use the full Plan price', () => {
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
  assert.equal(worksheet.totalDrawBasePrice, 3000)
  assert.equal(worksheet.totalHardwarePrice, 1000)
  assert.deepEqual(worksheet.rows[0].drawAmounts, [2550, 450])
})

test('additional hardware can exceed the Plan price without blocking draws', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: 1000, hardwarePrice: 1500 }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    {
      separateHardwarePrice: true,
      draws: [{ percentage: 50 }, { percentage: 50 }],
    },
  )

  assert.equal(worksheet.isReady, true)
  assert.equal(worksheet.totalDrawBasePrice, 1000)
  assert.equal(worksheet.totalHardwarePrice, 1500)
  assert.deepEqual(worksheet.rows[0].drawAmounts, [500, 500])
})

test('Separate Hardware allocation follows EXT, DM, HW rounding order', () => {
  const schedule = {
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 33.33, DM: 33.33, HW: 33.34 },
    draws: [
      { percentage: 25, eventType: 'EXT' },
      { percentage: 50, eventType: 'DM' },
      { percentage: 25, eventType: 'HW' },
    ],
  }

  assert.deepEqual(allocateHardwareAmounts(100, schedule), [33.33, 33.33, 33.34])
})

test('Separate Hardware can assign 100 percent to one Event Type', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: 3000, hardwarePrice: 1000 }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    {
      separateHardwarePrice: true,
      hardwareBillingMode: 'BY_EVENT',
      hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
      draws: [
        { percentage: 25, eventType: 'EXT' },
        { percentage: 50, eventType: 'DM' },
        { percentage: 25, eventType: 'HW' },
      ],
    },
  )

  assert.deepEqual(worksheet.rows[0].hardwarePercentages, [0, 0, 100])
  assert.deepEqual(worksheet.rows[0].hardwareAmounts, [0, 0, 1000])
})

test('Separate Hardware keeps its HW allocation when no HW Draw exists', () => {
  const schedule = {
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
    draws: [
      { percentage: 40, eventType: 'EXT' },
      { percentage: 60, eventType: 'DM' },
    ],
  }
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: 3000, hardwarePrice: 1000 }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    schedule,
  )

  assert.deepEqual(allocateHardwareEventAmounts(1000, schedule), {
    EXT: 0,
    DM: 0,
    HW: 1000,
  })
  assert.deepEqual(worksheet.rows[0].hardwareAmounts, [0, 0])
  assert.equal(worksheet.rows[0].hardwareEventAmounts.HW, 1000)
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

test('Utility Building offers the full Plan price on each selectable Draw without extras', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{
          id: 1,
          code: 'CLUB',
          price: 12500,
          hardwarePrice: 2500,
          options: [{ id: 10, code: 'OPT', price: 500 }],
        }],
      },
    },
    {
      lots: [{
        id: 101,
        lotNumber: 'UTILITY-1',
        utilityName: 'Clubhouse',
        planId: 1,
        optionIds: [10],
        isUtilityBuilding: true,
      }],
    },
    {
      utilityBuilding: true,
      separateHardwarePrice: true,
      draws: [{ percentage: 85 }, { percentage: 15 }],
    },
  )

  assert.equal(worksheet.isReady, true)
  assert.equal(worksheet.rows[0].utilityLabel, 'Clubhouse')
  assert.deepEqual(worksheet.rows[0].drawAmounts, [12500, 12500])
  assert.deepEqual(worksheet.rows[0].selectedOptions, [])
  assert.equal(worksheet.rows[0].hardwarePrice, null)
  assert.equal(worksheet.totalHardwarePrice, 0)
})

test('Utility Building allocates its Plan price by configured Draw events', () => {
  const worksheet = buildDrawWorksheet(
    { sequenceSheet: { plans: [{ id: 1, code: 'CLUB', price: 10001 }] } },
    {
      lots: [{
        id: 101,
        lotNumber: 'UTILITY-1',
        utilityName: 'Clubhouse',
        planId: 1,
        optionIds: [],
        isUtilityBuilding: true,
      }],
    },
    {
      utilityBuilding: true,
      utilityBillingMode: 'BY_EVENT',
      utilityEventPercentages: { EXT: 25, DM: 50, HW: 25 },
      draws: [
        { percentage: 25, eventType: 'EXT' },
        { percentage: 50, eventType: 'DM' },
        { percentage: 25, eventType: 'HW' },
      ],
    },
  )

  assert.equal(worksheet.utilityBillingMode, 'BY_EVENT')
  assert.deepEqual(worksheet.rows[0].utilityPercentages, [25, 50, 25])
  assert.deepEqual(worksheet.rows[0].drawAmounts, [2500.25, 5000.5, 2500.25])
  assert.equal(
    worksheet.rows[0].drawAmounts.reduce((total, amount) => total + amount, 0),
    10001,
  )
})

test('Utility event rounding follows the database EXT, DM, HW order', () => {
  const worksheet = buildDrawWorksheet(
    { sequenceSheet: { plans: [{ id: 1, code: 'CLUB', price: 0.01 }] } },
    {
      lots: [{
        id: 101,
        lotNumber: 'UTILITY-1',
        utilityName: 'Clubhouse',
        planId: 1,
        optionIds: [],
        isUtilityBuilding: true,
      }],
    },
    {
      utilityBuilding: true,
      utilityBillingMode: 'BY_EVENT',
      utilityEventPercentages: { EXT: 33.33, DM: 33.33, HW: 33.34 },
      draws: [
        { percentage: 25, eventType: 'HW' },
        { percentage: 25, eventType: 'EXT' },
        { percentage: 50, eventType: 'DM' },
      ],
    },
  )

  assert.deepEqual(worksheet.rows[0].drawAmounts, [0.01, 0, 0])
})

test('Utility Building requires the immutable Builder Setup capability', () => {
  const worksheet = buildDrawWorksheet(
    { sequenceSheet: { plans: [{ id: 1, code: 'CLUB', price: 12500 }] } },
    {
      lots: [{
        id: 101,
        lotNumber: 'UTILITY-1',
        utilityName: 'Pool House',
        planId: 1,
        optionIds: [],
        isUtilityBuilding: true,
      }],
    },
    { utilityBuilding: false, draws: [{ percentage: 100 }] },
  )

  assert.equal(worksheet.utilityCapabilityMissing, true)
  assert.equal(worksheet.isReady, false)
})

test('worksheet resolves only selected options that belong to the assigned plan', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{
          id: 1,
          code: 'A',
          price: 1000,
          options: [
            { id: 10, code: 'OPT-10', description: 'Door upgrade', price: 125 },
            { id: 11, code: 'OPT-11', description: 'Shelf upgrade', price: 75 },
          ],
        }],
      },
    },
    {
      lots: [{
        id: 1,
        lotNumber: '19',
        planId: 1,
        optionIds: [10, 999],
      }],
    },
    { draws: [{ percentage: 50 }, { percentage: 50 }] },
  )

  assert.deepEqual(worksheet.rows[0].selectedOptions, [
    { id: 10, code: 'OPT-10', description: 'Door upgrade', price: 125 },
  ])
})

test('worksheet exposes current draw, retention, WRAP and invoice totals', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: 10000 }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    {
      retentionEnabled: true,
      retentionPercentage: 5,
      ocipWrapEnabled: true,
      ocipWrapPercentage: 2,
      draws: [{ percentage: 85 }, { percentage: 15 }],
    },
  )

  assert.equal(worksheet.retentionMode, 'APPLY')
  assert.equal(worksheet.retentionPercentage, 5)
  assert.equal(worksheet.wrapInsurancePercentage, 2)
  assert.equal(worksheet.totalCurrentDraw, 10000)
  assert.equal(worksheet.totalRetention, 500)
  assert.equal(worksheet.totalWrapInsurance, 200)
  assert.equal(worksheet.totalInvoiceAmount, 9300)
  assert.deepEqual(worksheet.drawTotals, [8500, 1500])
  assert.deepEqual(worksheet.drawRetentionTotals, [425, 75])
  assert.deepEqual(worksheet.drawWrapInsuranceTotals, [170, 30])
  assert.deepEqual(worksheet.drawInvoiceTotals, [7905, 1395])
})

test('apply retention deducts 5 percent after regular draws total 100 percent', () => {
  const worksheet = buildDrawWorksheet(
    {
      sequenceSheet: {
        plans: [{ id: 1, code: 'A', price: 10000 }],
      },
    },
    { lots: [{ id: 1, lotNumber: '1', planId: 1 }] },
    {
      retentionEnabled: true,
      retentionPercentage: 5,
      draws: [{ percentage: 85 }, { percentage: 15 }],
    },
  )

  assert.equal(worksheet.retentionMode, 'APPLY')
  assert.equal(worksheet.totalCurrentDraw, 10000)
  assert.equal(worksheet.totalRetention, 500)
  assert.equal(worksheet.totalWrapInsurance, 0)
  assert.equal(worksheet.totalInvoiceAmount, 9500)
  assert.deepEqual(worksheet.drawTotals, [8500, 1500])
  assert.deepEqual(worksheet.drawRetentionTotals, [425, 75])
  assert.deepEqual(worksheet.drawInvoiceTotals, [8075, 1425])
})

test('a credit takes retention and WRAP off by the same rule as a charge, mirrored', () => {
  const schedule = {
    retentionEnabled: true,
    retentionPercentage: 5,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2,
  }

  assert.deepEqual(calculateInvoiceAmounts(-10000, schedule), {
    currentDraw: -10000,
    retention: -500,
    wrapInsurance: -200,
    invoiceAmount: -9300,
  })

  // A half cent rounds away from zero on both sides, as the database does.
  const half = { retentionEnabled: true, retentionPercentage: 50 }
  assert.equal(calculateInvoiceAmounts(0.05, half).retention, 0.03)
  assert.equal(calculateInvoiceAmounts(-0.05, half).retention, -0.03)
})

test('an Option price is any number, including a credit, but not a missing one', () => {
  assert.equal(hasOptionPrice(-25), true)
  assert.equal(hasOptionPrice(0), true)
  assert.equal(hasOptionPrice(120), true)
  assert.equal(hasOptionPrice(null), false)
  assert.equal(hasOptionPrice(undefined), false)
  assert.equal(hasOptionPrice(Number.NaN), false)
})
