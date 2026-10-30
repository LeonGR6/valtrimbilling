import test from 'node:test'
import assert from 'node:assert/strict'
import {
  displayInvoiceNumber,
  invoiceStatusLabel,
  packageDocumentNumber,
  worksheetCellLabels,
} from '../src/features/draw-invoice/utils/packageInvoiceLabel.js'

const created = {
  packageNumber: 'DP-00000008',
  quickbooksStatus: 'CREATED',
  quickbooksReference: '15001',
  paymentState: null,
}

test('the invoice number is the serial one once QuickBooks has the invoice', () => {
  assert.equal(displayInvoiceNumber(created), '15001')
  assert.equal(displayInvoiceNumber({ ...created, quickbooksStatus: 'NOT_CREATED' }), null)
  assert.equal(displayInvoiceNumber({ ...created, quickbooksStatus: 'VOIDED' }), null)
  // A number saved on the invoice itself wins.
  assert.equal(displayInvoiceNumber({ ...created, invoiceNumber: 'INV-9' }), 'INV-9')
})

test('a locked cell shows the Package number until there is an invoice', () => {
  const pending = { packageNumber: 'DP-00000008', quickbooksStatus: 'NOT_CREATED' }
  assert.deepEqual(worksheetCellLabels(pending), { title: 'DP-00000008', subtitle: 'Invoice pending' })
  assert.deepEqual(
    worksheetCellLabels(pending, 'Billed on Draw #2'),
    { title: 'DP-00000008', subtitle: 'Billed on Draw #2' },
  )
})

test('a locked cell shows the invoice number and how the invoice stands', () => {
  assert.deepEqual(worksheetCellLabels(created), { title: 'Invoice 15001', subtitle: 'Invoice created' })
  for (const [paymentState, label] of [
    ['OPEN', 'Open'],
    ['OVERDUE', 'Overdue'],
    ['PAID', 'Paid'],
    ['CLOSED', 'Closed'],
    ['PARTIALLY_PAID', 'Partially paid'],
  ]) {
    assert.equal(worksheetCellLabels({ ...created, paymentState }).subtitle, label)
  }
  assert.equal(
    worksheetCellLabels({ ...created, paymentState: 'PARTIALLY_PAID', paymentOverdue: true }).subtitle,
    'Partially paid · Overdue',
  )
})

test('documents are named by the invoice number once there is one', () => {
  assert.equal(packageDocumentNumber(created), '15001')
  assert.equal(
    packageDocumentNumber({ packageNumber: 'DP-00000009', quickbooksStatus: 'NOT_CREATED' }),
    'DP-00000009',
  )
})

test('the status is empty for a Package that was never invoiced', () => {
  assert.equal(invoiceStatusLabel({ quickbooksStatus: 'NOT_CREATED' }), null)
  assert.equal(invoiceStatusLabel({ quickbooksStatus: 'CREATED' }), 'Invoice created')
})
