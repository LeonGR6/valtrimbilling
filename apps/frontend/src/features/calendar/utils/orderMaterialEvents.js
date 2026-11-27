// The Calendar events that order material: the EXT events with "Order material" checked, the
// ones the Calendar paints yellow. They are split into the ones still to come (the soonest first)
// and the ones already past (the most recent first).

import { getActivityTone } from '../data/calendarEvents.js'

export function isOrderMaterialEvent(event) {
  const props = event?.extendedProps ?? {}
  return getActivityTone(props.activityType, props.orderMaterial, props.variant, props.dateOwner) === 'ext-order'
}

function eventDate(event) {
  return String(event.start ?? '').slice(0, 10)
}

/** `{ upcoming, past }` of the Order material events; `today` is a "YYYY-MM-DD" date. */
export function splitOrderMaterialEvents(events, today) {
  const orderEvents = (events ?? []).filter((event) => isOrderMaterialEvent(event) && eventDate(event))
  const byDateThenJob = (a, b) => eventDate(a).localeCompare(eventDate(b))
    || String(a.extendedProps.jobCode ?? '').localeCompare(String(b.extendedProps.jobCode ?? ''), undefined, { numeric: true })

  const upcoming = orderEvents.filter((event) => eventDate(event) >= today).sort(byDateThenJob)
  const past = orderEvents.filter((event) => eventDate(event) < today).sort((a, b) => byDateThenJob(b, a))

  return { upcoming, past }
}

/** Today as "YYYY-MM-DD" in the local time zone. */
export function localTodayIso(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
