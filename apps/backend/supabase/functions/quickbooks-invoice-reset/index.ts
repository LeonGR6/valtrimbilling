import { handlePreflight, json } from '../_shared/cors.ts'
import { requireInvoiceUser, requirePackageId } from '../_shared/quickbooksAccess.ts'
import { resetTestInvoice } from '../_shared/quickbooksInvoiceReset.ts'
import { removeStoredFile } from '../_shared/quickbooksPdfStorage.ts'
import { serviceClient } from '../_shared/supabase.ts'

// What the database says when a Package cannot be reset: readable, and not a bug.
const REFUSALS = /Only a Test invoice|Only an unpaid Test Package|no QuickBooks attempt|still being created|no longer exists/u

function errorResponse(error: unknown) {
  const message = (error as Error).message
  if (REFUSALS.test(message)) return json({ code: 'NOT_RESETTABLE', error: message }, 409)
  console.error('QuickBooks test invoice reset failed:', error)
  return json({ code: 'INTERNAL', error: message }, 500)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const access = await requireInvoiceUser(req, 'move a Test invoice back to Production')
    if (access.user == null) return access.response
    const { user } = access

    const packageId = requirePackageId(await req.json().catch(() => null))
    if (packageId == null) return json({ error: 'packageId must be a positive whole number.' }, 400)

    const admin = serviceClient()
    const result = await resetTestInvoice({
      reset: async (id, reason) => {
        const { data, error } = await admin.rpc('reset_quickbooks_test_invoice', {
          p_package_id: id,
          p_user_id: user.id,
          p_reason: reason,
        })
        if (error) throw new Error(error.message)
        return { removedStoragePath: (data as { removed_storage_path: string | null }).removed_storage_path }
      },
      removeStoredFile: removeStoredFile(admin),
    }, packageId)

    return json(result)
  } catch (error) {
    return errorResponse(error)
  }
})
