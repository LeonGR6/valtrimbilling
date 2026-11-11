import { Box } from '@mui/material'
import {
  formatWorkTypes,
  getServiceEventTone,
} from '../data/serviceCalendarEvents.js'
import { customerServiceMinimumMarginMinutes } from '../utils/customerServiceScheduling.js'
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

// Several visits can share a customer window; the work time tells them apart.
function formatWorkSlot(slot) {
  if (!/^\d{2}:\d{2}$/u.test(slot?.start ?? '') || !/^\d{2}:\d{2}$/u.test(slot?.end ?? '')) return ''
  const at = (time) => {
    const [hours, minutes] = time.split(':').map(Number)
    return timeFormatter.format(new Date(2000, 0, 1, hours, minutes))
  }
  return `Work ${at(slot.start)} – ${at(slot.end)}`
}

// How late the visit can start without it or a later visit leaving its window.
function formatDelayMargin(margin) {
  if (!Number.isInteger(margin)) return ''
  return margin < customerServiceMinimumMarginMinutes
    ? `Low margin · ${Math.max(0, margin)} min`
    : `Margin ${margin} min`
}

function formatPreviousVisit(lastVisit) {
  if (!lastVisit?.date) return 'No previous visits'
  const date = new Date(`${lastVisit.date}T12:00:00`)
  return `Last visit: ${shortDateFormatter.format(date)} · ${formatWorkTypes(lastVisit.workTypes)}`
}

export default function CustomerServiceEventCard({ event, displayMode = 'timed' }) {
  const props = event.extendedProps
  const tone = getServiceEventTone(props.status)
  const workTypes = formatWorkTypes(props.workTypes)
  const accessibleTitle = [
    props.requestNumber,
    workTypes,
    formatTimeRange(event),
    props.community && props.lotNumber ? `${props.community} · Lot ${props.lotNumber}` : null,
  ].filter(Boolean).join(' · ')

  if (displayMode === 'list') {
    return (
      <Box className={`service-list-event service-tone--${tone}`}>
        <Box className="service-list-event__identity">
          <span className="service-list-event__badge">CS</span>
          <Box className="service-list-event__copy">
            <strong>{workTypes} · {props.requestNumber}</strong>
            <span>{props.community} · Lot {props.lotNumber}</span>
            <span>{[formatTimeRange(event), props.technician, formatDelayMargin(props.delayMargin)].filter(Boolean).join(' · ')}</span>
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
        title={accessibleTitle}
        aria-label={accessibleTitle}
      >
        <span className="service-compact-event__marker" aria-hidden="true" />
        <strong>{isYear ? 'CS' : `${props.requestNumber} · ${workTypes}`}</strong>
        {!isYear && <span>{formatTimeRange(event)}</span>}
      </Box>
    )
  }

  return (
    <Box className={`service-work-event service-tone--${tone}`}>
      <Box className="service-work-event__topline">
        <strong>CS · {workTypes}</strong>
        <span>{props.status === 'CONFIRMED' ? 'Confirmed' : props.status === 'WORKING' ? 'In progress' : props.status?.toLowerCase()}</span>
      </Box>
      <span className="service-work-event__property">
        {props.community} · Lot {props.lotNumber}
      </span>
      <span className="service-work-event__time">
        {formatTimeRange(event)}
        {props.customerWindow?.exceptional ? ' · Exception window' : ''}
      </span>
      {formatWorkSlot(props.internalSlot) && (
        <span className="service-work-event__time">{formatWorkSlot(props.internalSlot)}</span>
      )}
      {formatDelayMargin(props.delayMargin) && (
        <span className="service-work-event__time">{formatDelayMargin(props.delayMargin)}</span>
      )}
      <span className="service-work-event__history">
        {formatPreviousVisit(props.lastVisit)}
      </span>
    </Box>
  )
}

