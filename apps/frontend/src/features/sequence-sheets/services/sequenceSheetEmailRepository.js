import { requireSupabase } from '../../../services/api.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

const FUNCTION_NAME = 'sequence-sheet-email'

async function invokeSequenceSheetEmail(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The Sequence Sheet email request failed.'), { cause: error })
  }
  return data
}

export function previewSequenceSheetEmail(phaseId) {
  return invokeSequenceSheetEmail({ action: 'preview', phaseId })
}

export function sendSequenceSheetEmail(phaseId, recipientEmails, requestId, subject) {
  return invokeSequenceSheetEmail({
    action: 'send',
    phaseId,
    recipientEmails,
    subject,
    requestId,
  })
}
