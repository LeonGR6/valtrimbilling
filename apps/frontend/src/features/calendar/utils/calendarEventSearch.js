// Text search over the Production events of the Calendar. It reads the events
// as the Calendar renders them (`extendedProps`), so what a person can type is
// what they see: job, community, builder, phase, building, lots, event, dates
// and the people on the job.

import { activityTypeMap, getLotsLabel } from '../data/calendarEvents.js'

const longDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})
const shortMonthDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function toUtcDate(isoDate) {
  const [year, month, day] = String(isoDate ?? '').slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day))
}

/** "Monday, May 12, 2026" for a "2026-05-12" date, without time zone shifts. */
export function formatSearchDate(isoDate) {
  const date = toUtcDate(isoDate)
  return date ? longDate.format(date) : ''
}

function bare(prefix, value) {
  return String(value ?? '').trim().replace(new RegExp(`^${prefix}\\s*`, 'i'), '')
}

function searchableText(event) {
  const props = event.extendedProps ?? {}
  const type = activityTypeMap[props.activityType]
  const date = toUtcDate(event.start)
  const phase = bare('phase', props.phase)
  const building = bare('building', props.building)
  const variant = props.variant === 'install-only'
    ? 'install only'
    : props.variant === 'lock-up' ? 'lock up' : ''

  return [
    type?.label,
    type?.shortLabel,
    type?.description,
    variant,
    props.jobCode,
    `#${props.jobCode}`,
    props.community,
    props.builder,
    props.phase,
    props.building,
    `p${phase} b${building}`,
    getLotsLabel(props.lotStart, props.lotEnd, props.lotNumbers),
    ...(props.lotNumbers ?? []),
    props.foreman,
    props.superintendent,
    props.notes,
    String(event.start ?? '').slice(0, 10),
    date && longDate.format(date),
    date && shortDate.format(date),
    date && shortMonthDate.format(date),
    date && `${shortDate.format(date)} ${date.getUTCFullYear()}`,
  ].filter((part) => part != null && part !== '').join(' ').toLowerCase()
}

/** The words typed, lowercased; an event matches when it has every one. */
export function searchTerms(query) {
  return String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

/** The events that match `query`, soonest first. An empty query matches nothing. */
export function searchCalendarEvents(events, query) {
  const terms = searchTerms(query)
  if (terms.length === 0) return []

  return events
    .filter((event) => {
      const text = searchableText(event)
      return terms.every((term) => text.includes(term))
    })
    .sort((left, right) => String(left.start).localeCompare(String(right.start))
      || String(left.extendedProps?.jobCode ?? '').localeCompare(
        String(right.extendedProps?.jobCode ?? ''),
        'en',
        { numeric: true },
      ))
}

/** Groups already sorted events by day: [{ date, events }]. */
export function groupEventsByDay(events) {
  const groups = []
  for (const event of events) {
    const date = String(event.start ?? '').slice(0, 10)
    const last = groups.at(-1)
    if (last?.date === date) last.events.push(event)
    else groups.push({ date, events: [event] })
  }
  return groups
}
