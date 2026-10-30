// How a Package's invoice is named and described on screen.
//
// Once the invoice exists its serial number (15001, 15002...) is what people
// know it by; before that the Package's own number (DP-0000xxxx) is shown.

export const PAYMENT_STATE_LABELS = {
  OPEN: 'Open',
  OVERDUE: 'Overdue',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  CLOSED: 'Closed',
  VOIDED: 'Voided',
  DELETED: 'Deleted',
}

/**
 * The invoice number to show: the one saved on the invoice, else the one
 * QuickBooks was given. Null while the Package has no invoice yet.
 */
export function displayInvoiceNumber({ invoiceNumber = null, quickbooksStatus, quickbooksReference }) {
  if (invoiceNumber) return invoiceNumber
  return quickbooksStatus === 'CREATED' && quickbooksReference ? quickbooksReference : null
}

/**
 * The number that names the Package in its documents: the invoice number once
 * there is one (15001), else the Package's own (DP-0000xxxx).
 */
export function packageDocumentNumber(record) {
  return displayInvoiceNumber(record) ?? record.packageNumber
}

/** The state of the invoice in words: Paid, Open, Overdue... or "Invoice created". */
export function invoiceStatusLabel({ paymentState = null, paymentOverdue = false, quickbooksStatus }) {
  const label = PAYMENT_STATE_LABELS[paymentState]
  if (label) return paymentOverdue && paymentState === 'PARTIALLY_PAID' ? `${label} · Overdue` : label
  return quickbooksStatus === 'CREATED' ? 'Invoice created' : null
}

/**
 * The two lines a locked worksheet cell shows for the Package that bills it:
 * the invoice number (or the Package number while there is no invoice) and the
 * status of the invoice (or what is still missing).
 *
 * @param owner a Package record, or the smaller record kept for a billed Utility charge
 * @param fallbackStatus what to say when there is no invoice and nothing else to add
 */
export function worksheetCellLabels(owner, fallbackStatus = 'Invoice pending') {
  const number = displayInvoiceNumber(owner)
  if (!number) return { title: owner.packageNumber, subtitle: fallbackStatus }

  return {
    title: `Invoice ${number}`,
    subtitle: invoiceStatusLabel(owner) ?? 'Invoice created',
  }
}
