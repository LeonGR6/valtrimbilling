// Lets an administrator or accounting user see and change which QuickBooks
// Customer each Builder is linked to. Linking checks the Customer exists in
// QuickBooks right now, so a typo or a deleted Customer cannot be saved.

import type { QuickbooksApiOptions, QuickbooksCustomer, QuickbooksCustomerDetail } from './quickbooksApi.ts'

export type CustomerAdminInput =
  | { action: 'search'; query: string }
  | { action: 'list' }
  | { action: 'link'; builderId: number; customerId: string }
  | { action: 'unlink'; builderId: number }

export type CustomerAdminResult =
  | { customers: QuickbooksCustomer[] }
  | { customer: QuickbooksCustomer }
  | { removed: boolean }

export type CustomerAdminErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_CONNECTED'
  | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_INACTIVE'

export class QuickbooksCustomerAdminError extends Error {
  readonly code: CustomerAdminErrorCode

  constructor(code: CustomerAdminErrorCode, message: string) {
    super(message)
    this.name = 'QuickbooksCustomerAdminError'
    this.code = code
  }
}

export interface CustomerAdminDeps {
  /** The environment of the connected company, or null when not connected. */
  getEnvironment(): Promise<string | null>
  /** Opens a QuickBooks session; only called when QuickBooks itself is needed. */
  openApi(): Promise<QuickbooksApiOptions>
  searchCustomers(api: QuickbooksApiOptions, query: string): Promise<QuickbooksCustomer[]>
  /** Every active Customer, to choose one by hand instead of searching by name. */
  listCustomers(api: QuickbooksApiOptions): Promise<QuickbooksCustomer[]>
  getCustomer(api: QuickbooksApiOptions, customerId: string): Promise<QuickbooksCustomerDetail | null>
  saveMapping(
    builderId: number,
    environment: string,
    customer: { customerId: string; displayName: string },
  ): Promise<void>
  deleteMapping(builderId: number, environment: string): Promise<boolean>
}

const MIN_QUERY_LENGTH = 2

function positiveInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new QuickbooksCustomerAdminError('INVALID_INPUT', `${field} must be a positive whole number.`)
  }
  return value as number
}

export function parseCustomerAdminInput(body: unknown): CustomerAdminInput {
  const input = (body ?? {}) as Record<string, unknown>

  switch (input.action) {
    case 'search': {
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      if (query.length < MIN_QUERY_LENGTH) {
        throw new QuickbooksCustomerAdminError(
          'INVALID_INPUT',
          `Type at least ${MIN_QUERY_LENGTH} characters to search QuickBooks.`,
        )
      }
      return { action: 'search', query }
    }
    case 'list':
      return { action: 'list' }
    case 'link': {
      const customerId = typeof input.customerId === 'string' ? input.customerId.trim() : ''
      if (!customerId) {
        throw new QuickbooksCustomerAdminError('INVALID_INPUT', 'customerId is required.')
      }
      return { action: 'link', builderId: positiveInteger(input.builderId, 'builderId'), customerId }
    }
    case 'unlink':
      return { action: 'unlink', builderId: positiveInteger(input.builderId, 'builderId') }
    default:
      throw new QuickbooksCustomerAdminError('INVALID_INPUT', 'Unknown action.')
  }
}

export async function handleCustomerAction(
  deps: CustomerAdminDeps,
  input: CustomerAdminInput,
): Promise<CustomerAdminResult> {
  const environment = await deps.getEnvironment()
  if (!environment) {
    throw new QuickbooksCustomerAdminError(
      'NOT_CONNECTED',
      'QuickBooks is not connected. An administrator must connect it first.',
    )
  }

  if (input.action === 'unlink') {
    return { removed: await deps.deleteMapping(input.builderId, environment) }
  }

  const api = await deps.openApi()

  if (input.action === 'search') {
    return { customers: await deps.searchCustomers(api, input.query) }
  }
  if (input.action === 'list') {
    return { customers: await deps.listCustomers(api) }
  }

  const customer = await deps.getCustomer(api, input.customerId)
  if (!customer) {
    throw new QuickbooksCustomerAdminError(
      'CUSTOMER_NOT_FOUND',
      'That Customer does not exist in QuickBooks.',
    )
  }
  if (!customer.active) {
    throw new QuickbooksCustomerAdminError(
      'CUSTOMER_INACTIVE',
      `The QuickBooks Customer "${customer.displayName}" is inactive.`,
    )
  }

  await deps.saveMapping(input.builderId, environment, {
    customerId: customer.id,
    displayName: customer.displayName,
  })
  return { customer: { id: customer.id, displayName: customer.displayName } }
}
