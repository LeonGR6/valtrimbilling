import { Box, Typography, useTheme } from '@mui/material'
import { drawBarSegments } from '../utils/builderSetupList.js'
import { formatSetupPercentage } from '../utils/setupSummary.js'

// The Draws take the colors the Calendar already gives EXT, DM and HW, so they read at a glance.
const EVENT_COLORS = {
  light: { EXT: '#8b5cf6', DM: '#dc2626', HW: '#2563eb' },
  dark: { EXT: '#a78bfa', DM: '#f87171', HW: '#60a5fa' },
}

/** The Draws as one thin bar, each as wide as its share, in the colors of their events. */
export default function DrawBar({ schedule, showTotal = true }) {
  const theme = useTheme()
  const colors = EVENT_COLORS[theme.palette.mode === 'dark' ? 'dark' : 'light']
  const { segments, total, complete } = drawBarSegments(schedule)
  const text = segments
    .map(({ eventType, percentage }) => `${eventType || 'Draw'} ${formatSetupPercentage(percentage)}%`)
    .join(', ')

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        role="img"
        aria-label={`Draws: ${text}${complete ? '' : `. They add up to ${formatSetupPercentage(total)}%, not 100%`}`}
        sx={{
          display: 'flex',
          gap: '2px',
          height: 8,
          borderRadius: 999,
          overflow: 'hidden',
          bgcolor: complete ? 'transparent' : 'action.selected',
          outline: complete ? 'none' : `1px solid ${theme.palette.warning.main}`,
        }}
      >
        {segments.map((segment) => (
          <Box
            key={segment.index}
            sx={{
              flex: `0 0 ${segment.share * 100}%`,
              minWidth: segment.percentage > 0 ? 4 : 0,
              bgcolor: colors[segment.eventType] ?? theme.palette.text.disabled,
            }}
          />
        ))}
      </Box>
      <Typography
        variant="caption"
        color={complete ? 'text.secondary' : 'warning.main'}
        noWrap
        sx={{ display: 'block', mt: 0.4, fontVariantNumeric: 'tabular-nums' }}
        title={text}
      >
        {segments.map(({ eventType, percentage }) => `${eventType || '—'} ${formatSetupPercentage(percentage)}`).join(' · ')}
        {showTotal && !complete && ` · adds up to ${formatSetupPercentage(total)}`}
      </Typography>
    </Box>
  )
}
