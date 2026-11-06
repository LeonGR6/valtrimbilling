import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import { requestToPrototypeFormValues } from './newRequestPrototype.js'
import { buildRequestReviewSummary, effectiveRequestWorkflowStage } from './requestInbox.js'
import { customerServiceTimeZone, getCustomerServiceClock } from './dates.js'
import { assignedPrototypeTechnicianIds, prototypeTechnicians } from '../data/prototypeTechnicians.js'
import {
  checkVisitCapacity, checkVisitDate, customerServicePickupMinutes, customerServiceWorkday,
  minutesToTime as timeFromMinutes, parseServiceDate as validDate, timeToMinutes as minutes,
} from './customerServiceScheduling.js'

export const prototypePlanningHours = {
  workdayStartsAt: customerServiceWorkday.startsAt, workdayEndsAt: customerServiceWorkday.endsAt,
}
// Each visit keeps the technician busy for 10 minutes after the work to collect tools.
export const prototypePickupMinutes = customerServicePickupMinutes

const busyStages = ['CONFIRMED', 'AWAITING_CUSTOMER', 'WORKING', 'COMPLETED']
const reservedStages = ['CONFIRMED', 'AWAITING_CUSTOMER', 'WORKING']

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
  const dateCheck = checkVisitDate({
    date: values.date, workStart: values.internalStart, today: clock.date,
    nowMinutes: clock.minutesSinceMidnight,
    unavailableDates: request?.customerUnavailableDates ?? [], dueOn: request?.dueOn ?? null,
  })
  errors.push(...dateCheck.errors)
  warnings.push(...dateCheck.warnings)

  // The same capacity rules the server applies before registering an appointment.
  const agenda = getPrototypeTechnicianAgenda(requests, uniqueIds, values.date, technicians)
  const capacity = checkVisitCapacity({
    visit: {
      requestId, label: request?.requestNumber ?? 'This visit', windowStart: values.windowStart,
      workStart: values.internalStart, durationMinutes: duration,
    },
    technicians: uniqueIds.map((id) => ({
      id, name: technicians.find((person) => String(person.id) === id)?.name ?? 'Unknown technician',
    })),
    agenda: dateCheck.dateIsValid ? agenda : [],
    travelMinutes: values.travelMinutes,
  })
  errors.push(...capacity.errors)
  warnings.push(...capacity.warnings)
  return {
    isValid: errors.length === 0, errors, warnings,
    // Registering reserves capacity, so every travel leg must be known first.
    travelPending: warnings.some((warning) => warning.travelPending),
    // A date after the due date cannot be registered while on-time days remain.
    pastDue: warnings.some((warning) => warning.pastDue),
    internalEnd: capacity.internalEnd, pickupEnd: capacity.pickupEnd, agenda,
    travelLegs: capacity.travelLegs, dateIsValid: dateCheck.dateIsValid,
  }
}

// Body for the customer-service-appointments Edge Function, which revalidates it.
// Only the travel legs of this sequence are sent, and all of them are known.
export function buildAppointmentRegistration({ request, values, validation, acceptance }) {
  return {
    requestId: Number(request.id),
    expectedRequestUpdatedAt: request.updatedAt,
    technicianIds: values.technicianIds.map(Number),
    date: values.date,
    windowStart: values.windowStart,
    workStart: values.internalStart,
    travelMinutes: Object.fromEntries(validation.travelLegs
      .filter((leg) => leg.minutes !== null).map((leg) => [leg.key, leg.minutes])),
    acceptance,
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

// Business days searched when the request is already overdue (no on-time day left).
export const proposalSuggestionSearchBusinessDays = 10
const suggestionStepMinutes = 15

// Proposes viable times for review (approved rule: suggest, never apply). It only reads
// the schedule and returns plain values; filling the form is the user's choice and
// registering still goes through the server. The first viable start of each window is
// listed, earliest first, using the same validator as the form.
export function suggestProposalTimes({ requestId, values, requests, technicians = prototypeTechnicians, now = new Date(), limit = 3 }) {
  const request = requests.find((entry) => String(entry.id) === String(requestId))
  const current = validatePrototypeProposalDraft({ requestId, values, requests, technicians, now })
  // Request or technician problems make every time invalid; the form already explains them.
  if (!request || current.errors.some((error) => ['request', 'technicianIds'].includes(error.field))) {
    return { suggestions: [], searchedThrough: null }
  }

  const today = getCustomerServiceClock(now).date
  const onTimeUntil = validDate(request.dueOn) && request.dueOn >= today ? request.dueOn : null
  const suggestions = []
  let searchedThrough = null
  let businessDays = 0
  for (const cursor = new Date(`${today}T12:00:00Z`); suggestions.length < limit; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10)
    if (onTimeUntil && date > onTimeUntil) break
    if ([0, 6].includes(cursor.getUTCDay())) continue
    businessDays += 1
    if (!onTimeUntil && businessDays > proposalSuggestionSearchBusinessDays) break
    searchedThrough = date

    for (const window of serviceCustomerWindowOptions) {
      for (let start = minutes(window.start); start < minutes(window.end); start += suggestionStepMinutes) {
        const internalStart = timeFromMinutes(start)
        if (date === values.date && window.start === values.windowStart && internalStart === values.internalStart) continue
        const candidate = { ...values, date, windowStart: window.start, internalStart }
        const result = validatePrototypeProposalDraft({ requestId, values: candidate, requests, technicians, now })
        if (!result.isValid || result.pastDue) continue
        suggestions.push({
          date, windowStart: window.start, windowLabel: window.label, internalStart,
          internalEnd: result.internalEnd, pickupEnd: result.pickupEnd, travelPending: result.travelPending,
        })
        break
      }
      if (suggestions.length >= limit) break
    }
  }
  return { suggestions, searchedThrough }
}

export function applyProposalSuggestion(values, suggestion) {
  return { ...values, date: suggestion.date, windowStart: suggestion.windowStart, internalStart: suggestion.internalStart }
}
