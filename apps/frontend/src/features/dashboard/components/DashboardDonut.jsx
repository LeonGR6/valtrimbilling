import { Box, Stack, Typography } from '@mui/material'
import { useColorScheme, useTheme } from '@mui/material/styles'

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function DashboardDonut({ items, centerLabel, emptyMessage }) {
  const theme = useTheme()
  const { mode, systemMode } = useColorScheme()
  const resolvedMode = mode === 'system' ? systemMode : mode
  const palette = theme.colorSchemes?.[resolvedMode === 'dark' ? 'dark' : 'light']?.palette
    ?? theme.palette
  const resolveColor = (color) => {
    const [section, shade] = color.split('.')
    return palette[section]?.[shade] ?? theme.palette[section]?.[shade]
  }
  const total = items.reduce((sum, item) => sum + item.value, 0)
  let completedLength = 0

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={3}
      sx={{ alignItems: 'center', justifyContent: 'center', py: 1.5 }}
    >
      <Box sx={{ position: 'relative', width: 176, height: 176, flexShrink: 0 }}>
        <Box
          component="svg"
          viewBox="0 0 120 120"
          role="img"
          aria-label={`${centerLabel}: ${total}. ${items.map((item) => `${item.label}: ${item.value}`).join(', ')}`}
          sx={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}
        >
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            strokeWidth="15"
            style={{ stroke: palette.divider }}
          />
          {total > 0 && items.map((item) => {
            const length = (item.value / total) * CIRCUMFERENCE
            const offset = -completedLength
            completedLength += length
            return item.value > 0 ? (
              <circle
                key={item.label}
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                strokeWidth="15"
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={offset}
                style={{ stroke: resolveColor(item.color) }}
              />
            ) : null
          })}
        </Box>
        <Stack
          sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
        >
          <Typography variant="h4" fontWeight={800}>{total}</Typography>
          <Typography variant="caption" color="text.secondary">{centerLabel}</Typography>
        </Stack>
      </Box>

      <Stack spacing={1.25} sx={{ width: '100%', maxWidth: 220 }}>
        {items.map((item) => (
          <Stack key={item.label} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color, flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
              {item.label}
            </Typography>
            <Typography variant="body2" fontWeight={750}>{item.value}</Typography>
          </Stack>
        ))}
        {total === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ pt: 0.5 }}>
            {emptyMessage}
          </Typography>
        )}
      </Stack>
    </Stack>
  )
}
