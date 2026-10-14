// What a Package's QuickBooks invoice is, in the words QuickBooks shows
// (Open, Overdue, Partially paid, Paid, Closed, Voided).
//
// The API has no status on an invoice: the screen works it out, and so does
// this. It is pure; the reading of the invoice and the writing of the result
// are done by quickbooksPaymentSync.ts.

import type { QuickbooksInvoiceDetail } from './quickbooksApi.ts'

export type QuickbooksPaymentState =
  | 'OPEN'
  | 'OVERDUE'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CLOSED'
  | 'VOIDED'
  | 'DELETED'

export interface DerivedPaymentState {
  state: QuickbooksPaymentState
  /** Still owing something after its due date (also true for a partly paid one). */
  overdue: boolean
}

const toCents = (value: number) => Math.round(value * 100)

/**
 * @param invoice the invoice as QuickBooks has it now, or null when it no longer exists
 * @param today YYYY-MM-DD in the company's calendar
 */
export function deriveQuickbooksPaymentState(
  invoice: QuickbooksInvoiceDetail | null,
  today: string,
): DerivedPaymentState {
  if (!invoice) return { state: 'DELETED', overdue: false }

  const total = toCents(invoice.totalAmount)
  const balance = toCents(invoice.balance)

  // A void keeps the invoice but zeroes its amounts.
  if (total === 0) return { state: 'VOIDED', overdue: false }

  if (balance <= 0) {
    // Settled. With a Payment linked it was paid; settled by a credit alone it
    // is "Closed": nobody paid, so a Package is not closed automatically.
    return invoice.linkedTransactions.includes('Payment')
      ? { state: 'PAID', overdue: false }
      : { state: 'CLOSED', overdue: false }
  }

  const overdue = Boolean(invoice.dueDate) && String(invoice.dueDate) < today
  if (balance < total) return { state: 'PARTIALLY_PAID', overdue }
  return { state: overdue ? 'OVERDUE' : 'OPEN', overdue }
}
