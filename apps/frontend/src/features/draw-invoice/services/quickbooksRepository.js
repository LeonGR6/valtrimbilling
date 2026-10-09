import { requireSupabase } from '../../../services/api.js'
import {
  QuickbooksInvoiceRequestError,
  toQuickbooksConnection,
  toQuickbooksInvoicePreview,
  toQuickbooksInvoiceResult,
  toQuickbooksInvoiceSync,
} from './quickbooksRecord.js'

const OAUTH_START_FUNCTION = 'quickbooks-oauth-start'
const INVOICE_FUNCTION = 'quickbooks-invoice-create'
const SYNC_COLUMNS = 'status, error, environment, qbo_invoice_id, qbo_doc_number, total_amount, updated_at'
const INTUIT_AUTHORIZATION_ORIGIN = 'https://appcenter.intuit.com'
// Never select refresh_token_secret_id: the browser only needs the status.
const CONNECTION_COLUMNS = [
  'realm_id',
  'environment',
  'company_name',
  'item_id',
  'item_name',
  'status',
  'connected_at',
  'last_error',
  'refresh_token_expires_at',
].join(', ')

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const responsePayload = await response.clone().json().catch(() => null)
    if (responsePayload?.error) return responsePayload.error
  }

  return error?.message || 'The QuickBooks request failed.'
}

export async function getQuickbooksConnection() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('quickbooks_connections')
    .select(CONNECTION_COLUMNS)
    .maybeSingle()
  if (error) throw error
  return toQuickbooksConnection(data)
}

export async function startQuickbooksOAuth() {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(OAUTH_START_FUNCTION, {
    body: {},
  })

  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }

  if (!data?.authorizationUrl) {
    throw new Error('QuickBooks did not return an authorization URL.')
  }

  const authorizationUrl = new URL(data.authorizationUrl)
  if (authorizationUrl.origin !== INTUIT_AUTHORIZATION_ORIGIN) {
    throw new Error('QuickBooks returned an invalid authorization URL.')
  }
  return authorizationUrl.toString()
}

// A non-2xx answer arrives as an error whose `context` is the raw Response.
async function invoiceRequestError(error, data) {
  let payload = data?.error ? data : null
  const response = error?.context
  if (!payload && response && typeof response.clone === 'function') {
    payload = await response.clone().json().catch(() => null)
  }

  return new QuickbooksInvoiceRequestError(
    payload?.error || error?.message || 'The QuickBooks request failed.',
    payload?.code ?? null,
    payload?.candidates ?? [],
  )
}

async function invoiceRequest(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(INVOICE_FUNCTION, { body })

  if (error || data?.error) throw await invoiceRequestError(error, data)
  return data
}

/** Builds the invoice lines and finds the Customer without sending anything. */
export async function previewQuickbooksInvoice(packageId, txnDate) {
  const preview = toQuickbooksInvoicePreview(
    await invoiceRequest({ packageId, txnDate, dryRun: true }),
  )
  if (!preview) throw new QuickbooksInvoiceRequestError('QuickBooks returned no invoice preview.')
  return preview
}

export async function createQuickbooksInvoice(packageId, txnDate) {
  return toQuickbooksInvoiceResult(await invoiceRequest({ packageId, txnDate }))
}

/** Outcome of the last QuickBooks attempt for a Package, or null if none. */
export async function getQuickbooksInvoiceSync(packageId) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('quickbooks_invoice_syncs')
    .select(SYNC_COLUMNS)
    .eq('package_id', packageId)
    .maybeSingle()
  if (error) throw error
  return toQuickbooksInvoiceSync(data)
}
