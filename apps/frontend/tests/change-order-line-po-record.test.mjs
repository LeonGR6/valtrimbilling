import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bestPosByLine,
  changeOrdersByPo,
  describeMatch,
  summarizeLinePos,
  toLinePo,
} from '../src/features/change-orders/services/changeOrderLinePoRecord.js'

const row = (fields) => toLinePo({
  change_order_id: 1, change_order_number: 'CO-0001', change_order_status: 'APPROVED', line_id: 10, lot_number: '17',
  line_amount: '1689.60', po_id: 5, po_line_number: 1, file_id: 'f', file_name: 'SIMI.pdf', storage_bucket: 'change-order-pos',
  storage_path: '9/f.pdf', po_number: '4010-C-003232', document_kind: 'PURCHASE_ORDER', lot_text: '0017', lots_checked: true,
  lot_amount: '1689.60', lot_net_amount: null, number_matches: true, amount_matches: 'GROSS', match_level: 'NUMBER', is_best: true,
  ...fields,
})

test('a row of the view reads as a match with its PDF', () => {
  const match = row({})
  assert.equal(match.lotAmount, 1689.6)
  assert.equal(match.file.storagePath, '9/f.pdf')
  assert.equal(match.kindLabel, 'Purchase Order')
  assert.equal(match.level, 'NUMBER')
})

test('only the surest POs of a line are kept, once each', () => {
  const byLine = bestPosByLine([row({}), row({}), row({ po_id: 6, is_best: false, match_level: 'LOT' })])
  assert.deepEqual(Object.keys(byLine), ['10'])
  assert.equal(byLine['10'].length, 1)
})

test('the summary says which Lots have a PO and groups them by PO', () => {
  const lines = [{ id: 10, lot: '17' }, { id: 11, lot: '18' }, { id: 12, lot: '21' }]
  const byLine = bestPosByLine([row({}), row({ line_id: 11, lot_number: '18', match_level: 'LOT' })])
  const summary = summarizeLinePos(lines, byLine)
  assert.equal(summary.backed, 2)
  assert.deepEqual(summary.missing.map((line) => line.lot), ['21'])
  assert.equal(summary.pos.length, 1)
  assert.deepEqual(summary.pos[0].lots, ['17', '18'])
  assert.equal(summary.pos[0].level, 'LOT')
})

test('a PO can back several Extras / COs; a cancelled one is left out', () => {
  const byPo = changeOrdersByPo([
    row({}),
    row({ change_order_id: 2, change_order_number: 'CO-0002', line_id: 20, lot_number: '30' }),
    row({ change_order_id: 3, change_order_number: 'CO-0003', change_order_status: 'CANCELLED', line_id: 30 }),
  ])
  assert.deepEqual(byPo['5'].map((item) => item.number), ['CO-0001', 'CO-0002'])
})

test('a match says what agrees, net of OCIP included', () => {
  const formatCurrency = (value) => `$${value.toFixed(2)}`
  assert.match(describeMatch(row({}), formatCurrency).facts.join(' '), /PO \/ CO # of this Extra/)
  const net = describeMatch(row({ number_matches: false, amount_matches: 'NET', lot_net_amount: '1689.60', lot_amount: '2000' }), formatCurrency)
  assert.equal(net.net, '$1689.60')
  assert.match(net.facts.join(' '), /OCIP/)
})
