import assert from 'node:assert/strict'
import test from 'node:test'
import {
  quickbooksLastInvoiceLabel,
  quickbooksStatusView,
  canManageQuickbooksCustomers,
  quickbooksCustomerRows,
  toQuickbooksCustomerLink,
  quickbooksButtonTitle,
  quickbooksOAuthReturnMessage,
  quickbooksProductMissing,
  toQuickbooksConnection,
  quickbooksConnectionSummary,
  quickbooksTokenDaysLeft,
  isQuickbooksTestPackage,
  canResetQuickbooksTestInvoice,
  canStartNewQuickbooksInvoice,
  quickbooksPackageEnvironmentView,
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

test('formats the last invoice as a time today and as a day and time before', () => {
  const now = new Date(2026, 9, 9, 18, 0)

  assert.equal(quickbooksLastInvoiceLabel(new Date(2026, 9, 9, 12, 42).toISOString(), now), '12:42 PM')
  assert.equal(quickbooksLastInvoiceLabel(new Date(2026, 9, 8, 9, 5).toISOString(), now), 'Oct 8, 9:05 AM')
  assert.equal(quickbooksLastInvoiceLabel(null, now), null)
  assert.equal(quickbooksLastInvoiceLabel('not a date', now), null)
})

test('describes the status card for every connection state', () => {
  const connected = toQuickbooksConnection(row)
  const noProduct = toQuickbooksConnection({ ...row, item_id: null, item_name: null })
  const production = toQuickbooksConnection({ ...row, environment: 'production' })
  const now = new Date(2026, 9, 9, 18, 0)
  const lastInvoiceAt = new Date(2026, 9, 9, 12, 42).toISOString()

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
  assert.deepEqual(
    quickbooksStatusView({ loading: false, connection: connected, canConnect: true, lastInvoiceAt, now }),
    { tone: 'success', status: 'Connected', detail: 'Last invoice: 12:42 PM · Test' },
  )
  assert.equal(
    quickbooksStatusView({ loading: false, connection: connected, canConnect: true, now }).detail,
    'No invoices yet · Test',
  )
  assert.equal(
    quickbooksStatusView({ loading: false, connection: production, canConnect: true, lastInvoiceAt, now }).detail,
    'Last invoice: 12:42 PM',
  )
  assert.deepEqual(quickbooksStatusView({ loading: false, connection: noProduct, canConnect: true }), {
    tone: 'warning',
    status: 'Product missing',
    detail: 'Sandbox Co · Test',
  })
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
    /Sandbox Co \(Test\) · Product: Material Installation & Supply/,
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
  isInvoicedThroughQuickbooks,
  quickbooksInvoiceUrl,
  quickbooksPaymentView,
  quickbooksPackageStatusView,
  quickbooksTableStatusView,
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
  const sync = { environment: 'production', invoiceId: '146', docNumber: 'DP-00000029' }

  for (const canSend of [true, false]) {
    assert.deepEqual(quickbooksPackageStatusView({ record: created, sync, canSend }), {
      tone: 'success',
      status: 'Invoice created',
      detail: 'Invoice DP-00000029',
      action: 'open',
      href: 'https://app.qbo.intuit.com/app/invoice?txnId=146',
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
  assert.deepEqual(preview.customFields, [])
  assert.deepEqual(preview.warnings, [])
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
    {
      invoiceId: '147',
      docNumber: 'DP-00000068',
      totalAmount: 760,
      customerName: 'Trumark',
      environment: null,
      invoiceNumber: '',
      warnings: [],
    },
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
      paymentState: null,
      paymentBalance: null,
      paymentTotal: null,
      dueDate: null,
      overdue: false,
      linkedTransactions: [],
      paymentCheckedAt: null,
    },
  )
})

test('the QuickBooks card speaks in QuickBooks words once the payment is known', () => {
  const sync = (overrides) => toQuickbooksInvoiceSync({
    status: 'CREATED',
    environment: 'production',
    qbo_invoice_id: '150',
    qbo_doc_number: 'DP-00000004',
    qbo_state: 'OPEN',
    qbo_balance: 1000,
    qbo_total: 1000,
    qbo_due_date: '2026-11-12',
    qbo_overdue: false,
    updated_at: 't',
    ...overrides,
  })
  const record = { packageType: 'DRAW', status: 'AWAITING_PAYMENT', quickbooksStatus: 'CREATED', quickbooksReference: 'DP-00000004' }
  const view = (overrides) => quickbooksPackageStatusView({ record, sync: sync(overrides), canSend: true })

  // Before QuickBooks was asked, the card says the invoice was created.
  assert.equal(quickbooksPackageStatusView({ record, sync: null, canSend: true }).status, 'Invoice created')
  assert.deepEqual(
    [view({}).status, view({}).tone, view({}).detail],
    ['Open', 'success', 'Invoice DP-00000004 · $1,000.00 due · due Nov 12'],
  )
  assert.deepEqual([view({ qbo_state: 'OVERDUE', qbo_overdue: true }).status, view({ qbo_state: 'OVERDUE', qbo_overdue: true }).tone], ['Overdue', 'error'])
  assert.equal(view({ qbo_state: 'PARTIALLY_PAID', qbo_balance: 400, qbo_overdue: true }).status, 'Partially paid · Overdue')
  assert.equal(view({ qbo_state: 'PAID', qbo_balance: 0 }).status, 'Paid')
  assert.equal(view({ qbo_state: 'CLOSED', qbo_balance: 0 }).detail.includes('Settled'), true)
  assert.equal(view({ qbo_state: 'VOIDED' }).status, 'Voided')
  assert.equal(view({ qbo_state: 'DELETED' }).tone, 'warning')
  assert.equal(quickbooksPaymentView(sync({ qbo_state: null })), null)
})

test('the Packages table reports the QuickBooks state of every invoiced package', () => {
  const draw = { packageType: 'DRAW', status: 'DRAFT' }

  assert.deepEqual(quickbooksTableStatusView({ ...draw, quickbooksStatus: 'NOT_CREATED' }), {
    tone: 'neutral', status: 'Not sent', detail: '',
  })
  assert.deepEqual(
    quickbooksTableStatusView({
      ...draw, quickbooksStatus: 'CREATED', quickbooksReference: 'DP-00000068',
    }),
    { tone: 'success', status: 'Invoice created', detail: 'Invoice DP-00000068' },
  )
  assert.equal(quickbooksTableStatusView({ ...draw, quickbooksStatus: 'SYNC_ERROR' }).status, 'Sync error')
  assert.equal(
    quickbooksTableStatusView({ packageType: 'RETENTION_RELEASE', quickbooksStatus: 'NOT_CREATED' }),
    null,
  )
})

test('the preview carries the custom fields and the warnings of the function', () => {
  const preview = toQuickbooksInvoicePreview({
    customer: { displayName: 'Trumark' },
    invoice: {
      Line: [],
      CustomField: [
        { DefinitionId: '1', Name: 'Job Name', Type: 'StringType', StringValue: 'Sunset Ridge' },
        { DefinitionId: '2', Name: 'Job #', Type: 'StringType', StringValue: '1307' },
      ],
    },
    warnings: ['"Job Name" was shortened to 31 characters, the QuickBooks limit.'],
  })

  assert.deepEqual(preview.customFields, [
    { name: 'Job Name', value: 'Sunset Ridge' },
    { name: 'Job #', value: '1307' },
  ])
  assert.deepEqual(preview.warnings, ['"Job Name" was shortened to 31 characters, the QuickBooks limit.'])
  assert.deepEqual(toQuickbooksInvoiceResult({ warnings: ['x'] }).warnings, ['x'])
  assert.deepEqual(toQuickbooksInvoiceResult({}).warnings, [])
})

test('only ADMIN and ACCOUNTING manage the Builder to Customer links', () => {
  assert.equal(canManageQuickbooksCustomers('ADMIN'), true)
  assert.equal(canManageQuickbooksCustomers('ACCOUNTING'), true)
  assert.equal(canManageQuickbooksCustomers('PROJECT_MANAGEMENT'), false)
})

test('lists every Builder with the Customer it is linked to in the connected environment', () => {
  const builders = [
    { id: 24, name: 'Separate HW Builder' },
    { id: 1, name: 'Trumark Homes' },
    { id: 16, name: 'monte vista' },
  ]
  const links = [
    toQuickbooksCustomerLink({ builder_id: 1, environment: 'sandbox', customer_id: '58', display_name: 'Trumark Homes' }),
    toQuickbooksCustomerLink({ builder_id: 16, environment: 'production', customer_id: '9', display_name: 'Monte Vista' }),
  ]

  assert.deepEqual(quickbooksCustomerRows(builders, links, 'sandbox'), [
    { builderId: 16, builderName: 'monte vista', linked: false, customerId: null, customerName: '' },
    { builderId: 24, builderName: 'Separate HW Builder', linked: false, customerId: null, customerName: '' },
    { builderId: 1, builderName: 'Trumark Homes', linked: true, customerId: '58', customerName: 'Trumark Homes' },
  ])
  assert.equal(quickbooksCustomerRows(builders, links, 'production').find((row) => row.builderId === 16).linked, true)
})

import {
  canVoidQuickbooksInvoice,
  toQuickbooksInvoicePdf,
} from '../src/features/draw-invoice/services/quickbooksRecord.js'
import {
  canDeleteVoidedQuickbooksPackage,
} from '../src/features/draw-invoice/services/drawInvoicePackageRecord.js'
import { canDeleteDraftPackage } from '../src/features/draw-invoice/utils/packageCatalog.js'

const invoicedDraft = {
  packageType: 'DRAW',
  status: 'DRAFT',
  quickbooksStatus: 'CREATED',
  quickbooksReference: 'DP-00000029',
  invoiceNumber: null,
  invoiceDate: null,
  submissionStatus: 'NOT_SUBMITTED',
  submittedAt: null,
  persistedInvoice: { status: 'DRAFT', paidAmount: 0 },
}

test('only ADMIN and ACCOUNTING can void, and only a created invoice of an open Package', () => {
  assert.equal(canVoidQuickbooksInvoice(invoicedDraft, 'ADMIN'), true)
  assert.equal(canVoidQuickbooksInvoice(invoicedDraft, 'ACCOUNTING'), true)
  assert.equal(canVoidQuickbooksInvoice(invoicedDraft, 'PROJECT_MANAGEMENT'), false)
  // An open invoice leaves the Package Awaiting payment; it can still be voided
  // until it is sent to the Builder.
  assert.equal(canVoidQuickbooksInvoice({ ...invoicedDraft, status: 'AWAITING_PAYMENT' }, 'ADMIN'), true)
  assert.equal(
    canVoidQuickbooksInvoice({ ...invoicedDraft, status: 'AWAITING_PAYMENT', submissionStatus: 'SUBMITTED' }, 'ADMIN'),
    false,
  )
  assert.equal(
    canVoidQuickbooksInvoice({ ...invoicedDraft, status: 'AWAITING_PAYMENT', submittedAt: '2026-10-14T10:00:00Z' }, 'ADMIN'),
    false,
  )
  assert.equal(canVoidQuickbooksInvoice({ ...invoicedDraft, status: 'PAID_CLOSED' }, 'ADMIN'), false)
  assert.equal(canVoidQuickbooksInvoice({ ...invoicedDraft, quickbooksStatus: 'NOT_CREATED' }, 'ADMIN'), false)
  assert.equal(canVoidQuickbooksInvoice({ ...invoicedDraft, quickbooksStatus: 'VOIDED' }, 'ADMIN'), false)
  assert.equal(canVoidQuickbooksInvoice({ ...invoicedDraft, packageType: 'RETENTION_RELEASE' }, 'ADMIN'), false)
})

test('a voided draft can be deleted, an invoiced one cannot, and neither can be edited', () => {
  const voided = { ...invoicedDraft, quickbooksStatus: 'VOIDED' }

  assert.equal(canDeleteVoidedQuickbooksPackage(voided), true)
  assert.equal(canDeleteDraftPackage(voided), true)
  assert.equal(canDeleteDraftPackage(invoicedDraft), false)
  assert.equal(canDeleteVoidedQuickbooksPackage({ ...voided, submissionStatus: 'SUBMITTED' }), false)
  assert.equal(canDeleteVoidedQuickbooksPackage({ ...voided, persistedInvoice: { status: 'DRAFT', paidAmount: 50 } }), false)
  assert.equal(canDeleteVoidedQuickbooksPackage({ ...voided, status: 'PAID_CLOSED' }), false)
  assert.equal(canDeleteVoidedQuickbooksPackage({ ...voided, packageType: 'RETENTION_RELEASE' }), false)
})

test('a voided invoice is shown as such in the card and the table', () => {
  const voided = { ...invoicedDraft, quickbooksStatus: 'VOIDED' }

  assert.deepEqual(quickbooksPackageStatusView({ record: voided, sync: null, canSend: true }), {
    tone: 'neutral',
    status: 'Invoice voided',
    detail: 'Invoice DP-00000029',
    action: 'none',
    href: null,
  })
  assert.deepEqual(quickbooksTableStatusView(voided), {
    tone: 'neutral',
    status: 'Invoice voided',
    detail: 'Invoice DP-00000029',
  })
})

test('maps the saved QuickBooks PDF of a Package', () => {
  assert.equal(toQuickbooksInvoicePdf(null, null), null)
  assert.deepEqual(
    toQuickbooksInvoicePdf(
      { id: 5, completed_at: '2026-10-10T16:00:00Z' },
      { bucket_id: 'package-documents', object_path: '29/invoice/a.pdf', original_filename: 'Invoice - DP-00000029.pdf', size_bytes: '51234' },
    ),
    {
      documentId: 5,
      savedAt: '2026-10-10T16:00:00Z',
      file: {
        bucket: 'package-documents',
        storagePath: '29/invoice/a.pdf',
        name: 'Invoice - DP-00000029.pdf',
        sizeBytes: 51234,
      },
    },
  )
})

test('a Price Adjustment is sent, shown and voided in QuickBooks like a Draw; a Retention Release is not', () => {
  const adjustment = { ...draftPackage, packageType: 'PRICE_ADJUSTMENT' }
  const release = { ...draftPackage, packageType: 'RETENTION_RELEASE' }

  assert.equal(isInvoicedThroughQuickbooks(adjustment), true)
  assert.equal(isInvoicedThroughQuickbooks(release), false)
  assert.equal(isInvoicedThroughQuickbooks(draftPackage), true)
  // A record with no type is a Draw, as every record before the types existed.
  assert.equal(isInvoicedThroughQuickbooks({ status: 'DRAFT' }), true)

  assert.equal(canCreateQuickbooksInvoice(adjustment, 'ADMIN'), true)
  assert.equal(canCreateQuickbooksInvoice(adjustment, 'ACCOUNTING'), true)
  assert.equal(canCreateQuickbooksInvoice(adjustment, 'PROJECT_MANAGEMENT'), false)
  assert.equal(canCreateQuickbooksInvoice({ ...adjustment, quickbooksStatus: 'CREATED' }, 'ADMIN'), false)
  assert.equal(canCreateQuickbooksInvoice(release, 'ADMIN'), false)

  const invoiced = { ...adjustment, quickbooksStatus: 'CREATED', status: 'AWAITING_PAYMENT' }
  assert.equal(canVoidQuickbooksInvoice(invoiced, 'ADMIN'), true)
  assert.equal(canVoidQuickbooksInvoice({ ...release, quickbooksStatus: 'CREATED' }, 'ADMIN'), false)
  assert.notEqual(quickbooksPackageStatusView({ record: adjustment, sync: null, canSend: true }), null)
  assert.equal(quickbooksPackageStatusView({ record: release, sync: null, canSend: true }), null)
  assert.notEqual(quickbooksTableStatusView(adjustment), null)
  assert.equal(quickbooksTableStatusView(release), null)
})

test('an invoice sent to the Test QuickBooks says so, whatever QuickBooks reports', () => {
  const record = {
    packageType: 'DRAW',
    status: 'AWAITING_PAYMENT',
    quickbooksStatus: 'CREATED',
    quickbooksReference: '15027',
    quickbooksEnvironment: 'sandbox',
  }
  const sync = toQuickbooksInvoiceSync({
    status: 'CREATED',
    environment: 'sandbox',
    qbo_invoice_id: '150',
    qbo_doc_number: '15027',
    qbo_state: 'OPEN',
    qbo_balance: 1000,
    qbo_total: 1000,
    qbo_due_date: '2026-11-12',
    qbo_overdue: false,
    updated_at: 't',
  })

  assert.deepEqual(quickbooksPackageStatusView({ record, sync, canSend: true }), {
    tone: 'warning',
    status: 'Test invoice',
    detail: 'Invoice 15027 · Test · Open',
    action: 'open',
    href: 'https://app.sandbox.qbo.intuit.com/app/invoice?txnId=150',
  })
  assert.deepEqual(quickbooksTableStatusView(record), {
    tone: 'warning',
    status: 'Test invoice',
    detail: 'Invoice 15027 · Test',
  })
  // The lane on the Package is enough even before the sync row is read.
  assert.equal(quickbooksPackageStatusView({ record, sync: null, canSend: false }).status, 'Test invoice')
  // A Production invoice keeps QuickBooks' own words.
  assert.equal(
    quickbooksTableStatusView({ ...record, quickbooksEnvironment: 'production' }).status,
    'Invoice created',
  )
})

import {
  assignedInvoiceNumber,
  canSwitchQuickbooksMode,
  pickQuickbooksConnection,
  quickbooksEnvironmentLabel,
  nextInvoiceNumber,
  quickbooksInvoiceNumberStatus,
  toQuickbooksSettings,
} from '../src/features/draw-invoice/services/quickbooksRecord.js'

test('names the environments the way people say them', () => {
  assert.equal(quickbooksEnvironmentLabel('sandbox'), 'Test')
  assert.equal(quickbooksEnvironmentLabel('production'), 'Production')
  assert.equal(quickbooksEnvironmentLabel(null), '')
})

test('reads the active mode, defaulting to Test, and only an ADMIN can change it', () => {
  assert.deepEqual(toQuickbooksSettings({ active_environment: 'production', changed_at: 't' }), {
    activeEnvironment: 'production',
    changedAt: 't',
  })
  assert.equal(toQuickbooksSettings({ active_environment: 'anything' }).activeEnvironment, 'sandbox')
  assert.equal(toQuickbooksSettings(null), null)

  assert.equal(canSwitchQuickbooksMode('ADMIN'), true)
  assert.equal(canSwitchQuickbooksMode('ACCOUNTING'), false)
  assert.equal(canSwitchQuickbooksMode(undefined), false)
})

test('picks the connection of one environment out of both', () => {
  const connections = [
    toQuickbooksConnection({ ...row, environment: 'sandbox', company_name: 'Test Co' }),
    toQuickbooksConnection({ ...row, environment: 'production', company_name: 'Real Co' }),
  ]

  assert.equal(pickQuickbooksConnection(connections, 'production').companyName, 'Real Co')
  assert.equal(pickQuickbooksConnection(connections, 'sandbox').companyName, 'Test Co')
  assert.equal(pickQuickbooksConnection([connections[0]], 'production'), null)
  assert.equal(pickQuickbooksConnection(undefined, 'sandbox'), null)
})

test('the preview carries where the invoice goes and what is known about the number', () => {
  const preview = toQuickbooksInvoicePreview({
    environment: 'production',
    customer: { displayName: 'Trumark' },
    invoice: { Line: [], DocNumber: '15027' },
    numberCheck: { number: '15027', inDatabase: false, inQuickbooks: true, last: '15026', current: null },
  })

  assert.equal(preview.environment, 'production')
  assert.deepEqual(preview.numberCheck, {
    number: '15027',
    inDatabase: false,
    inQuickbooks: true,
    last: '15026',
    current: null,
  })
  // An older answer without the number check still maps.
  assert.deepEqual(toQuickbooksInvoicePreview({ invoice: { Line: [] } }).numberCheck, {
    number: null,
    inDatabase: false,
    inQuickbooks: false,
    last: null,
    current: null,
  })
  assert.deepEqual(
    [toQuickbooksInvoiceResult({ environment: 'production', invoiceNumber: '15027' }).environment,
      toQuickbooksInvoiceResult({ environment: 'production', invoiceNumber: '15027' }).invoiceNumber],
    ['production', '15027'],
  )
})

test('tells the person whether the typed invoice number can be used', () => {
  const free = { number: '15027', inDatabase: false, inQuickbooks: false, last: '15026', current: null }

  assert.deepEqual(quickbooksInvoiceNumberStatus({ typed: '  ', checking: false, numberCheck: free }), {
    tone: 'neutral',
    blocking: true,
    message: 'Type the invoice number.',
  })
  assert.equal(quickbooksInvoiceNumberStatus({ typed: 'bad number!', checking: false, numberCheck: free }).tone, 'error')
  assert.equal(quickbooksInvoiceNumberStatus({ typed: 'X'.repeat(22), checking: false, numberCheck: free }).blocking, true)

  // The check belongs to the number it was made for; while it catches up, nothing is allowed.
  assert.equal(quickbooksInvoiceNumberStatus({ typed: '15028', checking: false, numberCheck: free }).message, 'Checking the number…')
  assert.equal(quickbooksInvoiceNumberStatus({ typed: '15027', checking: true, numberCheck: free }).blocking, true)

  assert.deepEqual(quickbooksInvoiceNumberStatus({ typed: '15027', checking: false, numberCheck: free }), {
    tone: 'success',
    blocking: false,
    message: 'This number is available.',
  })
  assert.equal(
    quickbooksInvoiceNumberStatus({ typed: '15027', checking: false, numberCheck: { ...free, inDatabase: true } }).message,
    'Another Package already uses this number.',
  )
  assert.equal(
    quickbooksInvoiceNumberStatus({ typed: '15027', checking: false, numberCheck: { ...free, inQuickbooks: true } }).message,
    'QuickBooks already has an invoice with this number.',
  )
})

test('counts the days left of the authorization and warns before it ends', () => {
  const now = new Date('2026-10-26T12:00:00Z')
  const at = (days) => toQuickbooksConnection({
    ...row,
    refresh_token_expires_at: new Date(now.getTime() + days * 86400000).toISOString(),
  })

  assert.equal(quickbooksTokenDaysLeft(at(40), now), 40)
  assert.equal(quickbooksTokenDaysLeft(toQuickbooksConnection({ ...row, refresh_token_expires_at: null }), now), null)

  assert.equal(quickbooksConnectionSummary('sandbox', at(60), now).status, 'Connected')
  assert.equal(quickbooksConnectionSummary('sandbox', at(60), now).attention, false)

  const soon = quickbooksConnectionSummary('production', at(5), now)
  assert.equal(soon.status, 'Reconnect soon')
  assert.equal(soon.tone, 'warning')
  assert.equal(soon.expiry, 'Authorization ends in 5 days')
  assert.equal(soon.attention, true)

  const expired = quickbooksConnectionSummary('production', at(-2), now)
  assert.equal(expired.status, 'Reconnect needed')
  assert.equal(expired.tone, 'error')

  const missing = quickbooksConnectionSummary('production', null, now)
  assert.equal(missing.status, 'Not connected')
  assert.equal(missing.label, 'Production')
  assert.equal(missing.attention, false)

  // The card of the active mode shows the warning too.
  assert.deepEqual(
    quickbooksStatusView({ loading: false, connection: at(5), canConnect: true, now }),
    { tone: 'warning', status: 'Reconnect soon', detail: 'Authorization ends in 5 days · Test' },
  )
})

test('only a Test Package that was never submitted can move back to Production', () => {
  const testPackage = {
    packageType: 'DRAW',
    quickbooksEnvironment: 'sandbox',
    quickbooksStatus: 'CREATED',
    status: 'AWAITING_PAYMENT',
    submissionStatus: 'NOT_SUBMITTED',
    submittedAt: null,
  }

  assert.equal(isQuickbooksTestPackage(testPackage), true)
  assert.equal(isQuickbooksTestPackage({ ...testPackage, quickbooksEnvironment: 'production' }), false)
  assert.equal(isQuickbooksTestPackage({}), false)

  assert.equal(canResetQuickbooksTestInvoice(testPackage, 'ACCOUNTING'), true)
  assert.equal(canResetQuickbooksTestInvoice({ ...testPackage, quickbooksStatus: 'SYNC_ERROR' }, 'ADMIN'), true)
  assert.equal(canResetQuickbooksTestInvoice({ ...testPackage, quickbooksStatus: 'VOIDED' }, 'ADMIN'), true)
  assert.equal(canResetQuickbooksTestInvoice(testPackage, 'PROJECT_MANAGEMENT'), false)
  assert.equal(canResetQuickbooksTestInvoice({ ...testPackage, quickbooksEnvironment: 'production' }, 'ADMIN'), false)
  assert.equal(canResetQuickbooksTestInvoice({ ...testPackage, quickbooksStatus: 'NOT_CREATED' }, 'ADMIN'), false)
  assert.equal(canResetQuickbooksTestInvoice({ ...testPackage, submissionStatus: 'SUBMITTED' }, 'ADMIN'), false)
  assert.equal(canResetQuickbooksTestInvoice({ ...testPackage, submittedAt: '2026-10-20T00:00:00Z' }, 'ADMIN'), false)
  assert.equal(canResetQuickbooksTestInvoice({ ...testPackage, status: 'PAID' }, 'ADMIN'), false)
})

test('a Production Package with a voided invoice can get a new one until it is submitted', () => {
  const voided = {
    packageType: 'DRAW',
    quickbooksEnvironment: 'production',
    quickbooksStatus: 'VOIDED',
    status: 'DRAFT',
    submissionStatus: 'NOT_SUBMITTED',
    submittedAt: null,
  }

  assert.equal(canStartNewQuickbooksInvoice(voided, 'ACCOUNTING'), true)
  assert.equal(canStartNewQuickbooksInvoice(voided, 'ADMIN'), true)
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, packageType: 'PRICE_ADJUSTMENT' }, 'ADMIN'), true)
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, status: 'AWAITING_PAYMENT' }, 'ADMIN'), true)

  assert.equal(canStartNewQuickbooksInvoice(voided, 'PROJECT_MANAGEMENT'), false)
  assert.equal(canStartNewQuickbooksInvoice(voided, 'READ_ONLY'), false)
  assert.equal(canStartNewQuickbooksInvoice(null, 'ADMIN'), false)
  // An invoice that stands is voided, not detached.
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, quickbooksStatus: 'CREATED' }, 'ADMIN'), false)
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, quickbooksStatus: 'NOT_CREATED' }, 'ADMIN'), false)
  // A Test Package moves back to Production instead.
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, quickbooksEnvironment: 'sandbox' }, 'ADMIN'), false)
  // A cancelled or submitted Package gets no new invoice.
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, status: 'CANCELLED' }, 'ADMIN'), false)
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, submissionStatus: 'SUBMITTED' }, 'ADMIN'), false)
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, submittedAt: '2026-10-20T00:00:00Z' }, 'ADMIN'), false)
  // A retention release is not invoiced through QuickBooks.
  assert.equal(canStartNewQuickbooksInvoice({ ...voided, packageType: 'RETENTION_RELEASE' }, 'ADMIN'), false)
})

