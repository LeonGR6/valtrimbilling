export const CALENDAR_UNSCHEDULED_PATH = '/calendar?tab=UNSCHEDULED'

/** Opens the Calendar with "New activity" ready for one Job and Phase. */
export function calendarSchedulePath(jobId, phaseId) {
  return `/calendar?schedule=${encodeURIComponent(`${jobId}:${phaseId}`)}`
}

/** Reads `schedule=<jobId>:<phaseId>` back into numbers, or null. */
export function parseCalendarSchedule(value) {
  const match = /^(\d+):(\d+)$/.exec(String(value ?? ''))
  return match ? { jobId: Number(match[1]), phaseId: Number(match[2]) } : null
}
