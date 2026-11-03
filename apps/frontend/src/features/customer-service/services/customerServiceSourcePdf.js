import { requireSupabase } from '../../../services/api.js'

const FUNCTION_NAME = 'customer-service-source-pdf'

async function functionErrorMessage(error, data, fallback) {
  if (data?.error) return data.error

  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }

  return error?.message || fallback
}

export async function uploadCustomerServiceSourcePdf(requestId, file) {
  const client = await requireSupabase()
  const body = new FormData()
  body.set('requestId', String(requestId))
  body.set('file', file, file.name)

  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(
      error,
      data,
      'The request was saved, but its PDF could not be retained.',
    ), { cause: error })
  }
  return data
}

export async function getCustomerServiceSourcePdfUrls(requestId) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
    body: { action: 'signed-url', requestId },
  })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(
      error,
      data,
      'The private source PDF could not be opened.',
    ), { cause: error })
  }
  return data
}
