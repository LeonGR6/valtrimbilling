import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import { requestToPrototypeFormValues } from './newRequestPrototype.js'
import { buildRequestReviewSummary, effectiveRequestWorkflowStage } from './requestInbox.js'
import { customerServiceTimeZone, getCustomerServiceClock, toIsoDate } from './dates.js'
import { assignedPrototypeTechnicianIds, prototypeTechnicians } from '../data/prototypeTechnicians.js'

export const prototypePlanningHours = { workdayStartsAt: '07:00', workdayEndsAt: '15:30' }
// Each visit keeps the technician busy for 10 minutes after the work to collect tools.
export const prototypePickupMinutes = 10

const busyStages = ['CONFIRMED', 'AWAITING_CUSTOMER', 'WORKING', 'COMPLETED']
const reservedStages = ['CONFIRMED', 'AWAITING_CUSTOMER', 'WORKING']

function minutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(String(time ?? ''))) return null
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function timeFromMinutes(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 1440) return ''
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ''))) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return toIsoDate(date) === value ? date : null
}

// Manual travel estimates are keyed by "fromRequestId>toRequestId". A missing or invalid
// value is unknown, never zero.
function manualTravelMinutes(travel, fromId, toId) {
  const value = travel?.[`${fromId}>${toId}`]
  return Number.isInteger(value) && value >= 0 ? value : null
}

