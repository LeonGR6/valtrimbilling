import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import { formatSearchDate, groupEventsByDay } from '../utils/calendarEventSearch.js'
import { ResultRow } from './CalendarSearchResults.jsx'

/**
 * The EXT events with "Order material" checked (yellow in the Calendar), as a list by day.
 * Selecting one opens it in the drawer, like on the Calendar.
 */
export default function OrderMaterials({
  upcoming,
  past,
  today,
  ready,
  error = null,
  selectedId,
  onOpen,
  onRetry,
}) {
  const [show, setShow] = useState('UPCOMING')
  const shown = show === 'UPCOMING' ? upcoming : past
  const groups = groupEventsByDay(shown)

  if (error) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 2.5, md: 4 } }}>
        <Alert
          severity="error"
          action={onRetry ? <Button color="inherit" onClick={onRetry}>Retry</Button> : undefined}
        >
          The Calendar events could not be loaded: {error}
        </Alert>
      </Box>
    )
  }

  if (!ready) {
    return (
      <Box sx={{ minHeight: 220, flex: 1, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={30} aria-label="Loading Order material events" />
      </Box>
    )
  }

  return (
    <Box className="calendar-search" role="region" aria-label="Order material events">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', pt: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={show}
          onChange={(_, value) => value && setShow(value)}
          aria-label="Which Order material events"
        >
          <ToggleButton value="UPCOMING">Upcoming ({upcoming.length})</ToggleButton>
          <ToggleButton value="PAST">Past ({past.length})</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary">
          EXT events with Order material checked.
        </Typography>
      </Box>

      {groups.length === 0 ? (
        <Card variant="outlined" sx={{ p: 5, mt: 2, textAlign: 'center' }}>
          <Inventory2RoundedIcon color="disabled" sx={{ fontSize: 42 }} />
          <Typography fontWeight={750} sx={{ mt: 1 }}>
            {show === 'UPCOMING' ? 'No material to order ahead' : 'No past Order material events'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Check Order material on an EXT event and it will appear here.
          </Typography>
        </Card>
      ) : groups.map((group) => (
        <Box key={group.date} className="calendar-search__day">
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
