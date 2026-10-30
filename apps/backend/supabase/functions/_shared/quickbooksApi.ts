// QuickBooks Online accounting API calls. Every call takes an injectable
// `fetcher` so it can be tested without touching Intuit.

import { type CustomFieldDefinition, parseCustomFieldDefinitions } from './quickbooksCustomFields.ts'
import type { QuickbooksInvoicePayload } from './quickbooksInvoice.ts'

export const QUICKBOOKS_PRODUCT_NAME = 'Material Installation & Supply'
export const QUICKBOOKS_MINOR_VERSION = '75'

export type QuickbooksEnvironment = 'sandbox' | 'production'

const API_BASE_URLS: Record<QuickbooksEnvironment, string> = {
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
  production: 'https://quickbooks.api.intuit.com',
}

type Fetcher = typeof fetch

export interface QuickbooksApiOptions {
  environment: QuickbooksEnvironment
  realmId: string
  accessToken: string
}

export interface QuickbooksItem {
  id: string
  name: string
}

export interface QuickbooksCustomer {
  id: string
  displayName: string
}

export interface QuickbooksCustomerDetail extends QuickbooksCustomer {
  active: boolean
}

export interface QuickbooksInvoiceDetail {
  id: string
  syncToken: string
  docNumber: string | null
  totalAmount: number
  balance: number
  /** Types of the payments, credits and other transactions linked to the invoice. */
  linkedTransactions: string[]
  /** YYYY-MM-DD, when QuickBooks has one. */
  dueDate?: string | null
  /** The private note: a voided invoice is marked there. */
  privateNote?: string | null
  /** When QuickBooks last changed the invoice (ISO). */
  lastUpdatedAt?: string | null
}

export interface CreatedQuickbooksInvoice {
  id: string
  docNumber: string | null
  syncToken: string | null
  totalAmount: number | null
}

/**
 * `definite` says whether QuickBooks certainly did not create anything. A
 * network failure or a 5xx may have created the invoice before failing, so the
 * same request id must be reused on retry instead of risking a duplicate.
 */
export class QuickbooksApiError extends Error {
  readonly status: number | null
  readonly definite: boolean
  /** QuickBooks' own error code, e.g. "610" for an object that does not exist. */
  readonly faultCode: string | null

  constructor(message: string, status: number | null, definite: boolean, faultCode: string | null = null) {
    super(message)
    this.name = 'QuickbooksApiError'
    this.status = status
    this.definite = definite
    this.faultCode = faultCode
  }
}

export function parseQuickbooksEnvironment(value: string | undefined): QuickbooksEnvironment {
  if (value === 'sandbox' || value === 'production') return value
  throw new Error('QBO_ENVIRONMENT must be "sandbox" or "production".')
}

export function quickbooksApiBaseUrl(environment: QuickbooksEnvironment) {
  return API_BASE_URLS[environment]
}

async function jsonBody(response: Response) {
  return await response.json().catch(() => null) as Record<string, unknown> | null
}

function faultDetails(operation: string, response: Response, body: Record<string, unknown> | null) {
  const fault = body?.Fault as { Error?: { Message?: string; Detail?: string; code?: string }[] } | undefined
  const first = fault?.Error?.[0]
  return {
    message: `${operation} failed: ${first?.Detail ?? first?.Message ?? `HTTP ${response.status}`}`,
    code: typeof first?.code === 'string' ? first.code : null,
  }
}

