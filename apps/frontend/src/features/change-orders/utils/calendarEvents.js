// Charging an Extra / CO with an event that is already on the Calendar. The database says, for each Lot,
// where its EXT, DM and HW events are and whether each can still be charged along with (more than 5
// business days left); this file turns that into what the form shows and what is sent back. Nothing here
// decides the rule: the database does, here and again when the Extra / CO is saved.

import { OWN_EVENT } from '../data/changeOrders.js'
import { formatLotRanges } from '../services/changeOrderRecord.js'

export { OWN_EVENT }

/** The Calendar events an Extra / CO can be charged with. */
export const CHARGE_EVENTS = [
  { value: 'EXT', label: 'EXT', description: 'Exterior frames' },
  { value: 'DM', label: 'DM', description: 'Doors and Material' },
  { value: 'HW', label: 'HW', description: 'Hardware' },
]

const CHARGE_EVENT_VALUES = CHARGE_EVENTS.map((event) => event.value)

/** True for EXT, DM and HW; false for "Own CO event" and anything else. */
export const isCalendarEvent = (value) => CHARGE_EVENT_VALUES.includes(value)

/** What the database says about an event: it can be charged along with, or why it cannot. `OWN` is a Lot
 * set to "Own CO event": nothing to look up, it needs an event of its own. */
export const EVENT_STATUS = {
  AVAILABLE: 'AVAILABLE',
  TOO_CLOSE: 'TOO_CLOSE',
  PASSED: 'PASSED',
  NOT_SCHEDULED: 'NOT_SCHEDULED',
  OWN: 'OWN',
}

/** Every choice a Lot or a Plan has: EXT, DM, HW, or an event of its own. */
export const EVENT_CHOICES = [
  ...CHARGE_EVENTS,
  { value: OWN_EVENT, label: 'Own CO event', description: 'Scheduled apart, on the Calendar' },
]

/** The short name of a choice: "DM", or "Own CO event". */
export const eventChoiceLabel = (value) => (
  EVENT_CHOICES.find((choice) => choice.value === value)?.label ?? 'Own CO event'
)

/**
 * The event chosen for each Lot. A Lot can have its own (`eventByLot`); with Specific Plan Types it
 * otherwise follows its Plan (`planRules[planId].event`); and else the choice for every Lot (`chargeEvent`).
 * Returns `(row) => 'EXT' | 'DM' | 'HW' | OWN_EVENT`.
 */
export function lotEventChooser({ chargeEvent = OWN_EVENT, eventByLot = {}, planRules = {}, coverageMode } = {}) {
  const byPlan = coverageMode === 'plans'
  return (row) => (
    eventByLot[row.lotId]
    ?? (byPlan && row.planId ? planRules[row.planId]?.event : undefined)
    ?? chargeEvent
  )
}

/** The event a Plan follows: its own, or the choice for every Lot. */
export const planEventOf = (planRules, planId, chargeEvent) => planRules?.[planId]?.event ?? chargeEvent

/**
 * Sets the event of some Lots. A Lot set to what it would follow anyway (its Plan, or every Lot) keeps
 * nothing of its own, so changing the Plan or every Lot later still moves it.
 */
export function setLotEvents(eventByLot, lotIds, event, followed) {
  const next = { ...eventByLot }
  for (const lotId of lotIds) {
    if (event === followed(lotId)) delete next[lotId]
    else next[lotId] = event
  }
  return next
}

/** True when some Lot of `rows` is to be charged with an EXT, DM or HW event: the Calendar must be read. */
export const needsCalendar = (rows, eventOf) => rows.some((row) => isCalendarEvent(eventOf(row)))

/** A row of `change_order_lot_events`: one event of one Lot. */
export function toLotEvent(row) {
  return {
    lotId: String(row.lot_id),
    type: row.event_type,
    date: row.event_date,
    owner: row.date_owner ?? '',
    status: row.event_status,
    businessDays: Number(row.business_days ?? 0),
  }
}

/** "1 business day", "3 business days". */
export const businessDaysText = (days) => `${days} business ${days === 1 ? 'day' : 'days'}`

/** What is left before a close event: "3 business days left", or "No business days left" on the day. */
export const businessDaysLeftText = (days) => (
  days > 0 ? `${businessDaysText(days)} left` : 'No business days left'
)

