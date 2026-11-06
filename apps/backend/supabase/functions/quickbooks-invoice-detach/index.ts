import { handlePreflight, json } from '../_shared/cors.ts'
import { requireInvoiceUser, requirePackageId } from '../_shared/quickbooksAccess.ts'
import { detachVoidedInvoice } from '../_shared/quickbooksInvoiceDetach.ts'
import { removeStoredFile } from '../_shared/quickbooksPdfStorage.ts'
import { serviceClient } from '../_shared/supabase.ts'

// What the database says when a Package cannot get a new invoice: readable, and not a bug.
const REFUSALS = /get a new invoice|no longer exists/u

function errorResponse(error: unknown) {
  const message = (error as Error).message
  if (REFUSALS.test(message)) return json({ code: 'NOT_DETACHABLE', error: message }, 409)
  console.error('QuickBooks voided invoice detach failed:', error)
  return json({ code: 'INTERNAL', error: message }, 500)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const access = await requireInvoiceUser(req, 'create a new invoice for a Package with a voided one')
    if (access.user == null) return access.response
    const { user } = access

    const packageId = requirePackageId(await req.json().catch(() => null))
    if (packageId == null) return json({ error: 'packageId must be a positive whole number.' }, 400)

    const admin = serviceClient()
    const result = await detachVoidedInvoice({
      detach: async (id) => {
        const { data, error } = await admin.rpc('detach_voided_quickbooks_invoice', {
          p_package_id: id,
          p_user_id: user.id,
        })
        if (error) throw new Error(error.message)
        const detached = data as {
          removed_storage_path: string | null
          voided_invoice_number: string | null
        }
        return {
          removedStoragePath: detached.removed_storage_path,
          voidedInvoiceNumber: detached.voided_invoice_number,
        }
      },
      removeStoredFile: removeStoredFile(admin),
    }, packageId)

    return json(result)
  } catch (error) {
    return errorResponse(error)
  }
})
