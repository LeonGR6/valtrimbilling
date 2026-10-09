// Opens a QuickBooks API session: reads the stored credentials, trades the
// refresh token for an access token and persists the rotated refresh token.
//
// QuickBooks issues a new refresh token on every refresh, so storing it is part
// of opening the session, not an afterthought. If it cannot be stored the call
// fails instead of silently losing the new token.

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
  constructor() {
    super('QuickBooks is not connected. An administrator must connect it first.')
    this.name = 'QuickbooksNotConnectedError'
  }
}

export async function openQuickbooksSession(
  admin: RpcClient,
  credentials: { clientId: string; clientSecret: string },
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<QuickbooksSession> {
  const { data, error } = await admin.rpc('get_quickbooks_credentials')
  if (error) throw new Error(error.message)
  if (!data) throw new QuickbooksNotConnectedError()

  const stored = data as {
    realmId: string
    environment: string
    itemId: string | null
    refreshToken: string
  }

  const tokens = await refreshQuickbooksTokens(
    { ...credentials, refreshToken: stored.refreshToken },
    fetcher,
    now,
  )

  const { error: rotateError } = await admin.rpc('rotate_quickbooks_refresh_token', {
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
}
