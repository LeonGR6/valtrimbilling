const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u

function assertSecret(secret: string) {
  if (new TextEncoder().encode(secret).length < 32) {
    throw new Error('FOLLOW_UP_RESPONSE_SECRET must contain at least 32 bytes.')
  }
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

async function signature(publicId: string, secret: string) {
  assertSecret(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`valtrim-builder-follow-up:${publicId.toLowerCase()}`),
  )
  return base64Url(new Uint8Array(signed))
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  if (leftBytes.length !== rightBytes.length) return false

  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index]
  }
  return difference === 0
}

export async function createBuilderFollowUpResponseToken(
  publicId: string,
  secret: string,
) {
  const normalized = publicId.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error('The follow-up response id is invalid.')
  }
  return `${normalized}.${await signature(normalized, secret)}`
}

export async function verifyBuilderFollowUpResponseToken(
  token: string,
  secret: string,
) {
  const [publicId, suppliedSignature, ...remainder] = token.trim().split('.')
  if (
    remainder.length > 0
    || !UUID_PATTERN.test(publicId ?? '')
    || !SIGNATURE_PATTERN.test(suppliedSignature ?? '')
  ) {
    return null
  }

  const normalized = publicId.toLowerCase()
  const expected = await signature(normalized, secret)
  return constantTimeEqual(suppliedSignature, expected) ? normalized : null
}

export function buildBuilderFollowUpResponseLinks(
  publicAppUrl: string,
  token: string,
) {
  const base = publicAppUrl.trim().replace(/\/+$/u, '')
  if (!/^https?:\/\//iu.test(base)) {
    throw new Error('FOLLOW_UP_PUBLIC_APP_URL must be an HTTP or HTTPS URL.')
  }

  const confirmed = new URL(`${base}/follow-up/respond`)
  confirmed.searchParams.set('token', token)
  confirmed.searchParams.set('intent', 'confirmed')

  const notReady = new URL(`${base}/follow-up/respond`)
  notReady.searchParams.set('token', token)
  notReady.searchParams.set('intent', 'not-ready')

  return {
    confirmed: confirmed.toString(),
    notReady: notReady.toString(),
  }
}
