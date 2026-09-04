import { toIsoDate } from './dates.js'

// The dashboard tiles all count the same list, so the counts are derived here
// instead of being stored anywhere. ISO dates compare correctly as plain
// strings, which keeps the week window away from timezone parsing.
export function summarizeRequests(requests, today = new Date()) {
  const todayIso = toIsoDate(today)
  const weekStart = toIsoDate(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6),
  )

  return {
    newThisWeek: requests.filter(
      (request) =>
        request.reportedAt >= weekStart && request.reportedAt <= todayIso,
    ).length,
    needContact: requests.filter(
      (request) => request.status === 'CONTACT_NEEDED',
    ).length,
    appointmentsToday: requests.filter(
      (request) =>
        request.appointmentState === 'SCHEDULED' &&
        request.appointmentDate === todayIso,
    ).length,
    waitingParts: requests.filter(
      (request) => request.status === 'AWAITING_PARTS',
    ).length,
    overdue: requests.filter((request) => request.status === 'OVERDUE').length,
  }
}
