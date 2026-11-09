// The one extra line a person may add to a Package invoice before it goes to QuickBooks, for the
// occasions when the total the Builder requires does not match the Package total (e.g. "DIFFERENCE").
//
// The line is a small, checked exception to "the invoice lines add up to the Package net":
//   * it is one line, with a text and an amount that may be positive (more) or negative (less),
//   * it can never be larger than the limit for the size of the invoice,
//   * the invoice total in QuickBooks is then the Package net plus this amount.
//
// Pure helpers: nothing here talks to QuickBooks or the database. The database holds the same formula in
// valtrim.invoice_difference_limit, and a test keeps the two in step.

export interface InvoiceDifference {
  description: string
  /** Dollars. Positive adds to the invoice, negative takes off. Never zero. */
  amount: number
}

export const DIFFERENCE_DESCRIPTION_MAX = 100
export const DEFAULT_DIFFERENCE_DESCRIPTION = 'DIFFERENCE'

// $5 for every $5,000 of invoice, counted from the first dollar: up to $5,000 -> $5, up to $10,000 -> $10,
// up to $15,000 -> $15, and so on. The Package net before the line is what is measured.
const STEP_CENTS = 500_000
const STEP_LIMIT_CENTS = 500

const toCents = (amount: number) => Math.round(amount * 100)

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** The largest difference (in dollars, either sign) an invoice of this Package net may carry. */
export function differenceLimit(netAmount: number): number {
  const netCents = Math.max(0, toCents(netAmount))
  const steps = Math.max(1, Math.ceil(netCents / STEP_CENTS))
  return (steps * STEP_LIMIT_CENTS) / 100
}

/** The text of a difference as it is printed: single spaces, no edges. */
export function cleanDifferenceDescription(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export interface DifferenceProblem {
  /** TOO_LARGE is the limit; INVALID is anything else wrong with what was typed. */
  code: 'TOO_LARGE' | 'INVALID'
  message: string
}

/**
 * What is wrong with a difference for an invoice whose Package net is `netAmount`, or null when it is
 * fine. The messages are written to be shown to the person.
 */
export function differenceProblem(difference: InvoiceDifference, netAmount: number): DifferenceProblem | null {
  const invalid = (message: string): DifferenceProblem => ({ code: 'INVALID', message })

  const description = cleanDifferenceDescription(difference.description)
  if (!description) return invalid('Write what the difference is for.')
  if (description.length > DIFFERENCE_DESCRIPTION_MAX) {
    return invalid(`The description can have up to ${DIFFERENCE_DESCRIPTION_MAX} characters.`)
  }
  if (!Number.isFinite(difference.amount)) return invalid('The difference must be an amount.')

  const cents = toCents(difference.amount)
  if (Math.abs(difference.amount * 100 - cents) > 1e-6) return invalid('The difference can have at most two decimals.')
  if (cents === 0) return invalid('The difference cannot be $0.00.')

  const limitCents = toCents(differenceLimit(netAmount))
  if (Math.abs(cents) > limitCents) {
    return {
      code: 'TOO_LARGE',
      message: `The difference of ${money(Math.abs(cents))} is greater than the ${money(limitCents)} allowed `
        + `for an invoice of ${money(Math.max(0, toCents(netAmount)))}.`,
    }
  }
  if (toCents(netAmount) + cents <= 0) return invalid('The difference cannot bring the invoice total to $0.00 or less.')
  return null
}

/**
 * Reads the difference of a request body: null when there is none, else the cleaned description and the
 * amount, or the reason it cannot be read. The limit is checked later, against the Package net.
 */
export function readInvoiceDifference(
  value: unknown,
): { difference: InvoiceDifference | null; problem: string | null } {
  if (value == null) return { difference: null, problem: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { difference: null, problem: 'The difference must have a description and an amount.' }
  }
  const { description, amount } = value as { description?: unknown; amount?: unknown }
  if (typeof description !== 'string') {
    return { difference: null, problem: 'Write what the difference is for.' }
  }
  if (typeof amount !== 'number') {
    return { difference: null, problem: 'The difference must be an amount.' }
  }
  return { difference: { description: cleanDifferenceDescription(description), amount }, problem: null }
}
