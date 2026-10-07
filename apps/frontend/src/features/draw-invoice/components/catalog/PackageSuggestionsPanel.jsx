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
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  formatBuilding,
  formatPhase,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  formatCurrency,
  formatLongDate,
} from '../../utils/drawInvoiceFormatters.js'

function businessDaysLabel(suggestion) {
  if (suggestion.isCutoffToday) return 'Cutoff today'

  const count = suggestion.businessDaysRemaining
  return `${count} business ${count === 1 ? 'day' : 'days'} remaining`
}

function groupSuggestions(suggestions) {
  const groups = new Map()

  for (const suggestion of suggestions) {
    const key = suggestion.mode === 'ANY_DATE'
      ? 'ANY_DATE'
      : `CUTOFF:${suggestion.cutoffDate}`
    const items = groups.get(key) ?? []
    items.push(suggestion)
    groups.set(key, items)
  }

  return [...groups.entries()].map(([key, items]) => ({ key, items }))
}

function SuggestionRow({ suggestion, disabled, onReview }) {
  const phaseScope = suggestion.phases.map((phase) => [
    formatPhase(phase.name, 'short'),
    formatBuilding(phase.building, 'short'),
  ].filter(Boolean).join(' / ')).join(' · ')
  const needsAttention = !suggestion.isReady

  return (
    <Box sx={{ px: { xs: 2, md: 2.5 }, py: 2 }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={2}
        sx={{ alignItems: { lg: 'center' } }}
      >
        <Box sx={{ flex: 1.35, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
            <Typography fontWeight={850}>Job #{suggestion.job.code}</Typography>
            <Chip
              size="small"
              color={needsAttention ? 'warning' : 'success'}
              variant="outlined"
              icon={needsAttention
                ? <WarningAmberRoundedIcon />
                : <CheckCircleRoundedIcon />}
              label={needsAttention ? 'Needs attention' : 'Ready to review'}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {suggestion.job.builder} · {suggestion.job.community}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {phaseScope}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={800}>
            {suggestion.selectionCount} suggested billing{' '}
            {suggestion.selectionCount === 1 ? 'item' : 'items'}
          </Typography>
          {suggestion.hardwareSelectionCount > 0 && (
            <Typography variant="caption" color="text.secondary" component="div">
              {suggestion.drawSelectionCount} Draw cells ·{' '}
              {suggestion.hardwareSelectionCount} Separate Hardware
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {suggestion.eventTypes.length > 0
              ? suggestion.eventTypes.join(' / ')
              : 'Calendar-linked work'}
          </Typography>
          {suggestion.needsWorksheetReview && (
            <Typography variant="caption" color="warning.dark" sx={{ display: 'block' }}>
              Worksheet setup needs review
            </Typography>
          )}
          {suggestion.unpricedOptionCount > 0 && (
            <Typography variant="caption" color="warning.dark" sx={{ display: 'block' }}>
              {suggestion.unpricedOptionCount}{' '}
              {suggestion.unpricedOptionCount === 1 ? 'option needs' : 'options need'} pricing
            </Typography>
          )}
        </Box>

        <Box sx={{ flex: 0.7, minWidth: { lg: 150 } }}>
          <Typography variant="caption" color="text.secondary">
            Estimated invoice
          </Typography>
          <Typography fontWeight={850}>
            {formatCurrency(suggestion.estimatedInvoiceAmount)}
          </Typography>
        </Box>

        <Button
          variant="contained"
          size="small"
          onClick={() => onReview(suggestion)}
          disabled={disabled}
          disableElevation
          sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', lg: 'center' } }}
        >
          Review Package
        </Button>
      </Stack>
    </Box>
  )
}

export default function PackageSuggestionsPanel({
  suggestions,
  loading,
  error,
  disabled,
  onReview,
}) {
  const groups = groupSuggestions(suggestions)

  return (
    <Card id="package-suggestions" variant="outlined" sx={{ mb: 2.5, overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, md: 2.5 }, py: 2.25 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: 1.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
            }}>
              <AutoAwesomeRoundedIcon />
            </Box>
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="h6" fontWeight={850}>Package Suggestions</Typography>
                {!loading && !error && suggestions.length > 0 && (
                  <Chip size="small" color="primary" label={suggestions.length} />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                Calendar-based recommendations for upcoming Builder cutoffs.
              </Typography>
            </Box>
          </Stack>
          {loading && <CircularProgress size={24} aria-label="Loading Package Suggestions" />}
        </Stack>
      </Box>

      {error && (
        <Box sx={{ px: { xs: 2, md: 2.5 }, pb: 2.25 }}>
          <Alert severity="warning">
            Package Suggestions are unavailable: {error}
          </Alert>
        </Box>
      )}

      {!loading && !error && groups.length === 0 && (
        <>
          <Divider />
          <Box sx={{ px: { xs: 2, md: 2.5 }, py: 2.25 }}>
            <Typography fontWeight={750}>No Package Suggestions right now</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              No Calendar-linked work is ready within the next 5 business days.
            </Typography>
          </Box>
        </>
      )}

      {!loading && !error && groups.map(({ key, items }) => {
        const first = items[0]
        const anyDate = first.mode === 'ANY_DATE'

        return (
          <Box key={key}>
            <Divider />
            <Box sx={{ px: { xs: 2, md: 2.5 }, py: 1.25, bgcolor: 'action.hover' }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <EventRoundedIcon color="action" fontSize="small" />
                  <Box>
                    <Typography variant="body2" fontWeight={850}>
                      {anyDate
                        ? 'Ready anytime'
                        : `Cutoff ${formatLongDate(first.cutoffDate)}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {anyDate
                        ? 'Highest-value rolling Calendar window'
                        : businessDaysLabel(first)}
                    </Typography>
                  </Box>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {items.length} {items.length === 1 ? 'Job' : 'Jobs'}
                </Typography>
              </Stack>
            </Box>
            {items.map((suggestion, index) => (
              <Box key={suggestion.job.id}>
                {index > 0 && <Divider />}
                <SuggestionRow
                  suggestion={suggestion}
                  disabled={disabled}
                  onReview={onReview}
                />
              </Box>
            ))}
          </Box>
        )
      })}
    </Card>
  )
}
