// Proposal Workspace capacity rules, shared by the browser planner and the
// customer-service-appointments Edge Function so both apply exactly the same
// checks. Pure functions only: no Deno, browser or database dependency.
//
// A visit occupies [work start, work end + pickup]. Only the neighbours of the new
// visit in each technician's day need travel checks (previous→new and new→next).
// A missing travel estimate is unknown, never zero.

export const customerServiceTimeZone = 'America/Los_Angeles'
export const customerServicePickupMinutes = 10
export const customerServiceWorkday = { startsAt: '07:00', endsAt: '15:30' }
export const customerServiceWindows = [
  { start: '08:00', end: '10:00', label: '8:00 AM–10:00 AM', exceptional: false },
  { start: '10:00', end: '12:00', label: '10:00 AM–12:00 PM', exceptional: false },
  { start: '12:00', end: '14:00', label: '12:00 PM–2:00 PM', exceptional: false },
]

export function timeToMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(String(time ?? ''))) return null
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export function minutesToTime(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 1440) return ''
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

// A real YYYY-MM-DD calendar day, or null. Noon keeps the day stable in any time zone.
export function parseServiceDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value ?? ''))
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date : null
}

const serviceDateLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
})

// '2026-11-17' reads as 'Tue, Nov 17', the format the planner shows everywhere.
/** @param {string | null | undefined} date */
export function formatServiceDate(date) {
  const day = parseServiceDate(date)
  return day ? serviceDateLabel.format(day) : String(date ?? '')
}

