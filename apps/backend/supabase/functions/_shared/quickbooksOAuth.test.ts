import { assertEquals, assertRejects } from '@std/assert'
import {
  buildQuickbooksAuthorizationUrl,
  exchangeQuickbooksAuthorizationCode,
  fetchQuickbooksCompanyName,
  findQuickbooksItemByName,
  parseQuickbooksEnvironment,
  quickbooksApiBaseUrl,
  quickbooksQueryLiteral,
  refreshQuickbooksTokens,
} from './quickbooksOAuth.ts'

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const now = () => new Date('2026-10-09T12:00:00.000Z')

interface Captured {
  url: string
  init?: RequestInit
}

function recordingFetcher(response: Response) {
  const calls: Captured[] = []
  const fetcher = ((input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return Promise.resolve(response)
  }) as typeof fetch
  return { fetcher, calls }
}

Deno.test('builds the Intuit authorization url with the accounting scope and state', () => {
  const url = new URL(
    buildQuickbooksAuthorizationUrl({
      clientId: 'client-1',
      redirectUri: 'https://example.test/callback',
      state: 'opaque-state',
    }),
  )

  assertEquals(url.origin + url.pathname, 'https://appcenter.intuit.com/connect/oauth2')
  assertEquals(url.searchParams.get('client_id'), 'client-1')
  assertEquals(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting')
  assertEquals(url.searchParams.get('redirect_uri'), 'https://example.test/callback')
  assertEquals(url.searchParams.get('response_type'), 'code')
  assertEquals(url.searchParams.get('state'), 'opaque-state')
})

Deno.test('exchanges the code with Basic client authentication', async () => {
  const { fetcher, calls } = recordingFetcher(
    reply({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      x_refresh_token_expires_in: 8726400,
    }),
  )

  const tokens = await exchangeQuickbooksAuthorizationCode(
    { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x.test/cb', code: 'abc' },
    fetcher,
    now,
  )

  assertEquals(tokens, {
    accessToken: 'access',
    refreshToken: 'refresh',
    refreshTokenExpiresAt: new Date('2027-01-18T12:00:00.000Z'),
  })
  assertEquals(calls[0].url, 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
  const headers = calls[0].init?.headers as Record<string, string>
  assertEquals(headers.Authorization, `Basic ${btoa('id:secret')}`)
  const form = calls[0].init?.body as URLSearchParams
  assertEquals(form.get('grant_type'), 'authorization_code')
  assertEquals(form.get('code'), 'abc')
  assertEquals(form.get('redirect_uri'), 'https://x.test/cb')
})

Deno.test('refresh returns the rotated refresh token', async () => {
  const { fetcher, calls } = recordingFetcher(
    reply({ access_token: 'new-access', refresh_token: 'rotated', x_refresh_token_expires_in: 100 }),
  )

  const tokens = await refreshQuickbooksTokens(
    { clientId: 'id', clientSecret: 'secret', refreshToken: 'old' },
    fetcher,
    now,
  )

  assertEquals(tokens.refreshToken, 'rotated')
  const form = calls[0].init?.body as URLSearchParams
  assertEquals(form.get('grant_type'), 'refresh_token')
  assertEquals(form.get('refresh_token'), 'old')
})

Deno.test('token errors surface the Intuit description and incomplete replies are rejected', async () => {
  await assertRejects(
    () =>
      refreshQuickbooksTokens(
        { clientId: 'id', clientSecret: 's', refreshToken: 'old' },
        recordingFetcher(reply({ error: 'invalid_grant', error_description: 'Token expired' }, 400))
          .fetcher,
      ),
    Error,
    'QuickBooks token refresh failed: Token expired',
  )

  await assertRejects(
    () =>
      exchangeQuickbooksAuthorizationCode(
        { clientId: 'id', clientSecret: 's', redirectUri: 'u', code: 'c' },
        recordingFetcher(reply({ access_token: 'only-access' })).fetcher,
      ),
    Error,
    'did not return both tokens',
  )
})

Deno.test('picks the sandbox or production API host', () => {
  assertEquals(quickbooksApiBaseUrl('sandbox'), 'https://sandbox-quickbooks.api.intuit.com')
  assertEquals(quickbooksApiBaseUrl('production'), 'https://quickbooks.api.intuit.com')
  assertEquals(parseQuickbooksEnvironment('sandbox'), 'sandbox')
  try {
    parseQuickbooksEnvironment('prod')
    throw new Error('should have rejected')
  } catch (error) {
    assertEquals((error as Error).message, 'QBO_ENVIRONMENT must be "sandbox" or "production".')
  }
})

Deno.test('escapes quotes in QuickBooks query literals', () => {
  assertEquals(quickbooksQueryLiteral('Material Installation & Supply'), "'Material Installation & Supply'")
  assertEquals(quickbooksQueryLiteral("O'Brien"), "'O\\'Brien'")
})

Deno.test('reads the company name from the sandbox company', async () => {
  const { fetcher, calls } = recordingFetcher(reply({ CompanyInfo: { CompanyName: 'Sandbox Co' } }))

  const name = await fetchQuickbooksCompanyName(
    { environment: 'sandbox', realmId: '9341', accessToken: 'tok' },
    fetcher,
  )

  assertEquals(name, 'Sandbox Co')
  const url = new URL(calls[0].url)
  assertEquals(url.origin, 'https://sandbox-quickbooks.api.intuit.com')
  assertEquals(url.pathname, '/v3/company/9341/companyinfo/9341')
  assertEquals(url.searchParams.get('minorversion'), '75')
  assertEquals((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer tok')
})

Deno.test('finds the Product by name and returns null when it does not exist', async () => {
  const found = recordingFetcher(reply({ QueryResponse: { Item: [{ Id: '19', Name: 'Material Installation & Supply' }] } }))
  const item = await findQuickbooksItemByName(
    { environment: 'sandbox', realmId: '9341', accessToken: 'tok' },
    'Material Installation & Supply',
    found.fetcher,
  )

  assertEquals(item, { id: '19', name: 'Material Installation & Supply' })
  assertEquals(
    new URL(found.calls[0].url).searchParams.get('query'),
    "select Id, Name from Item where Name = 'Material Installation & Supply'",
  )

  const missing = await findQuickbooksItemByName(
    { environment: 'sandbox', realmId: '9341', accessToken: 'tok' },
    'Nope',
    recordingFetcher(reply({ QueryResponse: {} })).fetcher,
  )
  assertEquals(missing, null)
})

Deno.test('API faults report the QuickBooks detail', async () => {
  await assertRejects(
    () =>
      fetchQuickbooksCompanyName(
        { environment: 'production', realmId: '1', accessToken: 'bad' },
        recordingFetcher(
          reply({ Fault: { Error: [{ Message: 'AuthenticationFailed', Detail: 'Token invalid' }] } }, 401),
        ).fetcher,
      ),
    Error,
    'Reading the QuickBooks company failed: Token invalid',
  )
})
