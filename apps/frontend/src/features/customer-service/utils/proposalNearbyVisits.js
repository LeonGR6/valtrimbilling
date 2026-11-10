// Nearby visits for the request being planned: the scheduled visits it could share a
// day with and the open requests near it, nearest first in straight-line miles. It
// only reads the loaded requests; nothing calls Google and nothing is saved.
import { hasCoordinates, nearbyCandidates } from './customerServiceProximity.js'
import { parseServiceDate } from './customerServiceScheduling.js'
import { effectiveRequestWorkflowStage } from './requestInbox.js'
import { getCustomerServiceClock } from './dates.js'
import { proposalSuggestionSearchBusinessDays } from './proposalDraft.js'

// Requests that still need a visit and have no scheduled appointment.
const openStages = ['NEEDS_REVIEW', 'READY_TO_PROPOSE', 'AWAITING_CUSTOMER', 'NEEDS_CONTACT']

// Last day a nearby visit can share: the due date while it is still ahead. A request
// already overdue looks as far as the time suggestions do (10 business days from today).
export function nearbyVisitsThrough(dueOn, today) {
  if (parseServiceDate(dueOn) && dueOn >= today) return { date: dueOn, byDueDate: true }
  let date = today
  let businessDays = 0
  for (const cursor = new Date(`${today}T12:00:00Z`); businessDays < proposalSuggestionSearchBusinessDays;
    cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if ([0, 6].includes(cursor.getUTCDay())) continue
    businessDays += 1
    date = cursor.toISOString().slice(0, 10)
  }
  return { date, byDueDate: false }
}

export function getProposalNearbyVisits({ request, requests = [], now = new Date() }) {
  const today = getCustomerServiceClock(now).date
  const through = nearbyVisitsThrough(request.dueOn, today)
  if (!hasCoordinates(request)) return { hasCoordinates: false, through, candidates: [] }

  const place = (entry) => ({
    requestId: String(entry.id), requestNumber: entry.requestNumber, community: entry.community ?? '',
    latitude: entry.latitude, longitude: entry.longitude,
  })
  const scheduled = (entry) => entry.appointment?.state === 'SCHEDULED'
  const visits = requests
    .filter((entry) => scheduled(entry) && parseServiceDate(entry.customerWindow?.date))
    .map((entry) => ({
      ...place(entry),
      date: entry.customerWindow.date,
      start: entry.internalSlot?.start ?? entry.customerWindow.start,
      end: entry.internalSlot?.end ?? entry.customerWindow.end,
      technicianNames: (entry.assignedTechnicians ?? []).map((person) => person.name),
    }))
  const openRequests = requests
    .filter((entry) => !scheduled(entry) && openStages.includes(effectiveRequestWorkflowStage(entry)))
    .map((entry) => ({ ...place(entry), stage: effectiveRequestWorkflowStage(entry), dueOn: entry.dueOn ?? null }))

  return {
    hasCoordinates: true,
    through,
    candidates: nearbyCandidates({
      requestId: String(request.id), origin: request, visits, openRequests,
      fromDate: today, throughDate: through.date, unavailableDates: request.customerUnavailableDates ?? [],
    }),
  }
}
