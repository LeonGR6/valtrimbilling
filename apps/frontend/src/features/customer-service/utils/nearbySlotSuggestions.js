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
// - Order: next to a nearby visit within the due date (D2), then the final days, then
//   the earliest available time.
// - Final days: the due date first (D1), then one business day back at a time.
// - D3: a HIGH priority request follows the same rules; it no longer only groups on its
//   earliest date (this replaces decision 4 of 9 Nov). Overdue requests have no final
//   days: the earliest time is the suggestion.
// Rules approved on 17 Nov 2026 (docs/customer-service-proposal-workspace-review.md):
// - Suggestions start 2 business days after today, or on the due date when it is sooner
//   (short notice).
// - No minimum delay margin (replaces D4's 15 min): pessimistic travel and the 10 minutes
//   of pickup are enough. The margin is still shown.
// - On a day without nearby visits the technician registered first (Jorge) is preferred;
//   another one is used only when that technician has no room that day.
// Rules approved on 19 Nov 2026 (docs/customer-service-block-b-plan.md, section 5):
// - A proposal offers a second day: the final days on another day than the first option,
//   then the earliest other day before the due date. Never a day after the due date while
//   the request can still be on time: without another on-time day it offers one day.
// - An overdue request's second day is the earliest other day with room.
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import {
  isCustomerServiceBusinessDay, minutesToTime, parseServiceDate, timeToMinutes, travelLegKey, travelMinutesFor,
} from './customerServiceScheduling.js'
import {
  proposalSuggestionLeadBusinessDays, proposalSuggestionSearchBusinessDays, proposalSuggestionStepMinutes,
  suggestionStartDate, suggestProposalTimes, validatePrototypeProposalDraft,
} from './proposalDraft.js'
import { formatWeekdayDate, getCustomerServiceClock } from './dates.js'

export const nearbySlotLimit = 3
const groupingBands = ['GREEN', 'YELLOW']
// Technician combinations tried for the earliest slot, so a large roster stays fast.
const maxTechnicianSets = 30

const crewSize = (request) => Math.max(1, Number(request.crewSize) || 1)

// Preference when nothing nearby decides: registration order (catalog id), then name.
const registrationRank = (person) => (Number.isFinite(Number(person.id)) ? Number(person.id) : Number.POSITIVE_INFINITY)
export function techniciansByPreference(technicians) {
  return [...technicians].sort((left, right) => {
    const [a, b] = [registrationRank(left), registrationRank(right)]
    return (a === b ? 0 : a < b ? -1 : 1) || left.name.localeCompare(right.name)
  })
}

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
  const others = techniciansByPreference(technicians).map((person) => person.id).filter((id) => !anchorIds.includes(id))
  const sets = anchorIds.length >= crew
    ? technicianSets(anchorIds, crew)
    : technicianSets(others, crew - anchorIds.length).map((added) => [...anchorIds, ...added])

  let best = null
  for (const technicianIds of sets) {
    const lead = technicianIds.find((id) => anchorIds.includes(id))
    const found = bestSlotNextTo({
      request, requests, technicians, technicianIds, anchor, technicianName: names.get(lead), travelMinutes, now,
    })
    if (found && (!best || rank(found) < rank(best))) best = found
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
    margin: best.validation.delay?.margin ?? null,
    travelPending: best.validation.travelPending,
    travelLegs: best.validation.travelLegs,
    baselineLeg: best.insertion.baselineLeg,
    warning: added.length
      ? `Needs ${added.length === 1 ? 'a second technician' : 'more technicians'}: ${joinNames(added)} ${added.length === 1 ? 'is' : 'are'} available that day.`
      : null,
  }
}

// The first day with a viable slot for any technician combination of the crew size, so
// grouping can always be compared with the earliest date. On that day the preferred
// technicians keep it while they have room, even at a later time.
export function earliestAvailableSlot({
  request, requests, technicians, travelMinutes = {}, now = new Date(), fromDate = null, skipDates = [],
}) {
  const names = new Map(technicians.map((person) => [person.id, person.name]))
  let best = null
  for (const technicianIds of technicianSets(techniciansByPreference(technicians).map((person) => person.id), crewSize(request))) {
    const { suggestions: [first] } = suggestProposalTimes({
      requestId: request.id, requests, technicians, now, limit: 1, fromDate, skipDates,
      values: { technicianIds, date: '', windowStart: '', internalStart: '', travelMinutes },
    })
    if (first && (!best || first.date < best.date)) {
      best = { ...first, technicianIds, technicianNames: technicianIds.map((id) => names.get(id)) }
    }
  }
  return best
}

const dayOf = (cursor) => cursor.toISOString().slice(0, 10)
// Monday to Friday and not a holiday (24 Nov 2026).
const isBusinessDay = (cursor) => isCustomerServiceBusinessDay(dayOf(cursor))

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

