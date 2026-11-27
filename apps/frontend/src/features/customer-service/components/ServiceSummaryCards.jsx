import { alpha } from '@mui/material/styles'
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import { summarizeRequestInbox } from '../utils/requestInbox.js'

const cards = [
  {
    key: 'needsReview',
    filter: 'NEEDS_REVIEW',
    label: 'Needs review',
    caption: 'Complete and validate information',
    color: 'warning',
    icon: FactCheckRoundedIcon,
  },
  {
    key: 'readyToPropose',
    filter: 'READY_TO_PROPOSE',
    label: 'Ready to propose',
    caption: 'Scheduling ready',
    color: 'info',
    icon: AutoAwesomeRoundedIcon,
  },
]

export default function ServiceSummaryCards({
  requests,
  activeFilter,
  onFilterChange,
}) {
  const summary = summarizeRequestInbox(requests)

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(auto-fit, minmax(170px, 1fr))',
        },
        gap: 1.5,
        mb: 2.5,
      }}
    >
      {cards.map(({ key, filter, label, caption, color, icon: Icon }) => {
        const active = activeFilter === filter
        return (
          <ButtonBase
            key={key}
            aria-label={`Filter by ${label}`}
            onClick={() => onFilterChange(active ? 'all' : filter)}
            sx={(theme) => ({
              display: 'block',
              textAlign: 'left',
              bgcolor: active
                ? alpha(theme.palette[color].main, 0.08)
                : 'background.paper',
              border: 1,
              borderColor: active ? `${color}.main` : 'divider',
              borderRadius: 2,
              p: { xs: 1.5, sm: 2 },
              transition: theme.transitions.create(['border-color', 'box-shadow']),
              '&:hover': {
                borderColor: `${color}.main`,
                boxShadow: theme.shadows[1],
              },
            })}
          >
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Box
                sx={(theme) => ({
                  width: 34,
                  height: 34,
                  flexShrink: 0,
                  borderRadius: '9px',
                  display: 'grid',
                  placeItems: 'center',
                  color: `${color}.main`,
                  bgcolor: alpha(theme.palette[color].main, 0.16),
                })}
              >
                <Icon sx={{ fontSize: 19 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" color="text.primary" fontWeight={600}>
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {caption}
                </Typography>
              </Box>
            </Stack>

            <Typography variant="h4" fontWeight={800} sx={{ mt: 1.5 }}>
              {summary[key]}
            </Typography>
          </ButtonBase>
        )
      })}
    </Box>
  )
}
