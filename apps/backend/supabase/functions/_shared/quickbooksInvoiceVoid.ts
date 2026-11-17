// Voids a Package's QuickBooks invoice.
//
// QuickBooks keeps a voided invoice with its number and zeroed amounts, which is
// what accounting wants instead of a deleted one. It is only allowed while the
// invoice is untouched: no payment or credit applied (checked live, in
// QuickBooks) and, in our database, an unpaid Package that was not submitted.
//
// Order matters: QuickBooks is voided first and the database second. If the
// second step fails the next attempt finds the invoice already voided in
// QuickBooks and only repeats the database step.

import type {
  QuickbooksApiOptions,
  QuickbooksEnvironment,
  QuickbooksInvoiceDetail,
} from './quickbooksApi.ts'
import type { QuickbooksSession } from './quickbooksSession.ts'

export type InvoiceVoidErrorCode = 'NOT_CREATED' | 'WRONG_COMPANY' | 'HAS_PAYMENTS'

export class QuickbooksInvoiceVoidError extends Error {
  readonly code: InvoiceVoidErrorCode

  constructor(code: InvoiceVoidErrorCode, message: string) {
    super(message)
    this.name = 'QuickbooksInvoiceVoidError'
    this.code = code
  }
}

export interface InvoiceVoidContext {
  quickbooksStatus: string
  invoiceId: string | null
  environment: string | null
  realmId: string | null
  /** Total recorded when the invoice was created, to tell a voided one (total 0). */
  totalAmount: number | null
}

export interface InvoiceVoidDeps {
  loadContext(packageId: number): Promise<InvoiceVoidContext>
  /** Opens the session of the environment the invoice was created in. */
  openSession(environment: QuickbooksEnvironment): Promise<QuickbooksSession>
  getInvoice(api: QuickbooksApiOptions, invoiceId: string): Promise<QuickbooksInvoiceDetail | null>
  voidInvoice(api: QuickbooksApiOptions, invoice: { id: string; syncToken: string }): Promise<void>
  /** Records the void in the database; the path is the saved PDF to delete from Storage. */
  markVoided(packageId: number): Promise<{ already: boolean; removedStoragePath: string | null }>
  removeStoredFile(path: string): Promise<void>
}

export type InvoiceVoidResult = {
  voided: true
  /** What QuickBooks already had: nothing to do, the invoice was already voided or it was deleted there. */
  quickbooks: 'voided' | 'already_voided' | 'missing'
}

const cents = (amount: number) => Math.round(amount * 100)

const environmentOf = (value: string | null): QuickbooksEnvironment | null =>
  value === 'sandbox' || value === 'production' ? value : null

export async function voidPackageInvoice(
  deps: InvoiceVoidDeps,
  packageId: number,
): Promise<InvoiceVoidResult> {
  const context = await deps.loadContext(packageId)

  if (context.quickbooksStatus === 'VOIDED') {
    return { voided: true, quickbooks: 'already_voided' }
  }
  if (context.quickbooksStatus !== 'CREATED' || !context.invoiceId) {
    throw new QuickbooksInvoiceVoidError('NOT_CREATED', 'This Package has no QuickBooks invoice to void.')
  }

  const environment = environmentOf(context.environment)
  if (!environment) {
    throw new QuickbooksInvoiceVoidError('NOT_CREATED', 'This Package has no QuickBooks invoice to void.')
  }

  const session = await deps.openSession(environment)
  if (session.environment !== context.environment || session.realmId !== context.realmId) {
    throw new QuickbooksInvoiceVoidError(
      'WRONG_COMPANY',
      'QuickBooks is connected to a different company than the one this invoice was created in.',
    )
  }
  const api: QuickbooksApiOptions = {
    environment: session.environment,
    realmId: session.realmId,
    accessToken: session.accessToken,
  }

  const invoice = await deps.getInvoice(api, context.invoiceId)
  let quickbooks: InvoiceVoidResult['quickbooks']

  if (!invoice) {
    // Deleted by hand in QuickBooks: nothing is left to void, only our record.
    quickbooks = 'missing'
  } else if (cents(invoice.totalAmount) === 0 && cents(context.totalAmount ?? 1) > 0) {
    quickbooks = 'already_voided'
  } else {
    if (invoice.linkedTransactions.length > 0 || cents(invoice.balance) !== cents(invoice.totalAmount)) {
      throw new QuickbooksInvoiceVoidError(
        'HAS_PAYMENTS',
        'The invoice already has a payment or credit applied in QuickBooks, so it cannot be voided here.',
      )
    }
    await deps.voidInvoice(api, { id: invoice.id, syncToken: invoice.syncToken })
    quickbooks = 'voided'
  }

  const { removedStoragePath } = await deps.markVoided(packageId)
  if (removedStoragePath) await deps.removeStoredFile(removedStoragePath).catch(() => {})

  return { voided: true, quickbooks }
}
