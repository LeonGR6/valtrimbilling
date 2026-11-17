import { quickbooksEnvironmentLabel } from './quickbooksRecord.js'

/**
 * Whether generating the Package also creates its QuickBooks invoice: the Package has none yet,
 * the person may create it, and the invoice is left in the PDF (unticking it generates the PDF
 * as before, with no invoice).
 */
export function createsInvoiceWhileGenerating({ canCreateInvoice, includeInvoice }) {
  return Boolean(canCreateInvoice) && Boolean(includeInvoice)
}

function listNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * What the dialog says when the invoice could not be created. Everything the Package needs besides
 * the invoice is generated first, so those documents are already saved: it says which, and that
 * nothing was joined, so the person knows generating again only has the invoice left to do.
 */
export function describeInvoiceCreationFailure(message, { savedDocuments = [] } = {}) {
  const reason = String(message ?? '').trim().replace(/[.!?]+$/u, '')
  const saved = savedDocuments.length === 0
    ? ''
    : ` The ${listNames(savedDocuments)} ${savedDocuments.length === 1 ? 'was' : 'were'} saved to this Package.`

  return `The QuickBooks invoice could not be created, so nothing was joined${reason ? `: ${reason}` : ''}.${saved}`
}

/** What the invoice was called when it was created, for the messages. */
export function createdInvoiceNumber(created) {
  return created?.invoiceNumber || created?.docNumber || created?.invoiceId || ''
}

/**
 * The message when the invoice exists but its PDF could not be read to join it. The invoice is
 * real by then, so it says so and where to get the PDF.
 */
export function describeMissingInvoicePdf(created) {
  const number = createdInvoiceNumber(created)

  return `Invoice ${number ? `${number} ` : ''}was created in QuickBooks, but its PDF could not be read, so nothing was joined. Get the PDF from QuickBooks under Invoice, then generate again.`
}

/** The sentence added to the success message when generating also created the invoice. */
export function describeCreatedInvoice(created) {
  if (!created) return ''

  const number = createdInvoiceNumber(created)
  const environment = quickbooksEnvironmentLabel(created.environment)

  return ` Invoice ${number ? `${number} ` : ''}was created in QuickBooks${environment ? ` ${environment}` : ''}.`
}
