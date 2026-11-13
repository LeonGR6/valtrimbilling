import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createdInvoiceNumber,
  createsInvoiceWhileGenerating,
  describeCreatedInvoice,
  describeInvoiceCreationFailure,
  describeMissingInvoicePdf,
} from '../src/features/draw-invoice/services/packageGenerateRecord.js'

test('generating creates the invoice only when it may and is left in the PDF', () => {
  assert.equal(createsInvoiceWhileGenerating({ canCreateInvoice: true, includeInvoice: true }), true)
  // Left out: the PDF is generated as before, with no invoice.
  assert.equal(createsInvoiceWhileGenerating({ canCreateInvoice: true, includeInvoice: false }), false)
  // Not allowed, or already invoiced: nothing to create.
  assert.equal(createsInvoiceWhileGenerating({ canCreateInvoice: false, includeInvoice: true }), false)
  assert.equal(createsInvoiceWhileGenerating({}), false)
})

test('a failed invoice says why, that nothing was joined and which documents are saved', () => {
  assert.equal(
    describeInvoiceCreationFailure('QuickBooks already has an invoice with this number.', {
      savedDocuments: ['Release', 'Payment Schedule'],
    }),
    'The QuickBooks invoice could not be created, so nothing was joined: QuickBooks already has an invoice with this number. The Release and Payment Schedule were saved to this Package.',
  )
  // A reason without a full stop gets one, and one document is "was saved".
  assert.equal(
    describeInvoiceCreationFailure('Not connected', { savedDocuments: ['Release'] }),
    'The QuickBooks invoice could not be created, so nothing was joined: Not connected. The Release was saved to this Package.',
  )
  assert.equal(
    describeInvoiceCreationFailure('Not connected'),
    'The QuickBooks invoice could not be created, so nothing was joined: Not connected.',
  )
  assert.equal(
    describeInvoiceCreationFailure('', {}),
    'The QuickBooks invoice could not be created, so nothing was joined.',
  )
})

test('the created invoice is named by its number, then its QuickBooks number, then its id', () => {
  assert.equal(createdInvoiceNumber({ invoiceNumber: '14880', docNumber: '14880', invoiceId: '55' }), '14880')
  assert.equal(createdInvoiceNumber({ invoiceNumber: '', docNumber: 'A-1', invoiceId: '55' }), 'A-1')
  assert.equal(createdInvoiceNumber({ invoiceNumber: '', docNumber: '', invoiceId: '55' }), '55')
  assert.equal(createdInvoiceNumber(null), '')
})

test('the messages after creating name the invoice and where it was made', () => {
  const created = { invoiceNumber: '14880', environment: 'production' }

  assert.equal(describeCreatedInvoice(created), ' Invoice 14880 was created in QuickBooks Production.')
  assert.equal(
    describeCreatedInvoice({ invoiceNumber: '9', environment: 'sandbox' }),
    ' Invoice 9 was created in QuickBooks Test.',
  )
  assert.equal(describeCreatedInvoice(null), '')

  assert.match(describeMissingInvoicePdf(created), /^Invoice 14880 was created in QuickBooks, but its PDF could not be read/u)
  assert.match(describeMissingInvoicePdf(created), /Get the PDF from QuickBooks under Invoice, then generate again\.$/u)
})
