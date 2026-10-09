import assert from 'node:assert/strict'
import test from 'node:test'
import {
  quickbooksStatusView,
  quickbooksButtonTitle,
  quickbooksOAuthReturnMessage,
  quickbooksProductMissing,
  toQuickbooksConnection,
} from '../src/features/draw-invoice/services/quickbooksRecord.js'

const row = {
  realm_id: '9341',
  environment: 'sandbox',
  company_name: 'Sandbox Co',
  item_id: '19',
  item_name: 'Material Installation & Supply',
  status: 'CONNECTED',
  connected_at: '2026-10-09T12:00:00Z',
  last_error: null,
  refresh_token_expires_at: '2027-01-17T12:00:00Z',
}

test('maps the connection row and tolerates no connection', () => {
  assert.equal(toQuickbooksConnection(null), null)
  assert.deepEqual(toQuickbooksConnection(row), {
    realmId: '9341',
    environment: 'sandbox',
    companyName: 'Sandbox Co',
    itemId: '19',
    itemName: 'Material Installation & Supply',
    status: 'CONNECTED',
    connectedAt: '2026-10-09T12:00:00Z',
    lastError: '',
    refreshTokenExpiresAt: '2027-01-17T12:00:00Z',
  })
})

test('describes the status card for every connection state', () => {
  const connected = toQuickbooksConnection(row)
  const noProduct = toQuickbooksConnection({ ...row, item_id: null, item_name: null })
  const production = toQuickbooksConnection({ ...row, environment: 'production' })

  assert.deepEqual(quickbooksStatusView({ loading: true, connection: null, canConnect: true }), {
    tone: 'neutral',
    status: 'Checking…',
    detail: 'Reading the connection',
  })
  assert.deepEqual(quickbooksStatusView({ loading: false, connection: null, canConnect: true }), {
    tone: 'neutral',
    status: 'Not connected',
    detail: 'Click to connect',
  })
  assert.equal(
    quickbooksStatusView({ loading: false, connection: null, canConnect: false }).detail,
    'Administrator only',
  )
  assert.deepEqual(quickbooksStatusView({ loading: false, connection: connected, canConnect: true }), {
    tone: 'success',
    status: 'Connected',
    detail: 'Sandbox Co · Sandbox',
  })
  assert.equal(
    quickbooksStatusView({ loading: false, connection: production, canConnect: true }).detail,
    'Sandbox Co',
  )
  assert.equal(
    quickbooksStatusView({ loading: false, connection: noProduct, canConnect: true }).tone,
    'warning',
  )
  assert.equal(quickbooksProductMissing(noProduct), true)
  assert.equal(quickbooksProductMissing(connected), false)
})

test('explains who can connect and which company is connected', () => {
  const connected = toQuickbooksConnection(row)

  assert.equal(
    quickbooksButtonTitle({ canConnect: false, connection: connected }),
    'Only an administrator can connect QuickBooks.',
  )
  assert.match(
    quickbooksButtonTitle({ canConnect: true, connection: connected }),
    /Sandbox Co \(Sandbox\) · Product: Material Installation & Supply/,
  )
})

test('turns each OAuth return reason into a readable message', () => {
  assert.match(quickbooksOAuthReturnMessage('access_denied'), /not granted/)
  assert.match(quickbooksOAuthReturnMessage('invalid_state'), /expired/)
  assert.match(quickbooksOAuthReturnMessage('product_not_found'), /Material Installation & Supply/)
  assert.match(quickbooksOAuthReturnMessage('whatever'), /could not be connected/)
})

import {
  canCreateQuickbooksInvoice,
  quickbooksInvoiceUrl,
  quickbooksPackageStatusView,
  toQuickbooksInvoicePreview,
  toQuickbooksInvoiceResult,
  toQuickbooksInvoiceSync,
} from '../src/features/draw-invoice/services/quickbooksRecord.js'

const draftPackage = {
  packageType: 'DRAW',
  status: 'DRAFT',
  quickbooksStatus: 'NOT_CREATED',
  quickbooksReference: null,
}

test('only ADMIN and ACCOUNTING can send an eligible Package to QuickBooks', () => {
  assert.equal(canCreateQuickbooksInvoice(draftPackage, 'ADMIN'), true)
  assert.equal(canCreateQuickbooksInvoice(draftPackage, 'ACCOUNTING'), true)
  assert.equal(canCreateQuickbooksInvoice(draftPackage, 'PROJECT_MANAGEMENT'), false)
  assert.equal(canCreateQuickbooksInvoice(draftPackage, 'READ_ONLY'), false)
  assert.equal(canCreateQuickbooksInvoice(null, 'ADMIN'), false)
})

test('the action is offered again after a sync error but never once created', () => {
  const failed = { ...draftPackage, quickbooksStatus: 'SYNC_ERROR' }

  assert.equal(canCreateQuickbooksInvoice(failed, 'ADMIN'), true)
  assert.equal(
    canCreateQuickbooksInvoice({ ...draftPackage, quickbooksStatus: 'CREATED' }, 'ADMIN'),
    false,
  )
})