// The first time that fits on one day, for the preferred technicians first: another
// combination is tried only when they have no room that day (decision of 17 Nov 2026). On
// a day the technician already works, each neighbouring visit must be Near or Medium (fit
// plan, section 4, point 3).
function firstSlotOnDay({ request, requests, technicians, date, drivingById, travelMinutes, now }) {
  const names = new Map(technicians.map((person) => [person.id, person.name]))
  for (const technicianIds of technicianSets(techniciansByPreference(technicians).map((person) => person.id), crewSize(request))) {
    for (const window of serviceCustomerWindowOptions) {
      for (let start = timeToMinutes(window.start); start < timeToMinutes(window.end); start += proposalSuggestionStepMinutes) {
        const internalStart = minutesToTime(start)
        const values = { technicianIds, date, windowStart: window.start, internalStart, travelMinutes }
        const validation = validatePrototypeProposalDraft({ requestId: request.id, values, requests, technicians, now })
        if (!validation.isValid || validation.pastDue) continue
        const neighbours = validation.travelLegs.map((leg) => (
          String(leg.fromRequestId) === String(request.id) ? leg.toRequestId : leg.fromRequestId))
        if (neighbours.some((id) => !groupingBands.includes(drivingById[id]?.band))) continue
        const insertions = technicianIds.map((id) => insertionDetails({
          validation, requestId: request.id, technicianName: names.get(id), travelMinutes,
        }))
        return {
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
      }
    }
  }
  return null
}

// Final days (rule approved 10 Nov 2026): the due date first (D1), then one business day
// back at a time down to fromDate (default today), skipping weekends, days the customer
// cannot and skipDates; on each day the first time that fits. Null for an overdue request,
// which goes to the earliest date.
export function finalDaysSlot({
  request, requests, technicians, drivingById = {}, travelMinutes = {}, now = new Date(), fromDate = null, skipDates = [],
}) {
  const today = getCustomerServiceClock(now).date
  if (!parseServiceDate(request.dueOn) || request.dueOn < today) return null
  const first = parseServiceDate(fromDate) && fromDate > today ? fromDate : today
  const skipped = [...(request.customerUnavailableDates ?? []), ...skipDates]
  for (const cursor = new Date(`${request.dueOn}T12:00:00Z`); dayOf(cursor) >= first; cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    if (!isBusinessDay(cursor) || skipped.includes(dayOf(cursor))) continue
    const slot = firstSlotOnDay({ request, requests, technicians, date: dayOf(cursor), drivingById, travelMinutes, now })
    if (slot) return slot
  }
  return null
}

// Legs whose traffic minutes the suggestions need, each pair once (the travel function
// takes distinct pairs), in the order the rows show: the legs of each fitting slot next
// to a visit and the direct drive it replaces, then the final days, then the earliest
// slot (blocks R3 and R4), then the second day of the proposal. The first departure of a
// pair wins.
export function suggestionLegsToCheck(plan) {
  const legs = new Map()
  const add = (leg) => {
    if (leg && !legs.has(leg.key)) legs.set(leg.key, leg)
  }
  for (const slot of plan.suggestions.filter((suggestion) => suggestion.fits)) {
    slot.travelLegs.forEach(add)
    add(slot.baselineLeg)
  }
  for (const slot of [plan.finalDays, plan.earliest, plan.second]) {
    ;(slot?.travelLegs ?? []).forEach(add)
    ;(slot?.baselineLegs ?? []).forEach(add)
  }
  return [...legs.values()]
}

// A slot before the usual lead (only when the due date is sooner) is short notice.
const markShortNotice = (slot, start) => (slot && slot.fits !== false ? { ...slot, shortNotice: slot.date < start.leadDate } : slot)

// The single slot shown first (review of 13 Nov 2026, phase 1), in the approved order: next
// to a nearby visit, then the final days, then the earliest time. It adds no rule; the
// reason says in plain words why this slot, and why the options before it did not apply.
// Null when nothing fits.
export function recommendSlot({ plan, hasCoordinates = true, groupingMiles = null }) {
  const nextTo = plan.suggestions.find((suggestion) => suggestion.fits)
  if (nextTo) {
    const names = nextTo.anchor.technicianNames?.length ? nextTo.anchor.technicianNames : nextTo.technicianNames
    return {
      kind: 'NEXT_TO', slot: nextTo, sharesDay: true,
      reason: `Next to ${nextTo.anchor.requestNumber}, a nearby visit already scheduled for ${joinNames(names)}.`,
    }
  }
  const noGrouping = !hasCoordinates
    ? 'No coordinates, so nearby visits cannot be checked.'
    : plan.suggestions.length
      ? 'No time fits next to the nearby visits.'
      : `No visit is scheduled within ${groupingMiles === null ? 'a short drive' : `${groupingMiles} driving miles`} before the due date.`
  if (plan.finalDays) {
    return {
      kind: 'FINAL_DAYS', slot: plan.finalDays, sharesDay: plan.finalDays.sharesDay,
      reason: `${noGrouping} It goes on the latest on-time day with room, so earlier days stay open to group nearby requests.${
        plan.finalDays.sharesDay ? ' It shares that day with nearby visits.' : ''}`,
    }
  }
  if (plan.earliest) {
    return {
      kind: 'EARLIEST', slot: plan.earliest, sharesDay: false,
      reason: plan.overdue
        ? 'This request is overdue, so the earliest available time comes first.'
        : `${noGrouping} No time fits on the final days, so this is the earliest time that fits before the due date.`,
    }
  }
  return null
}

// The second day a proposal offers with the first one, on another day (block B, decisions
// of 19 Nov 2026), and why in plain words:
// - the final days: the due date, or the business day before it when the first option
//   already takes it, so the customer still has a day on time if the first one does not work;
// - when the final days have no other room, the earliest other day before the due date;
// - for an overdue request, the earliest other day with room.
// Without another day, slot is null and the proposal offers one day: never a day after
// the due date while the request can still be on time. Null for an invalid first date.
export function secondOptionSlot({
  request, requests, technicians, firstDate, drivingById = {}, travelMinutes = {}, now = new Date(),
  leadBusinessDays = proposalSuggestionLeadBusinessDays,
}) {
  if (!parseServiceDate(firstDate)) return null
  const today = getCustomerServiceClock(now).date
  const onTime = Boolean(parseServiceDate(request.dueOn)) && request.dueOn >= today
  const start = suggestionStartDate({ today, dueOn: request.dueOn, leadBusinessDays })
  const search = { request, requests, technicians, travelMinutes, now, fromDate: start.date, skipDates: [firstDate] }
  const first = formatWeekdayDate(firstDate)

  const finalDays = finalDaysSlot({ ...search, drivingById })
  if (finalDays) {
    return {
      kind: 'FINAL_DAYS', slot: markShortNotice(finalDays, start),
      reason: `The latest other on-time day with room, so the customer still has a day on time if ${first} does not work.`,
    }
  }
  const earliest = earliestAvailableSlot(search)
  if (earliest) {
    return {
      kind: 'EARLIEST', slot: markShortNotice(earliest, start),
      reason: onTime
        ? 'The final days have no other room, so this is the earliest other day that fits before the due date.'
        : 'This request is overdue, so this is the earliest other day with room.',
    }
  }
  return {
    kind: 'NONE', slot: null,
    reason: onTime
      ? `No other day before the due date has room, so the proposal offers only ${first}.`
      : `No other day in the next ${proposalSuggestionSearchBusinessDays} business days has room, so the proposal offers only ${first}.`,
  }
}

// leadBusinessDays: days the customer gets to answer before the first suggested day.
export function nearbySlotSuggestions({
  request, requests, technicians, candidates = [], drivingById = {}, travelMinutes = {}, now = new Date(),
  leadBusinessDays = proposalSuggestionLeadBusinessDays,
}) {
  const start = suggestionStartDate({ today: getCustomerServiceClock(now).date, dueOn: request.dueOn, leadBusinessDays })
  const anchors = candidates
    .filter((candidate) => candidate.kind === 'VISIT' && candidate.date >= start.date
      && groupingBands.includes(drivingById[candidate.requestId]?.band))
    .sort((left, right) => drivingById[left.requestId].drivingMiles - drivingById[right.requestId].drivingMiles
      || left.date.localeCompare(right.date) || String(left.start).localeCompare(String(right.start)))
    .slice(0, nearbySlotLimit)
  const mark = (slot) => markShortNotice(slot, start)
  return {
    suggestions: anchors.map((anchor) => mark(suggestNextTo({ request, requests, technicians, anchor, travelMinutes, now }))),
    finalDays: mark(finalDaysSlot({ request, requests, technicians, drivingById, travelMinutes, now, fromDate: start.date })),
    earliest: mark(earliestAvailableSlot({ request, requests, technicians, travelMinutes, now, fromDate: start.date })),
    overdue: parseServiceDate(request.dueOn) ? getCustomerServiceClock(now).date > request.dueOn : false,
    startsOn: start.date,
  }
}

// The other days a proposal keeps for the customer (block B, step B5; decided 23 Nov
// 2026): up to three days with room for the same technicians, from the first suggested
// day on and with the same rules as the suggestions, skipping the offered days. They are
// not held; the customer may pick one only when no offered day works, and the
// coordinator approves it.
export function proposalAlternatives({
  request, requests, technicians, technicianIds, travelMinutes = {}, skipDates = [], now = new Date(), limit = 3,
  leadBusinessDays = proposalSuggestionLeadBusinessDays,
}) {
  const start = suggestionStartDate({ today: getCustomerServiceClock(now).date, dueOn: request.dueOn, leadBusinessDays })
  // The search gives the first time of each window; the customer is offered other days, so
  // only the first time of each day is kept.
  const { suggestions } = suggestProposalTimes({
    requestId: request.id, requests, technicians, now, limit: limit * serviceCustomerWindowOptions.length,
    fromDate: start.date, skipDates,
    values: { technicianIds, date: '', windowStart: '', internalStart: '', travelMinutes },
  })
  const firstOfEachDay = suggestions.filter((slot, index) => suggestions.findIndex((other) => other.date === slot.date) === index)
  return firstOfEachDay.slice(0, limit).map((slot) => ({
    date: slot.date, windowStart: slot.windowStart, workStart: slot.internalStart, technicianIds: technicianIds.map(Number),
  }))
}
