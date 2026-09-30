import {
  ensureDedicatedGoogleCalendar,
  exchangeGoogleAuthorizationCode,
  hashOAuthState,
} from '../_shared/googleCalendarOAuth.ts'
import { serviceClient } from '../_shared/supabase.ts'

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`)
  return value
}

function returnLocation(status: 'connected' | 'error', reason?: string) {
  const returnUrl = new URL(requiredEnv('GOOGLE_CALENDAR_RETURN_URL'))
  if (!['http:', 'https:'].includes(returnUrl.protocol)) {
    throw new Error('GOOGLE_CALENDAR_RETURN_URL must use HTTP or HTTPS.')
  }
  returnUrl.searchParams.set('google', status)
  if (reason) returnUrl.searchParams.set('reason', reason)
  return returnUrl.toString()
}

function redirect(status: 'connected' | 'error', reason?: string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: returnLocation(status, reason),
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

    const stateHash = await hashOAuthState(state)
    const admin = serviceClient()
    const consumedAt = new Date().toISOString()
    const { data: oauthState, error: stateError } = await admin
      .from('google_oauth_states')
      .update({ consumed_at: consumedAt })
      .eq('state_hash', stateHash)
      .is('consumed_at', null)
      .gt('expires_at', consumedAt)
      .select('user_id')
      .maybeSingle()

    if (stateError) throw stateError
    if (!oauthState) return redirect('error', 'invalid_state')

    if (requestUrl.searchParams.has('error')) {
      return redirect('error', 'access_denied')
    }

    const code = requestUrl.searchParams.get('code')
    if (!code) return redirect('error', 'missing_code')

    const clientId = requiredEnv('GOOGLE_CALENDAR_CLIENT_ID')
    const clientSecret = requiredEnv('GOOGLE_CALENDAR_CLIENT_SECRET')
    const redirectUri = requiredEnv('GOOGLE_CALENDAR_REDIRECT_URI')
    const tokens = await exchangeGoogleAuthorizationCode({
      clientId,
      clientSecret,
      redirectUri,
      code,
    })

    const { data: existingConnection, error: connectionError } = await admin
      .from('google_calendar_connections')
      .select('google_calendar_id')
      .eq('user_id', oauthState.user_id)
      .maybeSingle()
    if (connectionError) throw connectionError

    const calendar = await ensureDedicatedGoogleCalendar(
      tokens.accessToken,
      existingConnection?.google_calendar_id ?? null,
    )

    const { error: completeError } = await admin.rpc(
      'complete_google_calendar_connection',
      {
        p_user_id: oauthState.user_id,
        p_google_calendar_id: calendar.id,
        p_calendar_summary: calendar.summary,
        p_refresh_token: tokens.refreshToken,
        p_granted_scope: tokens.grantedScope,
      },
    )
    if (completeError) throw completeError

    return redirect('connected')
  } catch (error) {
    console.error('Google Calendar OAuth callback failed:', error)
    try {
      return redirect('error', 'oauth_failed')
    } catch {
      return new Response('Google Calendar OAuth failed.', {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }
})
