// Where the request fits next to a nearby scheduled visit (block 7 of the routing
// plan). It only reads and returns plain values: "Use this slot" fills the form, and
// registering still goes through the server, which checks capacity again.
//
// Rules approved on 9 Nov 2026 (docs/customer-service-nearby-visits-plan.md):
// - Only Near or Medium visits by driving miles are used, the 3 nearest.
// - Never after the due date nor on a customer-unavailable day (the nearby period).
// - A HIGH priority request only groups on its earliest available date.
// - Same technician as the nearby visit. When the crew needs more people, another
//   technician free that day is added with a warning; with nobody free, no suggestion.
// - The earliest available slot is always shown next to them.
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import { minutesToTime, timeToMinutes, travelMinutesFor } from './customerServiceScheduling.js'
import { proposalSuggestionStepMinutes, suggestProposalTimes, validatePrototypeProposalDraft } from './proposalDraft.js'

export const nearbySlotLimit = 3
const groupingBands = ['GREEN', 'YELLOW']
// Technician combinations tried for the earliest slot, so a large roster stays fast.
const maxTechnicianSets = 30

const crewSize = (request) => Math.max(1, Number(request.crewSize) || 1)

const joinNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

// Every combination of `size` ids, in roster order.
export function technicianSets(ids, size, limit = maxTechnicianSets) {
  const sets = []
  const pick = (start, chosen) => {
    if (sets.length >= limit) return
    if (chosen.length === size) {
      sets.push(chosen)
      return
    }
    for (let index = start; index < ids.length; index += 1) pick(index + 1, [...chosen, ids[index]])
  }
  if (size >= 0) pick(0, [])
  return sets
}

// Driving the new visit adds to one technician's day, and which saved visit it sits
// next to: (previous → new) + (new → next) − (previous → next). The extra minutes are
// null while a leg is unknown. Null when the visit is not next to the anchor.
export function insertionDetails({ validation, requestId, anchorId, technicianName, travelMinutes = {} }) {
  const legs = validation.travelLegs.filter((leg) => leg.technicianNames.includes(technicianName))
  const before = legs.find((leg) => String(leg.toRequestId) === String(requestId))
  const after = legs.find((leg) => String(leg.fromRequestId) === String(requestId))
  if (String(before?.fromRequestId) !== String(anchorId) && String(after?.toRequestId) !== String(anchorId)) return null
  const parts = [before, after].filter(Boolean)
  const baseline = before && after ? travelMinutesFor(travelMinutes, before.fromRequestId, after.toRequestId) : 0
  const known = parts.every((leg) => leg.minutes !== null) && baseline !== null
  return {
    extraMinutes: known ? Math.max(0, parts.reduce((total, leg) => total + leg.minutes, 0) - baseline) : null,
    legs: parts,
  }
}

// Fewer extra minutes first; unknown minutes last; on a tie the earlier time stays.
const rank = (slot) => slot.insertion.extraMinutes ?? Number.POSITIVE_INFINITY

function bestSlotNextTo({ request, requests, technicians, technicianIds, anchor, technicianName, travelMinutes, now }) {
  let best = null
  for (const window of serviceCustomerWindowOptions) {
    for (let start = timeToMinutes(window.start); start < timeToMinutes(window.end); start += proposalSuggestionStepMinutes) {
      const values = { technicianIds, date: anchor.date, windowStart: window.start, internalStart: minutesToTime(start), travelMinutes }
      const validation = validatePrototypeProposalDraft({ requestId: request.id, values, requests, technicians, now })
      if (!validation.isValid || validation.pastDue) continue
      const insertion = insertionDetails({
        validation, requestId: request.id, anchorId: anchor.requestId, technicianName, travelMinutes,
      })
      if (!insertion) continue
      const slot = { window, values, validation, insertion }
      if (!best || rank(slot) < rank(best)) best = slot
    }
  }
  return best
}

function suggestNextTo({ request, requests, technicians, anchor, travelMinutes, now }) {
  const names = new Map(technicians.map((person) => [person.id, person.name]))
  const anchorIds = (anchor.technicianIds ?? []).filter((id) => names.has(id))
  if (!anchorIds.length) return { anchor, fits: false }
  const crew = crewSize(request)
  const others = technicians.map((person) => person.id).filter((id) => !anchorIds.includes(id))
  const sets = anchorIds.length >= crew
    ? technicianSets(anchorIds, crew)
    : technicianSets(others, crew - anchorIds.length).map((added) => [...anchorIds, ...added])

  let best = null
  for (const technicianIds of sets) {
    const lead = technicianIds.find((id) => anchorIds.includes(id))
    const slot = bestSlotNextTo({
      request, requests, technicians, technicianIds, anchor, technicianName: names.get(lead), travelMinutes, now,
    })
    if (slot && (!best || rank(slot) < rank(best))) best = slot
  }
  if (!best) return { anchor, fits: false }

  const added = best.values.technicianIds.filter((id) => !anchorIds.includes(id)).map((id) => names.get(id))
  return {
    anchor,
    fits: true,
    date: best.values.date,
    windowStart: best.window.start,
    windowLabel: best.window.label,
    internalStart: best.values.internalStart,
    internalEnd: best.validation.internalEnd,
    pickupEnd: best.validation.pickupEnd,
    technicianIds: best.values.technicianIds,
    technicianNames: best.values.technicianIds.map((id) => names.get(id)),
    extraMinutes: best.insertion.extraMinutes,
    travelPending: best.validation.travelPending,
    travelLegs: best.validation.travelLegs,
    warning: added.length
      ? `Needs ${added.length === 1 ? 'a second technician' : 'more technicians'}: ${joinNames(added)} ${added.length === 1 ? 'is' : 'are'} available that day.`
      : null,
  }
}

// The first viable slot for any technician combination of the crew size, so grouping
// can always be compared with the earliest date.
export function earliestAvailableSlot({ request, requests, technicians, travelMinutes = {}, now = new Date() }) {
  const names = new Map(technicians.map((person) => [person.id, person.name]))
  let best = null
  for (const technicianIds of technicianSets(technicians.map((person) => person.id), crewSize(request))) {
    const { suggestions: [first] } = suggestProposalTimes({
      requestId: request.id, requests, technicians, now, limit: 1,
      values: { technicianIds, date: '', windowStart: '', internalStart: '', travelMinutes },
    })
    if (first && (!best || `${first.date} ${first.internalStart}` < `${best.date} ${best.internalStart}`)) {
      best = { ...first, technicianIds, technicianNames: technicianIds.map((id) => names.get(id)) }
    }
  }
  return best
}

export function nearbySlotSuggestions({
  request, requests, technicians, candidates = [], drivingById = {}, travelMinutes = {}, now = new Date(),
}) {
  const earliest = earliestAvailableSlot({ request, requests, technicians, travelMinutes, now })
  const highPriority = request.priority === 'HIGH'
  const anchors = candidates
    .filter((candidate) => candidate.kind === 'VISIT' && groupingBands.includes(drivingById[candidate.requestId]?.band))
    // A high priority request does not wait to be grouped (decision 4).
    .filter((candidate) => !highPriority || candidate.date === earliest?.date)
    .sort((left, right) => drivingById[left.requestId].drivingMiles - drivingById[right.requestId].drivingMiles
      || left.date.localeCompare(right.date) || String(left.start).localeCompare(String(right.start)))
    .slice(0, nearbySlotLimit)
  return {
    earliest,
    highPriority,
    suggestions: anchors.map((anchor) => suggestNextTo({ request, requests, technicians, anchor, travelMinutes, now })),
  }
}
