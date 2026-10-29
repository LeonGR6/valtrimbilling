import { requireSupabase } from '../../../services/api.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

const FUNCTION_NAME = 'dm-reminder-email'

async function invoke(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The DM reminder request failed.'), { cause: error })
  }
  return data
}

/** The DMs of a day (YYYY-MM-DD; tomorrow when omitted) with who each email is for. */
export function listDmReminders(date) {
  return invoke({ action: 'list', ...(date ? { date } : {}) })
}

/** The email of one DM, to review. The server loads everything it says. */
export function previewDmReminder({ scheduleId, date }) {
  return invoke({ action: 'preview', scheduleId, date })
}

export function sendDmReminder({ scheduleId, date, recipientEmails, subject, requestId }) {
  return invoke({ action: 'send', scheduleId, date, recipientEmails, subject, requestId })
}
