import { useMemo } from 'react'
import { alpha } from '@mui/material/styles'
import { Box, Stack, Typography } from '@mui/material'
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import MoveToInboxRoundedIcon from '@mui/icons-material/MoveToInboxRounded'
import PhoneInTalkRoundedIcon from '@mui/icons-material/PhoneInTalkRounded'
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded'
import { summarizeRequests } from '../utils/summary.js'

const cards = [
  {
    key: 'newThisWeek',
    label: 'New Requests',
    caption: 'This Week',
    color: 'primary',
    icon: MoveToInboxRoundedIcon,
  },
  {
    key: 'needContact',
    label: 'Need Contact',
    caption: 'Waiting',
    color: 'warning',
    icon: PhoneInTalkRoundedIcon,
  },
  {
    key: 'appointmentsToday',
    label: "Today's Appointments",
    caption: 'Today',
    color: 'secondary',
    icon: EventAvailableRoundedIcon,
  },
  {
    key: 'waitingParts',
    label: 'Waiting Parts',
    caption: 'Active',
    color: 'info',
    icon: Inventory2RoundedIcon,
  },
  {
    key: 'overdue',
    label: 'Overdue',
    caption: 'Requests',
    color: 'error',
    icon: ReportProblemRoundedIcon,
  },
]

export default function ServiceSummaryCards({ requests }) {
  const summary = useMemo(() => summarizeRequests(requests), [requests])

  return (
    <Box
      sx={{
        display: 'grid',
        // Five across on a desktop, folding down on narrower panes rather than
        // squeezing the labels.
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 1.5,
        mb: 2.5,
      }}
    >
      {cards.map(({ key, label, caption, color, icon: Icon }) => (
        <Box
          key={key}
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            p: 2,
          }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Box
              sx={(theme) => ({
                width: 32,
                height: 32,
                flexShrink: 0,
                // Literal pixels have to be a string: MUI multiplies plain
                // numbers by theme.shape.borderRadius.
                borderRadius: '8px',
                display: 'grid',
                placeItems: 'center',
                color: `${color}.main`,
                bgcolor: alpha(theme.palette[color].main, 0.16),
              })}
            >
              <Icon sx={{ fontSize: 18 }} />
            </Box>
            <Typography variant="body2" color="text.primary" noWrap>
              {label}
            </Typography>
          </Stack>

          <Typography variant="h4" fontWeight={700} sx={{ mt: 1.5 }}>
            {summary[key]}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {caption}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
