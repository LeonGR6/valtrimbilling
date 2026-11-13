import { formatCurrency } from './drawInvoiceFormatters.js'

// The one extra line a person may add to a Package invoice before it goes to QuickBooks, for the occasions
// when the total the Builder requires does not match the Package (e.g. "DIFFERENCE"). A line that takes off
// money is held to a limit; a line that adds money (the Builder pays more) has no limit but needs a reason,
// kept inside the app and never sent to QuickBooks. The server holds the
// same rule (functions/_shared/quickbooksInvoiceDifference.ts and valtrim.invoice_difference_limit) and
// checks it again; this copy only lets the person see the problem while typing. The tests keep them in step.

export const DIFFERENCE_DESCRIPTION_MAX = 100
export const DEFAULT_DIFFERENCE_DESCRIPTION = 'DIFFERENCE'
export const DIFFERENCE_REASON_MAX = 500

// $5 for every $5,000 of invoice, counted from the first dollar: up to $5,000 -> $5, up to $10,000 -> $10,
// up to $15,000 -> $15, and so on. The Package net before the line is what is measured.
const STEP_CENTS = 500_000
const STEP_LIMIT_CENTS = 500

const toCents = (amount) => Math.round(Number(amount) * 100)

/** The largest difference that TAKES OFF money an invoice of this Package net may carry, in dollars. */
export function differenceLimit(netAmount) {
  const net = Number(netAmount)
  const netCents = Number.isFinite(net) ? Math.max(0, toCents(net)) : 0
  const steps = Math.max(1, Math.ceil(netCents / STEP_CENTS))
  return (steps * STEP_LIMIT_CENTS) / 100
}

export function cleanDifferenceDescription(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/** The reason for a line that adds money, with its blanks tidied like the description. */
export function cleanDifferenceReason(value) {
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
 * or null when it is fine. `limit` may be given when the server already said it. A line that takes off
 * money (negative) is held to the limit; a line that adds money (positive) has none but needs a `reason`.
 */
export function differenceProblem({ description, amount, reason }, netAmount, limit = differenceLimit(netAmount)) {
  const text = cleanDifferenceDescription(description)
  if (!text) return 'Write what the difference is for.'
  if (text.length > DIFFERENCE_DESCRIPTION_MAX) {
    return `The description can have up to ${DIFFERENCE_DESCRIPTION_MAX} characters.`
  }
  if (!Number.isFinite(amount)) return 'The difference must be an amount.'

  const cents = toCents(amount)
  if (Math.abs(amount * 100 - cents) > 1e-6) return 'The difference can have at most two decimals.'
  if (cents === 0) return 'The difference cannot be $0.00.'

  if (cents < 0 && Math.abs(cents) > toCents(limit)) {
    return `The difference of ${formatCurrency(Math.abs(cents) / 100)} is greater than the ${
      formatCurrency(limit)
    } allowed for an invoice of ${formatCurrency(Math.max(0, Number(netAmount)))}.`
  }
  if (cents > 0) {
    const why = cleanDifferenceReason(reason)
    if (!why) return 'The Builder pays more than the Package: write why.'
    if (why.length > DIFFERENCE_REASON_MAX) {
      return `The reason can have up to ${DIFFERENCE_REASON_MAX} characters.`
    }
  }
  if (toCents(netAmount) + cents <= 0) return 'The difference cannot bring the invoice total to $0.00 or less.'
  return null
}

/**
 * The difference line from the total the person types: the total the Builder requires (what the invoice
 * has to come to). The line is that total minus the Package net so far, to the cent, and is then checked
 * like any other difference. Returns:
 *  - `difference`: the line to send (null while there is none or it has a problem),
 *  - `amount`: the signed difference the total implies (null while the total is empty or not an amount),
 *  - `problem`: what is wrong, as a sentence, or null,
 *  - `total`: the invoice total with the line (the Package net when there is no line).
 * Closed, or open with the total still empty: no line and no problem. `limit` is the one the server
 * reported for this Package, when it has.
 */
export function readDifferenceDraft({ open, description, totalText, reason }, netAmount, limit = undefined) {
  const net = Number(netAmount)
  const noLine = { difference: null, amount: null, problem: null, total: Number.isFinite(net) ? net : null }
  if (!open || !Number.isFinite(net)) return noLine

  const required = parseDifferenceAmount(totalText)
  if (required === null) return noLine
  if (Number.isNaN(required)) return { ...noLine, problem: 'The total must be an amount.' }

  const requiredCents = toCents(required)
  if (Math.abs(required * 100 - requiredCents) > 1e-6) {
    return { ...noLine, problem: 'The total can have at most two decimals.' }
  }
  if (requiredCents <= 0) return { ...noLine, problem: 'The total must be more than $0.00.' }

  const amount = (requiredCents - toCents(net)) / 100
  if (amount === 0) {
    return {
      ...noLine,
      amount: 0,
      problem: 'This is the same as the Package total, so there is no difference to add.',
    }
  }

  const candidate = { description: cleanDifferenceDescription(description), amount }
  // Only a line that adds money carries a reason; one that takes off has none.
  if (amount > 0) candidate.reason = cleanDifferenceReason(reason)
  const problem = differenceProblem(candidate, net, limit ?? differenceLimit(net))
  if (problem) return { difference: null, amount, problem, total: net }

  return { difference: candidate, amount, problem: null, total: requiredCents / 100 }
}

/** "+$8.00" or "-$8.00": the amount with its sign, for the places that say what was added. */
export function formatSignedCurrency(amount) {
  if (amount === null || amount === undefined || amount === '') return '—'
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  return `${value < 0 ? '-' : '+'}${formatCurrency(Math.abs(value))}`
}

/** What the invoice looks like after the change, for the person to read before saving. */
export function describeDifferenceChange(current, next) {
  if (current && !next) return `The "${current.description}" line of ${formatSignedCurrency(current.amount)} is taken off the invoice.`
  if (!current && next) return `A "${next.description}" line of ${formatSignedCurrency(next.amount)} is added to the invoice.`
  return `The "${current.description}" line of ${formatSignedCurrency(current.amount)} becomes "${next.description}" of ${formatSignedCurrency(next.amount)}.`
}

/** True when the line typed is the one the invoice already has. */
export function sameDifference(left, right) {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.description === right.description
    && Math.round(left.amount * 100) === Math.round(right.amount * 100)
    && cleanDifferenceReason(left.reason) === cleanDifferenceReason(right.reason)
}

/**
 * The ledger line of a Package summary for the difference its invoice carries, or null when it has none:
 * the text of the line as label, its signed amount as value, in red when it takes off.
 */
export function differenceLedgerLine(summary) {
  const difference = summary?.difference
  if (!difference || difference.amount == null) return null
  return {
    label: difference.description,
    value: formatSignedCurrency(difference.amount),
    tone: difference.amount < 0 ? 'deduction' : undefined,
  }
}