// '13:05' reads as '1:05 PM'.
/** @param {string | null | undefined} time */
export function formatServiceTime(time) {
  const value = timeToMinutes(time)
  if (value === null) return String(time ?? '')
  const hour = Math.floor(value / 60)
  return `${hour % 12 || 12}:${String(value % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

const californiaClock = new Intl.DateTimeFormat('en-US', {
  timeZone: customerServiceTimeZone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

// The operational day and time in California for an instant.
export function californiaClockAt(instant = new Date()) {
  const parts = Object.fromEntries(californiaClock.formatToParts(instant).map(({ type, value }) => [type, value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minutesSinceMidnight: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

// The UTC instant of a California wall-clock date and time (handles PST/PDT).
export function californiaInstant(date, time) {
  const day = parseServiceDate(date)
  const minutes = timeToMinutes(time)
  if (!day || minutes === null) return null
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, minutes)
  // California offset (wall clock minus UTC) at an instant. Evaluating it at a first
  // guess is exact except inside a DST change hour, never within the workday.
  const offset = (instant) => {
    const clock = californiaClockAt(new Date(instant))
    const [year, month, date_] = clock.date.split('-').map(Number)
    return Date.UTC(year, month - 1, date_, 0, clock.minutesSinceMidnight) - instant
  }
  return new Date(wall - offset(wall - offset(wall)))
}

// Emails to customers and coordinators go out only from 8:00 AM to 6:00 PM in
// California (decided 23 Nov 2026); one due outside those hours waits for 8:00 AM.
export const customerServiceEmailHours = { startsAt: '08:00', endsAt: '18:00' }

/** @param {Date} instant */
export function withinCustomerServiceEmailHours(instant) {
  const minutes = californiaClockAt(instant).minutesSinceMidnight
  return minutes >= Number(timeToMinutes(customerServiceEmailHours.startsAt))
    && minutes < Number(timeToMinutes(customerServiceEmailHours.endsAt))
}

// When an email due at an instant actually goes out: then, or the next 8:00 AM.
/** @param {Date} due */
export function customerServiceEmailTime(due) {
  if (withinCustomerServiceEmailHours(due)) return due
  const clock = californiaClockAt(due)
  const day = /** @type {Date} */ (parseServiceDate(clock.date))
  if (clock.minutesSinceMidnight >= Number(timeToMinutes(customerServiceEmailHours.endsAt))) {
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return /** @type {Date} */ (californiaInstant(day.toISOString().slice(0, 10), customerServiceEmailHours.startsAt))
}

export function travelLegKey(fromRequestId, toRequestId) {
  return `${fromRequestId}>${toRequestId}`
}

// Manual travel estimates are keyed "fromRequestId>toRequestId". Invalid means unknown.
export function travelMinutesFor(travel, fromRequestId, toRequestId) {
  const value = travel?.[travelLegKey(fromRequestId, toRequestId)]
  return Number.isInteger(value) && value >= 0 ? value : null
}

// Days Valtrim is closed: the US holidays it closes (decided 24-25 Nov 2026), kept in the
// service_holidays table. The browser and each Edge Function load them before planning
// with setCustomerServiceHolidays; until then there are none. A holiday is not a business
// day: no visit is offered or registered on it and it does not count as a business day.
let holidayNames = new Map()

/** @param {{ date: string, name: string }[]} holidays */
export function setCustomerServiceHolidays(holidays = []) {
  holidayNames = new Map(holidays.filter((holiday) => parseServiceDate(holiday?.date))
    .map((holiday) => [holiday.date, String(holiday.name ?? 'Holiday')]))
}

/** @param {string} date */
export function customerServiceHolidayName(date) {
  return holidayNames.get(date) ?? ''
}

// Monday to Friday and not a holiday. date: YYYY-MM-DD.
/** @param {string} date */
export function isCustomerServiceBusinessDay(date) {
  const day = parseServiceDate(date)
  return Boolean(day) && ![0, 6].includes(day.getUTCDay()) && !holidayNames.has(date)
}

// Date rules for a visit: real business day, not a holiday, not in the past, not blocked
// by the customer. A date after dueOn is only a warning (late-work policy is still open).
/**
 * @param {{ date: string, workStart: string, today: string, nowMinutes: number,
 *   unavailableDates?: string[], dueOn?: string | null }} input
 */
export function checkVisitDate({ date, workStart, today, nowMinutes, unavailableDates = [], dueOn = null }) {
  const errors = []
  const warnings = []
  const day = parseServiceDate(date)
  if (!day) errors.push({ field: 'date', message: 'Select a valid service date.' })
  else if (date < today) errors.push({ field: 'date', message: 'The service date cannot be in the past (California time).' })
  else if ([0, 6].includes(day.getUTCDay())) errors.push({ field: 'date', message: 'Service appointments are Monday through Friday.' })
  else if (holidayNames.has(date)) {
    errors.push({ field: 'date', message: `${holidayNames.get(date)} is a holiday and Valtrim is closed.` })
  }
  else if (unavailableDates.includes(date)) {
    errors.push({ field: 'date', message: 'The customer has recorded this date as unavailable.' })
  }
  // Approved 2026-11-05: a date after the due date blocks registration while
  // on-time days remain (pastDue). A request that is already overdue can still
  // be registered; it only carries the late warning. Drafts only warn.
  if (day && parseServiceDate(dueOn) && date > dueOn) {
    if (today <= dueOn) {
      warnings.push({ field: 'date', pastDue: true, message: `This date is after the due date (${formatServiceDate(dueOn)}). Choose a date on or before it to register the appointment.` })
    } else {
      warnings.push({ field: 'date', message: `This request was due on ${formatServiceDate(dueOn)}. The work will be completed late.` })
    }
  }
  const start = timeToMinutes(workStart)
  if (day && date === today && start !== null && start <= nowMinutes) {
    errors.push({ field: 'internalStart', message: 'The work start time cannot be in the past (California time).' })
  }
  return { errors, warnings, dateIsValid: Boolean(day) }
}

// Window, work, pickup and each technician's sequence on that day.
// visit: { requestId, label, windowStart, workStart, durationMinutes }
// technicians: [{ id, name }] selected for the visit (distinct)
// agenda: [{ requestId, requestNumber, technicianId, start, end, windowUncertain,
//   blocksAvailability, date }] for those technicians on the visit day
export function checkVisitCapacity({ visit, technicians, agenda, travelMinutes = {} }) {
  const errors = []
  const warnings = []
  const addError = (field, message) => errors.push({ field, message })
  const window = customerServiceWindows.find((option) => option.start === visit.windowStart)
  if (!window) addError('windowStart', 'Select an allowed two-hour customer window.')
  const start = timeToMinutes(visit.workStart)
  const duration = Number(visit.durationMinutes)
  const end = start !== null && Number.isInteger(duration) && duration > 0 ? start + duration : null
  if (start === null) addError('internalStart', 'Select the work start time.')
  else if (window && (start < timeToMinutes(window.start) || start >= timeToMinutes(window.end))) {
    addError('internalStart', 'Work must start within the selected customer arrival window.')
  }
  if (start !== null && end !== null && (
    start < timeToMinutes(customerServiceWorkday.startsAt) || end > timeToMinutes(customerServiceWorkday.endsAt)
  )) {
    addError('internalStart', `Work must fit within the ${formatServiceTime(customerServiceWorkday.startsAt)}–${formatServiceTime(customerServiceWorkday.endsAt)} workday.`)
  }
  if (window && end !== null && end + customerServicePickupMinutes > timeToMinutes(window.end)) {
    addError('internalStart', `Work and pickup must finish before the customer window closes at ${formatServiceTime(window.end)}.`)
  }

  // One leg per origin→destination pair; technicians sharing a leg share its estimate.
  const legs = new Map()
  // Departure is the moment the technician leaves the earlier visit (after its
  // pickup), in California time. Null when the visit date is not known yet.
  const departureFor = (clockTime) => (visit.date && clockTime
    ? californiaInstant(visit.date, clockTime)?.toISOString() ?? null
    : null)
  const addLeg = (fromRequestId, toRequestId, fromLabel, toLabel, name, departureAt) => {
    const key = travelLegKey(fromRequestId, toRequestId)
    const leg = legs.get(key) ?? {
      key, fromRequestId, toRequestId, fromLabel, toLabel, technicianNames: [],
      minutes: travelMinutesFor(travelMinutes, fromRequestId, toRequestId),
      departureAt,
    }
    if (!leg.technicianNames.includes(name)) leg.technicianNames.push(name)
    legs.set(key, leg)
  }
  const visitLabel = visit.label ?? 'This visit'
  if (window && start !== null && end !== null) {
    const visitStart = start
    const visitEnd = end + customerServicePickupMinutes
    for (const technician of technicians) {
      const id = String(technician.id)
      const name = technician.name ?? 'Unknown technician'
      const known = []
      for (const entry of agenda.filter((item) => String(item.technicianId) === id && item.blocksAvailability)) {
        if (!entry.date || entry.windowUncertain || entry.start === null || entry.end === null) {
          addError('agenda', `${entry.requestNumber}: the recorded date or two-hour window is incomplete; availability cannot be verified.`)
        } else {
          known.push({ ...entry, from: timeToMinutes(entry.start), to: timeToMinutes(entry.end) })
        }
      }
      known.sort((left, right) => left.from - right.from)
      for (const entry of known) {
        if (visitStart < entry.to && entry.from < visitEnd) {
          addError('agenda', `${name} is already busy with ${entry.requestNumber} from ${formatServiceTime(entry.start)} to ${formatServiceTime(entry.end)} (work plus pickup). Choose another time, technician or day.`)
        }
      }
      const arrival = (leaveAt, travel) => formatServiceTime(minutesToTime(leaveAt + travel))
      // The previous visit is the one this technician leaves last before the new start.
      const before = known.filter((entry) => entry.to <= visitStart)
        .reduce((latest, entry) => (!latest || entry.to > latest.to ? entry : latest), null)
      const after = known.find((entry) => entry.from >= visitEnd)
      if (before) {
        addLeg(before.requestId, visit.requestId, before.requestNumber, visitLabel, name, departureFor(before.end))
        const travel = travelMinutesFor(travelMinutes, before.requestId, visit.requestId)
        if (travel === null) {
          warnings.push({ field: 'agenda', travelPending: true, message: `Travel time from ${before.requestNumber} to this visit is missing for ${name}. Calculate it with Google Maps or type it.` })
        } else if (before.to + travel > visitStart) {
          addError('agenda', `${name} cannot reach this visit in time from ${before.requestNumber}: leaving at ${formatServiceTime(before.end)} with ${travel} min of travel, they arrive at ${arrival(before.to, travel)}.`)
        }
      }
      if (after) {
        addLeg(visit.requestId, after.requestId, visitLabel, after.requestNumber, name, departureFor(minutesToTime(visitEnd)))
        const travel = travelMinutesFor(travelMinutes, visit.requestId, after.requestId)
        if (travel === null) {
          warnings.push({ field: 'agenda', travelPending: true, message: `Travel time from this visit to ${after.requestNumber} is missing for ${name}. Calculate it with Google Maps or type it.` })
        } else if (visitEnd + travel > after.from) {
          addError('agenda', `${name} cannot reach ${after.requestNumber} in time: leaving this visit at ${formatServiceTime(minutesToTime(visitEnd))} with ${travel} min of travel, they arrive at ${arrival(visitEnd, travel)} and ${after.requestNumber} starts at ${formatServiceTime(after.start)}.`)
        }
      }
    }
  }
  return {
    errors, warnings, window: window ?? null,
    internalEnd: end === null ? '' : minutesToTime(end),
    pickupEnd: end === null ? '' : minutesToTime(end + customerServicePickupMinutes),
    travelLegs: [...legs.values()],
  }
}

// Delay margin of each visit in one technician's day: how many minutes it can start late
// (traffic, a longer job before it) while it and every later visit still finish, with
// pickup, inside their customer windows and the workday.
//   margin = min(own slack, wait before the next visit + margin of the next visit)
// Own slack is the window close (or workday end) minus the end of work plus pickup. The
// leg to the next visit absorbs wait + margin of the next visit of extra driving.
// An unknown leg or window makes the margins before it unknown (null), never zero; the
// own slack is still an upper bound.
// visits: [{ requestId, start, end, windowEnd }], end = work end + pickup (agenda shape).
export function visitDelayMargins({ visits = [], travelMinutes = {} }) {
  const workdayClose = timeToMinutes(customerServiceWorkday.endsAt) + customerServicePickupMinutes
  const sorted = visits
    .map((visit) => ({
      requestId: visit.requestId, from: timeToMinutes(visit.start), to: timeToMinutes(visit.end),
      close: timeToMinutes(visit.windowEnd),
    }))
    .sort((left, right) => (left.from ?? 0) - (right.from ?? 0))
  const results = []
  let following = null
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const { requestId, from, to, close } = sorted[index]
    const known = from !== null && to !== null && close !== null
    const ownSlack = known ? Math.min(close, workdayClose) - to : null
    let margin = ownSlack
    let nextLeg = null
    if (following) {
      const travel = travelMinutesFor(travelMinutes, requestId, following.requestId)
      const waitMinutes = known && travel !== null && following.from !== null ? following.from - (to + travel) : null
      const absorbsMinutes = waitMinutes === null || following.margin === null ? null : waitMinutes + following.margin
      nextLeg = { toRequestId: following.requestId, waitMinutes, absorbsMinutes }
      margin = ownSlack === null || absorbsMinutes === null ? null : Math.min(ownSlack, absorbsMinutes)
    }
    results.unshift({ requestId, ownSlack, margin, nextLeg })
    following = { requestId, from, margin }
  }
  return results
}
