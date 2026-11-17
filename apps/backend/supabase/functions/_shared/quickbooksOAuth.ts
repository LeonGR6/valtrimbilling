// QuickBooks Online OAuth 2.0: authorization url, code exchange and refresh.
//
// All network calls take an injectable `fetcher` so they can be tested without
// touching Intuit. State generation and hashing are shared with the Google flow.
// The accounting API helpers live in quickbooksApi.ts and are re-exported here.

export { createOAuthState, hashOAuthState } from './googleCalendarOAuth.ts'
export {
  fetchQuickbooksCompanyName,
  findQuickbooksItemByName,
  parseQuickbooksEnvironment,
  QUICKBOOKS_MINOR_VERSION,
  QUICKBOOKS_PRODUCT_NAME,
  quickbooksApiBaseUrl,
  quickbooksQueryLiteral,
} from './quickbooksApi.ts'
export type { QuickbooksEnvironment, QuickbooksItem } from './quickbooksApi.ts'

export const QUICKBOOKS_SCOPE = 'com.intuit.quickbooks.accounting'

const AUTHORIZATION_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

type Fetcher = typeof fetch

export interface QuickbooksTokens {
  accessToken: string
  refreshToken: string
  /** QuickBooks rotates the refresh token on every refresh. */
  refreshTokenExpiresAt: Date | null
}

export function buildQuickbooksAuthorizationUrl(
  { clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string },
) {
  const url = new URL(AUTHORIZATION_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', QUICKBOOKS_SCOPE)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url.toString()
}

async function jsonBody(response: Response) {
  return await response.json().catch(() => null) as Record<string, unknown> | null
}

function oauthError(operation: string, response: Response, body: Record<string, unknown> | null) {
  const detail = typeof body?.error_description === 'string'
    ? body.error_description
    : typeof body?.error === 'string'
    ? body.error
    : `HTTP ${response.status}`
  return new Error(`${operation} failed: ${detail}`)
}

async function requestTokens(
  operation: string,
  clientId: string,
  clientSecret: string,
  form: Record<string, string>,
  fetcher: Fetcher,
  now: () => Date,
): Promise<QuickbooksTokens> {
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  })
  const body = await jsonBody(response)

  if (!response.ok) throw oauthError(operation, response, body)

  const accessToken = body?.access_token
  const refreshToken = body?.refresh_token
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new Error(`${operation} failed: QuickBooks did not return both tokens.`)
  }

  const refreshSeconds = Number(body?.x_refresh_token_expires_in)
  return {
    accessToken,
    refreshToken,
    refreshTokenExpiresAt: Number.isFinite(refreshSeconds) && refreshSeconds > 0
      ? new Date(now().getTime() + refreshSeconds * 1000)
      : null,
  }
}

export function exchangeQuickbooksAuthorizationCode(
  options: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  fetcher: Fetcher = fetch,
  now: () => Date = () => new Date(),
) {
  return requestTokens(
    'QuickBooks OAuth token exchange',
    options.clientId,
    options.clientSecret,
    {
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
    },
    fetcher,
    now,
  )
}

export function refreshQuickbooksTokens(
  options: { clientId: string; clientSecret: string; refreshToken: string },
  fetcher: Fetcher = fetch,
  now: () => Date = () => new Date(),
) {
  return requestTokens(
    'QuickBooks token refresh',
    options.clientId,
    options.clientSecret,
    { grant_type: 'refresh_token', refresh_token: options.refreshToken },
    fetcher,
    now,
  )
}
