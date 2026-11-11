// Where the request fits next to a nearby scheduled visit (block 7 of the routing
// plan). It only reads and returns plain values: "Use this slot" fills the form, and
// registering still goes through the server, which checks capacity again.
//
// Rules approved on 9 Nov 2026 (docs/customer-service-nearby-visits-plan.md):
// - Only Near or Medium visits by driving miles are used, the 3 nearest.
// - Never after the due date nor on a customer-unavailable day (the nearby period).
// - Same technician as the nearby visit. When the crew needs more people, another
//   technician free that day is added with a warning; with nobody free, no suggestion.
// - The earliest available slot is always shown next to them.
// Rules approved on 10 Nov 2026 (docs/customer-service-proposal-fit-plan.md):
// - D4: a slot next to a visit keeps at least 15 min of delay margin; tighter slots are
//   not offered. A slot whose margin is still unknown (travel pending) stays, ranked last.
// - Order: next to a nearby visit within the due date (D2), then the final days, then
//   the earliest available time.
// - Final days: the due date first (D1), then one business day back at a time.
// - D3: a HIGH priority request follows the same rules; it no longer only groups on its
//   earliest date (this replaces decision 4 of 9 Nov). Overdue requests have no final
//   days: the earliest time is the suggestion.
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import {
  customerServiceMinimumMarginMinutes, minutesToTime, parseServiceDate, timeToMinutes, travelLegKey, travelMinutesFor,
} from './customerServiceScheduling.js'
import {
  delayMarginLimit, proposalSuggestionStepMinutes, suggestProposalTimes, validatePrototypeProposalDraft,
} from './proposalDraft.js'
import { formatWeekdayDate, getCustomerServiceClock } from './dates.js'

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
// baselineLeg is the direct drive previous → next it replaces, leaving at the same time
// as previous → new, so its traffic minutes can be asked for the same moment (block R3).
// Without anchorId it describes the visit next to whatever neighbours it has.
export function insertionDetails({ validation, requestId, anchorId = null, technicianName, travelMinutes = {} }) {
  const legs = validation.travelLegs.filter((leg) => leg.technicianNames.includes(technicianName))
  const before = legs.find((leg) => String(leg.toRequestId) === String(requestId))
  const after = legs.find((leg) => String(leg.fromRequestId) === String(requestId))
  if (anchorId !== null && String(before?.fromRequestId) !== String(anchorId) && String(after?.toRequestId) !== String(anchorId)) {
    return null
  }
  const parts = [before, after].filter(Boolean)
  const baselineLeg = before && after
    ? {
      key: travelLegKey(before.fromRequestId, after.toRequestId),
      fromRequestId: before.fromRequestId, toRequestId: after.toRequestId,
      fromLabel: before.fromLabel, toLabel: after.toLabel, technicianNames: [technicianName],
      minutes: travelMinutesFor(travelMinutes, before.fromRequestId, after.toRequestId),
      departureAt: before.departureAt,
    }
    : null
  const baseline = baselineLeg ? baselineLeg.minutes : 0
  const known = parts.every((leg) => leg.minutes !== null) && baseline !== null
  return {
    extraMinutes: known ? Math.max(0, parts.reduce((total, leg) => total + leg.minutes, 0) - baseline) : null,
    legs: parts,
    baselineLeg,
  }
}

// Fewer extra minutes first; unknown minutes last; on a tie the earlier time stays.
const rank = (slot) => slot.insertion.extraMinutes ?? Number.POSITIVE_INFINITY

// Highest margin among the slots dropped for being too tight, so the row can say why.
const widest = (current, value) => (current === null || value > current ? value : current)

function bestSlotNextTo({ request, requests, technicians, technicianIds, anchor, technicianName, travelMinutes, now }) {
  let best = null
  let tightMargin = null
  for (const window of serviceCustomerWindowOptions) {
    for (let start = timeToMinutes(window.start); start < timeToMinutes(window.end); start += proposalSuggestionStepMinutes) {
      const values = { technicianIds, date: anchor.date, windowStart: window.start, internalStart: minutesToTime(start), travelMinutes }
      const validation = validatePrototypeProposalDraft({ requestId: request.id, values, requests, technicians, now })
      if (!validation.isValid || validation.pastDue) continue
      const insertion = insertionDetails({
        validation, requestId: request.id, anchorId: anchor.requestId, technicianName, travelMinutes,
      })
      if (!insertion) continue
      const limit = delayMarginLimit(validation.delay)
      if (limit !== null && limit < customerServiceMinimumMarginMinutes) {
        tightMargin = widest(tightMargin, Math.max(0, limit))
        continue
      }
      const slot = { window, values, validation, insertion }
      if (!best || rank(slot) < rank(best)) best = slot
    }
  }
  return { best, tightMargin }
}

