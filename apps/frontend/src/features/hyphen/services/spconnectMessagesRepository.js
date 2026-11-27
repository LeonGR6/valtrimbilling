import { requireSupabase } from '../../../services/api.js'

// Reads the messages that Hyphen's UAT environment sent to the SPConnect webhook through
// our hyphen-messages Edge Function. The function checks that the caller is an ADMIN and
// reads the teammate's webhook project with its secret key, which stays on the server:
// the browser never holds a key for that project (decided 24 Nov 2026, after the view
// readable with the publishable key was removed).

const FUNCTION_NAME = 'hyphen-messages'

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }

  return 'Could not load the Hyphen requests. Try again in a moment.'
}

export async function listSpconnectMessages() {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body: {} })

  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }

  return data?.messages ?? []
}
