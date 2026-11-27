import { Link as RouterLink } from 'react-router-dom'
import { Box, Skeleton, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { activityTypeOptions } from '../../calendar/data/calendarEvents.js'
import { formatMonthDay, parseDateKey } from '../utils/dashboardDates.js'

const TYPE_COLORS = {
  EXT: 'primary.main',
  SHUTTER: 'info.main',
  DM: 'warning.main',
  HW: 'success.main',
}
const PERIODS = [7, 30, 90]
const MAX_EVENTS_PER_DAY = 4
const BAR_AREA_HEIGHT = 120

function typeLabel(type) {
  return activityTypeOptions.find((option) => option.value === type)?.shortLabel ?? type ?? 'Event'
}

function EventPill({ event }) {
  const props = event.extendedProps ?? {}
  const tentative = props.dateOwner === 'TENTATIVE'
  const color = TYPE_COLORS[props.activityType] ?? 'text.disabled'

  return (
    <Box
      component={RouterLink}
      to="/calendar"
      title={`${typeLabel(props.activityType)}${props.jobCode ? ` · Job #${props.jobCode}` : ''}${props.community ? ` · ${props.community}` : ''}`}
      sx={{
        display: 'block', minWidth: 0, py: 0.5, px: 0.875, borderRadius: '0 6px 6px 0',
        borderLeft: 3, borderLeftStyle: tentative ? 'dashed' : 'solid', borderLeftColor: color,
        bgcolor: 'action.hover', color: 'text.primary', textDecoration: 'none',
        '&:hover': { bgcolor: 'action.selected' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
      }}
    >
      <Typography variant="caption" noWrap sx={{ fontWeight: 600, display: 'block', lineHeight: 1.3 }}>
        {typeLabel(props.activityType)}{props.jobCode ? ` · Job #${props.jobCode}` : ''}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.3 }}>
        {props.community || event.title}
      </Typography>
      {tentative && (
        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', lineHeight: 1.3, color: 'urgency.soon' }}>
          Tentative
        </Typography>
      )}
    </Box>
  )
}

function DayColumns({ buckets }) {
  return (
    <Box
      sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${buckets.length}, minmax(0, 1fr))` },
        border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden',
      }}
    >
      {buckets.map((bucket, index) => {
        const date = parseDateKey(bucket.key)
        const visible = bucket.events.slice(0, MAX_EVENTS_PER_DAY)
        const hidden = bucket.events.length - visible.length
        return (
          <Box
            key={bucket.key}
            sx={{
              p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0,
              minHeight: { md: 168 },
              borderTop: { xs: index > 0 ? 1 : 0, md: 0 }, borderLeft: { md: index > 0 ? 1 : 0 },
              borderColor: 'divider',
              bgcolor: bucket.isToday ? 'primary.light' : bucket.isWeekend ? 'action.hover' : 'transparent',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexDirection: { md: 'column' }, mb: 0.25 }}>
              <Typography variant="caption" color="text.secondary">
                {date.toLocaleDateString('en-US', { weekday: 'short' })}
              </Typography>
              <Typography
                sx={{ fontWeight: 600, fontSize: 18, lineHeight: 1.2, color: bucket.isToday ? 'primary.main' : 'text.primary' }}
              >
                {date.getDate()}
              </Typography>
            </Box>
            {visible.map((event) => <EventPill key={event.id} event={event} />)}
            {hidden > 0 && (
              <Typography variant="caption" color="text.secondary">+{hidden} more</Typography>
            )}
            {bucket.events.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: { md: 'auto' } }}>
                No work scheduled
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

function WeekBars({ buckets }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total))

  return (
    <Box
      sx={{
        display: 'grid', gap: 0.75, alignItems: 'end', p: 1.5, pb: 1.25,
        border: 1, borderColor: 'divider', borderRadius: 2,
        gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
      }}
    >
      {buckets.map((bucket) => (
        <Box
          key={bucket.key}
          title={`${bucket.total} ${bucket.total === 1 ? 'event' : 'events'}`}
          sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 0.25, minWidth: 0 }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'center' }}>{bucket.total}</Typography>
          <Box sx={{ height: BAR_AREA_HEIGHT, display: 'flex', flexDirection: 'column-reverse', gap: '2px' }}>
            {activityTypeOptions.map((option) => (
              bucket.counts[option.value] > 0 && (
                <Box
                  key={option.value}
                  sx={{
                    height: `${(bucket.counts[option.value] / max) * 100}%`,
                    bgcolor: TYPE_COLORS[option.value], borderRadius: 0.5,
                  }}
                />
              )
            ))}
          </Box>
          <Typography
            variant="caption" noWrap
            sx={{
              textAlign: 'center', color: bucket.isToday ? 'primary.main' : 'text.secondary',
              fontWeight: bucket.isToday ? 600 : 400,
            }}
          >
            {bucket.isToday ? 'This week' : formatMonthDay(bucket.key)}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export default function ProductionSchedule({
  timeline, startKey, endKey, days, onDaysChange, loading, tentativeCount,
}) {
  const total = Object.values(timeline.typeCounts).reduce((sum, count) => sum + count, 0)

  return (
    <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>Production schedule</Typography>
          <Typography variant="body2" color="text.secondary">
            {formatMonthDay(startKey)} to {formatMonthDay(endKey)}
            {timeline.mode === 'weeks' ? ', events per week' : ''}
            {tentativeCount > 0 ? `, ${tentativeCount} tentative` : ''}
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={days} exclusive size="small" aria-label="Production period"
          onChange={(_, value) => { if (value) onDaysChange(value) }}
        >
          {PERIODS.map((value) => (
            <ToggleButton key={value} value={value} aria-label={`Next ${value} days`} sx={{ px: 1.5, textTransform: 'none' }}>
              {value} days
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 2, p: 0, display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
        {activityTypeOptions.map((option) => (
          <Box component="li" key={option.value} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: TYPE_COLORS[option.value] }} />
            <Typography variant="body2">
              {option.shortLabel}{' '}
              <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                {timeline.typeCounts[option.value]}
              </Typography>
            </Typography>
          </Box>
        ))}
      </Box>

      {loading ? (
        <Skeleton variant="rounded" height={200} />
      ) : total === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 5, textAlign: 'center', border: 1, borderColor: 'divider', borderRadius: 2 }}>
          No Production events in the next {days} days.
        </Typography>
      ) : timeline.mode === 'days' ? (
        <DayColumns buckets={timeline.buckets} />
      ) : (
        <WeekBars buckets={timeline.buckets} />
      )}
    </Box>
  )
}
