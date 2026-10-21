import { requireSupabase } from '../../../services/api.js'

const FUNCTION_NAME = 'purchase-order-options-email'

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }
  return error?.message || 'The email request failed.'
}

async function invokeEmail(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }
  return data
}

function toRequestAdditions(additions) {
  return additions.map(({ lotId, optionId, createdOption }) => ({
    lotId,
    optionId,
    createdOption: createdOption === true,
  }))
}

/** The email for the options a Purchase Order added to the Sequence Sheet, to review. */
export function previewOptionsEmail({ jobId, additions }) {
  return invokeEmail({
    action: 'preview',
    jobId,
    additions: toRequestAdditions(additions),
  })
}

export function sendOptionsEmail({ jobId, additions, recipientEmails, subject, requestId }) {
  return invokeEmail({
    action: 'send',
    jobId,
    additions: toRequestAdditions(additions),
    recipientEmails,
    subject,
    requestId,
  })
}
