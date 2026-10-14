import { assertEquals, assertRejects } from '@std/assert'
import {
  openQuickbooksSession,
  QuickbooksBusyError,
  QuickbooksNotConnectedError,
  type RpcClient,
} from './quickbooksSession.ts'

const credentials = { clientId: 'id', clientSecret: 'secret' }

interface Script {
  stored?: unknown
  lease?: string[]
  rotateError?: string | null
}

function fakeAdmin({ stored, lease = ['ACQUIRED'], rotateError = null }: Script) {
  const calls: { name: string; args?: Record<string, unknown> }[] = []
  const answers = [...lease]
  const admin: RpcClient = {
    rpc(name, args) {
      calls.push({ name, args })
      if (name === 'acquire_quickbooks_token_lease') {
        return Promise.resolve({ data: answers.shift() ?? lease.at(-1), error: null })
      }
      if (name === 'get_quickbooks_credentials') return Promise.resolve({ data: stored, error: null })
      if (name === 'rotate_quickbooks_refresh_token') {
        return Promise.resolve({ data: true, error: rotateError ? { message: rotateError } : null })
      }
      return Promise.resolve({ data: true, error: null })
    },
  }
  return { admin, calls, names: () => calls.map((call) => call.name) }
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

const options = {
  fetcher: tokenFetcher,
  now: () => new Date('2026-10-09T12:00:00.000Z'),
  newOwner: () => 'owner-1',
  sleep: () => Promise.resolve(),
}

Deno.test('takes the lease, refreshes, stores the rotated token and releases the lease', async () => {
  const { admin, calls, names } = fakeAdmin({ stored })

  const session = await openQuickbooksSession(admin, credentials, options)

  assertEquals(session, {
    environment: 'sandbox',
    realmId: '9341',
    itemId: '19',
    accessToken: 'fresh-access',
  })
  assertEquals(names(), [
    'acquire_quickbooks_token_lease',
    'get_quickbooks_credentials',
    'rotate_quickbooks_refresh_token',
    'release_quickbooks_token_lease',
  ])
  assertEquals(calls[2].args, {
    p_refresh_token: 'rotated-refresh',
    p_refresh_token_expires_at: '2026-10-10T12:00:00.000Z',
  })
  assertEquals(calls[3].args, { p_owner: 'owner-1' })
})

Deno.test('waits its turn while another request holds the lease', async () => {
  const sleeps: number[] = []
  const { admin, names } = fakeAdmin({ stored, lease: ['BUSY', 'BUSY', 'ACQUIRED'] })

  await openQuickbooksSession(admin, credentials, {
    ...options,
    pollMilliseconds: 100,
    sleep: (milliseconds) => {
      sleeps.push(milliseconds)
      return Promise.resolve()
    },
  })

  assertEquals(sleeps, [100, 100])
  assertEquals(names().filter((name) => name === 'acquire_quickbooks_token_lease').length, 3)
})

Deno.test('gives up with a clear error when the lease never frees up, without refreshing', async () => {
  const { admin, names } = fakeAdmin({ stored, lease: ['BUSY'] })

  await assertRejects(
    () => openQuickbooksSession(admin, credentials, { ...options, waitMilliseconds: 500, pollMilliseconds: 250 }),
    QuickbooksBusyError,
  )

  assertEquals(names().includes('get_quickbooks_credentials'), false)
  assertEquals(names().includes('release_quickbooks_token_lease'), false)
})

Deno.test('fails when QuickBooks is not connected', async () => {
  await assertRejects(
    () => openQuickbooksSession(fakeAdmin({ lease: ['NOT_CONNECTED'] }).admin, credentials, options),
    QuickbooksNotConnectedError,
  )
  await assertRejects(
    () => openQuickbooksSession(fakeAdmin({ stored: null }).admin, credentials, options),
    QuickbooksNotConnectedError,
  )
})

Deno.test('releases the lease even when the refresh or the storing fails', async () => {
  const failing = fakeAdmin({ stored, rotateError: 'vault down' })
  await assertRejects(
    () => openQuickbooksSession(failing.admin, credentials, options),
    Error,
    'Could not store the rotated QuickBooks refresh token: vault down',
  )
  assertEquals(failing.names().at(-1), 'release_quickbooks_token_lease')

  const rejected = fakeAdmin({ stored })
  await assertRejects(
    () =>
      openQuickbooksSession(rejected.admin, credentials, {
        ...options,
        fetcher: (() =>
          Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))) as typeof fetch,
      }),
    Error,
    'invalid_grant',
  )
  assertEquals(rejected.names().at(-1), 'release_quickbooks_token_lease')
})
