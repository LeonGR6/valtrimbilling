import { Box, Chip, Stack, Typography } from '@mui/material'
import {
  describeSetupDetails,
  describeSetupDraws,
  describeSetupFigures,
} from '../utils/setupSummary.js'

const STATUS_CHIPS = {
  ACTIVE: { label: 'Current', color: 'success' },
  SUPERSEDED: { label: 'Replaced by a newer version', color: 'default' },
}

function Figure({ figure }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {figure.label}
      </Typography>
      <Typography
        fontWeight={figure.on ? 800 : 500}
        color={figure.on ? 'text.primary' : 'text.disabled'}
        sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}
      >
        {figure.value}
      </Typography>
    </Box>
  )
}

/**
 * One version of a Builder billing setup, for someone about to rely on it: the figures that
 * change what a Package bills first (retention, OCIP / WRAP, payment terms, cutoff), then the
 * Draws with their percentages, then the rest. Read-only; `children` is for the actions
 * that go with it. `setup` is a billing setup record (see toBuilderDrawSchedule).
 */
export default function BillingSetupSummary({
  setup,
  title = 'Billing setup',
  compact = false,
  hideVersion = false,
  children = null,
}) {
  const figures = describeSetupFigures(setup)
  const { draws, total, totalIsComplete } = describeSetupDraws(setup)
  const details = describeSetupDetails(setup)
  const status = STATUS_CHIPS[setup.status]

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.75, py: 1.1, alignItems: 'center', flexWrap: 'wrap', bgcolor: 'action.hover' }}
        useFlexGap
      >
        <Typography fontWeight={800}>{title}</Typography>
        {!hideVersion && <Chip size="small" variant="outlined" label={`Version ${setup.versionNumber}`} />}
        {status && <Chip size="small" color={status.color} variant="outlined" label={status.label} />}
        <Box sx={{ flex: 1 }} />
        {children}
      </Stack>

      <Box
        sx={{
          px: 1.75,
          py: 1.5,
          display: 'grid',
          gap: 1.75,
          gridTemplateColumns: compact
            ? 'repeat(2, minmax(0, 1fr))'
            : { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
        }}
      >
        {figures.map((figure) => <Figure key={figure.key} figure={figure} />)}
      </Box>

      <Box sx={{ px: 1.75, pb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
          Draws
        </Typography>
        <Stack spacing={0.25}>
          {draws.map((draw) => (
            <Stack
              key={draw.number}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
              useFlexGap
            >
              <Typography variant="body2" fontWeight={750} sx={{ width: 64, flexShrink: 0 }}>
                Draw {draw.number}
              </Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', width: 56, flexShrink: 0 }}>
                {draw.percentage}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[draw.eventType, draw.name, draw.lag ? `${draw.lag} after the event` : null]
                  .filter(Boolean)
                  .join(' · ')}
                {draw.billsOptions ? ' · bills the options' : ''}
              </Typography>
            </Stack>
          ))}
        </Stack>
        {!totalIsComplete && (
          <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 0.5 }}>
            The Draws add up to {total}%, not 100%.
          </Typography>
        )}
      </Box>

      <Box
        sx={{
          px: 1.75,
          py: 1.25,
          borderTop: 1,
          borderColor: 'divider',
          display: 'grid',
          rowGap: { sm: 0.75 },
          gridTemplateColumns: compact ? '1fr' : { xs: '1fr', sm: '170px minmax(0, 1fr)' },
          columnGap: 2,
        }}
      >
        {details.map(({ label, value }) => (
          // Side by side where there is room; on a phone the label sits over its value.
          <Box key={label} sx={{
              display: compact ? 'block' : { xs: 'block', sm: 'contents' },
              '&:not(:first-of-type)': { mt: compact ? 0.75 : { xs: 0.75, sm: 0 } },
            }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: compact ? 12 : { xs: 12, sm: 'inherit' } }}>
              {label}
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{value}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
