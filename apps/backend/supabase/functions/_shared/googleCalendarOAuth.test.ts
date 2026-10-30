import { assert, assertEquals, assertMatch } from '@std/assert'
import {
  buildGoogleAuthorizationUrl,
  ensureDedicatedGoogleCalendar,
  exchangeGoogleAuthorizationCode,
  GOOGLE_CALENDAR_SCOPE,
  hashOAuthState,
} from './googleCalendarOAuth.ts'

Deno.test('builds an offline Google authorization URL with state', () => {
  const result = new URL(buildGoogleAuthorizationUrl({
    clientId: 'client-id',
    redirectUri: 'https://example.supabase.co/functions/v1/callback',
    state: 'opaque-state',
  }))

  assertEquals(result.origin, 'https://accounts.google.com')
  assertEquals(result.searchParams.get('scope'), GOOGLE_CALENDAR_SCOPE)
  assertEquals(result.searchParams.get('access_type'), 'offline')
  assertEquals(result.searchParams.get('prompt'), 'consent')
  assertEquals(result.searchParams.get('state'), 'opaque-state')
})

Deno.test('hashes OAuth state without retaining the original value', async () => {
  const digest = await hashOAuthState('opaque-state')
  assertMatch(digest, /^[0-9a-f]{64}$/u)
  assertEquals(digest, await hashOAuthState('opaque-state'))
})

Deno.test('exchanges an authorization code for offline credentials', async () => {
  const calls: Array<{ url: string; body: string }> = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body) })
    return Promise.resolve(Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      scope: GOOGLE_CALENDAR_SCOPE,
    }))
  }) as typeof fetch

  const tokens = await exchangeGoogleAuthorizationCode({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://example.supabase.co/functions/v1/callback',
    code: 'authorization-code',
  }, fetcher)

  assertEquals(tokens.refreshToken, 'refresh-token')
  assertEquals(calls.length, 1)
  assert(calls[0].body.includes('grant_type=authorization_code'))
})

Deno.test('reuses an accessible dedicated calendar', async () => {
  const calls: string[] = []
  const fetcher = ((input: string | URL | Request) => {
    calls.push(String(input))
    return Promise.resolve(Response.json({
      id: 'existing@group.calendar.google.com',
      summary: 'ValtrimBilling Test',
      timeZone: 'America/Mexico_City',
    }))
  }) as typeof fetch

  const calendar = await ensureDedicatedGoogleCalendar(
    'access-token',
    'existing@group.calendar.google.com',
    fetcher,
  )

  assertEquals(calendar.id, 'existing@group.calendar.google.com')
  assertEquals(calls.length, 1)
})

Deno.test('creates a dedicated calendar when no connection exists', async () => {
  const calls: Array<{ url: string; method: string | undefined }> = []
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method })
    return Promise.resolve(Response.json({
      id: 'new@group.calendar.google.com',
      summary: 'ValtrimBilling Test',
      timeZone: 'America/Mexico_City',
    }))
  }) as typeof fetch

  const calendar = await ensureDedicatedGoogleCalendar(
    'access-token',
    null,
    fetcher,
  )

  assertEquals(calendar.id, 'new@group.calendar.google.com')
  assertEquals(calls, [{
    url: 'https://www.googleapis.com/calendar/v3/calendars',
    method: 'POST',
  }])
})
