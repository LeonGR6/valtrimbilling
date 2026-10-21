import { requireSupabase } from '../../../services/api.js'

// Two emails tell Purchasing and the Job Coordinator how the options of a Sequence
// Sheet changed: the ones a Purchase Order added, and the ones someone removed.
const FUNCTIONS = {
  added: 'purchase-order-options-email',
  removed: 'sequence-sheet-options-removed-email',
}

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    const payload = await response.clone().json().catch(() => null)
    if (payload?.error) return payload.error
  }
  return error?.message || 'The email request failed.'
}

async function invokeEmail(kind, body) {
  const name = FUNCTIONS[kind]
  if (!name) throw new Error('Select a supported email.')

  const client = await requireSupabase()
  const { data, error } = await client.functions.invoke(name, { body })
  if (error || data?.error) {
    throw new Error(await functionErrorMessage(error, data), { cause: error })
  }
  return data
}

/**
 * What the browser names of each changed option; the server loads everything else.
 * A removed option also carries the price its Lot was billing, which the database no
 * longer has once the selection is gone.
 */
function toRequestChanges(changes) {
  return changes.map(({ lotId, optionId, createdOption, price, priceNotApplicable }) => ({
    lotId,
    optionId,
    createdOption: createdOption === true,
    ...(price === undefined ? {} : { price }),
    priceNotApplicable: priceNotApplicable === true,
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
