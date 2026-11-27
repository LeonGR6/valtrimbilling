import { Box } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
  formatWorkTypes,
  getServiceEventTone,
} from '../data/serviceCalendarEvents.js'
import './CustomerServiceCalendar.css'

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
})

function formatTimeRange(event) {
  if (!event.start) return 'Time pending'
  const start = event.start instanceof Date ? event.start : new Date(event.start)
  const end = event.end
    ? event.end instanceof Date ? event.end : new Date(event.end)
    : null
  return end
    ? `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`
    : timeFormatter.format(start)
}

// A short time range: "8:00–8:30 AM", or "11:30 AM–12:15 PM" across noon (25 Nov 2026).
function shortRange(startHours, startMinutes, endHours, endMinutes) {
  const part = (hours, minutes, withPeriod) => {
    const clock = `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}`
    return withPeriod ? `${clock} ${hours < 12 ? 'AM' : 'PM'}` : clock
  }
  const samePeriod = (startHours < 12) === (endHours < 12)
  return `${part(startHours, startMinutes, !samePeriod)}–${part(endHours, endMinutes, true)}`
}

// Several visits can share a customer window; the work time tells them apart.
function formatWorkSlot(slot) {
  if (!/^\d{2}:\d{2}$/u.test(slot?.start ?? '') || !/^\d{2}:\d{2}$/u.test(slot?.end ?? '')) return ''
  const [startHours, startMinutes] = slot.start.split(':').map(Number)
  const [endHours, endMinutes] = slot.end.split(':').map(Number)
  return shortRange(startHours, startMinutes, endHours, endMinutes)
}

// The customer window on a month chip: "8–10", or "8:30–10:30" when it has minutes.
function formatWindowShort(event) {
  if (!event.start || !event.end) return ''
  const start = new Date(event.start)
  const end = new Date(event.end)
  const part = (date) => {
    const hours = date.getHours() % 12 || 12
    return date.getMinutes() ? `${hours}:${String(date.getMinutes()).padStart(2, '0')}` : String(hours)
  }
  return `${part(start)}–${part(end)}`
}

// "Jorge M." for one technician, "Jorge M. +1" for a crew.
function techniciansShort(props) {
  const names = (props.assignedTechnicians?.map((person) => person.name) ?? String(props.technician ?? '').split(', '))
    .map((name) => String(name ?? '').trim()).filter(Boolean)
  if (!names.length) return ''
  const [first, ...rest] = names[0].split(/\s+/u)
  const lead = rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first
  return names.length > 1 ? `${lead} +${names.length - 1}` : lead
}

// How late the visit can start without it or a later visit leaving its window. Negative
// when the refreshed traffic no longer fits (there is no minimum since 17 Nov 2026).
function formatDelayMargin(margin) {
  if (!Number.isInteger(margin)) return ''
  return margin < 0 ? `Misses window by ${-margin} min` : `Margin ${margin} min`
}

// The short status on each card. A held day says which option it is when there are two.
function statusText(props) {
  if (props.status === 'CONFIRMED') return 'Confirmed'
  if (props.status === 'WORKING') return 'In progress'
  if (props.status === 'AWAITING_CUSTOMER') {
    return props.proposalOptions > 1 ? `Awaiting customer · Option ${props.proposalOption} of ${props.proposalOptions}` : 'Awaiting customer'
  }
  if (props.status === 'COMPLETED') return 'Completed'
  if (props.status === 'OVERDUE') return 'Overdue'
  return props.status ? props.status[0] + props.status.slice(1).toLowerCase() : ''
}

// The status on a card that has little room: "Awaiting · 1/2" for a held day.
function statusShort(props) {
  if (props.status === 'AWAITING_CUSTOMER') {
    return props.proposalOptions > 1 ? `Awaiting · ${props.proposalOption}/${props.proposalOptions}` : 'Awaiting'
  }
  return statusText(props)
}

function formatPreviousVisit(lastVisit) {
  if (!lastVisit?.date) return 'No previous visits'
  const date = new Date(`${lastVisit.date}T12:00:00`)
  return `Last visit: ${shortDateFormatter.format(date)} · ${formatWorkTypes(lastVisit.workTypes)}`
}

// What each view shows (25 Nov 2026): the folio first, so a visit is recognized at a
// glance, then where, who and when. The visit history stays in the detail panel.
export default function CustomerServiceEventCard({ event, displayMode = 'timed' }) {
  const theme = useTheme()
  const props = event.extendedProps
  const tone = getServiceEventTone(props.status)
  // A held day uses the Awaiting customer stage color of the Proposal Workspace.
  const toneStyle = tone === 'awaiting' ? { '--service-accent': theme.palette.secondary.main } : undefined
  const workTypes = formatWorkTypes(props.workTypes)
  const place = [props.community, props.lotNumber ? `Lot ${props.lotNumber}` : null].filter(Boolean).join(' · ')
  const who = techniciansShort(props)
  const accessibleTitle = [
    props.requestNumber,
    statusText(props),
    workTypes,
    formatTimeRange(event),
    place,
    props.technician,
  ].filter(Boolean).join(' · ')

  if (displayMode === 'list') {
    return (
      <Box className={`service-list-event service-tone--${tone}`} style={toneStyle}>
        <Box className="service-list-event__identity">
          <span className="service-list-event__badge">CS</span>
          <Box className="service-list-event__copy">
            <Box component="span" className="service-list-event__heading">
              <strong>{props.requestNumber} · {workTypes}</strong>
              <span className="service-status-tag">{statusText(props)}</span>
            </Box>
            <span>{place}</span>
            <span>{[
              formatTimeRange(event), props.technician, formatDelayMargin(props.delayMargin),
            ].filter(Boolean).join(' · ')}</span>
          </Box>
        </Box>
        <span className="service-list-event__history">
          {formatPreviousVisit(props.lastVisit)}
        </span>
      </Box>
    )
  }

  if (displayMode === 'compact' || displayMode === 'year') {
    const isYear = displayMode === 'year'

    return (
      <Box
        className={`service-compact-event service-compact-event--${displayMode} service-tone--${tone}`}
        style={toneStyle}
        title={accessibleTitle}
        aria-label={accessibleTitle}
      >
        <span className="service-compact-event__marker" aria-hidden="true" />
        <strong>{isYear ? 'CS' : [props.requestNumber, props.community].filter(Boolean).join(' · ')}</strong>
        {!isYear && <span>{formatWindowShort(event)}</span>}
      </Box>
    )
  }

  return (
    <Box className={`service-work-event service-tone--${tone}`} style={toneStyle} title={accessibleTitle}>
      <Box className="service-work-event__topline">
        <strong>{props.requestNumber}</strong>
        <span className="service-status-tag">{statusShort(props)}</span>
      </Box>
      {place && <span className="service-work-event__property">{place}</span>}
      <span className="service-work-event__time">
        {[who, formatWorkSlot(props.internalSlot)].filter(Boolean).join(' · ')}
      </span>
      {props.customerWindow?.exceptional && <span className="service-work-event__time">Exception window</span>}
      {formatDelayMargin(props.delayMargin) && (
        <span className="service-work-event__time service-work-event__margin">{formatDelayMargin(props.delayMargin)}</span>
      )}
    </Box>
  )
}
