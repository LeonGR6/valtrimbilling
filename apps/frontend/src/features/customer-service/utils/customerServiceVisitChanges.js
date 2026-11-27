// Moving and cancelling a confirmed visit, and closing a request without one (Reschedule
// block, 27 Nov 2026). The reasons and their rules live with the Edge Functions so the
// server checks the same words; Vite bundles the same pure module for the browser.
import { visitChangeReasonLabels } from '../../../../../backend/supabase/functions/_shared/customerServiceVisitChanges.mjs'
import {
  customerServiceWindows, timeToMinutes,
} from '../../../../../backend/supabase/functions/_shared/customerServiceScheduling.mjs'
import { mailingAddress } from './customerServiceEmailTemplates.js'
import { serviceWorkTypeLabel } from './customerServicePlanning.js'
import { formatTime, formatWeekdayDate, getCustomerServiceClock } from './dates.js'
import { effectiveRequestWorkflowStage } from './requestInbox.js'

export * from '../../../../../backend/supabase/functions/_shared/customerServiceVisitChanges.mjs'

// What a customer email shows about the request: the same columns the server reads.
export function customerEmailDetails(request) {
  return {
    folio: request.requestNumber,
    homeownerName: request.contactName,
    address: mailingAddress({
      street: request.street || request.address, city: request.city, state: request.state, postalCode: request.postalCode,
    }),
    // The type of work, never the Builder's text (decided 23 Nov 2026).
    work: serviceWorkTypeLabel(request.workType),
  }
}

// A visit as the dialogs show it: { date, detail }, e.g. "Tue, Dec 1" and
// "8:00 AM–10:00 AM window · work 8:00–8:30 AM · Jorge Murillo".
export function visitSummary({ date, windowStart, workStart, workEnd, technicianNames = [] }) {
  const window = customerServiceWindows.find((entry) => entry.start === windowStart)?.label
  return {
    date: formatWeekdayDate(date),
    detail: [
      window && `${window} window`,
      workStart && workEnd && `work ${formatTime(workStart)}–${formatTime(workEnd)}`,
      technicianNames.join(', '),
    ].filter(Boolean).join(' · '),
  }
}

// The current visit of a confirmed request, for the dialogs.
export function currentVisit(request) {
  return {
    date: request.customerWindow?.date ?? '',
    windowStart: request.customerWindow?.start ?? '',
    summary: visitSummary({
      date: request.customerWindow?.date ?? '', windowStart: request.customerWindow?.start ?? '',
      workStart: request.internalSlot?.start, workEnd: request.internalSlot?.end,
      technicianNames: (request.assignedTechnicians ?? []).map((person) => person.name),
    }),
  }
}

// Options for a reason select: [{ value, label }].
export function visitChangeReasonOptions(reasons) {
  return reasons.map((value) => ({ value, label: visitChangeReasonLabels[value] }))
}

// A confirmed visit can move or be cancelled until its window ends (decision P2).
export function canChangeVisit(request, now = new Date()) {
  if (!request?.appointment || request.appointment.state !== 'SCHEDULED') return false
  if (!['CONFIRMED', 'WORKING'].includes(effectiveRequestWorkflowStage(request))) return false
  const window = request.customerWindow
  if (!window?.date || !window.end) return false
  const clock = getCustomerServiceClock(now)
  return window.date > clock.date || (window.date === clock.date && timeToMinutes(window.end) > clock.minutesSinceMidnight)
}

// Before a visit is confirmed, a request can be closed (decision D2). A confirmed visit is
// cancelled with "Close the request" instead.
export function canCloseRequest(request) {
  return ['NEEDS_REVIEW', 'READY_TO_PROPOSE', 'NEEDS_CONTACT', 'AWAITING_CUSTOMER']
    .includes(effectiveRequestWorkflowStage(request))
}

