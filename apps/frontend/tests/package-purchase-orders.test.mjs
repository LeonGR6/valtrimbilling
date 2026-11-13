import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentPackageOptions,
  describeOrderOptions,
  describePurchaseOrderCount,
  describeUnbackedOption,
  findUnbackedOptions,
  joinableOrders,
  planPackagePurchaseOrders,
} from '../src/features/draw-invoice/utils/packagePurchaseOrders.js'
import { buildPurchaseOrderBacking } from '../src/features/purchase-orders/services/purchaseOrderRecord.js'

const money = (value) => `$${Number(value).toFixed(2)}`

// A line of compare_purchase_orders, as the app reads it.
let nextLine = 1
function line(documentId, lotId, planOptionId, optionCode, poUnitPrice, overrides = {}) {
  const lineId = nextLine++
  return {
    lineId,
    documentId,
    lotId,
    planOptionId,
    optionCode,
    poUnitPrice,
    poDate: '2026-10-01',
    revisedOn: null,
    status: 'MATCH',
    ...overrides,
  }
}

// An option the Package charges now.
const option = (lotId, optionId, optionCode, price, overrides = {}) => ({
  id: `${lotId}-${optionId}`,
  lotId,
  optionId,
  optionCode,
  lotNumber: String(lotId),
  phaseCode: '3',
  building: null,
  price,
  priceNotApplicable: false,
  chargedInCurrentPackage: true,
  ...overrides,
})

const files = {
  11: { id: 11, name: 'P3 Lot 22.pdf', bucket: 'job-documents', storagePath: 'a/11.pdf' },
  12: { id: 12, name: 'P3 Lot 23.pdf', bucket: 'job-documents', storagePath: 'a/12.pdf' },
}

test('an option that a Purchase Order prints at its price adds that PO and raises no warning', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, '6000', 250)],
    lines: [line(11, 22, 5, '6000', 250)],
    files,
  })

  assert.equal(plan.usesPurchaseOrders, true)
  assert.deepEqual(plan.orders.map((order) => order.documentId), [11])
  assert.equal(plan.orders[0].file.name, 'P3 Lot 22.pdf')
  assert.deepEqual(plan.unbacked, [])
  assert.equal(plan.backedCount, 1)
})

test('a Purchase Order backing several options goes in once, in the order of the options', () => {
  const plan = planPackagePurchaseOrders({
    rows: [
      option(23, 5, '6000', 100),
      option(22, 5, '6000', 100),
      option(22, 6, '7000', 50),
    ],
    lines: [
      line(11, 22, 5, '6000', 100),
      line(11, 22, 6, '7000', 50),
      line(12, 23, 5, '6000', 100),
    ],
    files,
  })

  // Lot 23 comes first among the options, so its order does too.
  assert.deepEqual(plan.orders.map((order) => order.documentId), [12, 11])
  assert.deepEqual(plan.orders[1].options.map((entry) => entry.optionCode), ['6000', '7000'])
  assert.equal(describePurchaseOrderCount(plan.orders.length), '2 Purchase Orders')
})

test('a Purchase Order with another price still goes in, and the option is flagged with both prices', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, '6000', 250)],
    lines: [line(11, 22, 5, '6000', 200, { status: 'PRICE_DIFF' })],
    files,
  })

  assert.deepEqual(plan.orders.map((order) => order.documentId), [11])
  assert.equal(plan.unbacked.length, 1)
  assert.equal(plan.unbacked[0].state, 'price_differs')
  assert.equal(plan.unbacked[0].poPrice, 200)
  assert.equal(
    describeUnbackedOption(plan.unbacked[0], money),
    'Lot 22 · 6000: the PO prints $200.00 and this Package bills $250.00.',
  )
  assert.equal(plan.backedCount, 0)
})

test('a Purchase Order printed for another Plan is flagged even at the right price, and still goes in', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, '6000', 100)],
    lines: [line(11, 22, 5, '6000', 100, { status: 'PLAN_MISMATCH' })],
    files,
  })

  assert.deepEqual(plan.orders.map((order) => order.documentId), [11])
  assert.deepEqual(plan.unbacked.map(({ state }) => state), ['plan_differs'])
  assert.equal(
    describeUnbackedOption(plan.unbacked[0], money),
    "Lot 22 · 6000: the PO was printed for another Plan than this Lot's.",
  )
})

test('an option the Lot\'s Purchase Order does not print is flagged and adds nothing', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, '6000', 100), option(22, 9, '9999', 40)],
    lines: [line(11, 22, 5, '6000', 100)],
    files,
  })

  assert.deepEqual(plan.orders.map((order) => order.documentId), [11])
  assert.deepEqual(plan.unbacked.map(({ state, row }) => [state, row.optionCode]), [['not_in_po', '9999']])
  assert.equal(
    describeUnbackedOption(plan.unbacked[0], money),
    'Lot 22 · 9999: the Lot has a PO, and it does not print this option.',
  )
})