function companyUrl(
  { environment, realmId }: QuickbooksApiOptions,
  path: string,
  params: Record<string, string>,
) {
  const url = new URL(
    `/v3/company/${encodeURIComponent(realmId)}/${path}`,
    quickbooksApiBaseUrl(environment),
  )
  url.searchParams.set('minorversion', QUICKBOOKS_MINOR_VERSION)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

async function apiGet(
  operation: string,
  options: QuickbooksApiOptions,
  path: string,
  params: Record<string, string>,
  fetcher: Fetcher,
) {
  const response = await fetcher(companyUrl(options, path, params), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${options.accessToken}` },
  })
  const body = await jsonBody(response)
  if (!response.ok) {
    const fault = faultDetails(operation, response, body)
    throw new QuickbooksApiError(fault.message, response.status, true, fault.code)
  }
  return body
}

/** Escapes a value for a single-quoted QuickBooks query literal. */
export function quickbooksQueryLiteral(value: string) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export async function fetchQuickbooksCompanyName(
  options: QuickbooksApiOptions,
  fetcher: Fetcher = fetch,
) {
  const body = await apiGet(
    'Reading the QuickBooks company',
    options,
    `companyinfo/${encodeURIComponent(options.realmId)}`,
    {},
    fetcher,
  )
  const name = (body?.CompanyInfo as { CompanyName?: unknown } | undefined)?.CompanyName
  return typeof name === 'string' ? name : null
}

export async function findQuickbooksItemByName(
  options: QuickbooksApiOptions,
  name: string,
  fetcher: Fetcher = fetch,
): Promise<QuickbooksItem | null> {
  const body = await apiGet(
    'Looking up the QuickBooks Product',
    options,
    'query',
    { query: `select Id, Name from Item where Name = ${quickbooksQueryLiteral(name)}` },
    fetcher,
  )
  const items = (body?.QueryResponse as { Item?: { Id?: unknown; Name?: unknown }[] } | undefined)
    ?.Item
  const item = items?.[0]
  return typeof item?.Id === 'string' && typeof item.Name === 'string'
    ? { id: item.Id, name: item.Name }
    : null
}

/** Active Customers whose DisplayName contains `name` (case-insensitive). */
export async function findQuickbooksCustomers(
  options: QuickbooksApiOptions,
  name: string,
  fetcher: Fetcher = fetch,
): Promise<QuickbooksCustomer[]> {
  const pattern = quickbooksQueryLiteral(`%${name.replaceAll('%', '')}%`)
  const body = await apiGet(
    'Looking up the QuickBooks Customer',
    options,
    'query',
    {
      query: `select Id, DisplayName from Customer where DisplayName like ${pattern} maxresults 25`,
    },
    fetcher,
  )
  const customers = (body?.QueryResponse as
    | { Customer?: { Id?: unknown; DisplayName?: unknown }[] }
    | undefined)?.Customer ?? []

  return customers.flatMap((customer) =>
    typeof customer.Id === 'string' && typeof customer.DisplayName === 'string'
      ? [{ id: customer.Id, displayName: customer.DisplayName }]
      : []
  )
}

const CUSTOMER_PAGE_SIZE = 1000
// A safety stop: no real company has this many Customers, and a bug must not loop.
const CUSTOMER_MAX_PAGES = 10

/**
 * Every active Customer, ordered by name, for choosing one by hand. QuickBooks
 * Jobs (sub-customers such as "Builder:Lot 12") are left out: a Builder is linked
 * to its top-level Customer.
 */
export async function listQuickbooksCustomers(
  options: QuickbooksApiOptions,
  fetcher: Fetcher = fetch,
): Promise<QuickbooksCustomer[]> {
  const customers: QuickbooksCustomer[] = []

  for (let page = 0; page < CUSTOMER_MAX_PAGES; page += 1) {
    const body = await apiGet(
      'Listing the QuickBooks Customers',
      options,
      'query',
      {
        query: 'select Id, DisplayName, Job from Customer order by DisplayName '
          + `startposition ${page * CUSTOMER_PAGE_SIZE + 1} maxresults ${CUSTOMER_PAGE_SIZE}`,
      },
      fetcher,
    )
    const rows = (body?.QueryResponse as
      | { Customer?: { Id?: unknown; DisplayName?: unknown; Job?: unknown }[] }
      | undefined)?.Customer ?? []

    for (const row of rows) {
      if (row.Job === true) continue
      if (typeof row.Id === 'string' && typeof row.DisplayName === 'string') {
        customers.push({ id: row.Id, displayName: row.DisplayName })
      }
    }
    if (rows.length < CUSTOMER_PAGE_SIZE) break
  }

  return customers
}

/** One Customer by id, or null when it no longer exists. */
export async function getQuickbooksCustomer(
  options: QuickbooksApiOptions,
  customerId: string,
  fetcher: Fetcher = fetch,
): Promise<QuickbooksCustomerDetail | null> {
  let body: Record<string, unknown> | null
  try {
    body = await apiGet(
      'Reading the QuickBooks Customer',
      options,
      `customer/${encodeURIComponent(customerId)}`,
      {},
      fetcher,
    )
  } catch (error) {
    // 610 is QuickBooks' "Object Not Found".
    if (error instanceof QuickbooksApiError && (error.faultCode === '610' || error.status === 404)) {
      return null
    }
    throw error
  }

  const customer = body?.Customer as { Id?: unknown; DisplayName?: unknown; Active?: unknown } | undefined
  return typeof customer?.Id === 'string' && typeof customer.DisplayName === 'string'
    ? { id: customer.Id, displayName: customer.DisplayName, active: customer.Active !== false }
    : null
}

/** The text custom fields (Job Name, Job #, ...) the company has defined for sales forms. */
export async function fetchQuickbooksCustomFieldDefinitions(
  options: QuickbooksApiOptions,
  fetcher: Fetcher = fetch,
): Promise<CustomFieldDefinition[]> {
  return parseCustomFieldDefinitions(
    await apiGet('Reading the QuickBooks preferences', options, 'preferences', {}, fetcher),
  )
}

/**
 * POSTs JSON. A network failure or a 5xx may have changed something in
 * QuickBooks before failing, so those are reported as not definite.
 */
async function apiPost(
  operation: string,
  options: QuickbooksApiOptions,
  path: string,
  params: Record<string, string>,
  payload: unknown,
  fetcher: Fetcher,
) {
  let response: Response
  try {
    response = await fetcher(companyUrl(options, path, params), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.accessToken}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new QuickbooksApiError(`${operation} failed: ${(error as Error).message}`, null, false)
  }

  const body = await jsonBody(response)
  if (!response.ok) {
    const definite = response.status >= 400 && response.status < 500 && response.status !== 408
    const fault = faultDetails(operation, response, body)
    throw new QuickbooksApiError(fault.message, response.status, definite, fault.code)
  }
  return { body, status: response.status }
}

export async function createQuickbooksInvoice(
  options: QuickbooksApiOptions,
  payload: QuickbooksInvoicePayload,
  requestId: string,
  fetcher: Fetcher = fetch,
): Promise<CreatedQuickbooksInvoice> {
  const operation = 'Creating the QuickBooks invoice'
  const { body, status } = await apiPost(operation, options, 'invoice', { requestid: requestId }, payload, fetcher)

  const invoice = body?.Invoice as
    | { Id?: unknown; DocNumber?: unknown; SyncToken?: unknown; TotalAmt?: unknown }
    | undefined
  if (typeof invoice?.Id !== 'string') {
    throw new QuickbooksApiError(`${operation} failed: QuickBooks returned no invoice.`, status, false)
  }

  return {
    id: invoice.Id,
    docNumber: typeof invoice.DocNumber === 'string' ? invoice.DocNumber : null,
    syncToken: typeof invoice.SyncToken === 'string' ? invoice.SyncToken : null,
    totalAmount: typeof invoice.TotalAmt === 'number' ? invoice.TotalAmt : null,
  }
}

/** The invoice that already uses this number (DocNumber) in QuickBooks, or null. */
export async function findQuickbooksInvoiceByDocNumber(
  options: QuickbooksApiOptions,
  docNumber: string,
  fetcher: Fetcher = fetch,
): Promise<{ id: string; docNumber: string } | null> {
  const body = await apiGet(
    'Looking up the QuickBooks invoice number',
    options,
    'query',
    { query: `select Id, DocNumber from Invoice where DocNumber = ${quickbooksQueryLiteral(docNumber)} maxresults 1` },
    fetcher,
  )
  const invoice = (body?.QueryResponse as { Invoice?: { Id?: unknown; DocNumber?: unknown }[] } | undefined)
    ?.Invoice?.[0]

  return typeof invoice?.Id === 'string'
    ? { id: invoice.Id, docNumber: typeof invoice.DocNumber === 'string' ? invoice.DocNumber : docNumber }
    : null
}

/** One invoice as it is in QuickBooks right now, or null when it no longer exists. */
export async function getQuickbooksInvoice(
  options: QuickbooksApiOptions,
  invoiceId: string,
  fetcher: Fetcher = fetch,
): Promise<QuickbooksInvoiceDetail | null> {
  let body: Record<string, unknown> | null
  try {
    body = await apiGet(
      'Reading the QuickBooks invoice',
      options,
      `invoice/${encodeURIComponent(invoiceId)}`,
      {},
      fetcher,
    )
  } catch (error) {
    if (error instanceof QuickbooksApiError && (error.faultCode === '610' || error.status === 404)) {
      return null
    }
    throw error
  }

  const invoice = body?.Invoice as {
    Id?: unknown
    SyncToken?: unknown
    DocNumber?: unknown
    TotalAmt?: unknown
    Balance?: unknown
    DueDate?: unknown
    PrivateNote?: unknown
    MetaData?: { LastUpdatedTime?: unknown }
    LinkedTxn?: { TxnType?: unknown }[]
  } | undefined
  if (typeof invoice?.Id !== 'string' || typeof invoice.SyncToken !== 'string') return null

  return {
    id: invoice.Id,
    syncToken: invoice.SyncToken,
    docNumber: typeof invoice.DocNumber === 'string' ? invoice.DocNumber : null,
    totalAmount: Number(invoice.TotalAmt ?? 0),
    balance: Number(invoice.Balance ?? 0),
    linkedTransactions: (invoice.LinkedTxn ?? []).map((txn) => String(txn.TxnType ?? 'Unknown')),
    dueDate: typeof invoice.DueDate === 'string' ? invoice.DueDate : null,
    privateNote: typeof invoice.PrivateNote === 'string' ? invoice.PrivateNote : null,
    lastUpdatedAt: typeof invoice.MetaData?.LastUpdatedTime === 'string'
      ? invoice.MetaData.LastUpdatedTime
      : null,
  }
}

/**
 * Voids an invoice: QuickBooks keeps it, with its number, and zeroes its amounts.
 * The SyncToken must be the current one, so it is read just before.
 */
export async function voidQuickbooksInvoice(
  options: QuickbooksApiOptions,
  invoice: { id: string; syncToken: string },
  fetcher: Fetcher = fetch,
): Promise<void> {
  await apiPost(
    'Voiding the QuickBooks invoice',
    options,
    'invoice',
    { operation: 'void' },
    { Id: invoice.id, SyncToken: invoice.syncToken, sparse: true },
    fetcher,
  )
}

/** The PDF QuickBooks generates for an invoice, as its own "Download" produces it. */
export async function getQuickbooksInvoicePdf(
  options: QuickbooksApiOptions,
  invoiceId: string,
  fetcher: Fetcher = fetch,
): Promise<Uint8Array> {
  const operation = 'Downloading the QuickBooks invoice PDF'
  const response = await fetcher(
    companyUrl(options, `invoice/${encodeURIComponent(invoiceId)}/pdf`, {}),
    { headers: { Accept: 'application/pdf', Authorization: `Bearer ${options.accessToken}` } },
  )

  if (!response.ok) {
    const fault = faultDetails(operation, response, await jsonBody(response))
    throw new QuickbooksApiError(fault.message, response.status, true, fault.code)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  // Every PDF starts with "%PDF"; anything else is an error page, not a document.
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
    throw new QuickbooksApiError(`${operation} failed: QuickBooks did not return a PDF.`, response.status, true)
  }
  return bytes
}
