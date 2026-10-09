import { handlePreflight, json } from '../_shared/cors.ts'
import { QuickbooksApiError } from '../_shared/quickbooksApi.ts'
import { QuickbooksCustomerError } from '../_shared/quickbooksCustomer.ts'
import { QuickbooksInvoiceError } from '../_shared/quickbooksInvoice.ts'
import {
  createPackageInvoice,
  type ClaimResult,
  QuickbooksSyncConflictError,
  realDeps,
} from '../_shared/quickbooksInvoiceSync.ts'
import { loadPackageSource, PackageNotFoundError } from '../_shared/quickbooksPackageSource.ts'
import { openQuickbooksSession, QuickbooksNotConnectedError } from '../_shared/quickbooksSession.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`)
  return value
}

function rpcFailure(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function errorResponse(error: unknown) {
  if (error instanceof PackageNotFoundError) {
    return json({ code: 'PACKAGE_NOT_FOUND', error: error.message }, 404)
  }
  if (error instanceof QuickbooksNotConnectedError) {
    return json({ code: 'NOT_CONNECTED', error: error.message }, 409)
  }
  if (error instanceof QuickbooksSyncConflictError) {
    return json({ code: error.reason, error: error.message }, 409)
  }
  if (error instanceof QuickbooksInvoiceError) {
    return json({ code: error.code, error: error.message }, 422)
  }
  if (error instanceof QuickbooksCustomerError) {
    return json({ code: error.code, error: error.message, candidates: error.candidates }, 422)
  }
  if (error instanceof QuickbooksApiError) {
    return json({ code: 'QUICKBOOKS_ERROR', error: error.message }, 502)
  }
  console.error('QuickBooks invoice creation failed:', error)
  return json({ code: 'INTERNAL', error: (error as Error).message }, 500)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  try {
    const caller = userClient(req)
    const {
      data: { user },
      error: authError,
    } = await caller.auth.getUser()

    if (authError || !user) return json({ error: 'Sign in first.' }, 401)

    const { data: profile, error: profileError } = await caller
      .from('app_users')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) throw profileError
    if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
      return json({ error: 'Only an administrator or accounting user can create QuickBooks invoices.' }, 403)
    }

    const body = await req.json().catch(() => null)
    const packageId = body?.packageId
    if (!Number.isInteger(packageId) || packageId <= 0) {
      return json({ error: 'packageId must be a positive whole number.' }, 400)
    }
    if (body?.txnDate != null && !DATE_PATTERN.test(String(body.txnDate))) {
      return json({ error: 'txnDate must be YYYY-MM-DD.' }, 400)
    }
    const txnDate = body?.txnDate ?? new Date().toISOString().slice(0, 10)

    const admin = serviceClient()
    const credentials = {
      clientId: requiredEnv('QBO_CLIENT_ID'),
      clientSecret: requiredEnv('QBO_CLIENT_SECRET'),
    }

    const result = await createPackageInvoice(
      realDeps({
        loadPackage: (id) => loadPackageSource(admin, id),
        openSession: () => openQuickbooksSession(admin, credentials),
        getCustomerMapping: async (builderId, environment) => {
          const { data, error } = await admin
            .from('builder_quickbooks_customers')
            .select('customer_id, display_name')
            .eq('builder_id', builderId)
            .eq('environment', environment)
            .maybeSingle()
          if (error) throw error
          return data ? { customerId: data.customer_id, displayName: data.display_name } : null
        },
        saveCustomerMapping: async (builderId, environment, customer) => {
          const { error } = await admin.from('builder_quickbooks_customers').upsert({
            builder_id: builderId,
            environment,
            customer_id: customer.customerId,
            display_name: customer.displayName,
            created_by: user.id,
          })
          if (error) throw error
        },
        claim: async (id, environment, realmId) => {
          const { data, error } = await admin.rpc('claim_quickbooks_invoice_sync', {
            p_package_id: id,
            p_user_id: user.id,
            p_environment: environment,
            p_realm_id: realmId,
          })
          rpcFailure(error)
          return data as ClaimResult
        },
        complete: async (id, created, payload) => {
          const { error } = await admin.rpc('complete_quickbooks_invoice_sync', {
            p_package_id: id,
            p_qbo_invoice_id: created.id,
            p_qbo_doc_number: created.docNumber,
            p_qbo_sync_token: created.syncToken,
            p_total_amount: created.totalAmount,
            p_payload: payload,
          })
          rpcFailure(error)
        },
        fail: async (id, message, requestReusable) => {
          const { error } = await admin.rpc('fail_quickbooks_invoice_sync', {
            p_package_id: id,
            p_error: message,
            p_request_reusable: requestReusable,
          })
          rpcFailure(error)
        },
      }),
      { packageId, txnDate, dryRun: body?.dryRun === true },
    )

    return json(result)
  } catch (error) {
    return errorResponse(error)
  }
})
