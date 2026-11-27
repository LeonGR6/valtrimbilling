import { visitChangeReasonLabels } from '../../../../../backend/supabase/functions/_shared/customerServiceVisitChanges.mjs'
import { getCustomerServiceClock } from './dates.js'
import { effectiveRequestWorkflowStage, filterAndSortRequestInbox } from './requestInbox.js'

// The California day a request was closed, or ''.
export function closedDate(request) {
  return request?.closedAt ? getCustomerServiceClock(new Date(request.closedAt)).date : ''
}

// How a History row ended: completed, or closed with its reason (Reschedule block, 27 Nov
// 2026). detail: the reason ("Not Valtrim work", "Duplicate of CS-3402") and the note
// when the coordinator wrote one.
export function historyOutcome(request, requests = []) {
  if (effectiveRequestWorkflowStage(request) !== 'CLOSED') return { closed: false, label: 'Completed', detail: '' }
  const label = visitChangeReasonLabels[request.closeReasonCode] ?? 'Closed'
  const original = request.duplicateOfRequestId == null
    ? null
    : requests.find((entry) => String(entry.id) === String(request.duplicateOfRequestId))
  const reason = request.closeReasonCode === 'DUPLICATE' && original ? `Duplicate of ${original.requestNumber}` : label
  const note = String(request.closeReason ?? '').trim()
  return { closed: true, label: 'Closed', detail: [reason, note && note !== label ? note : ''].filter(Boolean).join(' · ') }
}

// The day a History row is dated by: its visit, or the day a request without one closed.
export function historyDate(request) {
  return request.customerWindow?.date ?? closedDate(request)
}

// The History tab (decided 25 Nov 2026): completed requests and, since the Reschedule block,
// requests closed without a visit, the most recent first.
// The search is the Requests inbox search (folio, builder, community, address, lot,
// customer, phone, email, issue); the technician and the dates narrow it further.
export function completedRequestHistory(requests, { search = '', technicianId = 'all', from = '', to = '' } = {}) {
  return filterAndSortRequestInbox(requests, { search, view: 'HISTORY' })
    .filter((request) => {
      const date = historyDate(request)
      return (technicianId === 'all' || (request.technicianIds ?? []).map(String).includes(String(technicianId)))
        && (!from || (Boolean(date) && date >= from))
        && (!to || (Boolean(date) && date <= to))
    })
    .sort((left, right) => historyDate(right).localeCompare(historyDate(left))
      || String(right.requestNumber).localeCompare(String(left.requestNumber), undefined, { numeric: true }))
}

// The technicians of the completed visits, by name, for the technician filter.
export function historyTechnicianOptions(requests) {
  const people = new Map()
  for (const request of requests) {
    if (effectiveRequestWorkflowStage(request) !== 'COMPLETED') continue
    for (const person of request.assignedTechnicians ?? []) people.set(String(person.id), person.name)
  }
  return [...people].map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label))
}
