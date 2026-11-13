// Pure helpers for the events of their own of an Extra / CO: the Lots of an approved one that are not
// charged with an EXT, DM or HW event get a date (and a note) on the Production Calendar. What is read,
// which Lots still need one, what the screen says and how an event shows on the Calendar.
// Nothing here touches the network or React.

import { canWork } from '../../auth/authorization/roleAccess.js'
import { formatLotRanges } from './changeOrderRecord.js'

/** Who schedules them: the planning roles that own the Extra / CO, and Scheduling, who owns the Calendar. */
export const CHANGE_ORDER_EVENT_ROLES = ['ADMIN', 'PROJECT_MANAGEMENT', 'SCHEDULING']

export const canScheduleChangeOrderEvents = (role) => canWork(role, CHANGE_ORDER_EVENT_ROLES)

/** Only an approved Extra / CO is scheduled (the database says the same). */
export const isSchedulable = (status) => status === 'APPROVED'

// How long the note can be (the database takes the same).
export const maxEventNoteLength = 500

/** A Lot of an event, as the overview gives it. */
function toEventLot(lot) {
  return {
    lineId: lot.line_id,
    lotId: lot.lot_id,
    phase: lot.phase_code ?? '',
    building: lot.building ?? '',
    lot: lot.lot_number ?? '',
    plan: lot.plan_code ?? '',
    scope: lot.scope_of_work ?? '',
  }
}

/** A row of `change_order_event_overview`. */
export function toChangeOrderEvent(row) {
  return {
    id: row.id,
    changeOrderId: row.change_order_id,
    changeOrderNumber: row.change_order_number,
    poCoNumber: row.po_co_number ?? '',
    changeOrderStatus: row.change_order_status,
    jobId: row.job_id,
    jobCode: row.job_code ?? '',
    community: row.community ?? '',
    builderId: row.builder_id,
    builderName: row.builder_name ?? '',
    date: row.scheduled_date,
    note: row.note ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lots: (row.lots ?? []).map(toEventLot),
  }
}

const placeOf = (lot) => [
  lot.phase && `Phase ${lot.phase}`,
  lot.building && `Building ${lot.building}`,
].filter(Boolean).join(', ')

/**
 * Lots by Phase / Building, in the order given: `[{ place: 'Phase 2, Building 1', lots: '1–3, 5', count }]`.
 * Works for the lines of an Extra / CO and for the Lots of an event alike (both have phase, building, lot).
 */
export function lotsByPlace(lots) {
  const places = new Map()
  for (const lot of lots) {
    const place = placeOf(lot)
    if (!places.has(place)) places.set(place, [])
    places.get(place).push(lot.lot)
  }
  return [...places.entries()].map(([place, numbers]) => ({
    place,
    lots: formatLotRanges(numbers),
    count: numbers.length,
  }))
}

const lotWord = (text) => (/[,–]/.test(text) ? `Lots ${text}` : `Lot ${text}`)

/** "Phase 2, Building 1: Lots 1–3 · Phase 3: Lot 7", or just "Lots 1–3" when one place has them all. */
export function describeEventLots(lots) {
  const places = lotsByPlace(lots)
  if (places.length === 1) {
    return places[0].place ? `${places[0].place}: ${lotWord(places[0].lots)}` : lotWord(places[0].lots)
  }
  return places.map((item) => [item.place, lotWord(item.lots)].filter(Boolean).join(': ')).join(' · ')
}

/**
 * The Lot lines of an Extra / CO that still need an event of their own: not charged with an EXT, DM or HW
 * event and in no event yet. `lines` as `toChangeOrderLine` reads them; `events` as `toChangeOrderEvent`.
 */
export function linesNeedingEvent(lines, events) {
  const scheduled = new Set(events.flatMap((event) => event.lots.map((lot) => String(lot.lineId))))
  return lines.filter((line) => !line.isPlace && !line.billingEvent && !scheduled.has(String(line.id)))
}

