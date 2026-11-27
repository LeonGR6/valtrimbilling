import { requireSupabase } from '../../../services/api.js'
import { functionErrorMessage } from '../../../services/functionErrors.js'

// Three emails tell Purchasing and the Job Coordinator how the options of a Sequence
// Sheet changed: the ones a Purchase Order added, the ones someone added by editing a
// Phase, and the ones someone removed.
const FUNCTIONS = {
  added: 'purchase-order-options-email',
  added_manually: 'sequence-sheet-options-added-email',
  removed: 'sequence-sheet-options-removed-email',
}

async function invokeEmail(kind, body) {
  const name = FUNCTIONS[kind]
  if (!name) throw new Error('Select a supported email.')

  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(name, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data, 'The email request failed.'), { cause: error })
  }
  return data
}

/** What the browser names of each changed option; the server loads everything else. */
function toRequestChanges(changes) {
  return changes.map(({ lotId, optionId, createdOption }) => ({
    lotId,
    optionId,
    createdOption: createdOption === true,
  }))
}

/** The email for options that changed in the Sequence Sheet, to review. */
export function previewOptionsEmail({ kind = 'added', jobId, changes }) {
  return invokeEmail(kind, {
    action: 'preview',
    jobId,
    changes: toRequestChanges(changes),
  })
}

export function sendOptionsEmail({
  kind = 'added',
  jobId,
  changes,
  recipientEmails,
  subject,
  requestId,
}) {
  return invokeEmail(kind, {
    action: 'send',
    jobId,
    changes: toRequestChanges(changes),
    recipientEmails,
    subject,
    requestId,
  })
}
