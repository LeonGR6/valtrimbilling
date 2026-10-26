import { handlePreflight, json } from '../_shared/cors.ts'
import {
  buildQuickbooksAuthorizationUrl,
  createOAuthState,
  hashOAuthState,
} from '../_shared/quickbooksOAuth.ts'
import { environmentOrNull, quickbooksClientCredentials } from '../_shared/quickbooksEnvironment.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

const STATE_LIFETIME_MS = 10 * 60 * 1000

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`)
  return value
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
    if (!profile?.is_active || profile.role !== 'ADMIN') {
      return json({ error: 'Only an administrator can connect QuickBooks.' }, 403)
    }

    // Which QuickBooks to connect: Test (sandbox) or Production. It is remembered
    // with the one-time state, because Intuit's callback carries only the code.
    const body = await req.json().catch(() => null)
    const environment = environmentOrNull(body?.environment)
    if (!environment) {
      return json({ error: 'environment must be "sandbox" or "production".' }, 400)
    }

    const { clientId } = quickbooksClientCredentials(environment)
    const redirectUri = requiredEnv('QBO_REDIRECT_URI')
    const state = createOAuthState()
    const stateHash = await hashOAuthState(state)
    const admin = serviceClient()
    const now = new Date()

    const { error: cleanupError } = await admin
      .from('quickbooks_oauth_states')
      .delete()
      .eq('user_id', user.id)
      .or(`expires_at.lt.${now.toISOString()},consumed_at.not.is.null`)
    if (cleanupError) throw cleanupError

    const { error: insertError } = await admin
      .from('quickbooks_oauth_states')
      .insert({
        state_hash: stateHash,
        user_id: user.id,
        environment,
        expires_at: new Date(now.getTime() + STATE_LIFETIME_MS).toISOString(),
      })
    if (insertError) throw insertError

    return json({
      authorizationUrl: buildQuickbooksAuthorizationUrl({ clientId, redirectUri, state }),
    })
  } catch (error) {
    console.error('QuickBooks OAuth start failed:', error)
    return json({ error: (error as Error).message }, 500)
  }
})
