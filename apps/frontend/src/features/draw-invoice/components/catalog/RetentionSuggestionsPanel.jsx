import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import HourglassBottomRoundedIcon from '@mui/icons-material/HourglassBottomRounded'
import SuggestionsCard from './SuggestionsCard.jsx'
import {
  formatPhaseBuilding,
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
  return formatPhaseBuilding(suggestion.phase?.name, suggestion.phase?.building, {
    variant: 'short',
    separator: ' / ',
  })
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
  open,
  onToggle,
  onReview,
}) {
  if (suggestions.length === 0) return null

  return (
    <SuggestionsCard
      id="retention-suggestions"
      icon={<AccountBalanceRoundedIcon />}
      iconSx={{ bgcolor: 'success.light', color: 'success.dark' }}
      title="Retention Suggestions"
      count={suggestions.length}
      countColor="success"
      hint="Projected and releasable retention after Hardware completion."
      open={open}
      onToggle={onToggle}
    >
      {suggestions.map((suggestion, index) => {
        const content = statusContent[suggestion.status]
        return (
          <Box key={`${suggestion.job.id}:${suggestion.phaseId ?? 'JOB'}`}>
            {index > 0 && <Divider />}
            <Box
              sx={{
                px: { xs: 1.5, md: 2 },
                py: 1.1,
                display: 'grid',
                gap: { xs: 0.75, lg: 2 },
                alignItems: 'center',
                gridTemplateColumns: {
                  xs: '1fr',
                  lg: 'minmax(0, 1.4fr) 130px minmax(0, 1.2fr) 130px auto',
                },
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.25 }}>
                  <Typography fontWeight={800}>Job #{suggestion.job.code}</Typography>
                  <Chip
                    size="small"
                    color={content.color}
                    variant="outlined"
                    icon={content.icon}
                    label={content.label}
                    sx={{ height: 22 }}
                  />
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  noWrap
                  title={`${suggestion.job.builder} · ${suggestion.job.community} · ${scopeLabel(suggestion)}`}
                >
                  {suggestion.job.builder} · {suggestion.job.community} · {scopeLabel(suggestion)}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" component="div">
                  Projected
                </Typography>
                <Typography fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(suggestion.projectedRetention)}
                </Typography>
                {suggestion.draftRetention > 0 && (
                  <Typography variant="caption" color="warning.main" component="div">
                    {formatCurrency(suggestion.draftRetention)} in Draft
                  </Typography>
                )}
              </Box>

              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" component="div">
                  Releasable
                </Typography>
                <Typography
                  fontWeight={800}
                  color={suggestion.isReady ? 'success.main' : 'text.primary'}
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatCurrency(suggestion.releasableRetention)}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {eligibilityMessage(suggestion)}
                </Typography>
              </Box>

              <Box>
                {suggestion.sourceCutoffDate && (
                  <>
                    <Typography variant="caption" color="text.secondary" component="div">
                      Final Hardware cutoff
                    </Typography>
                    <Typography variant="body2" fontWeight={750}>
                      {formatLongDate(suggestion.sourceCutoffDate)}
                    </Typography>
                  </>
                )}
              </Box>

              <Button
                variant="contained"
                color="success"
                size="small"
                disabled={disabled || !suggestion.isReady}
                onClick={() => onReview(suggestion)}
                aria-label={`Review Retention Package for Job #${suggestion.job.code}`}
                disableElevation
                sx={{ flexShrink: 0, justifySelf: { xs: 'stretch', lg: 'end' } }}
              >
                Review
              </Button>
            </Box>
          </Box>
        )
      })}
    </SuggestionsCard>
  )
}
