import { Box } from '@mui/material'
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

function formatPreviousVisit(lastVisit) {
  if (!lastVisit?.date) return 'No previous visits'
  const date = new Date(`${lastVisit.date}T12:00:00`)
  return `Last visit: ${shortDateFormatter.format(date)} · ${formatWorkTypes(lastVisit.workTypes)}`
}

export default function CustomerServiceEventCard({ event, isList = false }) {
  const props = event.extendedProps
  const tone = getServiceEventTone(props.status)
  const workTypes = formatWorkTypes(props.workTypes)

  if (isList) {
    return (
      <Box className={`service-list-event service-tone--${tone}`}>
        <Box className="service-list-event__identity">
          <span className="service-list-event__badge">CS</span>
          <Box className="service-list-event__copy">
            <strong>{workTypes} · {props.requestNumber}</strong>
            <span>{props.community} · Lot {props.lotNumber}</span>
            <span>{formatTimeRange(event)} · {props.technician}</span>
          </Box>
        </Box>
        <span className="service-list-event__history">
          {formatPreviousVisit(props.lastVisit)}
        </span>
      </Box>
    )
  }

  return (
    <Box className={`service-work-event service-tone--${tone}`}>
      <Box className="service-work-event__topline">
        <strong>CS · {workTypes}</strong>
        <span>{props.status === 'CONFIRMED' ? 'Confirmed' : props.status?.toLowerCase()}</span>
      </Box>
      <span className="service-work-event__property">
        {props.community} · Lot {props.lotNumber}
      </span>
      <span className="service-work-event__time">{formatTimeRange(event)}</span>
      <span className="service-work-event__history">
        {formatPreviousVisit(props.lastVisit)}
      </span>
    </Box>
  )
}

