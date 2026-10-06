import {
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import HourglassBottomRoundedIcon from '@mui/icons-material/HourglassBottomRounded'
import {
  formatBuilding,
  formatPhase,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  formatCurrency,
  formatLongDate,
} from '../../utils/drawInvoiceFormatters.js'

const statusContent = {
  READY: { label: 'Ready to release', color: 'success', icon: <CheckCircleRoundedIcon /> },
  WAITING_FOR_DATE: { label: 'Waiting for release date', color: 'info', icon: <HourglassBottomRoundedIcon /> },
  PROJECTED: { label: 'Projected from Draft', color: 'warning', icon: <HourglassBottomRoundedIcon /> },
  WAITING_FOR_HARDWARE: { label: 'Hardware incomplete', color: 'default', icon: <HourglassBottomRoundedIcon /> },
  CUTOFF_REQUIRED: { label: 'Cutoff required', color: 'warning', icon: <HourglassBottomRoundedIcon /> },
}

function scopeLabel(suggestion) {
  if (suggestion.scopeType === 'JOB') return 'Per Job'
  return [
    formatPhase(suggestion.phase?.name, 'short'),
    formatBuilding(suggestion.phase?.building, 'short'),
  ].filter(Boolean).join(' / ')
}

function eligibilityMessage(suggestion) {
  if (suggestion.status === 'READY') {
    return `Available since ${formatLongDate(suggestion.availableDate)}`
  }
  if (suggestion.status === 'WAITING_FOR_DATE') {
    return `Available ${formatLongDate(suggestion.availableDate)}`
  }
  if (suggestion.status === 'CUTOFF_REQUIRED') {
    return 'The final Hardware Package has no fixed cutoff.'
  }
  if (suggestion.status === 'PROJECTED') {
    return 'A Draft completes Hardware, but Draft amounts are not releasable.'
  }
  return `${suggestion.remainingHardwareLots} of ${suggestion.expectedLotCount} Lots still need qualifying Hardware.`
}

export default function RetentionSuggestionsPanel({
  suggestions,
  disabled,
  onReview,
}) {
  if (suggestions.length === 0) return null

  return (
    <Card variant="outlined" sx={{ mb: 2.5, overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, md: 2.5 }, py: 2.25 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{
            width: 42,
            height: 42,
            flexShrink: 0,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'success.light',
            color: 'success.dark',
          }}>
            <AccountBalanceRoundedIcon />
          </Box>
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h6" fontWeight={850}>Retention Suggestions</Typography>
              <Chip size="small" color="success" label={suggestions.length} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Projected and releasable retention after Hardware completion.
            </Typography>
          </Box>
        </Stack>
      </Box>

      {suggestions.map((suggestion) => {
        const content = statusContent[suggestion.status]
        return (
          <Box key={`${suggestion.job.id}:${suggestion.phaseId ?? 'JOB'}`}>
            <Divider />
            <Box sx={{ px: { xs: 2, md: 2.5 }, py: 2 }}>
              <Stack
                direction={{ xs: 'column', lg: 'row' }}
                spacing={2}
                sx={{ alignItems: { lg: 'center' } }}
              >
                <Box sx={{ flex: 1.25, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography fontWeight={850}>Job #{suggestion.job.code}</Typography>
                    <Chip
                      size="small"
                      color={content.color}
                      variant="outlined"
                      icon={content.icon}
                      label={content.label}
                    />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {suggestion.job.builder} · {suggestion.job.community}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {scopeLabel(suggestion)}
                  </Typography>
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Projected retention
                  </Typography>
                  <Typography fontWeight={850}>
                    {formatCurrency(suggestion.projectedRetention)}
                  </Typography>
                  {suggestion.draftRetention > 0 && (
                    <Typography variant="caption" color="warning.dark">
                      {formatCurrency(suggestion.draftRetention)} remains in Draft
                    </Typography>
                  )}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Releasable amount
                  </Typography>
                  <Typography fontWeight={850} color={suggestion.isReady ? 'success.dark' : 'text.primary'}>
                    {formatCurrency(suggestion.releasableRetention)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {eligibilityMessage(suggestion)}
                  </Typography>
                </Box>

                {suggestion.sourceCutoffDate && (
                  <Box sx={{ flex: 0.8, minWidth: 150 }}>
                    <Typography variant="caption" color="text.secondary">
                      Final Hardware cutoff
                    </Typography>
                    <Typography variant="body2" fontWeight={750}>
                      {formatLongDate(suggestion.sourceCutoffDate)}
                    </Typography>
                  </Box>
                )}

                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  disabled={disabled || !suggestion.isReady}
                  onClick={() => onReview(suggestion)}
                  disableElevation
                  sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', lg: 'center' } }}
                >
                  Review Retention Package
                </Button>
              </Stack>
            </Box>
          </Box>
        )
      })}
    </Card>
  )
}