test('cancelled Packages and retention releases are never sent', () => {
  assert.equal(canCreateQuickbooksInvoice({ ...draftPackage, status: 'CANCELLED' }, 'ADMIN'), false)
  assert.equal(
    canCreateQuickbooksInvoice({ ...draftPackage, packageType: 'RETENTION_RELEASE' }, 'ADMIN'),
    false,
  )
})

test('builds the QuickBooks invoice link for each environment', () => {
  assert.equal(
    quickbooksInvoiceUrl('sandbox', '146'),
    'https://app.sandbox.qbo.intuit.com/app/invoice?txnId=146',
  )
  assert.equal(
    quickbooksInvoiceUrl('production', '146'),
    'https://app.qbo.intuit.com/app/invoice?txnId=146',
  )
  assert.equal(quickbooksInvoiceUrl('production', null), null)
  assert.equal(quickbooksInvoiceUrl(null, '146'), null)
})

test('a created invoice is highlighted and links to QuickBooks for every role', () => {
  const created = {
    ...draftPackage,
    quickbooksStatus: 'CREATED',
    quickbooksReference: 'DP-00000029',
  }
  const sync = { environment: 'sandbox', invoiceId: '146', docNumber: 'DP-00000029' }

  for (const canSend of [true, false]) {
    assert.deepEqual(quickbooksPackageStatusView({ record: created, sync, canSend }), {
      tone: 'success',
      status: 'Invoice created',
      detail: 'Invoice DP-00000029',
      action: 'open',
      href: 'https://app.sandbox.qbo.intuit.com/app/invoice?txnId=146',
    })
  }
  // Without the sync row the invoice is still announced, just not linked.
  assert.equal(quickbooksPackageStatusView({ record: created, sync: null, canSend: false }).href, null)
})

test('a failed sync can be retried only by people who can send', () => {
  const failed = { ...draftPackage, quickbooksStatus: 'SYNC_ERROR' }

  assert.deepEqual(quickbooksPackageStatusView({ record: failed, sync: null, canSend: true }), {
    tone: 'warning',
    status: 'Sync error',
    detail: 'Click to retry',
    action: 'send',
    href: null,
  })
  const readOnly = quickbooksPackageStatusView({ record: failed, sync: null, canSend: false })
  assert.equal(readOnly.action, 'none')
  assert.equal(readOnly.detail, 'The last attempt failed')
})

test('a Package that was never sent only shows the card to people who can send it', () => {
  assert.deepEqual(quickbooksPackageStatusView({ record: draftPackage, sync: null, canSend: true }), {
    tone: 'neutral',
    status: 'Not sent',
    detail: 'Click to send',
    action: 'send',
    href: null,
  })
  assert.equal(quickbooksPackageStatusView({ record: draftPackage, sync: null, canSend: false }), null)
  assert.equal(
    quickbooksPackageStatusView({ record: { ...draftPackage, status: 'CANCELLED' }, sync: null, canSend: true }),
    null,
  )
  assert.equal(
    quickbooksPackageStatusView({
      record: { ...draftPackage, packageType: 'RETENTION_RELEASE' },
      sync: null,
      canSend: true,
    }),
    null,
  )
})

test('maps the dry run to preview lines and a cent-exact total', () => {
  const preview = toQuickbooksInvoicePreview({
    dryRun: true,
    customer: { customerId: '58', displayName: 'Trumark', source: 'quickbooks' },
    invoice: {
      DocNumber: 'DP-00000068',
      TxnDate: '2026-10-09',
      DueDate: '2026-11-08',
      Line: [
        { Description: 'PHASE 1 LOTS #97-99\nDRAW 3', Amount: 2637.8 },
        { Description: 'PHASE 1 LOT #98\nOPTIONS', Amount: 50 },
        { Description: 'WRAP', Amount: -67.21 },
      ],
    },
  })

  assert.equal(preview.customerName, 'Trumark')
  assert.equal(preview.customerIsNew, true)
  assert.equal(preview.dueDate, '2026-11-08')
  assert.equal(preview.lines.length, 3)
  assert.equal(preview.total, 2620.59)
  assert.equal(toQuickbooksInvoicePreview({}), null)
})

test('maps the created invoice and the last sync attempt', () => {
  assert.deepEqual(
    toQuickbooksInvoiceResult({
      dryRun: false,
      invoiceId: '147',
      docNumber: 'DP-00000068',
      totalAmount: 760,
      customer: { displayName: 'Trumark' },
    }),
    { invoiceId: '147', docNumber: 'DP-00000068', totalAmount: 760, customerName: 'Trumark' },
  )
  assert.equal(toQuickbooksInvoiceSync(null), null)
  assert.deepEqual(
    toQuickbooksInvoiceSync({ status: 'FAILED', error: 'Customer not found', updated_at: 't' }),
    {
      status: 'FAILED',
      error: 'Customer not found',
      environment: null,
      invoiceId: null,
      docNumber: null,
      totalAmount: null,
      updatedAt: 't',
    },
  )
})
