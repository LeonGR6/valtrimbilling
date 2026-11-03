import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import { requestToPrototypeFormValues } from './newRequestPrototype.js'
import { buildRequestReviewSummary, effectiveRequestWorkflowStage } from './requestInbox.js'
import { customerServiceTimeZone, getCustomerServiceClock, toIsoDate } from './dates.js'
import { assignedPrototypeTechnicianIds, prototypeTechnicians } from '../data/prototypeTechnicians.js'

export const prototypePlanningHours = { workdayStartsAt: '07:00', workdayEndsAt: '15:30' }

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
  }
}

export function changePrototypeProposalWindow(values, windowStart) {
  if (windowStart === values.windowStart) return values
  return { ...values, windowStart, internalStart: windowStart }
}

export function proposalDraftHasChanges(values, baseline) {
  const comparable = (entry) => [
    entry.date, entry.windowStart, entry.internalStart, [...entry.technicianIds].sort(),
  ]
  return JSON.stringify(comparable(values)) !== JSON.stringify(comparable(baseline))
}

export function getPrototypeTechnicianAgenda(requests, technicianIds, date, technicians = prototypeTechnicians) {
  const ids = new Set(technicianIds)
  return requests.flatMap((request) => {
    const stage = effectiveRequestWorkflowStage(request)
    const assignedIds = assignedPrototypeTechnicianIds(request, technicians).filter((id) => ids.has(id))
    if (!assignedIds.length || !['CONFIRMED', 'AWAITING_CUSTOMER', 'COMPLETED'].includes(stage)) return []
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
    // Occupy the entire arrival window, plus any internal work extending beyond it.
    const occupiedStarts = [hasWindow ? windowStart : null, hasInternalSlot ? start : null]
      .filter((value) => value !== null)
    const occupiedEnds = [hasWindow ? windowEnd : null, hasInternalSlot ? end : null]
      .filter((value) => value !== null)
    return assignedIds.map((id) => ({
      requestId: request.id, requestNumber: request.requestNumber,
      technicianId: id, technicianName: technicians.find((person) => String(person.id) === id)?.name ?? 'Unknown technician', stage,
      date: validDate(entryDate) ? entryDate : null,
      customerWindow: request.customerWindow ?? null,
      internalSlot: hasInternalSlot ? { start: request.internalSlot.start, end: request.internalSlot.end } : null,
      start: occupiedStarts.length ? timeFromMinutes(Math.min(...occupiedStarts)) : null,
      end: occupiedEnds.length ? timeFromMinutes(Math.max(...occupiedEnds)) : null,
      windowUncertain: !hasWindow,
      timingUncertain: !hasInternalSlot,
      blocksAvailability: stage !== 'COMPLETED',
      issue: request.issue || request.description || '',
    }))
  }).sort((left, right) => String(left.start ?? '').localeCompare(String(right.start ?? '')))
}

export function validatePrototypeProposalDraft({ requestId, values, requests, technicians = prototypeTechnicians, now = new Date() }) {
  const request = requests.find((entry) => String(entry.id) === String(requestId))
  const errors = []
  const addError = (field, message) => errors.push({ field, message })
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
  if (date && values.date === clock.date && start !== null
    && start <= clock.minutesSinceMidnight) {
    addError('internalStart', 'The internal work start time cannot be in the past (California time).')
  }

  const agenda = getPrototypeTechnicianAgenda(requests, uniqueIds, values.date, technicians)
  if (date && window) {
    const windowStart = minutes(window.start)
    const windowEnd = minutes(window.end)
    const occupiedStart = Math.min(windowStart, start ?? windowStart)
    const occupiedEnd = Math.max(windowEnd, end ?? windowEnd)
    for (const entry of agenda.filter((item) => item.blocksAvailability)) {
      if (!entry.date || entry.windowUncertain || !entry.start || !entry.end) {
        addError('agenda', `${entry.requestNumber}: the recorded date or two-hour window is incomplete; availability cannot be verified.`)
      } else if (windowStart < minutes(entry.customerWindow.end) && windowEnd > minutes(entry.customerWindow.start)) {
        addError('agenda', `${entry.technicianName} already reserves the full customer window ${entry.customerWindow.start}–${entry.customerWindow.end} for ${entry.requestNumber}${entry.stage === 'AWAITING_CUSTOMER' ? ' · reserved pending customer response' : ' · confirmed'}. Choose another window, technician or day.`)
      } else if (occupiedStart < minutes(entry.end) && occupiedEnd > minutes(entry.start)) {
        addError('agenda', `${entry.technicianName} has an internal work conflict with the reserved schedule of ${entry.requestNumber} (${entry.start}–${entry.end}). Choose another window, technician or day.`)
      }
    }
  }
  return { isValid: errors.length === 0, errors, internalEnd, agenda, dateIsValid: Boolean(date) }
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
    estimatedDurationMinutes: Number(request.estimatedDurationMinutes), crewSize: Number(request.crewSize),
    requestSignature: proposalPlanningSignature(request), savedAt: now.toISOString(),
  }
}
