const ENVIRONMENT_LABELS = {
  sandbox: 'Sandbox',
  production: 'Production',
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

/**
 * What the QuickBooks status card shows: a short status word, one line of
 * detail and a tone the card maps to a colour.
 */
export function quickbooksStatusView({ loading, connection, canConnect }) {
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

  const company = connection.companyName || `Company ${connection.realmId}`
  const environment = ENVIRONMENT_LABELS[connection.environment]
  const detail = connection.environment === 'production' || !environment
    ? company
    : `${company} · ${environment}`

  return quickbooksProductMissing(connection)
    ? { tone: 'warning', status: 'Product missing', detail }
    : { tone: 'success', status: 'Connected', detail }
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

// ADMIN and ACCOUNTING may create QuickBooks invoices; the Edge Function
// re-checks the role, this only decides whether to offer the action.
const INVOICE_ROLES = ['ADMIN', 'ACCOUNTING']

export function canCreateQuickbooksInvoice(record, role) {
  return INVOICE_ROLES.includes(role)
    && record != null
    && record.packageType !== 'RETENTION_RELEASE'
    && record.status !== 'CANCELLED'
    && ['NOT_CREATED', 'SYNC_ERROR'].includes(record.quickbooksStatus)
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
  }
}

export function toQuickbooksInvoiceResult(data) {
  return {
    invoiceId: data?.invoiceId ?? '',
    docNumber: data?.docNumber ?? '',
    totalAmount: typeof data?.totalAmount === 'number' ? data.totalAmount : null,
    customerName: data?.customer?.displayName ?? '',
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
  if (!record || record.packageType === 'RETENTION_RELEASE') return null

  switch (record.quickbooksStatus) {
    case 'CREATED': {
      const number = record.quickbooksReference || sync?.docNumber || ''
      return {
        tone: 'success',
        status: 'Invoice created',
        detail: number ? `Invoice ${number}` : 'Created in QuickBooks',
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
