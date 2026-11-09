import { formatCurrency } from './drawInvoiceFormatters.js'

// The one extra line a person may add to a Package invoice before it goes to QuickBooks, for the occasions
// when the total the Builder requires does not match the Package (e.g. "DIFFERENCE"). The server holds the
// same rule (functions/_shared/quickbooksInvoiceDifference.ts and valtrim.invoice_difference_limit) and
// checks it again; this copy only lets the person see the problem while typing. The tests keep them in step.

export const DIFFERENCE_DESCRIPTION_MAX = 100
export const DEFAULT_DIFFERENCE_DESCRIPTION = 'DIFFERENCE'

// $5 for every $5,000 of invoice, counted from the first dollar: up to $5,000 -> $5, up to $10,000 -> $10,
// up to $15,000 -> $15, and so on. The Package net before the line is what is measured.
const STEP_CENTS = 500_000
const STEP_LIMIT_CENTS = 500

const toCents = (amount) => Math.round(Number(amount) * 100)

/** The largest difference (either sign) an invoice of this Package net may carry, in dollars. */
export function differenceLimit(netAmount) {
  const net = Number(netAmount)
  const netCents = Number.isFinite(net) ? Math.max(0, toCents(net)) : 0
  const steps = Math.max(1, Math.ceil(netCents / STEP_CENTS))
  return (steps * STEP_LIMIT_CENTS) / 100
}

export function cleanDifferenceDescription(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/**
 * The number typed in the amount box: "8", "-8", "+8.50", "$8", "1,250". Null when the box is empty,
 * NaN when what is there is not an amount.
 */
export function parseDifferenceAmount(text) {
  const cleaned = String(text ?? '').replace(/[\s$,]/gu, '')
  if (cleaned === '') return null
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/u.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

/**
 * What is wrong with a difference for an invoice whose Package net is `netAmount`, as a sentence to show,
 * or null when it is fine. `limit` may be given when the server already said it.
 */
export function differenceProblem({ description, amount }, netAmount, limit = differenceLimit(netAmount)) {
  const text = cleanDifferenceDescription(description)
  if (!text) return 'Write what the difference is for.'
  if (text.length > DIFFERENCE_DESCRIPTION_MAX) {
    return `The description can have up to ${DIFFERENCE_DESCRIPTION_MAX} characters.`
  }
  if (!Number.isFinite(amount)) return 'The difference must be an amount.'

  const cents = toCents(amount)
  if (Math.abs(amount * 100 - cents) > 1e-6) return 'The difference can have at most two decimals.'
  if (cents === 0) return 'The difference cannot be $0.00.'

  if (Math.abs(cents) > toCents(limit)) {
    return `The difference of ${formatCurrency(Math.abs(cents) / 100)} is greater than the ${
      formatCurrency(limit)
    } allowed for an invoice of ${formatCurrency(Math.max(0, Number(netAmount)))}.`
  }
  if (toCents(netAmount) + cents <= 0) return 'The difference cannot bring the invoice total to $0.00 or less.'
  return null
}

/**
 * The difference the person is typing, read against the Package: the line to send (or null while there
 * is nothing to send), what is wrong with it, and the invoice total with it.
 *  - Closed, or open with the amount still empty: no line and no problem.
 *  - `limit` is the one the server reported for this Package, when it has.
 */
export function readDifferenceDraft({ open, description, amountText }, netAmount, limit = undefined) {
  const net = Number(netAmount)
  const noLine = { difference: null, problem: null, total: Number.isFinite(net) ? net : null }
  if (!open || !Number.isFinite(net)) return noLine

  const amount = parseDifferenceAmount(amountText)
  if (amount === null) return noLine

  const candidate = { description: cleanDifferenceDescription(description), amount }
  const problem = Number.isNaN(amount)
    ? 'The difference must be an amount.'
    : differenceProblem(candidate, net, limit ?? differenceLimit(net))
  if (problem) return { difference: null, problem, total: net }

  return {
    difference: candidate,
    problem: null,
    total: Math.round((net + amount) * 100) / 100,
  }
}

/** "+$8.00" or "-$8.00": the amount with its sign, for the places that say what was added. */
export function formatSignedCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '—'
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  return `${value < 0 ? '-' : '+'}${formatCurrency(Math.abs(value))}`
}
