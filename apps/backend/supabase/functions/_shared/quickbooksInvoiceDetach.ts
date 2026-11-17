// Lets a Package whose QuickBooks invoice was voided get a new invoice.
//
// The voided invoice itself stays in QuickBooks, with its number and its amounts at $0;
// only this platform lets go of it, so the Package can be sent again. The database
// refuses anything that is not an unpaid, unsubmitted Package with a voided invoice, and
// archives the attempt.

export interface InvoiceDetachDeps {
  /** Detaches the voided invoice in the database; returns the saved PDF to delete from Storage. */
  detach(packageId: number): Promise<{
    removedStoragePath: string | null
    voidedInvoiceNumber: string | null
  }>
  removeStoredFile(path: string): Promise<void>
}

export type InvoiceDetachResult = {
  detached: true
  voidedInvoiceNumber: string | null
  removedPdf: boolean
}

export async function detachVoidedInvoice(
  deps: InvoiceDetachDeps,
  packageId: number,
): Promise<InvoiceDetachResult> {
  const { removedStoragePath, voidedInvoiceNumber } = await deps.detach(packageId)
  if (!removedStoragePath) return { detached: true, voidedInvoiceNumber, removedPdf: false }

  // The Package is already free: a PDF left behind in Storage is harmless.
  const removed = await deps.removeStoredFile(removedStoragePath).then(() => true, () => false)
  return { detached: true, voidedInvoiceNumber, removedPdf: removed }
}
