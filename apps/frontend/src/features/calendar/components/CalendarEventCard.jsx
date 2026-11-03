import { Box } from '@mui/material'
import {
  activityTypeMap,
  getActivityTone,
  getDateOwnerLabel,
  getFollowUpStatusMeta,
  getLotsLabel,
} from '../data/calendarEvents.js'
import CustomerServiceEventCard from '../../customer-service/components/CustomerServiceEventCard.jsx'

export default function CalendarEventCard({ event, displayMode = 'timed' }) {
  const props = event.extendedProps

  if (props.calendarType === 'CUSTOMER_SERVICE') {
    return <CustomerServiceEventCard event={event} displayMode={displayMode} />
  }

  const type = activityTypeMap[props.activityType]
  const tone = getActivityTone(props.activityType, props.orderMaterial)
  const followUp = getFollowUpStatusMeta(props.followUp)

  if (displayMode === 'list') {
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
          {props.variant === 'lock-up' && <span>Lock up</span>}
          {followUp && (
            <span className={`follow-up-status follow-up-status--${followUp.tone}`}>
              {followUp.label}
            </span>
          )}
        </Box>
      </Box>
    )
  }

  if (displayMode === 'compact' || displayMode === 'year') {
    const isYear = displayMode === 'year'
    const accessibleTitle = `${type.label} · Job #${props.jobCode} · ${props.community}`

    return (
      <Box
        className={`service-compact-event service-compact-event--production service-compact-event--${displayMode} activity-tone--${tone}`}
        title={accessibleTitle}
        aria-label={accessibleTitle}
      >
        <span className="service-compact-event__marker" aria-hidden="true" />
        <strong>{isYear ? 'P' : `${type.shortLabel} · #${props.jobCode}`}</strong>
      </Box>
    )
  }

  return (
    <Box className={`work-event activity-tone--${tone}`}>
      <Box className="work-event__topline">
        <strong>{type.label}</strong>
        {props.orderMaterial && <span className="work-event__tag">Order material</span>}
        {props.variant === 'install-only' && <span className="work-event__tag">Install only</span>}
        {props.variant === 'lock-up' && <span className="work-event__tag">Lock up</span>}
        {followUp && (
          <span className={`work-event__tag follow-up-status follow-up-status--${followUp.tone}`}>
            {followUp.label}
          </span>
        )}
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