export function getPrototypePlanningTechnicians(technicians = prototypeTechnicians) {
  return technicians.map(({ id, name }) => ({ id: String(id), name }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function proposalPlanningSignature(request) {
  const values = requestToPrototypeFormValues(request)
  return JSON.stringify({
    builder: values.builderName, community: values.community, lot: values.lotNumber,
    address: values.address, coordinates: values.coordinates,
    serviceKind: values.serviceKind, workType: values.workType, task: values.serviceTask,
    items: values.requestedWorkItems.map(({ description, materialRequired, chargeable }) => (
      { description, materialRequired, chargeable }
    )),
    duration: Number(request.estimatedDurationMinutes), crew: Number(request.crewSize),
    reviewedAt: request.review?.completedAt ?? null,
  })
}

export function proposalDraftFormValues(draft, now = new Date()) {
  return {
    technicianIds: [...(draft?.technicianIds ?? [])],
    date: draft?.date ?? getCustomerServiceClock(now).date,
    windowStart: draft?.customerWindow?.start ?? '',
    internalStart: draft?.internalSlot?.start ?? '',
    travelMinutes: { ...(draft?.travelMinutes ?? {}) },
  }
}

// Sets or clears one manual travel estimate without mutating the current values.
export function changePrototypeTravelMinutes(values, key, input) {
  const travelMinutes = { ...(values.travelMinutes ?? {}) }
  const text = String(input ?? '').trim()
  if (/^\d{1,3}$/u.test(text)) travelMinutes[key] = Number(text)
  else delete travelMinutes[key]
  return { ...values, travelMinutes }
}

export function changePrototypeProposalWindow(values, windowStart) {
  if (windowStart === values.windowStart) return values
  return { ...values, windowStart, internalStart: windowStart }
}

export function proposalDraftHasChanges(values, baseline) {
  const comparable = (entry) => [
    entry.date, entry.windowStart, entry.internalStart, [...entry.technicianIds].sort(),
    Object.entries(entry.travelMinutes ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  ]
  return JSON.stringify(comparable(values)) !== JSON.stringify(comparable(baseline))
}

// Occupied time per technician. Known work occupies its time plus pickup, not the whole
// arrival window. If the work time is unknown, the whole arrival window stays busy.
export function getPrototypeTechnicianAgenda(requests, technicianIds, date, technicians = prototypeTechnicians) {
  const ids = new Set(technicianIds)
  return requests.flatMap((request) => {
    const stage = effectiveRequestWorkflowStage(request)
    const assignedIds = assignedPrototypeTechnicianIds(request, technicians).filter((id) => ids.has(id))
    if (!assignedIds.length || !busyStages.includes(stage)) return []
    const entryDate = request.customerWindow?.date
    // A sent/confirmed record without a usable date must not imply availability on other days.
    if (validDate(entryDate) && entryDate !== date) return []
    const start = minutes(request.internalSlot?.start)
    const end = minutes(request.internalSlot?.end)
    const hasInternalSlot = start !== null && end !== null && end > start
    const windowStart = minutes(request.customerWindow?.start)
    const windowEnd = minutes(request.customerWindow?.end)
    const hasWindow = serviceCustomerWindowOptions.some((window) => (
      window.start === request.customerWindow?.start && window.end === request.customerWindow?.end
    ))
    const occupiedStart = hasInternalSlot ? start : (hasWindow ? windowStart : null)
    const occupiedEnd = hasInternalSlot ? end + prototypePickupMinutes : (hasWindow ? windowEnd : null)
    return assignedIds.map((id) => ({
      requestId: request.id, requestNumber: request.requestNumber,
      technicianId: id, technicianName: technicians.find((person) => String(person.id) === id)?.name ?? 'Unknown technician', stage,
      date: validDate(entryDate) ? entryDate : null,
      customerWindow: request.customerWindow ?? null,
      internalSlot: hasInternalSlot ? { start: request.internalSlot.start, end: request.internalSlot.end } : null,
      start: occupiedStart === null ? null : timeFromMinutes(occupiedStart),
      end: occupiedEnd === null ? null : timeFromMinutes(occupiedEnd),
      windowUncertain: !hasWindow,
      timingUncertain: !hasInternalSlot,
      blocksAvailability: reservedStages.includes(stage),
      issue: request.issue || request.description || '',
    }))
  }).sort((left, right) => String(left.start ?? '').localeCompare(String(right.start ?? '')))
}

export function validatePrototypeProposalDraft({ requestId, values, requests, technicians = prototypeTechnicians, now = new Date() }) {
  const request = requests.find((entry) => String(entry.id) === String(requestId))
  const errors = []
  const addError = (field, message) => errors.push({ field, message })
  // Warnings never claim viability, but they do not block a draft: drafts reserve nothing.
  const warnings = []
  const addWarning = (field, message) => warnings.push({ field, message })
  if (!request || effectiveRequestWorkflowStage(request) !== 'READY_TO_PROPOSE') {
    addError('request', 'Only Ready to propose requests can have a planning draft.')
  } else if (!request.review?.valtrimItemsConfirmed || !buildRequestReviewSummary(request).isComplete) {
    addError('request', 'Complete and approve the request information in Requests before planning.')
  }

  const duration = Number(request?.estimatedDurationMinutes)
  const crew = Number(request?.crewSize)
  const roster = getPrototypePlanningTechnicians(technicians)
  const ids = Array.isArray(values.technicianIds) ? values.technicianIds : []
  const uniqueIds = [...new Set(ids)]
  if (!ids.length) addError('technicianIds', 'Select the technicians assigned to this work.')
  else if (ids.length !== uniqueIds.length || uniqueIds.some((id) => !roster.some((person) => person.id === id))) {
    addError('technicianIds', 'Select distinct technicians recorded in this simulation.')
  } else if (uniqueIds.length < crew) {
    addError('technicianIds', `This work requires ${crew} people; ${uniqueIds.length} selected.`)
  }

  const clock = getCustomerServiceClock(now)
  const date = validDate(values.date)
  if (!date) addError('date', 'Select a valid service date.')
  else if (values.date < clock.date) addError('date', 'The service date cannot be in the past (California time).')
  else if ([0, 6].includes(date.getDay())) addError('date', 'Service appointments are Monday through Friday.')
  else if (request?.customerUnavailableDates?.includes(values.date)) {
    addError('date', 'The customer has recorded this date as unavailable.')
  }
  // Work should be completed by the due date. How late work is handled is still an open
  // decision, so a later date is flagged without blocking an overdue request from planning.
  const dueOn = validDate(request?.dueOn) ? request.dueOn : null
  if (date && dueOn && values.date > dueOn) {
    addWarning('date', `This date is after the due date ${dueOn}. The work would be completed late.`)
  }

  const window = serviceCustomerWindowOptions.find((option) => option.start === values.windowStart)
  if (!window) addError('windowStart', 'Select an allowed two-hour customer window.')
  const start = minutes(values.internalStart)
  const end = start !== null && Number.isInteger(duration) ? start + duration : null
  const internalEnd = end === null ? '' : timeFromMinutes(end)
  if (start === null) addError('internalStart', 'Select the internal work start time.')
  else if (window && (start < minutes(window.start) || start >= minutes(window.end))) {
    addError('internalStart', 'Work must start within the selected customer arrival window.')
  }
  if (start !== null && end !== null && (
    start < minutes(prototypePlanningHours.workdayStartsAt)
    || end > minutes(prototypePlanningHours.workdayEndsAt)
  )) addError('internalStart', 'Internal work must fit within 7:00 AM–3:30 PM.')
  if (window && end !== null && end + prototypePickupMinutes > minutes(window.end)) {
    addError('internalStart', `Work and pickup must finish before the customer window closes at ${window.end}.`)
  }
  if (date && values.date === clock.date && start !== null
    && start <= clock.minutesSinceMidnight) {
    addError('internalStart', 'The internal work start time cannot be in the past (California time).')
  }

  // The new visit occupies [start, end + pickup]. Only its neighbours in each technician's day
  // need travel checks: inserting it between A and B requires A→new and new→B, not A→B.
  const agenda = getPrototypeTechnicianAgenda(requests, uniqueIds, values.date, technicians)
  // One leg per origin→destination pair; technicians sharing a leg share its estimate.
  const legs = new Map()
  const addLeg = (fromRequestId, toRequestId, fromLabel, toLabel, name) => {
    const key = `${fromRequestId}>${toRequestId}`
    const leg = legs.get(key) ?? {
      key, fromRequestId, toRequestId, fromLabel, toLabel, technicianNames: [],
      minutes: manualTravelMinutes(values.travelMinutes, fromRequestId, toRequestId),
    }
    if (!leg.technicianNames.includes(name)) leg.technicianNames.push(name)
    legs.set(key, leg)
  }
  const visitLabel = request?.requestNumber ?? 'This visit'
  if (date && window && start !== null && end !== null) {
    const visitStart = start
    const visitEnd = end + prototypePickupMinutes
    for (const id of uniqueIds) {
      const name = technicians.find((person) => String(person.id) === id)?.name ?? 'Unknown technician'
      const busy = agenda.filter((entry) => entry.technicianId === id && entry.blocksAvailability)
      const known = []
      for (const entry of busy) {
        if (!entry.date || entry.windowUncertain || entry.start === null || entry.end === null) {
          addError('agenda', `${entry.requestNumber}: the recorded date or two-hour window is incomplete; availability cannot be verified.`)
        } else {
          known.push({ ...entry, from: minutes(entry.start), to: minutes(entry.end) })
        }
      }
      known.sort((left, right) => left.from - right.from)
      for (const entry of known) {
        if (visitStart < entry.to && entry.from < visitEnd) {
          addError('agenda', `${name} has an internal work conflict with the reserved schedule of ${entry.requestNumber} (${entry.start}–${entry.end}). Choose another window, technician or day.`)
        }
      }
      // The previous visit is the one this technician leaves last before the new start.
      const before = known.filter((entry) => entry.to <= visitStart)
        .reduce((latest, entry) => (!latest || entry.to > latest.to ? entry : latest), null)
      const after = known.find((entry) => entry.from >= visitEnd)
      if (before) {
        addLeg(before.requestId, requestId, before.requestNumber, visitLabel, name)
        const travel = manualTravelMinutes(values.travelMinutes, before.requestId, requestId)
        if (travel === null) {
          addWarning('agenda', `Travel time pending: enter the manual estimate from ${before.requestNumber} to this visit for ${name}.`)
        } else if (before.to + travel > visitStart) {
          addError('agenda', `${name} cannot reach this visit from ${before.requestNumber} in time, including the manual travel estimate.`)
        }
      }
      if (after) {
        addLeg(requestId, after.requestId, visitLabel, after.requestNumber, name)
        const travel = manualTravelMinutes(values.travelMinutes, requestId, after.requestId)
        if (travel === null) {
          addWarning('agenda', `Travel time pending: enter the manual estimate from this visit to ${after.requestNumber} for ${name}.`)
        } else if (visitEnd + travel > after.from) {
          addError('agenda', `${name} cannot reach ${after.requestNumber} after this visit in time, including the manual travel estimate.`)
        }
      }
    }
  }
  const pickupEnd = end === null ? '' : timeFromMinutes(end + prototypePickupMinutes)
  return {
    isValid: errors.length === 0, errors, warnings, internalEnd, pickupEnd, agenda,
    travelLegs: [...legs.values()], dateIsValid: Boolean(date),
  }
}

export function createPrototypeProposalDraft({ requestId, values, requests, technicians = prototypeTechnicians, now = new Date() }) {
  const validation = validatePrototypeProposalDraft({ requestId, values, requests, technicians, now })
  if (!validation.isValid) throw new Error(validation.errors.map((error) => error.message).join(' '))
  const request = requests.find((entry) => String(entry.id) === String(requestId))
  const window = serviceCustomerWindowOptions.find((option) => option.start === values.windowStart)
  return {
    requestId: request.id, technicianIds: [...values.technicianIds], date: values.date,
    timeZone: customerServiceTimeZone,
    customerWindow: { date: values.date, start: window.start, end: window.end, exceptional: window.exceptional },
    internalSlot: { start: values.internalStart, end: validation.internalEnd },
    // Keep only the estimates for this sequence; they are revalidated with the draft.
    travelMinutes: Object.fromEntries(validation.travelLegs
      .filter((leg) => leg.minutes !== null).map((leg) => [leg.key, leg.minutes])),
    estimatedDurationMinutes: Number(request.estimatedDurationMinutes), crewSize: Number(request.crewSize),
    requestSignature: proposalPlanningSignature(request), savedAt: now.toISOString(),
  }
}
