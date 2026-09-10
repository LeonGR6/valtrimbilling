const FLOW_BY_PATH = {
  '/accept-invite': 'invite',
  '/reset-password': 'recovery',
}

const AUTH_QUERY_KEYS = [
  'access_token',
  'error',
  'error_code',
  'error_description',
  'expires_in',
  'refresh_token',
  'token_type',
  'type',
]

export function parsePasswordFlowUrl(input) {
  const url = input instanceof URL ? input : new URL(input)
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const value = (key) => hash.get(key) ?? url.searchParams.get(key)

  return {
    expectedType: FLOW_BY_PATH[normalizedPath] ?? null,
    type: value('type'),
    accessToken: value('access_token'),
    refreshToken: value('refresh_token'),
    errorCode: value('error_code') ?? value('error'),
    errorDescription: value('error_description'),
  }
}

function capturePasswordFlowUrl() {
  if (typeof window === 'undefined') return null

  const link = parsePasswordFlowUrl(window.location.href)
  if (!link.expectedType) return null

  const sanitizedUrl = new URL(window.location.href)
  sanitizedUrl.hash = ''
  for (const key of AUTH_QUERY_KEYS) sanitizedUrl.searchParams.delete(key)
  window.history.replaceState(
    window.history.state,
    '',
    `${sanitizedUrl.pathname}${sanitizedUrl.search}`,
  )

  return link
}

const capturedPasswordFlow = capturePasswordFlowUrl()
let passwordFlowPromise = null

export async function establishPasswordFlow(client, link) {
  if (!link?.expectedType) return null

  if (link.errorCode || link.errorDescription) {
    throw new Error(
      link.errorDescription
      || 'This password link is invalid or has expired.',
    )
  }

  if (link.type !== link.expectedType) {
    throw new Error('This link does not match the requested password operation.')
  }

  if (!link.accessToken || !link.refreshToken) {
    throw new Error('This password link is incomplete or has expired.')
  }

  const { data: sessionData, error: sessionError } = await client.auth.setSession({
    access_token: link.accessToken,
    refresh_token: link.refreshToken,
  })

  if (sessionError || !sessionData.session) {
    throw new Error(sessionError?.message || 'This password link is invalid or has expired.')
  }

  const { data: userData, error: userError } = await client.auth.getUser(
    sessionData.session.access_token,
  )

  if (userError || !userData.user) {
    throw new Error(userError?.message || 'The account in this password link could not be verified.')
  }

  if (userData.user.id !== sessionData.session.user.id) {
    throw new Error('The password link does not match the authenticated account.')
  }

  return {
    type: link.expectedType,
    userId: userData.user.id,
    email: userData.user.email ?? '',
  }
}

export function establishCapturedPasswordFlow(client) {
  if (!capturedPasswordFlow) return Promise.resolve(null)
  passwordFlowPromise ??= establishPasswordFlow(client, capturedPasswordFlow)
  return passwordFlowPromise
}

export function ensurePasswordFlowUser(user, expectedUserId) {
  if (!expectedUserId || !user || user.id !== expectedUserId) {
    throw new Error('The active session does not match this password link.')
  }
}
