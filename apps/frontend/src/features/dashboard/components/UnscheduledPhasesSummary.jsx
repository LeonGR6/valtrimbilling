import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItemButton,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { formatPhaseBuilding } from '../../calendar/components/calendarSchedulerUtils.js'
import { CALENDAR_UNSCHEDULED_PATH } from '../../calendar/utils/calendarRoutes.js'

export const UNSCHEDULED_PHASES_PREVIEW_LIMIT = 5

export default function UnscheduledPhasesSummary({ coverage }) {
  if (coverage.error) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Calendar coverage is unavailable right now.
      </Alert>
    )
  }

  if (!coverage.ready) return <Skeleton variant="rounded" height={158} sx={{ mt: 2 }} />

  const { unscheduled } = coverage
  if (unscheduled.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        Every Phase created in Sequence Sheets has Calendar events.
      </Typography>
    )
  }

  const preview = unscheduled.slice(0, UNSCHEDULED_PHASES_PREVIEW_LIMIT)
  const hiddenCount = unscheduled.length - preview.length

  return (
    <>
      <List disablePadding sx={{ mt: 1.5 }}>
        {preview.map(({ key, job, phase, lotCount }, index) => (
          <Box component="li" key={key} sx={{ listStyle: 'none' }}>
            {index > 0 && <Divider />}
            <ListItemButton
              component={RouterLink}
              to={CALENDAR_UNSCHEDULED_PATH}
              sx={{ px: 1, py: 1.25, borderRadius: 1.5 }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.25}
                sx={{ alignItems: { md: 'center' }, width: '100%', minWidth: 0 }}
              >
                <Chip
                  label="No Calendar events"
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ minWidth: 150, flexShrink: 0 }}
                />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={750} noWrap>
                    Job #{job.code} · {formatPhaseBuilding(phase.name, phase.building)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {job.builder} · {job.community}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: { md: 140 }, textAlign: { md: 'right' } }}>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {lotCount} {lotCount === 1 ? 'lot' : 'lots'}
                    {phase.createdAt ? ` · Created ${phase.createdAt}` : ''}
                  </Typography>
                </Box>
              </Stack>
            </ListItemButton>
          </Box>
        ))}
      </List>
      {hiddenCount > 0 && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1 }}>
          <Button component={RouterLink} to={CALENDAR_UNSCHEDULED_PATH} size="small">
            +{hiddenCount} more {hiddenCount === 1 ? 'Phase' : 'Phases'}
          </Button>
        </Stack>
      )}
    </>
  )
}
