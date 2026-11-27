// Sends a Package that was invoiced in the QuickBooks Test company back to a
// clean Draft, so it can be sent to Production.
//
// The Test invoice itself stays in the Test company (it is not real and nothing
// there matters); only this platform forgets it. The database refuses anything
// that is not an unpaid, unsubmitted Test Package, and archives the attempt.

export interface InvoiceResetDeps {
  /** Resets the Package in the database; returns the saved PDF to delete from Storage. */
  reset(packageId: number, reason: string): Promise<{ removedStoragePath: string | null }>
  removeStoredFile(path: string): Promise<void>
}

export type InvoiceResetResult = { reset: true; removedPdf: boolean }

export const RESET_REASON = 'Moved back to Production by a user'

export async function resetTestInvoice(
  deps: InvoiceResetDeps,
  packageId: number,
): Promise<InvoiceResetResult> {
  const { removedStoragePath } = await deps.reset(packageId, RESET_REASON)
  if (!removedStoragePath) return { reset: true, removedPdf: false }

  // The Package is already clean: a PDF left behind in Storage is harmless.
  const removed = await deps.removeStoredFile(removedStoragePath).then(() => true, () => false)
  return { reset: true, removedPdf: removed }
}
