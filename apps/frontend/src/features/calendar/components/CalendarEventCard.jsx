import { Box } from '@mui/material'
import {
  activityTypeMap,
  getActivityTone,
  getDateOwnerLabel,
  getLotsLabel,
} from '../data/calendarEvents.js'

export default function CalendarEventCard({ event, isList = false }) {
  const props = event.extendedProps
  const type = activityTypeMap[props.activityType]
  const tone = getActivityTone(props.activityType, props.orderMaterial)

  if (isList) {
    return (
      <Box className={`list-event activity-tone--${tone}`}>
        <Box className="list-event__identity">
          <span className="list-event__stage">{type.shortLabel}</span>
          <Box className="list-event__copy">
            <strong>{type.label}</strong>
            <span>Job #{props.jobCode} · {props.community}</span>
            <span>{props.phase} · {props.building}</span>
            <span>{getLotsLabel(props.lotStart, props.lotEnd, props.lotNumbers)}</span>
          </Box>
        </Box>
        <Box className="list-event__tags">
          <span>{getDateOwnerLabel(props.dateOwner, true)}</span>
          {props.orderMaterial && <span>Order material</span>}
          {props.variant === 'install-only' && <span>Install only</span>}
        </Box>
      </Box>
    )
  }

  return (
    <Box className={`work-event activity-tone--${tone}`}>
      <Box className="work-event__topline">
        <strong>{type.label}</strong>
        {props.orderMaterial && <span className="work-event__tag">Order material</span>}
        {props.variant === 'install-only' && <span className="work-event__tag">Install only</span>}
      </Box>
      <span className="work-event__community">Job #{props.jobCode} · {props.community}</span>
      <span className="work-event__phase-building">{props.phase} · {props.building}</span>
      <Box className="work-event__details">
        <span className="work-event__lots">{getLotsLabel(props.lotStart, props.lotEnd, props.lotNumbers)}</span>
        <span className="work-event__date-owner">{getDateOwnerLabel(props.dateOwner, true)}</span>
      </Box>
    </Box>
  )
}