// The request as the planner sees it while its visit moves (decision P1): ready to propose
// and without its visit, so the visit does not occupy its own slot. The planner's rules,
// suggestions and travel then work unchanged.
export function requestPlanningForMove(request) {
  const planning = { ...request, workflowStage: 'READY_TO_PROPOSE' }
  for (const field of ['appointment', 'customerWindow', 'internalSlot', 'technicianIds', 'assignedTechnicians']) {
    delete planning[field]
  }
  return planning
}

export function requestsPlanningForMove(requests, request) {
  const planning = requestPlanningForMove(request)
  return requests.map((entry) => (String(entry.id) === String(request.id) ? planning : entry))
}

const cleanNote = (note) => String(note ?? '').trim() || null

// Body for "Move visit". request is the confirmed request (with its visit); values and
// validation come from the planner. email: { greeting, message } or null.
export function buildVisitMove({ request, values, validation, reason, note = '', email = null }) {
  return {
    appointmentId: Number(request.appointment.id),
    expectedAppointmentUpdatedAt: request.appointment.updatedAt,
    requestId: Number(request.id),
    expectedRequestUpdatedAt: request.updatedAt,
    technicianIds: values.technicianIds.map(Number),
    date: values.date,
    windowStart: values.windowStart,
    workStart: values.internalStart,
    travelMinutes: Object.fromEntries(validation.travelLegs
      .filter((leg) => leg.minutes !== null).map((leg) => [leg.key, leg.minutes])),
    reason,
    note: cleanNote(note),
    ...(email ? { email } : {}),
  }
}

// Body for "Cancel visit"; closeRequest closes the request too (decision P4).
export function buildVisitCancel({ request, reason, note = '', closeRequest = false, duplicateOfRequestId = null, email = null }) {
  return {
    appointmentId: Number(request.appointment.id),
    expectedAppointmentUpdatedAt: request.appointment.updatedAt,
    reason,
    note: cleanNote(note),
    closeRequest,
    duplicateOfRequestId: closeRequest && reason === 'DUPLICATE' ? Number(duplicateOfRequestId) : null,
    ...(email ? { email } : {}),
  }
}

// Body for "Close request" (decision D2).
export function buildRequestClose({ request, reason, note = '', duplicateOfRequestId = null }) {
  return {
    requestId: Number(request.id),
    expectedRequestUpdatedAt: request.updatedAt,
    reason,
    note: cleanNote(note),
    duplicateOfRequestId: reason === 'DUPLICATE' ? Number(duplicateOfRequestId) : null,
  }
}

// The original of a duplicate: any other request, by folio, newest first.
export function duplicateCandidates(requests, request) {
  return requests
    .filter((entry) => String(entry.id) !== String(request.id))
    .sort((left, right) => String(right.requestNumber).localeCompare(String(left.requestNumber), undefined, { numeric: true }))
}

// What the coordinator reads after a change. The change is always saved; the customer
// email may have been sent, failed or not been sent (no email was asked for: no sentence).
function emailSentence(email) {
  if (!email) return { severity: 'success', text: '' }
  if (email.status === 'SENT') {
    return { severity: 'success', text: ` The customer was emailed at ${email.to}${email.testMode ? ' (test inbox)' : ''}.` }
  }
  if (email.status === 'FAILED') return { severity: 'warning', text: ` The customer email failed: ${email.message}` }
  return { severity: 'warning', text: ` ${email.message}` }
}

export function visitMovedNotice(requestNumber, newDate, result) {
  const { severity, text } = emailSentence(result?.email)
  const late = result?.warnings?.length ? ' It is after the due date.' : ''
  return { severity, message: `${requestNumber} moved to ${formatWeekdayDate(newDate)}.${late}${text}` }
}

export function visitCancelledNotice(requestNumber, result) {
  const { severity, text } = emailSentence(result?.email)
  const next = result?.closed ? 'the request was closed and is in History' : 'the request is Ready to propose again'
  return { severity, message: `The ${requestNumber} visit was cancelled; ${next}.${text}` }
}

export function requestClosedNotice(requestNumber, reason) {
  return { severity: 'success', message: `${requestNumber} was closed (${visitChangeReasonLabels[reason] ?? 'Other'}). It is in History.` }
}