/** Today as "2026-11-12" in the person's own day (the date input works in it). */
export function todayKey(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * What stops an event from being saved, as `{ field, message }`; empty when it can be saved. `values` are
 * `{ date, note, lineIds }`; `lineIds` is only checked when creating. A date that was already saved may stay
 * in the past (moving it is what cannot go before today).
 */
export function eventProblems(values, { creating = true, today = todayKey(), savedDate = '' } = {}) {
  const problems = []
  if (creating && (values.lineIds?.length ?? 0) === 0) {
    problems.push({ field: 'lines', message: 'Choose at least one Lot for the event.' })
  }
  if (!values.date) {
    problems.push({ field: 'date', message: 'Choose the date of the event.' })
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
    problems.push({ field: 'date', message: 'Write the date as mm/dd/yyyy.' })
  } else if (values.date < today && values.date !== savedDate) {
    problems.push({ field: 'date', message: 'The date cannot be before today.' })
  }
  if ((values.note ?? '').trim().length > maxEventNoteLength) {
    problems.push({ field: 'note', message: `The note can have up to ${maxEventNoteLength} characters.` })
  }
  return problems
}

/** The arguments of `create_change_order_event`. */
export function toCreateEventRpc(changeOrderId, values) {
  return {
    p_change_order_id: Number(changeOrderId),
    p_scheduled_date: values.date,
    p_line_ids: values.lineIds.map(Number),
    p_note: values.note.trim() || null,
  }
}

/** The arguments of `update_change_order_event`. */
export function toUpdateEventRpc(eventId, values) {
  return {
    p_event_id: Number(eventId),
    p_scheduled_date: values.date,
    p_note: values.note.trim() || null,
  }
}

/** A date as "Thu, Nov 26, 2026". */
export function formatEventDay(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`)
  if (!dateKey || Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** What the screen says once an event is created. */
export function eventCreatedNotice(event) {
  return `CO event created for ${describeEventLots(event.lots)} on ${formatEventDay(event.date)}. It is on the Production Calendar.`
}

/** The Calendar, opened at the event. */
export const calendarEventPath = (eventId) => `/calendar?coEvent=${encodeURIComponent(eventId)}`

/** Reads `coEvent=<id>` back, or null. */
export function parseCalendarEventParam(value) {
  return /^\d+$/.test(String(value ?? '')) ? Number(value) : null
}

/** The id an event has on the Calendar (the Production events have their own ids). */
export const calendarEventId = (eventId) => `change-order-event-${eventId}`

/**
 * An event as the Production Calendar draws it: an all-day event with `activityType` CHANGE_ORDER and the
 * same `extendedProps` the Calendar's filters and search read (Builder, Community, Job, Phase, Building,
 * Lots), plus what the Extra / CO event card shows. It cannot be dragged: its date changes from its card.
 */
export function toCalendarEvent(event) {
  const places = lotsByPlace(event.lots)
  const onePlace = places.length === 1 ? event.lots[0] : null

  return {
    id: calendarEventId(event.id),
    title: `${event.changeOrderNumber} · Job #${event.jobCode}`,
    start: event.date,
    allDay: true,
    startEditable: false,
    extendedProps: {
      activityType: 'CHANGE_ORDER',
      changeOrderEventId: event.id,
      changeOrderId: event.changeOrderId,
      changeOrderNumber: event.changeOrderNumber,
      poCoNumber: event.poCoNumber,
      jobId: event.jobId,
      jobCode: event.jobCode,
      community: event.community,
      builder: event.builderName,
      phase: onePlace?.phase ? `Phase ${onePlace.phase}` : '',
      building: onePlace?.building ? `Building ${onePlace.building}` : '',
      lotNumbers: event.lots.map((lot) => lot.lot),
      lotsText: describeEventLots(event.lots),
      note: event.note,
    },
  }
}
