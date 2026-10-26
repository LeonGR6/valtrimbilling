// Opens a QuickBooks API session: reads the stored credentials, trades the
// refresh token for an access token and persists the rotated refresh token.
//
// QuickBooks issues a new refresh token on every refresh, so storing it is part
// of opening the session, not an afterthought. If it cannot be stored the call
// fails instead of silently losing the new token.
//
// Refreshing is serialized with a short database lease: two requests that
// refresh together would both start from the same stored token, and the one
// finishing last would overwrite the other's newer one. Each environment (Test
// and Production) has its own connection, token and lease.

import {
  parseQuickbooksEnvironment,
  type QuickbooksEnvironment,
  refreshQuickbooksTokens,
} from './quickbooksOAuth.ts'

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>

export interface RpcClient {
  rpc(name: string, args?: Record<string, unknown>): RpcResult
}

export interface QuickbooksSession {
  environment: QuickbooksEnvironment
  realmId: string
  itemId: string | null
  accessToken: string
}

export class QuickbooksNotConnectedError extends Error {
  readonly environment: QuickbooksEnvironment | null

  constructor(environment: QuickbooksEnvironment | null = null) {
    const label = environment === 'production' ? 'Production ' : environment === 'sandbox' ? 'Test ' : ''
    super(`QuickBooks ${label}is not connected. An administrator must connect it first.`)
    this.name = 'QuickbooksNotConnectedError'
    this.environment = environment
  }
}

export class QuickbooksBusyError extends Error {
  constructor() {
    super('QuickBooks is busy with another request. Try again in a few seconds.')
    this.name = 'QuickbooksBusyError'
  }
}

export interface SessionOptions {
  fetcher?: typeof fetch
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  newOwner?: () => string
  /** Seconds the lease lasts if the holder dies before releasing it. */
  leaseSeconds?: number
  /** How long to wait for another request to finish refreshing. */
  waitMilliseconds?: number
  pollMilliseconds?: number
}

async function acquireLease(
  admin: RpcClient,
  environment: QuickbooksEnvironment,
  owner: string,
  options: Required<
    Pick<SessionOptions, 'sleep' | 'leaseSeconds' | 'waitMilliseconds' | 'pollMilliseconds'>
  >,
) {
  let waited = 0
  for (;;) {
    const { data, error } = await admin.rpc('acquire_quickbooks_token_lease', {
      p_owner: owner,
      p_environment: environment,
      p_seconds: options.leaseSeconds,
    })
    if (error) throw new Error(error.message)
    if (data === 'ACQUIRED') return
    if (data === 'NOT_CONNECTED') throw new QuickbooksNotConnectedError(environment)
    if (waited >= options.waitMilliseconds) throw new QuickbooksBusyError()

    await options.sleep(options.pollMilliseconds)
    waited += options.pollMilliseconds
  }
}

export async function openQuickbooksSession(
  admin: RpcClient,
  environment: QuickbooksEnvironment,
  credentials: { clientId: string; clientSecret: string },
  options: SessionOptions = {},
): Promise<QuickbooksSession> {
  const {
    fetcher = fetch,
    now = () => new Date(),
    sleep = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    newOwner = () => crypto.randomUUID(),
    leaseSeconds = 30,
    waitMilliseconds = 15_000,
    pollMilliseconds = 250,
  } = options

  const owner = newOwner()
  await acquireLease(admin, environment, owner, { sleep, leaseSeconds, waitMilliseconds, pollMilliseconds })

  try {
    // Read after taking the lease so the token is the latest one stored.
    const { data, error } = await admin.rpc('get_quickbooks_credentials', {
      p_environment: environment,
    })
    if (error) throw new Error(error.message)
    if (!data) throw new QuickbooksNotConnectedError(environment)

    const stored = data as {
      realmId: string
      environment: string
      itemId: string | null
      refreshToken: string
    }

    // The connection answered for the environment asked; anything else would send
    // a request meant for one company to the other.
    if (stored.environment !== environment) {
      throw new Error(`QuickBooks ${environment} returned the credentials of ${stored.environment}.`)
    }

    const tokens = await refreshQuickbooksTokens(
      { ...credentials, refreshToken: stored.refreshToken },
      fetcher,
      now,
    )

    const { error: rotateError } = await admin.rpc('rotate_quickbooks_refresh_token', {
      p_environment: environment,
      p_refresh_token: tokens.refreshToken,
      p_refresh_token_expires_at: tokens.refreshTokenExpiresAt?.toISOString() ?? null,
    })
    if (rotateError) {
      throw new Error(`Could not store the rotated QuickBooks refresh token: ${rotateError.message}`)
    }

    return {
      environment: parseQuickbooksEnvironment(stored.environment),
      realmId: stored.realmId,
      itemId: stored.itemId,
      accessToken: tokens.accessToken,
    }
  } finally {
    // Best effort: a failed release only costs the lease's few seconds.
    await admin.rpc('release_quickbooks_token_lease', { p_owner: owner, p_environment: environment })
  }
}
