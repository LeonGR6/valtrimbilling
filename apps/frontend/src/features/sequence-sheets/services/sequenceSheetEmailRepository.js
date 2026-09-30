import { requireSupabase } from '../../../services/api.js'

const FUNCTION_NAME = 'sequence-sheet-email'

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }
  return error?.message || 'The Sequence Sheet email request failed.'
}

async function invokeSequenceSheetEmail(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }
  return data
}

export function previewSequenceSheetEmail(phaseId) {
  return invokeSequenceSheetEmail({ action: 'preview', phaseId })
}

export function sendSequenceSheetEmail(phaseId, recipientEmails, requestId) {
  return invokeSequenceSheetEmail({
    action: 'send',
    phaseId,
    recipientEmails,
    requestId,
  })
}
