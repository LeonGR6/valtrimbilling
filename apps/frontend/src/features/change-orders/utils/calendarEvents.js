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

/** What the database says about an event: it can be charged along with, or why it cannot. */
export const EVENT_STATUS = {
  AVAILABLE: 'AVAILABLE',
  TOO_CLOSE: 'TOO_CLOSE',
  PASSED: 'PASSED',
  NOT_SCHEDULED: 'NOT_SCHEDULED',
}

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
 * Where each Lot stands for the event chosen. `rows` are the Lots of the coverage, `events` what the
 * database read for the Job and `savedLinks` the ties the Extra / CO already had when it was opened,
 * `{ [lotId]: { event, date } }`. A Lot is `linked` (it will be sent as charged with the event) when the
 * event can still be charged along with, or when that very tie was already saved: a saved tie is not
 * taken away because the date moved closer, it is `kept` and the screen says so.
 * With "Own CO event" nothing is evaluated: no Lot is tied.
 */
export function evaluateLots(rows, { chargeEvent, events = [], savedLinks = {} }) {
  if (!isCalendarEvent(chargeEvent)) return []

  const byLot = new Map()
  for (const event of events) {
    if (event.type === chargeEvent) byLot.set(event.lotId, event)
  }

  return rows.map((row) => {
    const event = byLot.get(row.lotId) ?? null
    const status = event ? event.status : EVENT_STATUS.NOT_SCHEDULED
    const saved = savedLinks[row.lotId]?.event === chargeEvent ? savedLinks[row.lotId] : null
    const available = status === EVENT_STATUS.AVAILABLE
    const kept = Boolean(saved) && !available

    return {
      row,
      status,
      date: event?.date ?? saved?.date ?? '',
      owner: event?.owner ?? '',
      businessDays: event?.businessDays ?? 0,
      linked: available || kept,
      kept,
    }
  })
}

// Available first by date, then what is blocked by date, what has no date last.
const partOrder = (left, right) => {
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
    const partKey = [evaluation.status, evaluation.date, evaluation.kept].join('|')
    if (!parts.has(partKey)) {
      parts.set(partKey, {
        key: partKey,
        status: evaluation.status,
        date: evaluation.date,
        owner: evaluation.owner,
        businessDays: evaluation.businessDays,
        kept: evaluation.kept,
        linked: evaluation.linked,
        lots: [],
      })
    }
    parts.get(partKey).lots.push(row.lot)
  }

  return [...groups.values()].map(({ parts, ...group }) => ({
    ...group,
    parts: [...parts.values()]
      .map(({ lots, ...part }) => ({ ...part, lotText: formatLotRanges(lots), count: lots.length }))
      .sort(partOrder),
  }))
}

/** `{ [lotId]: 'DM' }` for the Lots that are tied: what is sent as each line's `billing_event`. */
export function linkedEvents(evaluations, chargeEvent) {
  const links = {}
  for (const evaluation of evaluations) {
    if (evaluation.linked) links[evaluation.row.lotId] = chargeEvent
  }
  return links
}

/** How many Lots are tied and how many are left for an event of their own CO. */
export function summarizeEvaluations(evaluations) {
  const linked = evaluations.filter((evaluation) => evaluation.linked).length
  return { total: evaluations.length, linked, own: evaluations.length - linked }
}
