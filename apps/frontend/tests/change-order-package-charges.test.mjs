import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupPackageCharges,
  packageLotIds,
  toPackageChargeRow,
} from '../src/features/change-orders/utils/packageCharges.js'

test('the Lots of the Packages about to be created: Draw cells and Options, once each, in order', () => {
  const packages = [
    { kind: 'DRAW', input: { selections: [{ lotId: 12, drawIndex: 0 }, { lotId: 3, drawIndex: 0 }, { lotId: 12, drawIndex: 1 }] } },
    { kind: 'OPTIONS', input: { optionSelections: [{ lotId: 3, optionId: 9 }, { lotId: 40, optionId: 9 }] } },
    { kind: 'DRAW', input: { selections: [{ lotId: null }], optionSelections: [] } },
    {},
  ]
  assert.deepEqual(packageLotIds(packages), ['3', '12', '40'])
  assert.deepEqual(packageLotIds(), [])
})

const raw = (overrides = {}) => ({
  source_change_order_id: 2,
  source_change_order_number: 'CO-0002',
  source_internal_number: 'CO-0002',
  source_po_co_number: null,
  lot_id: 611,
  phase_id: 80,
  phase_code: '3',
  building: null,
  lot_number: '14',
  plan_id: 461,
  plan_code: '2',
  plan_name: 'Plan Two',
  scope_of_work: 'Wider door',
  amount: '250.50',
  ...overrides,
})

test('a row of the preview is read with text instead of null and the Amount as a number', () => {
  assert.deepEqual(toPackageChargeRow(raw()), {
    sourceId: 2,
    sourceNumber: 'CO-0002',
    sourceInternalNumber: 'CO-0002',
    sourcePoCoNumber: '',
    lotId: '611',
    phase: '3',
    building: '',
    lot: '14',
    plan: '2',
    planName: 'Plan Two',
    scope: 'Wider door',
    amount: 250.5,
  })
})

test('the rows go under the Extra / CO they charge for, with exact totals', () => {
  const rows = [
    raw({ lot_id: 1, amount: '0.10' }),
    raw({ lot_id: 2, amount: '0.20', source_change_order_id: 5, source_change_order_number: 'CO-0005', source_po_co_number: 'PO 77' }),
    raw({ lot_id: 3, amount: '0.20' }),
  ].map(toPackageChargeRow)
  const { groups, lots, total } = groupPackageCharges(rows)

  assert.equal(lots, 3)
  assert.equal(total, 0.5)
  assert.deepEqual(groups.map(({ number, poCoNumber, total: sum, rows: own }) => ({ number, poCoNumber, sum, lots: own.map((row) => row.lotId) })), [
    { number: 'CO-0002', poCoNumber: '', sum: 0.3, lots: ['1', '3'] },
    { number: 'CO-0005', poCoNumber: 'PO 77', sum: 0.2, lots: ['2'] },
  ])
  assert.deepEqual(groupPackageCharges([]), { groups: [], lots: 0, total: 0 })
})
