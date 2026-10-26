import {
  exchangeQuickbooksAuthorizationCode,
  fetchQuickbooksCompanyName,
  findQuickbooksItemByName,
  hashOAuthState,
  parseQuickbooksEnvironment,
  QUICKBOOKS_PRODUCT_NAME,
  QUICKBOOKS_SCOPE,
} from '../_shared/quickbooksOAuth.ts'
import { quickbooksClientCredentials } from '../_shared/quickbooksEnvironment.ts'
import { serviceClient } from '../_shared/supabase.ts'

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`)
  return value
}

function returnLocation(status: 'connected' | 'error', reason?: string, environment?: string) {
  const returnUrl = new URL(requiredEnv('QBO_RETURN_URL'))
  if (!['http:', 'https:'].includes(returnUrl.protocol)) {
    throw new Error('QBO_RETURN_URL must use HTTP or HTTPS.')
  }
  returnUrl.searchParams.set('quickbooks', status)
  if (reason) returnUrl.searchParams.set('reason', reason)
  if (environment) returnUrl.searchParams.set('environment', environment)
  return returnUrl.toString()
}

function redirect(status: 'connected' | 'error', reason?: string, environment?: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: returnLocation(status, reason, environment),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response('Use GET.', {
      status: 405,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  try {
    const requestUrl = new URL(req.url)
    const state = requestUrl.searchParams.get('state')
    if (!state) return redirect('error', 'invalid_state')

    // The one-time state is the trust boundary: nothing privileged happens
    // before this atomic consume succeeds.
    const stateHash = await hashOAuthState(state)
    const admin = serviceClient()
    const consumedAt = new Date().toISOString()
    const { data: oauthState, error: stateError } = await admin
      .from('quickbooks_oauth_states')
      .update({ consumed_at: consumedAt })
      .eq('state_hash', stateHash)
      .is('consumed_at', null)
      .gt('expires_at', consumedAt)
      .select('user_id, environment')
      .maybeSingle()

    if (stateError) throw stateError
    if (!oauthState) return redirect('error', 'invalid_state')

    if (requestUrl.searchParams.has('error')) return redirect('error', 'access_denied')

    const code = requestUrl.searchParams.get('code')
    if (!code) return redirect('error', 'missing_code')

    // Intuit returns the id of the company the administrator chose.
    const realmId = requestUrl.searchParams.get('realmId')
    if (!realmId) return redirect('error', 'missing_realm')

    // The environment that started this connection (Test or Production): it picks
    // the Intuit app keys and the QuickBooks host.
    const environment = parseQuickbooksEnvironment(oauthState.environment)
    const tokens = await exchangeQuickbooksAuthorizationCode({
      ...quickbooksClientCredentials(environment),
      redirectUri: requiredEnv('QBO_REDIRECT_URI'),
      code,
    })

    // Reading the company and the Product proves the tokens work before the
    // connection is recorded. A missing Product is reported, not fatal.
    const api = { environment, realmId, accessToken: tokens.accessToken }
    const companyName = await fetchQuickbooksCompanyName(api)
    const item = await findQuickbooksItemByName(api, QUICKBOOKS_PRODUCT_NAME)

    const { error: completeError } = await admin.rpc('complete_quickbooks_connection', {
      p_user_id: oauthState.user_id,
      p_realm_id: realmId,
      p_environment: environment,
      p_company_name: companyName,
      p_item_id: item?.id ?? null,
      p_item_name: item?.name ?? null,
      p_refresh_token: tokens.refreshToken,
      p_refresh_token_expires_at: tokens.refreshTokenExpiresAt?.toISOString() ?? null,
      p_granted_scope: QUICKBOOKS_SCOPE,
      p_last_error: item
        ? null
        : `The Product "${QUICKBOOKS_PRODUCT_NAME}" was not found in this QuickBooks company.`,
    })
    if (completeError) throw completeError

    return redirect(item ? 'connected' : 'error', item ? undefined : 'product_not_found', environment)
  } catch (error) {
    console.error('QuickBooks OAuth callback failed:', error)
    try {
      return redirect('error', 'oauth_failed')
    } catch {
      return new Response('QuickBooks OAuth failed.', {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }
})
