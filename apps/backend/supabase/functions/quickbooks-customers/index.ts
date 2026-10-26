import { handlePreflight, json } from '../_shared/cors.ts'
import { findQuickbooksCustomers, getQuickbooksCustomer, QuickbooksApiError } from '../_shared/quickbooksApi.ts'
import {
  handleCustomerAction,
  parseCustomerAdminInput,
  QuickbooksCustomerAdminError,
} from '../_shared/quickbooksCustomerAdmin.ts'
import { loadActiveEnvironment, openSessionFor } from '../_shared/quickbooksEnvironment.ts'
import { QuickbooksBusyError, QuickbooksNotConnectedError } from '../_shared/quickbooksSession.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const ALLOWED_ROLES = ['ADMIN', 'ACCOUNTING']

function errorResponse(error: unknown) {
  if (error instanceof QuickbooksCustomerAdminError) {
    const status = error.code === 'INVALID_INPUT' ? 400 : error.code === 'NOT_CONNECTED' ? 409 : 422
    return json({ code: error.code, error: error.message }, status)
  }
  if (error instanceof QuickbooksNotConnectedError) {
    return json({ code: 'NOT_CONNECTED', error: error.message }, 409)
  }
  if (error instanceof QuickbooksBusyError) return json({ code: 'BUSY', error: error.message }, 503)
  if (error instanceof QuickbooksApiError) {
    return json({ code: 'QUICKBOOKS_ERROR', error: error.message }, 502)
  }
  console.error('QuickBooks customers request failed:', error)
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
      return json({ error: 'Only an administrator or accounting user can manage QuickBooks customers.' }, 403)
    }

    const input = parseCustomerAdminInput(await req.json().catch(() => null))
    const admin = serviceClient()

    const result = await handleCustomerAction({
      // Customers are linked for the environment the platform is set to; null when
      // that one is not connected.
      getEnvironment: async () => {
        const environment = await loadActiveEnvironment(admin)
        const { data, error } = await admin
          .from('quickbooks_connections')
          .select('status')
          .eq('environment', environment)
          .maybeSingle()
        if (error) throw error
        return data?.status === 'CONNECTED' ? environment : null
      },
      openApi: async () => {
        const session = await openSessionFor(admin, await loadActiveEnvironment(admin))
        return {
          environment: session.environment,
          realmId: session.realmId,
          accessToken: session.accessToken,
        }
      },
      searchCustomers: (api, query) => findQuickbooksCustomers(api, query),
      getCustomer: (api, customerId) => getQuickbooksCustomer(api, customerId),
      saveMapping: async (builderId, environment, customer) => {
        const { error } = await admin.from('builder_quickbooks_customers').upsert({
          builder_id: builderId,
          environment,
          customer_id: customer.customerId,
          display_name: customer.displayName,
          created_by: user.id,
        })
        if (error) throw error
      },
      deleteMapping: async (builderId, environment) => {
        const { data, error } = await admin
          .from('builder_quickbooks_customers')
          .delete()
          .eq('builder_id', builderId)
          .eq('environment', environment)
          .select('builder_id')
        if (error) throw error
        return (data?.length ?? 0) > 0
      },
    }, input)

    return json(result)
  } catch (error) {
    return errorResponse(error)
  }
})