test('a Lot with no Purchase Order is flagged on a Job that uses them, after the real mismatches', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(30, 5, '6000', 100), option(22, 5, '6000', 250), option(22, 9, '9999', 40)],
    lines: [line(11, 22, 5, '6000', 200)],
    files,
  })

  assert.deepEqual(plan.unbacked.map(({ state }) => state), ['price_differs', 'not_in_po', 'no_po'])
  assert.equal(
    describeUnbackedOption(plan.unbacked[2], money),
    'Lot 30 · 6000: no PO has been uploaded for this Lot.',
  )
})

test('a Job without Purchase Orders has nothing to add and nothing to warn about', () => {
  const plan = planPackagePurchaseOrders({ rows: [option(22, 5, '6000', 100)], lines: [], files: {} })

  assert.equal(plan.usesPurchaseOrders, false)
  assert.deepEqual(plan.orders, [])
  assert.deepEqual(plan.unbacked, [])
  assert.deepEqual(findUnbackedOptions(buildPurchaseOrderBacking([]), [option(22, 5, '6000', 100)]), [])
  assert.deepEqual(findUnbackedOptions(null, [option(22, 5, '6000', 100)]), [])
})

test('a Package that charges no option adds no Purchase Order', () => {
  const plan = planPackagePurchaseOrders({ rows: [], lines: [line(11, 22, 5, '6000', 100)], files })

  assert.deepEqual(plan.orders, [])
  assert.deepEqual(plan.unbacked, [])
  assert.equal(plan.optionCount, 0)
})

test('when two Purchase Orders print the same option of a Lot, the newest one is the one that goes in', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, '6000', 100)],
    lines: [
      line(11, 22, 5, '6000', 100, { poDate: '2026-09-01' }),
      line(12, 22, 5, '6000', 100, { poDate: '2026-10-01', revisedOn: '2026-10-05' }),
    ],
    files,
  })

  assert.deepEqual(plan.orders.map((order) => order.documentId), [12])
})

test('an option is matched by its code when the line was not tied to an option of the Plan', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, 'pa-6000', 100)],
    lines: [line(11, 22, null, 'PA 6000', 100)],
    files,
  })

  assert.deepEqual(plan.orders.map((order) => order.documentId), [11])
  assert.deepEqual(plan.unbacked, [])
})

test('an option with no price that applies agrees with a PO that prints zero', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, '6000', 0, { priceNotApplicable: true })],
    lines: [line(11, 22, 5, '6000', 0)],
    files,
  })

  assert.deepEqual(plan.unbacked, [])
  assert.equal(
    describeUnbackedOption(
      { row: option(22, 5, '6000', 0, { priceNotApplicable: true }), state: 'price_differs', poPrice: 30 },
      money,
    ),
    'Lot 22 · 6000: the PO prints $30.00 and this Package bills NA.',
  )
})

test('a Purchase Order whose PDF cannot be found is listed but cannot be joined', () => {
  const plan = planPackagePurchaseOrders({
    rows: [option(22, 5, '6000', 100), option(23, 5, '6000', 100)],
    lines: [line(11, 22, 5, '6000', 100), line(99, 23, 5, '6000', 100)],
    files,
  })

  assert.deepEqual(plan.orders.map((order) => order.documentId), [11, 99])
  assert.equal(plan.orders[1].file, null)
  assert.deepEqual(joinableOrders(plan).map((order) => order.documentId), [11])
  assert.deepEqual(joinableOrders(null), [])
})

test('only the options this Package charges now are looked at, not the ones charged earlier', () => {
  const rows = [option(22, 5, '6000', 100), option(23, 5, '6000', 100, { chargedInCurrentPackage: false })]

  assert.deepEqual(currentPackageOptions(rows).map((row) => row.lotId), [22])
  assert.deepEqual(currentPackageOptions(), [])
})

test('the options a Purchase Order backs are named, and a long list is shortened', () => {
  const entries = ['1', '2', '3', '4', '5', '6'].map((lotNumber) => ({ lotNumber, optionCode: '6000' }))

  assert.equal(describeOrderOptions({ options: entries.slice(0, 2) }), 'Lot 1 · 6000, Lot 2 · 6000')
  assert.equal(
    describeOrderOptions({ options: entries }),
    'Lot 1 · 6000, Lot 2 · 6000, Lot 3 · 6000, Lot 4 · 6000 and 2 more',
  )
  assert.equal(describePurchaseOrderCount(1), '1 Purchase Order')
})
