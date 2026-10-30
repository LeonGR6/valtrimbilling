// Keeps QuickBooks' own PDF of an invoice as the Package's INVOICE document.
//
// The PDF is the one QuickBooks produces when a person picks "Download" on the
// invoice, so it carries the company's form design. Storing it is separate from
// creating the invoice: the invoice is the money record and must never be lost
// because a PDF could not be saved.

import type { QuickbooksApiOptions, QuickbooksEnvironment } from './quickbooksApi.ts'
import type { QuickbooksSession } from './quickbooksSession.ts'

// The same limit the Package documents bucket and the register function enforce.
export const MAX_INVOICE_PDF_BYTES = 25 * 1024 * 1024

export type InvoicePdfErrorCode = 'NOT_CREATED' | 'WRONG_COMPANY' | 'TOO_LARGE'

export class QuickbooksInvoicePdfError extends Error {
  readonly code: InvoicePdfErrorCode

  constructor(code: InvoicePdfErrorCode, message: string) {
    super(message)
    this.name = 'QuickbooksInvoicePdfError'
    this.code = code
  }
}

export interface PdfStoreDeps {
  fetchPdf(api: QuickbooksApiOptions, invoiceId: string): Promise<Uint8Array>
  upload(path: string, bytes: Uint8Array): Promise<void>
  register(input: {
    packageId: number
    storagePath: string
    fileName: string
    sizeBytes: number
    sha256: string
  }): Promise<{ replacedStoragePath: string | null }>
  removeStoredFile(path: string): Promise<void>
  newId(): string
}

export interface StoredInvoicePdf {
  fileName: string
  sizeBytes: number
}

async function sha256Hex(bytes: Uint8Array) {
  // slice() gives an ArrayBuffer-backed copy, which is what digest() accepts.
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Characters a file name cannot hold become spaces; the rest of the name is kept. */
export function invoicePdfFileName(documentNumber: string) {
  const cleaned = Array.from(documentNumber)
    .map((character) => (character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? ' ' : character))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  return `${`Invoice - ${cleaned || 'QuickBooks'}`.slice(0, 250)}.pdf`
}

/**
 * Downloads the invoice PDF and saves it as the Package's INVOICE document,
 * replacing the previous one. If registering fails the uploaded file is removed
 * so no orphan is left in Storage.
 */
export async function storeInvoicePdf(
  deps: PdfStoreDeps,
  { api, packageId, invoiceId, documentNumber }: {
    api: QuickbooksApiOptions
    packageId: number
    invoiceId: string
    documentNumber: string
  },
): Promise<StoredInvoicePdf> {
  const bytes = await deps.fetchPdf(api, invoiceId)
  if (bytes.length > MAX_INVOICE_PDF_BYTES) {
    throw new QuickbooksInvoicePdfError('TOO_LARGE', 'The QuickBooks invoice PDF is larger than 25 MB.')
  }

  const storagePath = `${packageId}/invoice/${deps.newId()}.pdf`
  const fileName = invoicePdfFileName(documentNumber)

  await deps.upload(storagePath, bytes)

  let replaced: string | null
  try {
    ;({ replacedStoragePath: replaced } = await deps.register({
      packageId,
      storagePath,
      fileName,
      sizeBytes: bytes.length,
      sha256: await sha256Hex(bytes),
    }))
  } catch (error) {
    await deps.removeStoredFile(storagePath).catch(() => {})
    throw error
  }

  // The new PDF is already registered; failing to delete the old file only leaves clutter.
  if (replaced) await deps.removeStoredFile(replaced).catch(() => {})

  return { fileName, sizeBytes: bytes.length }
}

export interface InvoicePdfContext {
  packageNumber: string
  quickbooksStatus: string
  invoiceId: string | null
  docNumber: string | null
  environment: string | null
  realmId: string | null
}

export interface InvoicePdfActionDeps extends PdfStoreDeps {
  loadContext(packageId: number): Promise<InvoicePdfContext>
  /** Opens the session of the environment the invoice was created in. */
  openSession(environment: QuickbooksEnvironment): Promise<QuickbooksSession>
}

/** Saves, or saves again, the PDF of a Package whose invoice already exists. */
export async function saveInvoicePdfForPackage(
  deps: InvoicePdfActionDeps,
  packageId: number,
): Promise<StoredInvoicePdf> {
  const context = await deps.loadContext(packageId)
  if (context.quickbooksStatus !== 'CREATED' || !context.invoiceId) {
    throw new QuickbooksInvoicePdfError('NOT_CREATED', 'This Package has no QuickBooks invoice to save.')
  }

  const environment = context.environment === 'sandbox' || context.environment === 'production'
    ? context.environment
    : null
  if (!environment) {
    throw new QuickbooksInvoicePdfError('NOT_CREATED', 'This Package has no QuickBooks invoice to save.')
  }

  const session = await deps.openSession(environment)
  if (session.environment !== context.environment || session.realmId !== context.realmId) {
    throw new QuickbooksInvoicePdfError(
      'WRONG_COMPANY',
      'QuickBooks is connected to a different company than the one this invoice was created in.',
    )
  }

  return storeInvoicePdf(deps, {
    api: { environment: session.environment, realmId: session.realmId, accessToken: session.accessToken },
    packageId,
    invoiceId: context.invoiceId,
    documentNumber: context.docNumber ?? context.packageNumber,
  })
}
