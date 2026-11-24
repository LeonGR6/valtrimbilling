/**
 * The message to show when a call to an Edge Function fails: the one the function sent back in its
 * answer, else the one in the body of the error response, else the error's own, else `fallback`.
 */
export async function functionErrorMessage(error, data, fallback) {
  if (data?.error) return data.error

  const payload = await functionErrorPayload(error, data)
  if (payload?.error) return payload.error

  return error?.message || fallback
}

/** The JSON body an Edge Function answered with, also when it answered with an error status. */
export async function functionErrorPayload(error, data) {
  if (data && typeof data === 'object') return data

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    return await response.clone().json().catch(() => null)
  }
  return null
}
