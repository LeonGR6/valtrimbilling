// Finds the QuickBooks Customer that corresponds to a Builder.
//
// Matching is deliberately strict: only a Customer whose name equals the
// Builder's name (ignoring case and extra spaces) is used. A partial match such
// as "Trumark Homes" for "Trumark" is reported as a suggestion, never used, so
// an invoice cannot silently go to the wrong Customer. Nothing is auto-created.

import type { QuickbooksCustomer } from './quickbooksApi.ts'

export type QuickbooksCustomerErrorCode = 'CUSTOMER_NOT_FOUND' | 'CUSTOMER_AMBIGUOUS'

export class QuickbooksCustomerError extends Error {
  readonly code: QuickbooksCustomerErrorCode
  readonly candidates: string[]

  constructor(code: QuickbooksCustomerErrorCode, message: string, candidates: string[]) {
    super(message)
    this.name = 'QuickbooksCustomerError'
    this.code = code
    this.candidates = candidates
  }
}

export interface ResolvedQuickbooksCustomer {
  customerId: string
  displayName: string
  /** `mapping` was saved earlier; `quickbooks` was just found and should be saved. */
  source: 'mapping' | 'quickbooks'
}

export function normalizeCustomerName(value: string) {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase()
}

export async function resolveBuilderCustomer(
  { builderName, mapping, search }: {
    builderName: string
    mapping: { customerId: string; displayName: string | null } | null
    search: (name: string) => Promise<QuickbooksCustomer[]>
  },
): Promise<ResolvedQuickbooksCustomer> {
  if (mapping) {
    return {
      customerId: mapping.customerId,
      displayName: mapping.displayName ?? builderName,
      source: 'mapping',
    }
  }

  const wanted = normalizeCustomerName(builderName)
  const found = await search(builderName.trim())
  const exact = found.filter(({ displayName }) => normalizeCustomerName(displayName) === wanted)

  if (exact.length === 1) {
    return { customerId: exact[0].id, displayName: exact[0].displayName, source: 'quickbooks' }
  }

  if (exact.length > 1) {
    throw new QuickbooksCustomerError(
      'CUSTOMER_AMBIGUOUS',
      `QuickBooks has ${exact.length} Customers named "${builderName}". Keep only one active.`,
      exact.map(({ displayName }) => displayName),
    )
  }

  const suggestions = found.map(({ displayName }) => displayName)
  throw new QuickbooksCustomerError(
    'CUSTOMER_NOT_FOUND',
    suggestions.length > 0
      ? `QuickBooks has no Customer named exactly "${builderName}". Similar: ${suggestions.join(', ')}.`
      : `QuickBooks has no Customer named "${builderName}". Create it in QuickBooks with that exact name.`,
    suggestions,
  )
}
