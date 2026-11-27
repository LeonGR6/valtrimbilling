import assert from 'node:assert/strict'
import test from 'node:test'
import { billedCellAmount } from '../src/features/draw-invoice/utils/drawPackages.js'
import {
  priceChangeIssue,
  priceChangeLabel,
  priceChangeRows,
  priceChangeTotals,
} from '../src/features/draw-invoice/utils/priceChanges.js'
import {
  planCreatedPackages,
  planPackageSplit,
} from '../src/features/draw-invoice/utils/packageSplit.js'
import {
  canCorrectDrawPackage,
  toCreateDrawPackageRpc,
  toDrawInvoicePackage,
} from '../src/features/draw-invoice/services/drawInvoicePackageRecord.js'
import { toPriceDifference } from '../src/features/plan-pricing/utils/priceDifferences.js'

const difference = (overrides = {}) => ({
  id: 1,
  packageId: 140,
  packageNumber: 'DP-00000146',
  kind: 'DRAW',
  phaseId: 47,
  phaseCode: 'MODELS',
  building: '',
  lotNumber: '2',
  drawNumber: 1,
  hardwareEventType: null,
  gross: -75,
  retention: 0,
  wrap: 0,
  net: -75,
  ...overrides,
})

test('only the price changes of the Phases the Package bills are offered, in reading order', () => {
  const rows = priceChangeRows([
    difference({ id: 4, lotNumber: '10' }),
    difference({ id: 3, lotNumber: '4', drawNumber: 2 }),
    difference({ id: 2, lotNumber: '4' }),
    difference({ id: 5, phaseId: 48, phaseCode: '1' }),
    difference({ id: 6, phaseId: null }),
  ], new Set(['47']))

  assert.deepEqual(rows.map(({ id }) => id), [2, 3, 4], 'lot 4 draw 1, lot 4 draw 2, then lot 10')
  assert.deepEqual(priceChangeRows([difference()], new Set()), [], 'nothing selected, nothing offered')
})

test('the totals of the chosen price changes are exact to the cent', () => {
  assert.deepEqual(
    priceChangeTotals([
      difference({ gross: 0.1, net: 0.1, retention: 0.05 }),
      difference({ gross: 0.2, net: 0.2, wrap: 0.01 }),
      difference({ gross: -75, net: -75 }),
    ]),
    { gross: -74.7, retention: 0.05, wrap: 0.01, net: -74.7, count: 3 },
  )
  assert.deepEqual(priceChangeTotals([]), { gross: 0, retention: 0, wrap: 0, net: 0, count: 0 })
})

test('credits can only reduce what the Package bills', () => {
  const credit = priceChangeTotals([difference({ gross: -300, net: -300 })])
  const billed = { gross: 8220.55, retention: 0, wrap: 0, net: 8220.55 }

  assert.equal(priceChangeIssue(billed, credit), null)
  assert.equal(priceChangeIssue(billed, priceChangeTotals([])), null, 'nothing chosen is never a problem')
  assert.match(
    priceChangeIssue({ ...billed, gross: 100, net: 100 }, credit),
    /credits larger than what this Package bills/,
  )
  // Retention is a deduction: a credit cannot turn it into an addition.
  assert.match(
    priceChangeIssue(
      { gross: 1000, retention: 5, wrap: 0, net: 995 },
      priceChangeTotals([difference({ gross: -10, retention: -8, net: -2 })]),
    ),
    /credits larger/,
  )
})

test('a price change says where it was billed', () => {
  assert.equal(priceChangeLabel(difference()), 'Draw 1')
  assert.equal(
    priceChangeLabel(difference({ kind: 'HARDWARE_EVENT', hardwareEventType: 'EXT', drawNumber: null })),
    'Hardware EXT',
  )
})

