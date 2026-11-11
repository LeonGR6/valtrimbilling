// Edits a Package that already has a QuickBooks invoice and updates that same invoice.
//
// POST { packageId, action: "preview" | "apply" | "retry", selections, hardwareSelections,
//        releasedOptions, addedOptions, reason, notes }
//   or   { packageId, action: "preview" | "apply", difference: { description, amount, reason? } | null }
//        which only adds, changes or (null) takes off the manual DIFFERENCE line of the invoice
//   preview  what the edit would change and the new total; nothing is saved anywhere
//   apply    edits the Package, then sends the new lines to the same QuickBooks invoice
//   retry    sends again a change that is saved but did not reach QuickBooks

import { handlePreflight, json } from '../_shared/cors.ts'
import { QuickbooksApiError, readQuickbooksInvoice, updateQuickbooksInvoice } from '../_shared/quickbooksApi.ts'
import { requireInvoiceUser, requirePackageId } from '../_shared/quickbooksAccess.ts'
import { QuickbooksInvoiceError } from '../_shared/quickbooksInvoice.ts'
import {
  type InvoiceUpdateAction,
  type PackageEditResult,
  type DifferenceChangeResult,
  parseDifferenceRequest,
  parseEditRequest,
  QuickbooksInvoiceUpdateError,
  updatePackageInvoice,
} from '../_shared/quickbooksInvoiceUpdate.ts'
import { storeInvoicePdf } from '../_shared/quickbooksInvoicePdf.ts'
import { loadPackageSource, PackageNotFoundError } from '../_shared/quickbooksPackageSource.ts'
import { realPdfStoreDeps, removeStoredFile } from '../_shared/quickbooksPdfStorage.ts'
import { openSessionFor } from '../_shared/quickbooksEnvironment.ts'
import { QuickbooksBusyError, QuickbooksNotConnectedError } from '../_shared/quickbooksSession.ts'
import { loadUpdateContext } from '../_shared/quickbooksSyncContext.ts'
import { serviceClient } from '../_shared/supabase.ts'

const ACTIONS: InvoiceUpdateAction[] = ['preview', 'apply', 'retry']

// The edit function refuses with these codes and a message a person can read.
const REFUSAL_CODES = new Set(['23514', '23505', '23503', '42501', '55000', 'P0002'])

class EditRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditRefusedError'
  }
}

function errorResponse(error: unknown) {
  if (error instanceof PackageNotFoundError) return json({ code: 'PACKAGE_NOT_FOUND', error: error.message }, 404)
  if (error instanceof QuickbooksNotConnectedError) return json({ code: 'NOT_CONNECTED', error: error.message }, 409)
  if (error instanceof QuickbooksBusyError) return json({ code: 'BUSY', error: error.message }, 503)
  if (error instanceof QuickbooksInvoiceUpdateError) {
    return json({ code: error.code, error: error.message }, error.code === 'INVALID_REQUEST' ? 400 : 409)
  }
  if (error instanceof EditRefusedError) return json({ code: 'EDIT_REFUSED', error: error.message }, 409)
  if (error instanceof QuickbooksInvoiceError) return json({ code: error.code, error: error.message }, 422)
  if (error instanceof QuickbooksApiError) return json({ code: 'QUICKBOOKS_ERROR', error: error.message }, 502)
  console.error('QuickBooks invoice update failed:', error)
  return json({ code: 'INTERNAL', error: (error as Error).message }, 500)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const access = await requireInvoiceUser(req, 'edit invoiced Packages')
    if (access.user == null) return access.response
    const { user } = access

    const body = await req.json().catch(() => null)
    const packageId = requirePackageId(body)
    if (packageId == null) return json({ error: 'packageId must be a positive whole number.' }, 400)

    const action = (body as { action?: unknown }).action
    if (typeof action !== 'string' || !ACTIONS.includes(action as InvoiceUpdateAction)) {
      return json({ error: 'action must be "preview", "apply" or "retry".' }, 400)
    }

    // A body with a `difference` and no cells only changes that line of the invoice.
    const differenceChange = action === 'retry' ? null : parseDifferenceRequest(body)

    const admin = serviceClient()
    const result = await updatePackageInvoice({
      loadContext: (id) => loadUpdateContext(admin, id),
      // The invoice is updated in the environment it was created in, whatever mode is active.
      openSession: (environment) => openSessionFor(admin, environment),
      readInvoice: (api, invoiceId) => readQuickbooksInvoice(api, invoiceId),
      applyEdit: async (id, request, dryRun) => {
        const { data, error } = await admin.rpc('edit_invoiced_draw_package', {
          p_actor_id: user.id,
          p_package_id: id,
          p_selections: request.selections,
          p_hardware_selections: request.hardwareSelections,
          p_released_options: request.releasedOptions,
          p_added_options: request.addedOptions,
          p_reason: request.reason,
          p_notes: request.notes,
          p_dry_run: dryRun,
        })
        if (error) {
          if (REFUSAL_CODES.has(error.code)) throw new EditRefusedError(error.message)
          throw new Error(error.message)
        }
        return data as PackageEditResult
      },
      applyDifference: async (id, difference, dryRun) => {
        const { data, error } = await admin.rpc('set_invoice_difference', {
          p_actor_id: user.id,
          p_package_id: id,
          p_description: difference?.description ?? null,
          p_amount: difference?.amount ?? null,
          p_reason: difference?.reason ?? null,
          p_dry_run: dryRun,
        })
        if (error) {
          if (REFUSAL_CODES.has(error.code)) throw new EditRefusedError(error.message)
          throw new Error(error.message)
        }
        return data as DifferenceChangeResult
      },
      removeStoredFile: removeStoredFile(admin),
      loadPackage: (id) => loadPackageSource(admin, id),
      updateInvoice: (api, invoice, requestId) => updateQuickbooksInvoice(api, invoice, requestId),
      complete: async (id, updated, payload) => {
        const { error } = await admin.rpc('complete_quickbooks_invoice_update', {
          p_package_id: id,
          p_qbo_sync_token: updated.syncToken,
          p_total_amount: updated.totalAmount,
          p_payload: payload,
        })
        if (error) throw new Error(error.message)
      },
      fail: async (id, message, requestReusable) => {
        const { error } = await admin.rpc('fail_quickbooks_invoice_update', {
          p_package_id: id,
          p_error: message,
          p_request_reusable: requestReusable,
        })
        if (error) throw new Error(error.message)
      },
      saveInvoicePdf: (api, input) =>
        storeInvoicePdf(realPdfStoreDeps(admin, user.id), { api, ...input }).then(() => undefined),
    }, {
      packageId,
      action: action as InvoiceUpdateAction,
      edit: action === 'retry' || differenceChange ? undefined : parseEditRequest(body),
      differenceChange: differenceChange ?? undefined,
    })

    return json(result)
  } catch (error) {
    return errorResponse(error)
  }
})
