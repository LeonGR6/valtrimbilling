import { requireSupabase } from '../../../services/api.js'
import {
  QuickbooksInvoiceRequestError,
  toQuickbooksConnection,
  toQuickbooksCustomerLink,
  toQuickbooksSettings,
  toQuickbooksInvoicePdf,
  toQuickbooksInvoicePreview,
  toQuickbooksInvoiceResult,
  toQuickbooksInvoiceSync,
} from './quickbooksRecord.js'

const OAUTH_START_FUNCTION = 'quickbooks-oauth-start'
const INVOICE_FUNCTION = 'quickbooks-invoice-create'
const CUSTOMERS_FUNCTION = 'quickbooks-customers'
const VOID_FUNCTION = 'quickbooks-invoice-void'
const RESET_FUNCTION = 'quickbooks-invoice-reset'
const PDF_FUNCTION = 'quickbooks-invoice-pdf'
const SYNC_COLUMNS = [
  'status',
  'error',
  'environment',
  'qbo_invoice_id',
  'qbo_doc_number',
  'total_amount',
  'updated_at',
  'qbo_state',
  'qbo_total',
  'qbo_balance',
  'qbo_due_date',
  'qbo_overdue',
  'qbo_linked_transactions',
  'qbo_state_checked_at',
].join(', ')
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

/** Both QuickBooks connections (Test and Production), whichever exist. */
export async function getQuickbooksConnections() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('quickbooks_connections')
    .select(CONNECTION_COLUMNS)
  if (error) throw error
  return (data ?? []).map(toQuickbooksConnection)
}

/** Which QuickBooks environment new invoices go to. */
export async function getQuickbooksSettings() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('quickbooks_settings')
    .select('active_environment, changed_at')
    .maybeSingle()
  if (error) throw error
  return toQuickbooksSettings(data)
}

/** ADMIN only (the database refuses anyone else): choose Test or Production. */
export async function setQuickbooksActiveEnvironment(environment) {
  const client = await requireSupabase()
  const { error } = await client.rpc('set_quickbooks_active_environment', {
    p_environment: environment,
  })
  if (error) throw new Error(error.message, { cause: error })
}

