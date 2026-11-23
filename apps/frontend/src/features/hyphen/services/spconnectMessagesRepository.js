// Reads the messages that Hyphen's UAT environment sent to the SPConnect
// webhook. That webhook (spconnect-orders) still runs in a separate Supabase
// project, so this is a plain read-only PostgREST call to that project instead
// of a second Supabase client: no session, no writes. It goes away once the
// webhook moves into our own project and the table is read through api.js.
//
// The UAT project exposes only UAT rows, read-only, through the
// public.spconnect_messages_uat view.

const url = import.meta.env.VITE_SPCONNECT_UAT_URL
const publishableKey = import.meta.env.VITE_SPCONNECT_UAT_PUBLISHABLE_KEY

export const isSpconnectUatConfigured = Boolean(url && publishableKey)

const MESSAGE_LIMIT = 200

export async function listSpconnectMessages() {
  if (!isSpconnectUatConfigured) {
    throw new Error(
      'The Hyphen UAT connection is not configured. Add VITE_SPCONNECT_UAT_URL and '
      + 'VITE_SPCONNECT_UAT_PUBLISHABLE_KEY to apps/frontend/.env.',
    )
  }

  const endpoint = new URL('/rest/v1/spconnect_messages_uat', url)
  endpoint.searchParams.set('select', '*')
  endpoint.searchParams.set('order', 'received_at.desc')
  endpoint.searchParams.set('limit', String(MESSAGE_LIMIT))

  let response
  try {
    response = await fetch(endpoint, { headers: { apikey: publishableKey } })
  } catch {
    throw new Error('Could not reach the Hyphen UAT project. Check your connection and try again.')
  }

  if (response.status === 404) {
    throw new Error('The Hyphen UAT project does not expose the spconnect_messages_uat view yet.')
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('The Hyphen UAT project rejected the key. Check VITE_SPCONNECT_UAT_PUBLISHABLE_KEY.')
  }
  if (!response.ok) {
    throw new Error(`The Hyphen UAT project answered with status ${response.status}.`)
  }

  return response.json()
}
