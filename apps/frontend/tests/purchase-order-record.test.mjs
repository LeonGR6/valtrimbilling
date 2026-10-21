import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeHeaderMatch,
  describePurchaseOrderDocument,
  groupWorkOrders,
  priceDifference,
  summarizeByDocument,
  summarizeComparison,
  toComparisonLine,
  toPurchaseOrderAnalysis,
  uncoveredByLot,
} from '../src/features/purchase-orders/services/purchaseOrderRecord.js'

function row(overrides = {}) {
  return {
    line_id: 1,
    job_document_id: 'doc-27',
    work_order_no: 'WO-1',
    reference_no: '0004617537',
    po_date: '2026-08-13',
    revised_on: '2026-09-02',
    lot_raw: '27',
    phase_raw: 'MDL',
    plan_raw: '4',
    elevation_raw: 'B',
    option_code_raw: '2FIN5006',
    description_lines: ['Add Half Size Shelf', 'Bedroom 3'],
    quantity: '1.000',
    po_unit_price: '81.00',
    header_status: 'suggested',
    lot_id: 27,
    lot_number: '27',
    phase_code: 'MODELS',
    building: '.',
    plan_code: '4B',
    plan_option_id: 100,
    option_name: 'Add Half Size Lower Second Shelf',
    system_price: '81.00',
    system_not_applicable: false,
    conflicting_po_prices: false,
    status: 'MATCH',
    ...overrides,
  }
}

test('maps a comparison line with numbers as numbers', () => {
  const line = toComparisonLine(row({ system_price: '-14.00', po_unit_price: '-14.00' }))
  assert.equal(line.poUnitPrice, -14)
  assert.equal(line.systemPrice, -14)
  assert.equal(line.quantity, 1)
  assert.equal(line.lotId, 27)
  assert.equal(line.documentId, 'doc-27')

  const unmatched = toComparisonLine(row({
    lot_id: null,
    lot_number: null,
    system_price: null,
    plan_option_id: null,
    status: 'HEADER_UNRESOLVED',
  }))
  assert.equal(unmatched.lotId, null)
  assert.equal(unmatched.systemPrice, null)
  assert.equal(unmatched.planOptionId, null)
})

test('the price difference is PO minus system, in cents', () => {
  assert.equal(priceDifference(toComparisonLine(row({ po_unit_price: '1126.00', system_price: '1100.00' }))), 26)
  assert.equal(priceDifference(toComparisonLine(row({ po_unit_price: '0.30', system_price: '0.10' }))), 0.2)
  assert.equal(priceDifference(toComparisonLine(row({ system_price: null }))), null)
})

test('summarizes statuses and how many lines need attention', () => {
  const lines = [
    row({ status: 'MATCH' }),
    row({ line_id: 2, status: 'PRICE_DIFF' }),
    row({ line_id: 3, status: 'MISSING_OPTION' }),
    row({ line_id: 4, status: 'MATCH' }),
  ].map(toComparisonLine)

  const summary = summarizeComparison(lines)
  assert.equal(summary.total, 4)
  assert.equal(summary.matches, 2)
  assert.equal(summary.attention, 2)
  assert.equal(summary.byStatus.PRICE_DIFF, 1)
  assert.equal(summary.byStatus.HEADER_UNRESOLVED, 0)
})

test('summarizes each document of a Job apart', () => {
  const lines = [
    row({ job_document_id: 'a', status: 'MATCH' }),
    row({ line_id: 2, job_document_id: 'b', status: 'PRICE_DIFF' }),
    row({ line_id: 3, job_document_id: 'b', status: 'MATCH' }),
  ].map(toComparisonLine)

  const byDocument = summarizeByDocument(lines)
  assert.equal(byDocument.a.attention, 0)
  assert.equal(byDocument.b.total, 2)
  assert.equal(byDocument.b.attention, 1)
})

test('the card of a PDF says what happened to it', () => {
  const analysis = (status, extra = {}) => toPurchaseOrderAnalysis({
    id: 'x',
    job_document_id: 'doc',
    job_id: 4,
    status,
    issues: [],
    updated_at: '2026-10-21T12:00:00Z',
    ...extra,
  })

  assert.equal(describePurchaseOrderDocument(null).status.label, 'Not analyzed')
  assert.equal(describePurchaseOrderDocument(null, null, true).status.label, 'Analyzing…')
  assert.equal(describePurchaseOrderDocument(analysis('failed')).status.color, 'error')

  const notPo = describePurchaseOrderDocument(analysis('not_option_po', { error: 'Layout not supported.' }))
  assert.equal(notPo.status.label, 'Not a PO of options')
  assert.equal(notPo.title, 'Layout not supported.')

  assert.equal(describePurchaseOrderDocument(analysis('analyzed')).status.label, 'Analyzed')
  assert.deepEqual(
    describePurchaseOrderDocument(analysis('analyzed'), { total: 5, attention: 2 }),
    { status: { color: 'warning', label: '2 to review' }, linesChip: { label: '5 options' } },
  )
  assert.deepEqual(
    describePurchaseOrderDocument(analysis('analyzed'), { total: 1, attention: 0 }),
    { status: { color: 'success', label: 'All match' }, linesChip: { label: '1 option' } },
  )
})

test('groups lines by work order and explains a suggested match', () => {
  const lines = [
    row({ line_id: 1, work_order_no: 'WO-2', lot_raw: '28', lot_number: '28', plan_code: '2A', plan_raw: '2', elevation_raw: 'A' }),
    row({ line_id: 2, work_order_no: 'WO-1' }),
    row({ line_id: 3, work_order_no: 'WO-1', option_code_raw: '1STR0024' }),
  ].map(toComparisonLine)

  const groups = groupWorkOrders(lines)
  assert.deepEqual(groups.map((group) => group.workOrderNo), ['WO-1', 'WO-2'])
  assert.equal(groups[0].lines.length, 2)
  assert.equal(groups[0].printed.plan, '4B')
  assert.equal(groups[0].system.planCode, '4B')

  const message = describeHeaderMatch(groups[0])
  assert.match(message, /Lot 27 · Phase MDL · Plan 4B/)
  assert.match(message, /Phase MODELS/)
})

test('explains a header that did not match', () => {
  const group = (overrides) => groupWorkOrders([toComparisonLine(row(overrides))])[0]

  assert.equal(describeHeaderMatch(group({ header_status: 'resolved' })), null)
  assert.match(
    describeHeaderMatch(group({ header_status: 'plan_mismatch', plan_code: '2A' })),
    /Plan 4B, but Lot 27 is Plan 2A/,
  )
  assert.match(
    describeHeaderMatch(group({ header_status: 'lot_not_found', lot_id: null, lot_number: null, status: 'HEADER_UNRESOLVED' })),
    /No Lot of this Job fits Lot 27/,
  )
})

test('lists uncovered options only for the Lots of the document', () => {
  const uncovered = [
    { lot_id: 27, lot_number: '27', phase_code: 'MODELS', building: '.', option_id: 103, option_code: '9XXX0001', option_name: 'Extra', system_price: '10.00', system_not_applicable: false },
    { lot_id: 30, lot_number: '30', phase_code: 'MODELS', building: '.', option_id: 104, option_code: '9XXX0002', option_name: 'Other', system_price: null, system_not_applicable: true },
  ].map((item) => ({
    lotId: item.lot_id,
    lotNumber: item.lot_number,
    optionCode: item.option_code,
  }))

  const result = uncoveredByLot(uncovered, [27])
  assert.equal(result.length, 1)
  assert.equal(result[0].lotNumber, '27')
  assert.equal(result[0].options[0].optionCode, '9XXX0001')
})
