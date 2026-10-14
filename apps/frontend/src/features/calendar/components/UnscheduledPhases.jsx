import { useMemo } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import { formatBuilding, formatPhase } from './calendarSchedulerUtils.js'

function groupByJob(unscheduled) {
  const groups = new Map()
  for (const item of unscheduled) {
    const items = groups.get(item.job.id) ?? []
    items.push(item)
    groups.set(item.job.id, items)
  }
  return [...groups.values()]
}

/** Phases that have no Production events yet, with a shortcut to schedule them. */
export default function UnscheduledPhases({
  unscheduled,
  ready,
  error = null,
  canSchedule,
  onSchedule,
  onRetry,
}) {
  const groups = useMemo(() => groupByJob(unscheduled), [unscheduled])

  if (error) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 2.5, md: 4 } }}>
        <Alert
          severity="error"
          action={onRetry ? <Button color="inherit" onClick={onRetry}>Retry</Button> : undefined}
        >
          Calendar coverage could not be loaded: {error}
        </Alert>
      </Box>
    )
  }

  if (!ready) {
    return (
      <Box sx={{ minHeight: 220, flex: 1, display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={30} aria-label="Loading Calendar coverage" />
      </Box>
    )
  }

  return (
    // The Calendar page clips its content, so this tab scrolls on its own.
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 2.5, md: 4 } }}>
      {groups.length === 0 ? (
        <Card variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
          <EventAvailableRoundedIcon color="success" sx={{ fontSize: 42 }} />
          <Typography fontWeight={750} sx={{ mt: 1 }}>
            Every Phase has Calendar events
          </Typography>
          <Typography variant="body2" color="text.secondary">
            New Phases created in Sequence Sheets will appear here until they are scheduled.
          </Typography>
        </Card>
      ) : (
        <Stack spacing={2}>
          <Alert severity="warning">
            {unscheduled.length} {unscheduled.length === 1 ? 'Phase has' : 'Phases have'} no
            EXT, DM or HW events yet. Without them there are no Package Suggestions.
          </Alert>
          {!canSchedule && (
            <Alert severity="info">
              Your role has read-only access to Production activities.
            </Alert>
          )}
          {groups.map((items) => {
            const { job } = items[0]

            return (
              <Card key={job.id} variant="outlined" sx={{ overflow: 'hidden' }}>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ px: 2.5, py: 1.75, bgcolor: 'action.hover', alignItems: 'center' }}
                >
                  <EventBusyRoundedIcon color="warning" />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography fontWeight={800}>Job #{job.code}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {job.builder} · {job.community}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    color="warning"
                    label={`${items.length} ${items.length === 1 ? 'Phase' : 'Phases'}`}
                  />
                </Stack>
                {items.map(({ key, phase, lotCount }) => (
                  <Box key={key}>
                    <Divider />
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      sx={{ px: 2.5, py: 1.5, alignItems: { sm: 'center' } }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography fontWeight={750}>
                          {formatPhase(phase.name)} · {formatBuilding(phase.building)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {lotCount} {lotCount === 1 ? 'lot' : 'lots'}
                          {phase.createdAt ? ` · Created ${phase.createdAt}` : ''}
                        </Typography>
                      </Box>
                      <Button
                        variant="contained"
                        size="small"
                        disableElevation
                        disabled={!canSchedule}
                        onClick={() => onSchedule(job, phase)}
                      >
                        Schedule now
                      </Button>
                    </Stack>
                  </Box>
                ))}
              </Card>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
