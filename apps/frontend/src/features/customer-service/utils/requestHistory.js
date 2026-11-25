import { effectiveRequestWorkflowStage, filterAndSortRequestInbox } from './requestInbox.js'

// The History tab (decided 25 Nov 2026): completed requests, the most recent visit first.
// The search is the Requests inbox search (folio, builder, community, address, lot,
// customer, phone, email, issue); the technician and the visit dates narrow it further.
export function completedRequestHistory(requests, { search = '', technicianId = 'all', from = '', to = '' } = {}) {
  return filterAndSortRequestInbox(requests, { search, view: 'HISTORY' })
    .filter((request) => {
      const date = request.customerWindow?.date ?? ''
      return (technicianId === 'all' || (request.technicianIds ?? []).map(String).includes(String(technicianId)))
        && (!from || (Boolean(date) && date >= from))
        && (!to || (Boolean(date) && date <= to))
    })
    .sort((left, right) => (right.customerWindow?.date ?? '').localeCompare(left.customerWindow?.date ?? '')
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