test('a Package sent to QuickBooks says whether it is Test or Production', () => {
  assert.deepEqual(
    quickbooksPackageEnvironmentView({ packageType: 'DRAW', quickbooksEnvironment: 'sandbox' }),
    { label: 'Test', tone: 'warning' },
  )
  assert.deepEqual(
    quickbooksPackageEnvironmentView({ packageType: 'PRICE_ADJUSTMENT', quickbooksEnvironment: 'production' }),
    { label: 'Production', tone: 'neutral' },
  )
  // A record without a type is a Draw.
  assert.equal(quickbooksPackageEnvironmentView({ quickbooksEnvironment: 'sandbox' }).label, 'Test')
})

test('a Package that was never sent, or never invoiced, has no mode to show', () => {
  assert.equal(quickbooksPackageEnvironmentView({ packageType: 'DRAW', quickbooksEnvironment: null }), null)
  assert.equal(quickbooksPackageEnvironmentView({ packageType: 'DRAW' }), null)
  assert.equal(quickbooksPackageEnvironmentView({ packageType: 'DRAW', quickbooksEnvironment: 'other' }), null)
  assert.equal(quickbooksPackageEnvironmentView({ packageType: 'RETENTION_RELEASE', quickbooksEnvironment: 'sandbox' }), null)
  assert.equal(quickbooksPackageEnvironmentView(null), null)
})

