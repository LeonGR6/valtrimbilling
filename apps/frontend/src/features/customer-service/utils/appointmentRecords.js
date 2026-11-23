// Maps persisted appointments onto the request shape the planner, agenda and
// Calendar already use (customerWindow, internalSlot, technicianIds).
import { californiaClockAt, travelLegKey } from './customerServiceScheduling.js'

export function toPlanningTechnicians(rows) {
  return rows.filter((row) => row.isActive).map((row) => ({ id: String(row.id), name: row.name }))
}

// The planner only needs travel to or from a neighbouring visit on the planned day,
// and visits cannot be planned in the past: estimates touching appointments from
// today (California) onward are enough.
export function upcomingAppointmentRequestIds(appointments = [], now = new Date()) {
  const today = californiaClockAt(now).date
  return [...new Set(appointments
    .filter((row) => californiaClockAt(new Date(row.window_starts_at)).date >= today)
    .map((row) => Number(row.request_id)))]
    .sort((left, right) => left - right)
}

// Distance band limits in miles, as configured in Settings; null without a settings row.
export function toDistanceBands(row) {
  if (!row) return null
  return {
    distanceGreenMaxMiles: Number(row.distance_green_max_miles),
    distanceYellowMaxMiles: Number(row.distance_yellow_max_miles),
    distanceOrangeMaxMiles: Number(row.distance_orange_max_miles),
  }
}

export function travelEstimatesToMinutes(rows = []) {
  return Object.fromEntries(rows.map((row) => [travelLegKey(row.from_request_id, row.to_request_id), row.minutes]))
}

// Traffic details of saved Google estimates, by leg key (used to label the legs).
export function travelEstimateDetails(rows = []) {
  return Object.fromEntries(rows
    .filter((row) => row.source === 'ROUTES_API')
    .map((row) => [travelLegKey(row.from_request_id, row.to_request_id), {
      staticMinutes: row.static_minutes ?? null,
      trafficModel: row.traffic_model ?? null,
      trafficDepartureAt: row.departure_at ?? null,
    }]))
}

// Manual legs the day-before check compared with Google (decision P5): the typed minutes
// and Google's minutes with traffic at that departure, by leg key.
export function manualTravelChecks(rows = []) {
  return Object.fromEntries(rows
    .filter((row) => row.source === 'MANUAL' && Number.isInteger(row.google_minutes))
    .map((row) => [travelLegKey(row.from_request_id, row.to_request_id), {
      minutes: row.minutes, googleMinutes: row.google_minutes,
    }]))
}

// The days a sent proposal holds until the customer answers, in California time.
function toProposalHold(row) {
  const window = { start: californiaClockAt(new Date(row.window_starts_at)), end: californiaClockAt(new Date(row.window_ends_at)) }
  return {
    optionId: row.option_id, optionNumber: row.option_number, proposalId: row.proposal_id, sentAt: row.sent_at,
    date: window.start.date, windowStart: window.start.time, windowEnd: window.end.time,
    start: californiaClockAt(new Date(row.starts_at)).time, end: californiaClockAt(new Date(row.ends_at)).time,
    pickupMinutes: row.pickup_minutes, technicianIds: row.technician_ids.map(String),
  }
}

// The 24-hour reminder of a proposal (its last attempt) and the Builder to call at 48
// hours: the Job's jobsite superintendent (block B, step B7).
function proposalReminder(row, reminders) {
  const attempts = reminders.filter((entry) => String(entry.metadata?.proposalId) === String(row.id))
    .sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)))
  const last = attempts[0]
  return last ? { status: last.status, at: last.occurred_at, message: last.error_message ?? '' } : null
}

function proposalBuilderContact(row, builderContacts) {
  const job = builderContacts.find((entry) => String(entry.id) === String(row.request_id))?.service_properties?.jobs
  const contact = job?.superintendent
  if (!contact) return null
  return {
    builderName: job.builders?.name ?? '', name: contact.name ?? '', phone: contact.phone ?? '',
    officePhone: contact.office_phone ?? '', email: contact.email ?? '',
  }
}

// A request's latest proposal: the one waiting for the customer, or the customer's last
// answer (block B, step B6). Times stay as stored; screens format them.
function toProposal(row, followUps) {
  return {
    id: row.id, status: row.status, senderMailbox: row.sender_mailbox, sentAt: row.sent_at,
    reminderSentAt: row.reminder_sent_at ?? null, builderContactedAt: row.builder_contacted_at ?? null,
    respondedAt: row.responded_at ?? null, responseVia: row.response_via ?? null,
    counterDates: row.counter_dates ?? [], counterDayPart: row.counter_day_part ?? null,
    customerNote: row.customer_note ?? '', cancelledAt: row.cancelled_at ?? null, cancelReason: row.cancel_reason ?? '',
    reminder: proposalReminder(row, followUps.reminders ?? []),
    builderContact: proposalBuilderContact(row, followUps.builderContacts ?? []),
  }
}

export function applyAppointmentsToRequests(
  requests, appointments = [], technicians = [], proposalHolds = [], proposals = [], followUps = {},
) {
  const byRequest = new Map(appointments.map((row) => [String(row.request_id), row]))
  const holdsByRequest = new Map()
  for (const row of proposalHolds) {
    const key = String(row.request_id)
    holdsByRequest.set(key, [...(holdsByRequest.get(key) ?? []), row])
  }
  // The proposal waiting for the customer (one at most per request) is the current one;
  // otherwise the newest, whose answer shows while the request is planned again.
  const latestByRequest = new Map()
  const current = (row, other) => (row.status === 'SENT') !== (other.status === 'SENT')
    ? row.status === 'SENT'
    : row.sent_at > other.sent_at
  for (const row of proposals) {
    const key = String(row.request_id)
    if (!latestByRequest.has(key) || current(row, latestByRequest.get(key))) latestByRequest.set(key, row)
  }
  const names = new Map(technicians.map((person) => [String(person.id), person.name]))
  return requests.map((original) => {
    const latest = latestByRequest.get(String(original.id))
    const request = latest ? { ...original, latestProposal: toProposal(latest, followUps) } : original
    const holds = holdsByRequest.get(String(request.id))
    if (holds) {
      return { ...request, proposalHolds: holds.map(toProposalHold).sort((left, right) => left.optionNumber - right.optionNumber) }
    }
    const row = byRequest.get(String(request.id))
    if (!row) return request
    const window = { start: californiaClockAt(new Date(row.window_starts_at)), end: californiaClockAt(new Date(row.window_ends_at)) }
    const technicianIds = row.technician_ids.map(String)
    return {
      ...request,
      customerWindow: { date: window.start.date, start: window.start.time, end: window.end.time },
      internalSlot: {
        start: californiaClockAt(new Date(row.starts_at)).time,
        end: californiaClockAt(new Date(row.ends_at)).time,
      },
      technicianIds,
      assignedTechnicians: technicianIds.map((id) => ({ id, name: names.get(id) ?? 'Unknown technician' })),
      appointment: { id: row.id, updatedAt: row.updated_at, acceptance: row.acceptance, state: row.state },
    }
  })
}
