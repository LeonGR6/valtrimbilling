// Why a Customer Service visit moved or was cancelled, or why a request closed (Reschedule
// block, 27 Nov 2026). The codes are valtrim.service_change_reason. Each action accepts
// only its part of the list, the same rule the RPCs check, and OTHER needs a note.
// Shared by the Edge Function and the screens. Pure functions only: no Deno, browser or
// database dependency.

// The words stored when there is no note (the same as private.service_change_reason_label).
export const visitChangeReasonLabels = Object.freeze({
  CUSTOMER_ASKED: 'Customer asked',
  BUILDER_ASKED: 'Builder asked',
  TECHNICIAN_UNAVAILABLE: 'Technician unavailable',
  WEATHER: 'Weather',
  CUSTOMER_CANCELLED: 'Customer cancelled',
  BUILDER_CANCELLED: 'Cancelled by Builder',
  RESOLVED_WITHOUT_VISIT: 'Resolved without a visit',
  NOT_VALTRIM_WORK: 'Not Valtrim work',
  DUPLICATE: 'Duplicate request',
  OTHER: 'Other',
})

export const moveReasons = Object.freeze(['CUSTOMER_ASKED', 'BUILDER_ASKED', 'TECHNICIAN_UNAVAILABLE', 'WEATHER', 'OTHER'])
export const cancelReasons = Object.freeze([
  'CUSTOMER_CANCELLED', 'BUILDER_CANCELLED', 'RESOLVED_WITHOUT_VISIT', 'NOT_VALTRIM_WORK', 'DUPLICATE', 'OTHER',
])
// A request closes for the same reasons a visit is cancelled.
export const closeReasons = cancelReasons

export const visitChangeNoteLimit = 500

const reasonsByAction = { move: moveReasons, cancel: cancelReasons, close: closeReasons }
const missingReason = {
  move: 'Choose why the visit moves',
  cancel: 'Choose why the visit is cancelled',
  close: 'Choose why the request closes',
}

// The first problem with a reason, in the RPC's words, or null. action is move, cancel
// (closeRequest: also close the request) or close.
/**
 * @param {{ action: string, reason: string, note?: string, closeRequest?: boolean,
 *   duplicateOfRequestId?: number | null }} change
 * @returns {string | null}
 */
export function visitChangeProblem({ action, reason, note = '', closeRequest = false, duplicateOfRequestId = null }) {
  const reasons = reasonsByAction[action]
  if (!reasons) return 'Unknown change'
  if (!reasons.includes(reason)) return missingReason[action]
  const text = String(note ?? '').trim()
  if ((reason === 'OTHER' && !text) || text.length > visitChangeNoteLimit) {
    return 'Describe the reason in 500 characters or fewer'
  }
  const closes = action === 'close' || (action === 'cancel' && closeRequest)
  if (action === 'cancel' && !closes && (reason === 'DUPLICATE' || duplicateOfRequestId != null)) {
    return 'A duplicate closes the request'
  }
  if (closes && (reason === 'DUPLICATE') !== (duplicateOfRequestId != null)) {
    return 'A duplicate needs the original request, and only a duplicate has one'
  }
  return null
}