test('the next invoice number follows the last one used, keeping its length', () => {
  assert.equal(nextInvoiceNumber('14879'), '14880')
  assert.equal(nextInvoiceNumber(' 14879 '), '14880')
  assert.equal(nextInvoiceNumber('99999'), '100000')
  assert.equal(nextInvoiceNumber('0099'), '0100')
  assert.equal(nextInvoiceNumber('9007199254740993'), '9007199254740994')
})

test('there is no next invoice number when nothing was used or the last one is not all digits', () => {
  assert.equal(nextInvoiceNumber(null), null)
  assert.equal(nextInvoiceNumber(undefined), null)
  assert.equal(nextInvoiceNumber(''), null)
  assert.equal(nextInvoiceNumber('INV-14879'), null)
  assert.equal(nextInvoiceNumber('14.879'), null)
})

test('the invoice number is assigned, never typed: the one after the last used', () => {
  const check = (overrides) => ({
    number: null,
    inDatabase: false,
    inQuickbooks: false,
    last: '14879',
    current: null,
    ...overrides,
  })

  // The first preview has no number yet: the one after the last used goes in the field.
  assert.deepEqual(assignedInvoiceNumber(check({})), { number: '14880' })
  // A retry keeps the number of the earlier attempt, even when it is not the next one.
  assert.deepEqual(assignedInvoiceNumber(check({ current: '14850', number: null })), { number: '14850' })
  assert.deepEqual(assignedInvoiceNumber(check({ current: '14850', number: '14850' })), { number: '14850' })
  // Once the assigned number is checked and free, the field is left as it is.
  assert.equal(assignedInvoiceNumber(check({ number: '14880' })), null)
})

test('an assigned invoice number that turns out taken moves on to the next one', () => {
  const taken = (overrides) => ({
    number: '14880',
    inDatabase: false,
    inQuickbooks: false,
    last: '14879',
    current: null,
    ...overrides,
  })

  // Another Package took it meanwhile: the last used is now that number.
  assert.deepEqual(
    assignedInvoiceNumber(taken({ inDatabase: true, last: '14880' })),
    { number: '14881' },
  )
  // An invoice made straight in QuickBooks is not in the last used here: count from the number itself.
  assert.deepEqual(assignedInvoiceNumber(taken({ inQuickbooks: true })), { number: '14881' })
  // The length is kept.
  assert.deepEqual(
    assignedInvoiceNumber(taken({ number: '0099', last: '0098', inQuickbooks: true })),
    { number: '0100' },
  )
})

test('with nothing to count from, the invoice number is left to be typed', () => {
  const none = { number: null, inDatabase: false, inQuickbooks: false, current: null }

  // The first invoice of an environment has no last number.
  assert.deepEqual(assignedInvoiceNumber({ ...none, last: null }), { manual: true })
  // Neither do numbers that are not all digits.
  assert.deepEqual(assignedInvoiceNumber({ ...none, last: 'INV-14879' }), { manual: true })
})
