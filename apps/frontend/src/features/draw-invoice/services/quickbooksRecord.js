// QuickBooks "sandbox" is called Test everywhere a person reads it.
const ENVIRONMENT_LABELS = {
  sandbox: 'Test',
  production: 'Production',
}

export function quickbooksEnvironmentLabel(environment) {
  return ENVIRONMENT_LABELS[environment] ?? environment ?? ''
}

export function toQuickbooksSettings(row) {
  if (!row) return null
  return {
    activeEnvironment: row.active_environment === 'production' ? 'production' : 'sandbox',
    changedAt: row.changed_at ?? null,
  }
}

/** The connection of one environment out of the (at most two) that exist. */
export function pickQuickbooksConnection(connections, environment) {
  return (connections ?? []).find((connection) => connection.environment === environment) ?? null
}

export function canSwitchQuickbooksMode(role) {
  return role === 'ADMIN'
}

export function toQuickbooksConnection(row) {
  if (!row) return null
  return {
    realmId: row.realm_id,
    environment: row.environment,
    companyName: row.company_name ?? '',
    itemId: row.item_id ?? null,
    itemName: row.item_name ?? '',
    status: row.status,
    connectedAt: row.connected_at,
    lastError: row.last_error ?? '',
    refreshTokenExpiresAt: row.refresh_token_expires_at ?? null,
  }
}

/** The connection exists but invoices cannot be created until the Product is found. */
export function quickbooksProductMissing(connection) {
  return connection?.status === 'CONNECTED' && !connection.itemId
}

const lastInvoiceTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})
const lastInvoiceDayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

/** "12:42 PM" for today, "Oct 9, 12:42 PM" for an earlier day, or null. */
export function quickbooksLastInvoiceLabel(value, now = new Date()) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const time = lastInvoiceTimeFormatter.format(date)
  return date.toDateString() === now.toDateString()
    ? time
    : `${lastInvoiceDayFormatter.format(date)}, ${time}`
}

/**
 * What the QuickBooks status card shows: a short status word, one line of
 * detail and a tone the card maps to a colour. The company and environment are
 * in the tooltip; only a sandbox is flagged on the card itself.
 */
