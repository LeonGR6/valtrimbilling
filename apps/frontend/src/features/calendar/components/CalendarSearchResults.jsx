import { useEffect, useRef } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import {
  activityTypeMap,
  getActivityTone,
  getLotsLabel,
} from '../data/calendarEvents.js'
import { formatSearchDate, groupEventsByDay } from '../utils/calendarEventSearch.js'

function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function ResultRow({ event, selected, onOpen }) {
  const props = event.extendedProps
  const type = activityTypeMap[props.activityType]
  const tone = getActivityTone(props.activityType, props.orderMaterial)
  const extra = props.variant === 'install-only'
    ? 'Install only'
    : props.variant === 'baseboard-install'
      ? 'Baseboard install'
      : props.variant === 'lock-up' ? 'Lock up' : ''

  return (
    <ButtonBase
      className={`calendar-search__row activity-tone--${tone}${selected ? ' is-selected' : ''}`}
      onClick={() => onOpen(event.id)}
    >
      <span className="calendar-search__type">{type?.shortLabel ?? props.activityType}</span>
      <span className="calendar-search__copy">
        <strong>Job #{props.jobCode} · {props.community}</strong>
        <span>
          {[
            props.builder,
            [props.phase, props.building].filter(Boolean).join(' · '),
            getLotsLabel(props.lotStart, props.lotEnd, props.lotNumbers),
            extra,
          ].filter(Boolean).join('  |  ')}
        </span>
      </span>
      <span className="calendar-search__people">
        {[props.foreman, props.superintendent].filter(Boolean).join(' · ')}
      </span>
    </ButtonBase>
  )
}

/**
 * The events that match what was typed in the Calendar search, as a list by
 * day. It replaces the calendar grid while there is a search.
 */
export default function CalendarSearchResults({ results, query, selectedId, onOpen }) {
  const groups = groupEventsByDay(results)
  const today = todayIso()
  const firstUpcoming = groups.find((group) => group.date >= today)?.date
  const upcomingRef = useRef(null)

  // Land on the next event that is still to come, so past ones do not bury it.
  useEffect(() => {
    upcomingRef.current?.scrollIntoView?.({ block: 'start' })
  }, [query])

  return (
    <Box className="calendar-search" role="region" aria-label="Search results" aria-live="polite">
      <Typography variant="body2" color="text.secondary" className="calendar-search__summary">
        {results.length === 0
          ? `No events match “${query.trim()}”.`
          : `${results.length} ${results.length === 1 ? 'event matches' : 'events match'} “${query.trim()}” · all events, filters ignored`}
      </Typography>

      {groups.map((group) => (
        <Box
          key={group.date}
          className="calendar-search__day"
          ref={group.date === firstUpcoming ? upcomingRef : undefined}
        >
          <Typography variant="subtitle2" className="calendar-search__date">
            {formatSearchDate(group.date)}
            {group.date === today && <span className="calendar-search__today">Today</span>}
          </Typography>
          {group.events.map((event) => (
            <ResultRow
              key={event.id}
              event={event}
              selected={event.id === selectedId}
              onOpen={onOpen}
            />
          ))}
        </Box>
      ))}
    </Box>
  )
}