function suggestNextTo({ request, requests, technicians, anchor, travelMinutes, now }) {
  const names = new Map(technicians.map((person) => [person.id, person.name]))
  const anchorIds = (anchor.technicianIds ?? []).filter((id) => names.has(id))
  if (!anchorIds.length) return { anchor, fits: false, tightMargin: null }
  const crew = crewSize(request)
  const others = technicians.map((person) => person.id).filter((id) => !anchorIds.includes(id))
  const sets = anchorIds.length >= crew
    ? technicianSets(anchorIds, crew)
    : technicianSets(others, crew - anchorIds.length).map((added) => [...anchorIds, ...added])

  let best = null
  let tightMargin = null
  for (const technicianIds of sets) {
    const lead = technicianIds.find((id) => anchorIds.includes(id))
    const found = bestSlotNextTo({
      request, requests, technicians, technicianIds, anchor, technicianName: names.get(lead), travelMinutes, now,
    })
    if (found.tightMargin !== null) tightMargin = widest(tightMargin, found.tightMargin)
    if (found.best && (!best || rank(found.best) < rank(best))) best = found.best
  }
  // tightMargin: it would fit, but only with less margin than the minimum.
  if (!best) return { anchor, fits: false, tightMargin }

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
    margin: best.validation.delay?.margin ?? null,
    travelPending: best.validation.travelPending,
    travelLegs: best.validation.travelLegs,
    baselineLeg: best.insertion.baselineLeg,
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

const dayOf = (cursor) => cursor.toISOString().slice(0, 10)
const isBusinessDay = (cursor) => ![0, 6].includes(cursor.getUTCDay())

// On-time business days the customer can still use after `date`, up to the due date.
export function businessDaysLeft({ date, dueOn, unavailableDates = [] }) {
  if (!parseServiceDate(date) || !parseServiceDate(dueOn)) return null
  let count = 0
  for (const cursor = new Date(`${date}T12:00:00Z`); ;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (dayOf(cursor) > dueOn) return count
    if (isBusinessDay(cursor) && !unavailableDates.includes(dayOf(cursor))) count += 1
  }
}

// "Due Mon, Nov 23 · 1 business day left" under each suggestion, so the coordinator sees
// how much room is left if the customer says no.
export function deadlineLabel({ date, request, now = new Date() }) {
  const dueOn = request.dueOn
  if (!parseServiceDate(dueOn)) return null
  if (getCustomerServiceClock(now).date > dueOn) return `Overdue since ${formatWeekdayDate(dueOn)}`
  const left = businessDaysLeft({ date, dueOn, unavailableDates: request.customerUnavailableDates ?? [] })
  if (left === null) return null
  const due = `Due ${formatWeekdayDate(dueOn)}`
  if (left === 0) return `${due} · last on-time day`
  return `${due} · ${left} business ${left === 1 ? 'day' : 'days'} left`
}

// The first time that fits on one day for any technician combination. On a day the
// technician already works, each neighbouring visit must be Near or Medium and the visit
// keeps the minimum margin (fit plan, section 4, point 3).
function firstSlotOnDay({ request, requests, technicians, date, drivingById, travelMinutes, now }) {
  const names = new Map(technicians.map((person) => [person.id, person.name]))
  let best = null
  for (const technicianIds of technicianSets(technicians.map((person) => person.id), crewSize(request))) {
    search: for (const window of serviceCustomerWindowOptions) {
      for (let start = timeToMinutes(window.start); start < timeToMinutes(window.end); start += proposalSuggestionStepMinutes) {
        const internalStart = minutesToTime(start)
        if (best && internalStart >= best.internalStart) break search
        const values = { technicianIds, date, windowStart: window.start, internalStart, travelMinutes }
        const validation = validatePrototypeProposalDraft({ requestId: request.id, values, requests, technicians, now })
        if (!validation.isValid || validation.pastDue) continue
        const neighbours = validation.travelLegs.map((leg) => (
          String(leg.fromRequestId) === String(request.id) ? leg.toRequestId : leg.fromRequestId))
        if (neighbours.some((id) => !groupingBands.includes(drivingById[id]?.band))) continue
        const limit = delayMarginLimit(validation.delay)
        if (neighbours.length && limit !== null && limit < customerServiceMinimumMarginMinutes) continue
        const insertions = technicianIds.map((id) => insertionDetails({
          validation, requestId: request.id, technicianName: names.get(id), travelMinutes,
        }))
        best = {
          date, windowStart: window.start, windowLabel: window.label, internalStart,
          internalEnd: validation.internalEnd, pickupEnd: validation.pickupEnd,
          technicianIds, technicianNames: technicianIds.map((id) => names.get(id)),
          sharesDay: neighbours.length > 0,
          extraMinutes: insertions.some((entry) => entry.extraMinutes === null)
            ? null : insertions.reduce((total, entry) => total + entry.extraMinutes, 0),
          margin: validation.delay?.margin ?? null,
          travelPending: validation.travelPending,
          travelLegs: validation.travelLegs,
          baselineLegs: insertions.map((entry) => entry.baselineLeg).filter(Boolean),
        }
        break search
      }
    }
  }
  return best
}

// Final days (rule approved 10 Nov 2026): the due date first (D1), then one business day
// back at a time, skipping weekends and days the customer cannot; on each day the first
// time that fits. Null for an overdue request, which goes to the earliest date.
export function finalDaysSlot({ request, requests, technicians, drivingById = {}, travelMinutes = {}, now = new Date() }) {
  const today = getCustomerServiceClock(now).date
  if (!parseServiceDate(request.dueOn) || request.dueOn < today) return null
  const unavailable = request.customerUnavailableDates ?? []
  for (const cursor = new Date(`${request.dueOn}T12:00:00Z`); dayOf(cursor) >= today; cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    if (!isBusinessDay(cursor) || unavailable.includes(dayOf(cursor))) continue
    const slot = firstSlotOnDay({ request, requests, technicians, date: dayOf(cursor), drivingById, travelMinutes, now })
    if (slot) return slot
  }
  return null
}

// Legs whose traffic minutes the suggestions need, each pair once (the travel function
// takes distinct pairs), in the order the rows show: the legs of each fitting slot next
// to a visit and the direct drive it replaces, then the final days, then the earliest
// slot (blocks R3 and R4). The first departure of a pair wins.
export function suggestionLegsToCheck(plan) {
  const legs = new Map()
  const add = (leg) => {
    if (leg && !legs.has(leg.key)) legs.set(leg.key, leg)
  }
  for (const slot of plan.suggestions.filter((suggestion) => suggestion.fits)) {
    slot.travelLegs.forEach(add)
    add(slot.baselineLeg)
  }
  ;(plan.finalDays?.travelLegs ?? []).forEach(add)
  ;(plan.finalDays?.baselineLegs ?? []).forEach(add)
  ;(plan.earliest?.travelLegs ?? []).forEach(add)
  return [...legs.values()]
}

export function nearbySlotSuggestions({
  request, requests, technicians, candidates = [], drivingById = {}, travelMinutes = {}, now = new Date(),
}) {
  const anchors = candidates
    .filter((candidate) => candidate.kind === 'VISIT' && groupingBands.includes(drivingById[candidate.requestId]?.band))
    .sort((left, right) => drivingById[left.requestId].drivingMiles - drivingById[right.requestId].drivingMiles
      || left.date.localeCompare(right.date) || String(left.start).localeCompare(String(right.start)))
    .slice(0, nearbySlotLimit)
  return {
    suggestions: anchors.map((anchor) => suggestNextTo({ request, requests, technicians, anchor, travelMinutes, now })),
    finalDays: finalDaysSlot({ request, requests, technicians, drivingById, travelMinutes, now }),
    earliest: earliestAvailableSlot({ request, requests, technicians, travelMinutes, now }),
    overdue: parseServiceDate(request.dueOn) ? getCustomerServiceClock(now).date > request.dueOn : false,
  }
}