test('a pending difference keeps its Phase and what it billed', () => {
  const view = toPriceDifference({
    id: 74,
    recalculation_id: 54,
    package_id: 140,
    package_number: 'DP-00000146',
    line_kind: 'DRAW',
    lot_id: 150,
    draw_number: 1,
    hardware_event_type: null,
    phase_id: 47,
    phase_code: 'MODELS',
    building: null,
    lot_number: '2',
    plan_code: '1A',
    billed_gross: '1107.25',
    new_gross: '1032.25',
    billed_net: '1107.25',
    new_net: '1032.25',
    delta_gross: '-75.00',
    delta_net: '-75.00',
  })

  assert.equal(view.phaseId, 47)
  assert.equal(view.billedGross, 1107.25)
  assert.equal(view.newGross, 1032.25)
  assert.equal(view.gross, -75)
})

test('a cell that already belongs to a Package shows what that Package billed, not today\'s price', () => {
  const owner = {
    persistedDrawLines: [
      { lotId: 150, drawIndex: 0, baseDrawAmount: 1107.25, utilityAmount: 0, isUtilityBuilding: false },
      { lotId: 151, drawIndex: 0, baseDrawAmount: 0, utilityAmount: 750, isUtilityBuilding: true },
    ],
  }

  assert.equal(billedCellAmount(owner, 150, 0), 1107.25)
  assert.equal(billedCellAmount(owner, '150', 0), 1107.25, 'ids may be text')
  assert.equal(billedCellAmount(owner, 151, 0), 750, 'a Utility row bills its utility amount')
  assert.equal(billedCellAmount(owner, 150, 1), null, 'another Draw of the Lot is not in it')
  assert.equal(billedCellAmount({}, 150, 0), null)
  assert.equal(billedCellAmount(null, 150, 0), null)
})

// Two Phases, each billing one cell.
const job = {
  id: 7,
  sequenceSheet: {
    phases: [
      { id: 47, name: '1', building: '', lots: [{ id: 1 }, { id: 2 }] },
      { id: 48, name: '2', building: '', lots: [{ id: 3 }, { id: 4 }] },
    ],
  },
}
const schedule = (singleInvoiceScope) => ({
  draws: [{}, {}, {}],
  singleInvoiceScope,
  finalReleaseScope: '',
  retentionEnabled: false,
  retentionPercentage: 0,
  retentionReleaseScope: 'JOB',
  separateHardwarePrice: false,
})
const selections = [
  { phaseId: 47, lotId: 1, drawIndex: 1 },
  { phaseId: 48, lotId: 3, drawIndex: 1 },
]
const input = {
  jobId: 7,
  selections,
  hardwareSelections: [],
  optionSelections: [],
  optionsBillingDrawIndex: null,
  notes: '',
}

test('the price changes chosen go with the Package that bills their Phase', () => {
  const single = planCreatedPackages({
    job,
    schedule: schedule(''),
    splitPlan: planPackageSplit({ job, schedule: schedule(''), selections }),
    input,
    priceDifferences: [{ id: 10, phaseId: 47 }, { id: 11, phaseId: 48 }],
  })
  assert.equal(single.length, 1)
  assert.deepEqual(single[0].input.priceDifferenceIds, [10, 11])
  assert.equal(input.priceDifferenceIds, undefined, 'the input is not touched')

  // One invoice per Phase: each Package takes the changes of its own Phase.
  const split = planCreatedPackages({
    job,
    schedule: schedule('PHASE'),
    splitPlan: planPackageSplit({ job, schedule: schedule('PHASE'), selections }),
    input,
    priceDifferences: [{ id: 10, phaseId: 47 }, { id: 11, phaseId: 48 }, { id: 12, phaseId: 47 }],
  })
  assert.equal(split.length, 2)
  assert.deepEqual(
    split.map((created) => [created.group.phaseIds, created.input.priceDifferenceIds]),
    [[['47'], [10, 12]], [['48'], [11]]],
  )
})

