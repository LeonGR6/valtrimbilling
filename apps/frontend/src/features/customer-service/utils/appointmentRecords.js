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

export function applyAppointmentsToRequests(requests, appointments = [], technicians = []) {
  const byRequest = new Map(appointments.map((row) => [String(row.request_id), row]))
  const names = new Map(technicians.map((person) => [String(person.id), person.name]))
  return requests.map((request) => {
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
