// QuickBooks Online accounting API calls. Every call takes an injectable
// `fetcher` so it can be tested without touching Intuit.

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

  constructor(message: string, status: number | null, definite: boolean) {
    super(message)
    this.name = 'QuickbooksApiError'
    this.status = status
    this.definite = definite
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

function faultMessage(operation: string, response: Response, body: Record<string, unknown> | null) {
  const fault = body?.Fault as { Error?: { Message?: string; Detail?: string }[] } | undefined
  const first = fault?.Error?.[0]
  return `${operation} failed: ${first?.Detail ?? first?.Message ?? `HTTP ${response.status}`}`
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
    throw new QuickbooksApiError(faultMessage(operation, response, body), response.status, true)
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

export async function createQuickbooksInvoice(
  options: QuickbooksApiOptions,
  payload: QuickbooksInvoicePayload,
  requestId: string,
  fetcher: Fetcher = fetch,
): Promise<CreatedQuickbooksInvoice> {
  const operation = 'Creating the QuickBooks invoice'

  let response: Response
  try {
    response = await fetcher(companyUrl(options, 'invoice', { requestid: requestId }), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.accessToken}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new QuickbooksApiError(
      `${operation} failed: ${(error as Error).message}`,
      null,
      false,
    )
  }

  const body = await jsonBody(response)
  if (!response.ok) {
    const definite = response.status >= 400 && response.status < 500 && response.status !== 408
    throw new QuickbooksApiError(faultMessage(operation, response, body), response.status, definite)
  }

  const invoice = body?.Invoice as
    | { Id?: unknown; DocNumber?: unknown; SyncToken?: unknown; TotalAmt?: unknown }
    | undefined
  if (typeof invoice?.Id !== 'string') {
    throw new QuickbooksApiError(`${operation} failed: QuickBooks returned no invoice.`, response.status, false)
  }

  return {
    id: invoice.Id,
    docNumber: typeof invoice.DocNumber === 'string' ? invoice.DocNumber : null,
    syncToken: typeof invoice.SyncToken === 'string' ? invoice.SyncToken : null,
    totalAmount: typeof invoice.TotalAmt === 'number' ? invoice.TotalAmt : null,
  }
}
