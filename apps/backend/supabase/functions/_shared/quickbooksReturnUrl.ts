// Where the browser lands after connecting QuickBooks. The administrator's own
// page is used so the same Edge Function serves localhost and the deployed site,
// but only a page of an allowed origin is accepted: otherwise anyone able to
// start a connection could send the browser (and the result) to another site.
//
// Allowed: the origin of the configured QBO_RETURN_URL, any loopback address
// (it only ever reaches the developer's own machine) and the origins listed in
// QBO_ALLOWED_RETURN_ORIGINS (comma separated).

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

function parseHttpUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

function isAllowedOrigin(url: URL, configured: string | null | undefined, extraOrigins: string | null | undefined) {
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) return true
  if (parseHttpUrl(configured)?.origin === url.origin) return true
  return (extraOrigins ?? '')
    .split(',')
    .some((origin) => parseHttpUrl(origin)?.origin === url.origin)
}

/**
 * The page to come back to (origin and path only: no query, hash or credentials),
 * or null when it is missing or not an allowed origin, which means "use the
 * configured URL".
 */
export function resolveReturnUrl(
  candidate: unknown,
  configured: string | null | undefined,
  extraOrigins: string | null | undefined,
): string | null {
  if (typeof candidate !== 'string') return null
  const url = parseHttpUrl(candidate)
  if (!url || url.username || url.password) return null
  if (!isAllowedOrigin(url, configured, extraOrigins)) return null

  const returnUrl = `${url.origin}${url.pathname}`
  return returnUrl.length <= 300 ? returnUrl : null
}
