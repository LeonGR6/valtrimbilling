import { handlePreflight, json } from '../_shared/cors.ts'
import { QuickbooksApiError, getQuickbooksInvoice, voidQuickbooksInvoice } from '../_shared/quickbooksApi.ts'
import { requireInvoiceUser, requirePackageId } from '../_shared/quickbooksAccess.ts'
import { QuickbooksInvoiceVoidError, voidPackageInvoice } from '../_shared/quickbooksInvoiceVoid.ts'
import { PackageNotFoundError } from '../_shared/quickbooksPackageSource.ts'
import { removeStoredFile } from '../_shared/quickbooksPdfStorage.ts'
import { openSessionFor } from '../_shared/quickbooksEnvironment.ts'
import { QuickbooksBusyError, QuickbooksNotConnectedError } from '../_shared/quickbooksSession.ts'
import { loadSyncContext } from '../_shared/quickbooksSyncContext.ts'
import { serviceClient } from '../_shared/supabase.ts'

function errorResponse(error: unknown) {
  if (error instanceof PackageNotFoundError) return json({ code: 'PACKAGE_NOT_FOUND', error: error.message }, 404)
  if (error instanceof QuickbooksNotConnectedError) return json({ code: 'NOT_CONNECTED', error: error.message }, 409)
  if (error instanceof QuickbooksBusyError) return json({ code: 'BUSY', error: error.message }, 503)
  if (error instanceof QuickbooksInvoiceVoidError) return json({ code: error.code, error: error.message }, 409)
  if (error instanceof QuickbooksApiError) return json({ code: 'QUICKBOOKS_ERROR', error: error.message }, 502)
  // The database refuses to void a paid or submitted Package with a readable message.
  const message = (error as Error).message
  if (/can have its invoice voided|has no created QuickBooks invoice/u.test(message)) {
    return json({ code: 'NOT_VOIDABLE', error: message }, 409)
  }
  console.error('QuickBooks invoice void failed:', error)
  return json({ code: 'INTERNAL', error: message }, 500)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const access = await requireInvoiceUser(req, 'void QuickBooks invoices')
    if (access.user == null) return access.response
    const { user } = access

    const packageId = requirePackageId(await req.json().catch(() => null))
    if (packageId == null) return json({ error: 'packageId must be a positive whole number.' }, 400)

    const admin = serviceClient()
    const result = await voidPackageInvoice({
      loadContext: (id) => loadSyncContext(admin, id),
      // The invoice is voided in the environment it was created in, whatever mode is active.
      openSession: (environment) => openSessionFor(admin, environment),
      getInvoice: (api, invoiceId) => getQuickbooksInvoice(api, invoiceId),
      voidInvoice: (api, invoice) => voidQuickbooksInvoice(api, invoice),
      markVoided: async (id) => {
        const { data, error } = await admin.rpc('void_quickbooks_invoice_sync', {
          p_package_id: id,
          p_user_id: user.id,
        })
        if (error) throw new Error(error.message)
        const row = data as { already: boolean; removed_storage_path: string | null }
        return { already: row.already, removedStoragePath: row.removed_storage_path }
      },
      removeStoredFile: removeStoredFile(admin),
    }, packageId)

    return json(result)
  } catch (error) {
    return errorResponse(error)
  }
})