export function quickbooksStatusView({ loading, connection, canConnect, lastInvoiceAt = null, now }) {
  if (loading) {
    return { tone: 'neutral', status: 'Checking…', detail: 'Reading the connection' }
  }

  if (!connection || connection.status !== 'CONNECTED') {
    return {
      tone: 'neutral',
      status: 'Not connected',
      detail: canConnect ? 'Click to connect' : 'Administrator only',
    }
  }

  const sandbox = connection.environment === 'sandbox' ? ' · Test' : ''

  if (quickbooksProductMissing(connection)) {
    const company = connection.companyName || `Company ${connection.realmId}`
    return { tone: 'warning', status: 'Product missing', detail: `${company}${sandbox}` }
  }

  const summary = quickbooksConnectionSummary(connection.environment, connection, now)
  if (summary.attention) {
    return { tone: summary.tone, status: summary.status, detail: `${summary.expiry}${sandbox}` }
  }

  const last = quickbooksLastInvoiceLabel(lastInvoiceAt, now)
  return {
    tone: 'success',
    status: 'Connected',
    detail: `${last ? `Last invoice: ${last}` : 'No invoices yet'}${sandbox}`,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
// Intuit rotates the refresh token every time it is used and it lasts about 100
// days without use; a warning this early leaves time to reconnect.
const TOKEN_WARNING_DAYS = 14

/** Whole days until the refresh token expires (negative once expired), or null when unknown. */
export function quickbooksTokenDaysLeft(connection, now = new Date()) {
  if (!connection?.refreshTokenExpiresAt) return null
  const expires = new Date(connection.refreshTokenExpiresAt)
  if (Number.isNaN(expires.getTime())) return null
  return Math.floor((expires.getTime() - now.getTime()) / DAY_MS)
}

/**
 * One line per environment for the connections panel: whether it is connected,
 * to which company, and how long the authorization lasts. `attention` is true
 * when an administrator should act (reconnect, or the Product is missing).
 */
export function quickbooksConnectionSummary(environment, connection, now = new Date()) {
  const label = quickbooksEnvironmentLabel(environment)
  if (!connection || connection.status !== 'CONNECTED') {
    return {
      environment,
      label,
      tone: 'neutral',
      status: 'Not connected',
      company: '',
      product: '',
      expiry: '',
      attention: false,
    }
  }

  const company = connection.companyName || `Company ${connection.realmId}`
  const daysLeft = quickbooksTokenDaysLeft(connection, now)
  let expiry = ''
  let tone = 'success'
  let status = 'Connected'
  let attention = false

  if (daysLeft != null && daysLeft < 0) {
    expiry = 'Authorization expired'
    tone = 'error'
    status = 'Reconnect needed'
    attention = true
  } else if (daysLeft != null && daysLeft <= TOKEN_WARNING_DAYS) {
    expiry = `Authorization ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
    tone = 'warning'
    status = 'Reconnect soon'
    attention = true
  } else if (daysLeft != null) {
    expiry = `Authorization renews with use · ${daysLeft} days left`
  }

  if (quickbooksProductMissing(connection)) {
    tone = tone === 'error' ? 'error' : 'warning'
    status = tone === 'error' ? status : 'Product missing'
    attention = true
  }

  return {
    environment,
    label,
    tone,
    status,
    company,
    product: connection.itemName || '',
    expiry,
    attention,
  }
}

export function quickbooksButtonTitle({ canConnect, connection }) {
  if (!canConnect) return 'Only an administrator can connect QuickBooks.'
  if (!connection || connection.status !== 'CONNECTED') {
    return 'Connect the QuickBooks Online company used to create invoices.'
  }

  const company = connection.companyName || `Company ${connection.realmId}`
  const environment = ENVIRONMENT_LABELS[connection.environment] ?? connection.environment
  if (quickbooksProductMissing(connection)) {
    return `${company} (${environment}) is connected, but the Product was not found. Create it in QuickBooks and reconnect.`
  }
  return `${company} (${environment}) · Product: ${connection.itemName}. Select to reconnect.`
}

export function quickbooksOAuthReturnMessage(reason) {
  switch (reason) {
    case 'access_denied':
      return 'QuickBooks access was not granted.'
    case 'invalid_state':
      return 'The QuickBooks connection expired. Please try again.'
    case 'missing_code':
      return 'QuickBooks did not return an authorization code. Please try again.'
    case 'missing_realm':
      return 'QuickBooks did not say which company was selected. Please try again.'
    case 'product_not_found':
      return 'QuickBooks was connected, but the Product "Material Installation & Supply" was not found in that company.'
    default:
      return 'QuickBooks could not be connected. Review the Edge Function logs and try again.'
  }
}

/**
 * A Draw Package and a Price Adjustment are invoiced through QuickBooks. A
 * Retention Release is not (yet): the Edge Functions refuse it, so the app does
 * not offer to send or void it. A record without a type is a Draw.
 */
export function isInvoicedThroughQuickbooks(record) {
  return ['DRAW', 'PRICE_ADJUSTMENT'].includes(record?.packageType ?? 'DRAW')
}

// ADMIN and ACCOUNTING may create QuickBooks invoices; the Edge Function
// re-checks the role, this only decides whether to offer the action.
const INVOICE_ROLES = ['ADMIN', 'ACCOUNTING']

export function canCreateQuickbooksInvoice(record, role) {
  return INVOICE_ROLES.includes(role)
    && record != null
    && isInvoicedThroughQuickbooks(record)
    && record.status !== 'CANCELLED'
    && ['NOT_CREATED', 'SYNC_ERROR'].includes(record.quickbooksStatus)
}

/**
 * The date the QuickBooks invoice is dated with: the cut off date of a Draw Package
 * whose Builder bills on cut off dates, and `today` (the day the invoice is created)
 * for a Builder that bills any date, a Price Adjustment, or a setup that gives no cut
 * off date. `source` says which one it is.
 */
export function quickbooksInvoiceDate(record, today) {
  const hasCutoff = (record?.packageType ?? 'DRAW') === 'DRAW'
    && !record?.billingCutoffAnyDate
    && Boolean(record?.billingCutoffDate)

  return hasCutoff
    ? { date: record.billingCutoffDate, source: 'CUTOFF' }
    : { date: today, source: 'CREATION' }
}

/** The Edge Function answers { code, error, candidates? } for every refusal. */
export class QuickbooksInvoiceRequestError extends Error {
  constructor(message, code = null, candidates = []) {
    super(message)
    this.name = 'QuickbooksInvoiceRequestError'
    this.code = code
    this.candidates = candidates
  }
}

export function toQuickbooksInvoicePreview(data) {
  const invoice = data?.invoice
  if (!invoice) return null

  const lines = (invoice.Line ?? []).map((line) => ({
    description: line.Description ?? '',
    amount: Number(line.Amount),
  }))
  const totalCents = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0)

  return {
    customerName: data.customer?.displayName ?? '',
    customerIsNew: data.customer?.source === 'quickbooks',
    txnDate: invoice.TxnDate,
    dueDate: invoice.DueDate ?? null,
    docNumber: invoice.DocNumber ?? '',
    lines,
    total: totalCents / 100,
    customFields: (invoice.CustomField ?? []).map((field) => ({
      name: field.Name,
      value: field.StringValue,
    })),
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    // Where this invoice would go (Test or Production) and what is known about the typed number.
    environment: data.environment ?? null,
    numberCheck: {
      number: data.numberCheck?.number ?? null,
      inDatabase: Boolean(data.numberCheck?.inDatabase),
      inQuickbooks: Boolean(data.numberCheck?.inQuickbooks),
      last: data.numberCheck?.last ?? null,
      current: data.numberCheck?.current ?? null,
    },
  }
}

/**
 * What to tell the person about the invoice number they typed: free, taken by
 * another Package, or already in QuickBooks. `checking` is while the preview is
 * being read again for the number just typed.
 */
export function quickbooksInvoiceNumberStatus({ typed, checking, numberCheck }) {
  const value = String(typed ?? '').trim()
  if (!value) return { tone: 'neutral', blocking: true, message: 'Type the invoice number.' }
  if (!/^[0-9A-Za-z][0-9A-Za-z.-]{0,20}$/u.test(value)) {
    return {
      tone: 'error',
      blocking: true,
      message: 'Use up to 21 letters, numbers, dots or dashes.',
    }
  }
  if (checking || numberCheck?.number !== value) {
    return { tone: 'neutral', blocking: true, message: 'Checking the number…' }
  }
  if (numberCheck.inDatabase) {
    return { tone: 'error', blocking: true, message: 'Another Package already uses this number.' }
  }
  if (numberCheck.inQuickbooks) {
    return { tone: 'error', blocking: true, message: 'QuickBooks already has an invoice with this number.' }
  }
  return { tone: 'success', blocking: false, message: 'This number is available.' }
}

export function toQuickbooksInvoiceResult(data) {
  return {
    invoiceId: data?.invoiceId ?? '',
    docNumber: data?.docNumber ?? '',
    totalAmount: typeof data?.totalAmount === 'number' ? data.totalAmount : null,
    customerName: data?.customer?.displayName ?? '',
    environment: data?.environment ?? null,
    invoiceNumber: data?.invoiceNumber ?? '',
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  }
}

export function toQuickbooksInvoiceSync(row) {
  if (!row) return null
  return {
    status: row.status,
    error: row.error ?? '',
    environment: row.environment ?? null,
    invoiceId: row.qbo_invoice_id ?? null,
    docNumber: row.qbo_doc_number ?? null,
    totalAmount: row.total_amount == null ? null : Number(row.total_amount),
    updatedAt: row.updated_at,
    // What QuickBooks shows about the payment (null until it has been read).
    paymentState: row.qbo_state ?? null,
    paymentBalance: row.qbo_balance == null ? null : Number(row.qbo_balance),
    paymentTotal: row.qbo_total == null ? null : Number(row.qbo_total),
    dueDate: row.qbo_due_date ?? null,
    overdue: Boolean(row.qbo_overdue),
    linkedTransactions: row.qbo_linked_transactions ?? [],
    paymentCheckedAt: row.qbo_state_checked_at ?? null,
  }
}

const dueDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function formatDueDate(isoDate) {
  const [year, month, day] = String(isoDate ?? '').split('-').map(Number)
  return year && month && day ? dueDateFormatter.format(new Date(Date.UTC(year, month - 1, day))) : ''
}

const money = (value) => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/**
 * How QuickBooks shows the payment of a Package's invoice, in its own words:
 * Open, Overdue, Partially paid, Paid, Closed, Voided. Returns null when the
 * payment has not been read yet.
 */
export function quickbooksPaymentView(sync) {
  const state = sync?.paymentState
  if (!state) return null

  const due = formatDueDate(sync.dueDate)
  switch (state) {
    case 'PAID':
      return { tone: 'success', status: 'Paid', detail: 'Paid in QuickBooks' }
    case 'PARTIALLY_PAID':
      return {
        tone: sync.overdue ? 'error' : 'warning',
        status: sync.overdue ? 'Partially paid · Overdue' : 'Partially paid',
        detail: `${money(sync.paymentBalance ?? 0)} still due${due ? ` · due ${due}` : ''}`,
      }
    case 'OVERDUE':
      return {
        tone: 'error',
        status: 'Overdue',
        detail: `${money(sync.paymentBalance ?? 0)} due${due ? ` since ${due}` : ''}`,
      }
    case 'OPEN':
      return {
        tone: 'success',
        status: 'Open',
        detail: `${money(sync.paymentBalance ?? 0)} due${due ? ` · due ${due}` : ''}`,
      }
    case 'CLOSED':
      return {
        tone: 'neutral',
        status: 'Closed',
        detail: 'Settled in QuickBooks without a payment',
      }
    case 'VOIDED':
      return { tone: 'neutral', status: 'Voided', detail: 'Voided in QuickBooks' }
    case 'DELETED':
      return { tone: 'warning', status: 'Deleted', detail: 'No longer in QuickBooks' }
    default:
      return null
  }
}

const INVOICE_URL_HOSTS = {
  sandbox: 'https://app.sandbox.qbo.intuit.com',
  production: 'https://app.qbo.intuit.com',
}

/** Link that opens an invoice in the QuickBooks Online web app, or null if unknown. */
export function quickbooksInvoiceUrl(environment, invoiceId) {
  const host = INVOICE_URL_HOSTS[environment]
  return host && invoiceId
    ? `${host}/app/invoice?txnId=${encodeURIComponent(invoiceId)}`
    : null
}

/**
 * The QuickBooks card of a Package: what happened to its invoice and whether
 * the card can be used to send it. Returns null when there is nothing to show.
 */
export function quickbooksPackageStatusView({ record, sync, canSend }) {
  if (!record || !isInvoicedThroughQuickbooks(record)) return null

  switch (record.quickbooksStatus) {
    case 'CREATED': {
      const number = record.quickbooksReference || sync?.docNumber || ''
      // Once QuickBooks has been asked, its own word for the invoice is shown.
      const payment = quickbooksPaymentView(sync)
      const href = quickbooksInvoiceUrl(sync?.environment, sync?.invoiceId)
      // An invoice sent to the Test QuickBooks is not a real one, and says so.
      if ((record.quickbooksEnvironment ?? sync?.environment) === 'sandbox') {
        return {
          tone: 'warning',
          status: 'Test invoice',
          detail: `${number ? `Invoice ${number} · ` : ''}Test${payment ? ` · ${payment.status}` : ''}`,
          action: 'open',
          href,
        }
      }
      return {
        tone: payment?.tone ?? 'success',
        status: payment?.status ?? 'Invoice created',
        detail: payment
          ? `${number ? `Invoice ${number} · ` : ''}${payment.detail}`
          : number ? `Invoice ${number}` : 'Created in QuickBooks',
        action: 'open',
        href: quickbooksInvoiceUrl(sync?.environment, sync?.invoiceId),
      }
    }
    case 'SYNC_ERROR':
      return {
        tone: 'warning',
        status: 'Sync error',
        detail: canSend ? 'Click to retry' : 'The last attempt failed',
        action: canSend ? 'send' : 'none',
        href: null,
      }
    case 'VOIDED':
      return {
        tone: 'neutral',
        status: 'Invoice voided',
        detail: record.quickbooksReference ? `Invoice ${record.quickbooksReference}` : 'Voided in QuickBooks',
        action: 'none',
        href: null,
      }
    case 'NOT_CREATED':
      // Only people who can act on it need to see an invoice that was never sent.
      return record.status === 'CANCELLED' || !canSend
        ? null
        : {
          tone: 'neutral',
          status: 'Not sent',
          detail: 'Click to send',
          action: 'send',
          href: null,
        }
    default:
      return null
  }
}

/**
 * The QuickBooks cell of the Packages table. Unlike the detail card it shows
 * the state to every role, because the table only reports and never acts.
 * Returns null for packages that are never invoiced (Retention Releases).
 */
export function quickbooksTableStatusView(record) {
  if (!record || !isInvoicedThroughQuickbooks(record)) return null

  switch (record.quickbooksStatus) {
    case 'CREATED':
      return record.quickbooksEnvironment === 'sandbox'
        ? {
          tone: 'warning',
          status: 'Test invoice',
          detail: record.quickbooksReference ? `Invoice ${record.quickbooksReference} · Test` : 'Test',
        }
        : {
          tone: 'success',
          status: 'Invoice created',
          detail: record.quickbooksReference ? `Invoice ${record.quickbooksReference}` : '',
        }
    case 'SYNC_ERROR':
      return { tone: 'warning', status: 'Sync error', detail: 'Last attempt failed' }
    case 'VOIDED':
      return {
        tone: 'neutral',
        status: 'Invoice voided',
        detail: record.quickbooksReference ? `Invoice ${record.quickbooksReference}` : '',
      }
    default:
      return { tone: 'neutral', status: 'Not sent', detail: '' }
  }
}

export function canManageQuickbooksCustomers(role) {
  return INVOICE_ROLES.includes(role)
}

export function toQuickbooksCustomerLink(row) {
  return {
    builderId: row.builder_id,
    environment: row.environment,
    customerId: row.customer_id,
    displayName: row.display_name ?? '',
  }
}

/**
 * One row per Builder with the QuickBooks Customer it is linked to in the
 * connected environment (links of the other environment are ignored).
 */
export function quickbooksCustomerRows(builders, links, environment) {
  const byBuilder = new Map(
    links
      .filter((link) => link.environment === environment)
      .map((link) => [String(link.builderId), link]),
  )

  return [...builders]
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
    .map((builder) => {
      const link = byBuilder.get(String(builder.id))
      return {
        builderId: builder.id,
        builderName: builder.name,
        linked: Boolean(link),
        customerId: link?.customerId ?? null,
        customerName: link?.displayName ?? '',
      }
    })
}

/**
 * Whether to offer voiding the QuickBooks invoice of a Package. The Edge
 * Function and the database re-check everything (payments in QuickBooks, a
 * Package already submitted); this only hides the action when it cannot apply.
 */
export function canVoidQuickbooksInvoice(record, role) {
  return INVOICE_ROLES.includes(role)
    && record != null
    && isInvoicedThroughQuickbooks(record)
    && record.quickbooksStatus === 'CREATED'
    // An open invoice puts the Package in Awaiting payment; it can be voided
    // there as long as it was not sent to the Builder and nothing was paid.
    && ['DRAFT', 'AWAITING_PAYMENT'].includes(record.status)
    && (record.submissionStatus ?? 'NOT_SUBMITTED') === 'NOT_SUBMITTED'
    && !record.submittedAt
}

/** The Package was invoiced (or attempted) in the QuickBooks Test company: nothing about it is real. */
export function isQuickbooksTestPackage(record) {
  return record?.quickbooksEnvironment === 'sandbox'
}

/**
 * Whether to offer moving a Test Package back to a clean Draft so it can be sent
 * to Production. The database re-checks everything (unpaid, never submitted, not
 * a Production invoice); this only hides the action when it cannot apply.
 */
export function canResetQuickbooksTestInvoice(record, role) {
  return INVOICE_ROLES.includes(role)
    && record != null
    && isInvoicedThroughQuickbooks(record)
    && isQuickbooksTestPackage(record)
    && ['CREATED', 'VOIDED', 'SYNC_ERROR'].includes(record.quickbooksStatus)
    && ['DRAFT', 'AWAITING_PAYMENT'].includes(record.status)
    && (record.submissionStatus ?? 'NOT_SUBMITTED') === 'NOT_SUBMITTED'
    && !record.submittedAt
}

/** The saved QuickBooks PDF of a Package (its INVOICE document), or null. */
export function toQuickbooksInvoicePdf(document, file) {
  if (!document || !file) return null
  return {
    documentId: document.id,
    savedAt: document.completed_at ?? null,
    file: {
      bucket: file.bucket_id,
      storagePath: file.object_path,
      name: file.original_filename,
      sizeBytes: Number(file.size_bytes),
    },
  }
}