test('a Package without price changes chosen is created exactly as before', () => {
  const created = planCreatedPackages({
    job,
    schedule: schedule(''),
    splitPlan: planPackageSplit({ job, schedule: schedule(''), selections }),
    input,
  })
  assert.equal(created[0].input, input)

  // A change of a Phase this Package does not bill is not carried by it.
  const other = planCreatedPackages({
    job,
    schedule: schedule(''),
    splitPlan: planPackageSplit({ job, schedule: schedule(''), selections: [selections[0]] }),
    input: { ...input, selections: [selections[0]] },
    priceDifferences: [{ id: 11, phaseId: 48 }],
  })
  assert.equal(other[0].input.priceDifferenceIds, undefined)
})

test('the price changes chosen go to the database as a sorted list without repeats', () => {
  const payload = toCreateDrawPackageRpc({ jobId: 7, selections, priceDifferenceIds: [12, 10, 12, '11'] })
  assert.deepEqual(payload.p_difference_ids, [10, 11, 12])

  assert.equal('p_difference_ids' in toCreateDrawPackageRpc({ jobId: 7, selections }), false)
  assert.equal(
    'p_difference_ids' in toCreateDrawPackageRpc({ jobId: 7, selections, priceDifferenceIds: [] }),
    false,
    'without any, the payload is the one the creation always took',
  )
})

const packageRow = {
  id: 160,
  package_number: 'DP-00000160',
  package_type: 'DRAW',
  builder_id: 2,
  job_id: 7,
  phase_id: 47,
  setup_version_id: 31,
  package_date: '2026-10-30',
  invoice_line_format: 'LOT_SCOPE',
  workflow_status: 'DRAFT',
  status: 'DRAFT',
  created_at: '2026-10-30T12:00:00Z',
  updated_at: '2026-10-30T12:00:00Z',
  status_changed_at: '2026-10-30T12:00:00Z',
}
const invoiceRow = {
  id: 401,
  package_id: 160,
  gross_amount: '8065.80',
  retention_amount: '0.00',
  wrap_amount: '0.00',
  net_amount: '8065.80',
  paid_amount: '0',
  status: 'DRAFT',
}
const lineRow = (overrides) => ({
  id: 1,
  package_id: 160,
  source_package_id: 140,
  source_package_number: 'DP-00000146',
  line_kind: 'DRAW',
  lot_id: 150,
  draw_number: 1,
  hardware_event_type: null,
  phase_id: 47,
  phase_code: 'MODELS',
  building: null,
  lot_number: '2',
  plan_code: '1A',
  delta_base: '-75.00',
  delta_hardware: '0.00',
  delta_utility: '0.00',
  delta_options: '0.00',
  gross: '-75.00',
  retention: '0.00',
  wrap: '0.00',
  net: '-75.00',
  ...overrides,
})
const draftWith = (lines) => toDrawInvoicePackage(
  packageRow, invoiceRow, [], [], null, [], null, [], [], [], null, lines,
)

test('a Draw Package keeps the price changes it collected, with what they add up to', () => {
  const record = draftWith([
    lineRow({ id: 1 }),
    lineRow({ id: 2, lot_id: 152, lot_number: '4', plan_code: '3B', gross: '-79.75', net: '-79.75', delta_base: '-79.75' }),
  ])

  assert.equal(record.priceAdjustment, null, 'it is not a Price Adjustment')
  assert.equal(record.priceDifferences.lineCount, 2)
  assert.equal(record.priceDifferences.sourcePackageCount, 1)
  assert.equal(record.priceDifferences.grossAmount, -154.75)
  assert.equal(record.priceDifferences.netAmount, -154.75)
  assert.deepEqual(
    record.priceDifferences.lines.map(({ lotNumber, drawNumber, gross, building }) => [lotNumber, drawNumber, gross, building]),
    [['2', 1, -75, ''], ['4', 1, -79.75, '']],
  )
  assert.equal(draftWith([]).priceDifferences, null, 'one that collected none has none')
})

test('a Package that collected price changes is cancelled, not edited or transferred', () => {
  const plain = draftWith([])
  const carrier = draftWith([lineRow({})])

  assert.equal(canCorrectDrawPackage(plain), true)
  assert.equal(canCorrectDrawPackage(carrier), false)
})