export async function startQuickbooksOAuth(environment) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(OAUTH_START_FUNCTION, {
    // Intuit sends the browser back to this page (the server checks it is an allowed one).
    body: { environment, returnUrl: `${window.location.origin}${window.location.pathname}` },
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

async function functionRequest(name, body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(name, { body })

  if (error || data?.error) throw await invoiceRequestError(error, data)
  return data
}

const invoiceRequest = (body) => functionRequest(INVOICE_FUNCTION, body)
const customersRequest = (body) => functionRequest(CUSTOMERS_FUNCTION, body)

/** Builds the invoice lines and finds the Customer without sending anything. */
export async function previewQuickbooksInvoice(
  packageId,
  txnDate,
  { invoiceNumber = null, expectedEnvironment = null } = {},
) {
  const preview = toQuickbooksInvoicePreview(
    await invoiceRequest({
      packageId,
      txnDate,
      dryRun: true,
      invoiceNumber,
      expectedEnvironment,
    }),
  )
  if (!preview) throw new QuickbooksInvoiceRequestError('QuickBooks returned no invoice preview.')
  return preview
}

/**
 * `expectedEnvironment` is the mode the person was shown; if the platform was
 * switched since, the server sends nothing and says so.
 */
export async function createQuickbooksInvoice(
  packageId,
  txnDate,
  { invoiceNumber, expectedEnvironment },
) {
  return toQuickbooksInvoiceResult(
    await invoiceRequest({ packageId, txnDate, invoiceNumber, expectedEnvironment }),
  )
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

/** When the last invoice was created in a QuickBooks environment, or null if none yet. */
export async function getLastQuickbooksInvoiceAt(environment) {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('quickbooks_invoice_syncs')
    .select('updated_at')
    .eq('environment', environment)
    .eq('status', 'CREATED')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.updated_at ?? null
}

/** Which QuickBooks Customer each Builder is linked to, in every environment. */
export async function listQuickbooksCustomerLinks() {
  const client = await requireSupabase()
  const { data, error } = await client
    .from('builder_quickbooks_customers')
    .select('builder_id, environment, customer_id, display_name')
  if (error) throw error
  return (data ?? []).map(toQuickbooksCustomerLink)
}

export async function searchQuickbooksCustomers(query) {
  const data = await customersRequest({ action: 'search', query })
  return data?.customers ?? []
}

/** Every active Customer of the connected QuickBooks company, ordered by name. */
export async function listQuickbooksCustomers() {
  const data = await customersRequest({ action: 'list' })
  return data?.customers ?? []
}

export async function linkQuickbooksCustomer(builderId, customerId) {
  const data = await customersRequest({ action: 'link', builderId, customerId })
  return data?.customer ?? null
}

export async function unlinkQuickbooksCustomer(builderId) {
  const data = await customersRequest({ action: 'unlink', builderId })
  return Boolean(data?.removed)
}

/** Voids the Package's invoice in QuickBooks; the Package can then be deleted. */
export async function voidQuickbooksInvoice(packageId) {
  const data = await functionRequest(VOID_FUNCTION, { packageId })
  return { quickbooks: data?.quickbooks ?? 'voided' }
}

/**
 * Moves a Package invoiced in the QuickBooks Test company back to a clean Draft,
 * so it can be sent to Production. The Test invoice itself stays in Test.
 */
export async function resetQuickbooksTestInvoice(packageId) {
  const data = await functionRequest(RESET_FUNCTION, { packageId })
  return { removedPdf: Boolean(data?.removedPdf) }
}

/** Downloads QuickBooks' PDF of the invoice and saves it as the Package's INVOICE document. */
export async function saveQuickbooksInvoicePdf(packageId) {
  const data = await functionRequest(PDF_FUNCTION, { packageId })
  return { fileName: data?.fileName ?? '', sizeBytes: Number(data?.sizeBytes ?? 0) }
}

/** The saved QuickBooks invoice PDF of a Package, or null when none is saved. */
export async function getQuickbooksInvoicePdf(packageId) {
  const client = await requireSupabase()
  const { data: document, error } = await client
    .from('package_documents')
    .select('id, file_id, completed_at')
    .eq('package_id', packageId)
    .eq('document_type', 'INVOICE')
    .eq('status', 'COMPLETE')
    .maybeSingle()
  if (error) throw error
  if (!document?.file_id) return null

  const { data: file, error: fileError } = await client
    .from('stored_files')
    .select('bucket_id, object_path, original_filename, size_bytes')
    .eq('id', document.file_id)
    .maybeSingle()
  if (fileError) throw fileError

  return toQuickbooksInvoicePdf(document, file)
}

/** The saved PDF as bytes, ready to join into the Package PDF, or null. */
export async function downloadQuickbooksInvoicePdf(packageId) {
  const pdf = await getQuickbooksInvoicePdf(packageId)
  if (!pdf) return null

  const client = await requireSupabase()
  const { data, error } = await client.storage.from(pdf.file.bucket).download(pdf.file.storagePath)
  if (error || !data) throw new Error('The saved invoice PDF could not be downloaded.', { cause: error })

  return { name: pdf.file.name, bytes: new Uint8Array(await data.arrayBuffer()) }
}

const PAYMENTS_FUNCTION = 'quickbooks-payments-sync'

/**
 * Asks QuickBooks how a Package's invoice stands (open, overdue, paid...) and
 * records it. A Package paid there becomes Paid / Closed here.
 * @returns {{ state: string, overdue: boolean, workflowStatus: string|null }}
 */
export async function refreshQuickbooksPayment(packageId) {
  const data = await functionRequest(PAYMENTS_FUNCTION, { packageId })
  const [result] = data?.results ?? []
  if (!result) throw new QuickbooksInvoiceRequestError('QuickBooks returned no payment state.')
  if (result.error) throw new QuickbooksInvoiceRequestError(result.error)
  return result
}

/**
 * Checks every open QuickBooks invoice at once (the same check the scheduler
 * runs), so Packages paid there reach Paid / Closed without being opened one by
 * one. Returns how many Packages were checked.
 */
export async function refreshAllQuickbooksPayments() {
  const data = await functionRequest(PAYMENTS_FUNCTION, { all: true })
  return data?.results?.length ?? 0
}
