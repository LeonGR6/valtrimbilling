export const GOOGLE_CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.app.created'

export const GOOGLE_CALENDAR_SUMMARY = 'ValtrimBilling Test'
export const GOOGLE_CALENDAR_TIME_ZONE = 'America/Mexico_City'

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDARS_URL = 'https://www.googleapis.com/calendar/v3/calendars'

type Fetcher = typeof fetch

interface AuthorizationUrlOptions {
  clientId: string
  redirectUri: string
  state: string
}

interface ExchangeCodeOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}

interface GoogleTokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

export interface GoogleTokens {
  accessToken: string
  refreshToken: string
  grantedScope: string
}

export interface GoogleCalendar {
  id: string
  summary: string
  timeZone?: string
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

async function payload(response: Response) {
  return await response.json().catch(() => null) as Record<string, unknown> | null
}

function googleApiError(
  operation: string,
  response: Response,
  responsePayload: Record<string, unknown> | null,
) {
  const nestedError = responsePayload?.error
  const message = typeof nestedError === 'object' && nestedError
    && 'message' in nestedError && typeof nestedError.message === 'string'
    ? nestedError.message
    : typeof responsePayload?.error_description === 'string'
      ? responsePayload.error_description
      : `HTTP ${response.status}`

  return new Error(`${operation} failed: ${message}`)
}

export function createOAuthState() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export async function hashOAuthState(state: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(state),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function buildGoogleAuthorizationUrl({
  clientId,
  redirectUri,
  state,
}: AuthorizationUrlOptions) {
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL)
  authorizationUrl.searchParams.set('client_id', clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri)
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE)
  authorizationUrl.searchParams.set('access_type', 'offline')
  authorizationUrl.searchParams.set('include_granted_scopes', 'true')
  authorizationUrl.searchParams.set('prompt', 'consent')
  authorizationUrl.searchParams.set('state', state)
  return authorizationUrl.toString()
}

export async function exchangeGoogleAuthorizationCode(
  {
    clientId,
    clientSecret,
    redirectUri,
    code,
  }: ExchangeCodeOptions,
  fetcher: Fetcher = fetch,
): Promise<GoogleTokens> {
  const response = await fetcher(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
  })
  const responsePayload = await payload(response) as GoogleTokenPayload | null

  if (!response.ok) {
    throw googleApiError(
      'Google OAuth token exchange',
      response,
      responsePayload as Record<string, unknown> | null,
    )
  }

  if (!responsePayload?.access_token || !responsePayload.refresh_token) {
    throw new Error(
      'Google OAuth did not return offline credentials. Revoke the existing grant and connect again.',
    )
  }

  return {
    accessToken: responsePayload.access_token,
    refreshToken: responsePayload.refresh_token,
    grantedScope: responsePayload.scope || GOOGLE_CALENDAR_SCOPE,
  }
}

async function readCalendar(response: Response) {
  const responsePayload = await payload(response)
  if (!response.ok) return { responsePayload, calendar: null }

  const id = responsePayload?.id
  const summary = responsePayload?.summary
  if (typeof id !== 'string' || typeof summary !== 'string') {
    throw new Error('Google Calendar returned an invalid calendar resource.')
  }

  return {
    responsePayload,
    calendar: {
      id,
      summary,
      timeZone: typeof responsePayload?.timeZone === 'string'
        ? responsePayload.timeZone
        : undefined,
    } satisfies GoogleCalendar,
  }
}

export async function ensureDedicatedGoogleCalendar(
  accessToken: string,
  existingCalendarId: string | null,
  fetcher: Fetcher = fetch,
): Promise<GoogleCalendar> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  if (existingCalendarId) {
    const existingResponse = await fetcher(
      `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(existingCalendarId)}`,
      { headers },
    )
    const existing = await readCalendar(existingResponse)
    if (existing.calendar) return existing.calendar
    if (![404, 410].includes(existingResponse.status)) {
      throw googleApiError(
        'Reading the existing Google calendar',
        existingResponse,
        existing.responsePayload,
      )
    }
  }

  const createResponse = await fetcher(GOOGLE_CALENDARS_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      summary: GOOGLE_CALENDAR_SUMMARY,
      timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    }),
  })
  const created = await readCalendar(createResponse)
  if (!createResponse.ok || !created.calendar) {
    throw googleApiError(
      'Creating the dedicated Google calendar',
      createResponse,
      created.responsePayload,
    )
  }

  return created.calendar
}
