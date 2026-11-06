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
  /** A saved mapping pointed to a Customer that no longer exists, so it was dropped. */
  replacedStale: boolean
}

export function normalizeCustomerName(value: string) {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/**
 * A saved mapping is checked against QuickBooks every time: if its Customer was
 * deleted or deactivated the mapping is dropped and the Builder is matched by
 * name again, instead of sending an invoice to a Customer that is gone.
 */
export async function resolveBuilderCustomer(
  { builderName, mapping, verify, clearMapping, search }: {
    builderName: string
    mapping: { customerId: string; displayName: string | null } | null
    verify: (customerId: string) => Promise<{ displayName: string; active: boolean } | null>
    clearMapping: () => Promise<void>
    search: (name: string) => Promise<QuickbooksCustomer[]>
  },
): Promise<ResolvedQuickbooksCustomer> {
  let replacedStale = false

  if (mapping) {
    const current = await verify(mapping.customerId)
    if (current?.active) {
      return {
        customerId: mapping.customerId,
        displayName: current.displayName,
        source: 'mapping',
        replacedStale: false,
      }
    }
    await clearMapping()
    replacedStale = true
  }

  const wanted = normalizeCustomerName(builderName)
  const found = await search(builderName.trim())
  const exact = found.filter(({ displayName }) => normalizeCustomerName(displayName) === wanted)
  const staleNote = replacedStale
    ? `The QuickBooks Customer saved for "${builderName}" no longer exists or is inactive. `
    : ''

  if (exact.length === 1) {
    return {
      customerId: exact[0].id,
      displayName: exact[0].displayName,
      source: 'quickbooks',
      replacedStale,
    }
  }

  if (exact.length > 1) {
    throw new QuickbooksCustomerError(
      'CUSTOMER_AMBIGUOUS',
      `${staleNote}QuickBooks has ${exact.length} Customers named "${builderName}". Keep only one active.`,
      exact.map(({ displayName }) => displayName),
    )
  }

  const suggestions = found.map(({ displayName }) => displayName)
  throw new QuickbooksCustomerError(
    'CUSTOMER_NOT_FOUND',
    suggestions.length > 0
      ? `${staleNote}QuickBooks has no Customer named exactly "${builderName}". Similar: ${suggestions.join(', ')}.`
      : `${staleNote}QuickBooks has no Customer named "${builderName}". Create it in QuickBooks with that exact name.`,
    suggestions,
  )
}