/** A date as "Tue, Sep 22, 2026"; the weekday is there because the rule counts business days. */
export function formatEventDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`)
  if (!dateKey || Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Where each Lot stands for the event chosen for it. `rows` are the Lots of the coverage, `eventOf(row)` the
 * event chosen for each (or `chargeEvent` for all), `events` what the database read for the Job and
 * `savedLinks` the ties the Extra / CO already had when it was opened, `{ [lotId]: { event, date } }`.
 * A Lot is `linked` (it will be sent as charged with its event) when the event can still be charged along
 * with, or when that very tie was already saved: a saved tie is not taken away because the date moved
 * closer, it is `kept` and the screen says so. A Lot set to "Own CO event" has the status OWN, not linked.
 */
export function evaluateLots(rows, { chargeEvent = OWN_EVENT, eventOf = () => chargeEvent, events = [], savedLinks = {} }) {
  const byLotAndType = new Map()
  for (const event of events) byLotAndType.set(`${event.lotId}|${event.type}`, event)

  return rows.map((row) => {
    const chosen = eventOf(row)
    if (!isCalendarEvent(chosen)) {
      return {
        row, event: OWN_EVENT, status: EVENT_STATUS.OWN, date: '', owner: '', businessDays: 0, linked: false, kept: false,
      }
    }

    const event = byLotAndType.get(`${row.lotId}|${chosen}`) ?? null
    const status = event ? event.status : EVENT_STATUS.NOT_SCHEDULED
    const saved = savedLinks[row.lotId]?.event === chosen ? savedLinks[row.lotId] : null
    const available = status === EVENT_STATUS.AVAILABLE
    const kept = Boolean(saved) && !available

    return {
      row,
      event: chosen,
      status,
      date: event?.date ?? saved?.date ?? '',
      owner: event?.owner ?? '',
      businessDays: event?.businessDays ?? 0,
      linked: available || kept,
      kept,
    }
  })
}

// By event (EXT, DM, HW, own last), then available first by date, what is blocked by date, no date last.
const EVENT_ORDER = [...CHARGE_EVENT_VALUES, OWN_EVENT]
const partOrder = (left, right) => {
  if (left.event !== right.event) return EVENT_ORDER.indexOf(left.event) - EVENT_ORDER.indexOf(right.event)
  if (!left.date !== !right.date) return left.date ? -1 : 1
  return left.date.localeCompare(right.date) || left.status.localeCompare(right.status)
}

/**
 * The evaluations by Phase / Building (one record of the Job each), in the order of the Lots. Inside
 * each, the Lots that stand the same way (same date, same status) are one `part` with its Lot ranges,
 * so an event the Calendar split in several dates shows each date with its own Lots.
 */
export function groupEvaluations(evaluations) {
  const groups = new Map()

  for (const evaluation of evaluations) {
    const { row } = evaluation
    if (!groups.has(row.recordId)) {
      groups.set(row.recordId, {
        key: row.recordId,
        label: [row.phase, row.building].filter(Boolean).join(', '),
        parts: new Map(),
      })
    }

    const { parts } = groups.get(row.recordId)
    const partKey = [evaluation.event, evaluation.status, evaluation.date, evaluation.kept].join('|')
    if (!parts.has(partKey)) {
      parts.set(partKey, {
        key: partKey,
        event: evaluation.event,
        status: evaluation.status,
        date: evaluation.date,
        owner: evaluation.owner,
        businessDays: evaluation.businessDays,
        kept: evaluation.kept,
        linked: evaluation.linked,
        lots: [],
        lotIds: [],
      })
    }
    parts.get(partKey).lots.push(row.lot)
    parts.get(partKey).lotIds.push(row.lotId)
  }

  return [...groups.values()].map(({ parts, ...group }) => ({
    ...group,
    parts: [...parts.values()]
      .map(({ lots, ...part }) => ({ ...part, lotText: formatLotRanges(lots), count: lots.length }))
      .sort(partOrder),
  }))
}

/** `{ [lotId]: 'DM' }` for the Lots that are tied: what is sent as each line's `billing_event`. */
export function linkedEvents(evaluations) {
  const links = {}
  for (const evaluation of evaluations) {
    if (evaluation.linked) links[evaluation.row.lotId] = evaluation.event
  }
  return links
}

/** How many Lots are tied and how many are left for an event of their own CO. */
export function summarizeEvaluations(evaluations) {
  const linked = evaluations.filter((evaluation) => evaluation.linked).length
  return { total: evaluations.length, linked, own: evaluations.length - linked }
}

/**
 * The evaluations by Phase / Building (one record of the Job each), in the order of the Lots, each Lot on
 * its own: what the screen lists to choose the event Lot by Lot. `event` is the one all its Lots share, or
 * '' when they differ.
 */
export function groupLotsByRecord(evaluations) {
  const groups = new Map()
  for (const evaluation of evaluations) {
    const { row } = evaluation
    if (!groups.has(row.recordId)) {
      groups.set(row.recordId, {
        key: row.recordId,
        label: [row.phase, row.building].filter(Boolean).join(', '),
        items: [],
      })
    }
    groups.get(row.recordId).items.push(evaluation)
  }

  return [...groups.values()].map((group) => {
    const events = new Set(group.items.map((item) => item.event))
    return { ...group, event: events.size === 1 ? [...events][0] : '' }
  })
}
