/**
 * The message to show when a call to an Edge Function fails: the one the function sent back in its
 * answer, else the one in the body of the error response, else the error's own, else `fallback`.
 */
export async function functionErrorMessage(error, data, fallback) {
  if (data?.error) return data.error

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }

  return error?.message || fallback
}
