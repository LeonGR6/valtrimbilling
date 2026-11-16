import assert from 'node:assert/strict'
import test from 'node:test'
import {
  lotKey,
  lotsWithPriorChangeOrders,
  priorChangeOrdersByLot,
} from '../src/features/change-orders/utils/priorChangeOrders.js'

const orders = [
  { id: 1, number: 'CO-0001', status: 'APPROVED' },
  { id: 2, number: 'CO-0002', status: 'CANCELLED' },
  { id: 3, number: 'CO-0003', status: 'DRAFT' },
]
const lines = [
  { changeOrderId: 1, location: 'Lot 91' },
  { changeOrderId: 1, location: '"92"' },
  { changeOrderId: 2, location: 'LOT93' },
  { changeOrderId: 3, location: 'Sales Office' },
  { changeOrderId: 3, location: 'lot 91' },
  { changeOrderId: 9, location: 'Lot 95' },
]

test('Lot numbers compare without zeros or case', () => {
  assert.equal(lotKey('014'), '14')
  assert.equal(lotKey(' 12a '), '12A')
  assert.equal(lotKey(null), '')
})

test('each Lot number keeps the Extras / COs whose lines named it, except cancelled ones', () => {
  const byLot = priorChangeOrdersByLot(lines, orders)
  assert.deepEqual(byLot.get('91').map((order) => order.number), ['CO-0001', 'CO-0003'])
  assert.deepEqual(byLot.get('92').map((order) => order.number), ['CO-0001'])
  assert.equal(byLot.has('93'), false)
  assert.equal(byLot.has('95'), false)
  assert.equal(byLot.has('OFFICE'), false)
})

test('the Lots of a Sequence Sheet that had an Extra / CO are found once each, in any way they are written', () => {
  const byLot = priorChangeOrdersByLot(lines, orders)
  const found = lotsWithPriorChangeOrders(['090', '091', '91', '92', '93', ''], byLot)
  assert.deepEqual(found.map((item) => item.lot), ['091', '92'])
  assert.deepEqual(lotsWithPriorChangeOrders(['1', '2'], byLot), [])
})
