import { assertEquals, assertRejects } from '@std/assert'
import {
  openQuickbooksSession,
  QuickbooksNotConnectedError,
  type RpcClient,
} from './quickbooksSession.ts'

const credentials = { clientId: 'id', clientSecret: 'secret' }

function fakeAdmin(stored: unknown, rotateError: string | null = null) {
  const calls: { name: string; args?: Record<string, unknown> }[] = []
  const admin: RpcClient = {
    rpc(name, args) {
      calls.push({ name, args })
      if (name === 'get_quickbooks_credentials') {
        return Promise.resolve({ data: stored, error: null })
      }
      return Promise.resolve({
        data: true,
        error: rotateError ? { message: rotateError } : null,
      })
    },
  }
  return { admin, calls }
}

const tokenFetcher = (() =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        access_token: 'fresh-access',
        refresh_token: 'rotated-refresh',
        x_refresh_token_expires_in: 86400,
      }),
      { status: 200 },
    ),
  )) as typeof fetch

const stored = {
  realmId: '9341',
  environment: 'sandbox',
  itemId: '19',
  refreshToken: 'old-refresh',
}

Deno.test('refreshes the access token and stores the rotated refresh token', async () => {
  const { admin, calls } = fakeAdmin(stored)

  const session = await openQuickbooksSession(
    admin,
    credentials,
    tokenFetcher,
    () => new Date('2026-10-09T12:00:00.000Z'),
  )

  assertEquals(session, {
    environment: 'sandbox',
    realmId: '9341',
    itemId: '19',
    accessToken: 'fresh-access',
  })
  assertEquals(calls.map((call) => call.name), [
    'get_quickbooks_credentials',
    'rotate_quickbooks_refresh_token',
  ])
  assertEquals(calls[1].args, {
    p_refresh_token: 'rotated-refresh',
    p_refresh_token_expires_at: '2026-10-10T12:00:00.000Z',
  })
})

Deno.test('fails when QuickBooks is not connected', async () => {
  await assertRejects(
    () => openQuickbooksSession(fakeAdmin(null).admin, credentials, tokenFetcher),
    QuickbooksNotConnectedError,
  )
})

Deno.test('fails instead of losing the rotated token when it cannot be stored', async () => {
  await assertRejects(
    () => openQuickbooksSession(fakeAdmin(stored, 'vault down').admin, credentials, tokenFetcher),
    Error,
    'Could not store the rotated QuickBooks refresh token: vault down',
  )
})
