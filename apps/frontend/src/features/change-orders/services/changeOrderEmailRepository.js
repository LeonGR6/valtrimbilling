import { requireSupabase } from '../../../services/api.js'
import { listAllRows } from '../../../services/pagedQuery.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'
import { toEmailRecord } from './changeOrderEmailRecord.js'

const FUNCTION = 'change-order-event-email'

async function invokeEmail(body) {
  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(FUNCTION, { body })
  if (error || data?.error) {
    throw new Error(
      await functionErrorMessage(error, data, 'The email to Scheduling could not be prepared.'),
      { cause: error },
    )
  }
  return data
}

/** The email for the lots of an Extra / CO charged with a Calendar event, to review before it is sent. */
export function previewSchedulingEmail(changeOrderId) {
  return invokeEmail({ action: 'preview', changeOrderId })
}

/** Sends it to `recipientEmails` with `subject`; `requestId` makes a retry after a failure safe. */
export function sendSchedulingEmail({ changeOrderId, recipientEmails, subject, requestId }) {
  return invokeEmail({ action: 'send', changeOrderId, recipientEmails, subject, requestId })
}

/** The emails already sent to Scheduling about an Extra / CO, newest first. */
export async function listSchedulingEmails(changeOrderId) {
  const client = await requireSupabase()
  const rows = await listAllRows(
    () => client
      .from('change_order_event_emails')
      .select('id, events, lot_count, recipients, subject, sent_at')
      .eq('change_order_id', Number(changeOrderId))
      .order('sent_at', { ascending: false })
      .order('id', { ascending: false }),
    (error) => {
      throw new Error('The emails sent to Scheduling could not be read.', { cause: error })
    },
  )

  return rows.map(toEmailRecord)
}
