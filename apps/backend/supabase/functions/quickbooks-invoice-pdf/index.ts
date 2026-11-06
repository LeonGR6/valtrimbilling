import { handlePreflight, json } from '../_shared/cors.ts'
import { QuickbooksApiError } from '../_shared/quickbooksApi.ts'
import { requireInvoiceUser, requirePackageId } from '../_shared/quickbooksAccess.ts'
import { QuickbooksInvoicePdfError, saveInvoicePdfForPackage } from '../_shared/quickbooksInvoicePdf.ts'
import { PackageNotFoundError } from '../_shared/quickbooksPackageSource.ts'
import { realPdfStoreDeps } from '../_shared/quickbooksPdfStorage.ts'
import { openSessionFor } from '../_shared/quickbooksEnvironment.ts'
import { QuickbooksBusyError, QuickbooksNotConnectedError } from '../_shared/quickbooksSession.ts'
import { loadSyncContext } from '../_shared/quickbooksSyncContext.ts'
import { serviceClient } from '../_shared/supabase.ts'

function errorResponse(error: unknown) {
  if (error instanceof PackageNotFoundError) return json({ code: 'PACKAGE_NOT_FOUND', error: error.message }, 404)
  if (error instanceof QuickbooksNotConnectedError) return json({ code: 'NOT_CONNECTED', error: error.message }, 409)
  if (error instanceof QuickbooksBusyError) return json({ code: 'BUSY', error: error.message }, 503)
  if (error instanceof QuickbooksInvoicePdfError) return json({ code: error.code, error: error.message }, 409)
  if (error instanceof QuickbooksApiError) return json({ code: 'QUICKBOOKS_ERROR', error: error.message }, 502)
  console.error('QuickBooks invoice PDF failed:', error)
  return json({ code: 'INTERNAL', error: (error as Error).message }, 500)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const access = await requireInvoiceUser(req, 'save QuickBooks invoice PDFs')
    if (access.user == null) return access.response
    const { user } = access

    const packageId = requirePackageId(await req.json().catch(() => null))
    if (packageId == null) return json({ error: 'packageId must be a positive whole number.' }, 400)

    const admin = serviceClient()
    const stored = await saveInvoicePdfForPackage({
      ...realPdfStoreDeps(admin, user.id),
      loadContext: (id) => loadSyncContext(admin, id),
      // The PDF comes from the environment the invoice was created in.
      openSession: (environment) => openSessionFor(admin, environment),
    }, packageId)

    return json(stored)
  } catch (error) {
    return errorResponse(error)
  }
})
