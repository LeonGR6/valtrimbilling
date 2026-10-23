import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import SuggestionsCard from './SuggestionsCard.jsx'
import {
  formatPhaseBuilding,
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
      : `${suggestion.isMissedCutoff ? 'MISSED' : 'CUTOFF'}:${suggestion.cutoffDate}`
    const items = groups.get(key) ?? []
    items.push(suggestion)
    groups.set(key, items)
  }

  return [...groups.entries()].map(([key, items]) => ({ key, items }))
}

function SuggestionRow({ suggestion, disabled, onReview }) {
  const phaseScope = suggestion.phases.map((phase) => formatPhaseBuilding(
    phase.name,
    phase.building,
    { variant: 'short', separator: ' / ' },
  )).join(' · ')
  const needsAttention = !suggestion.isReady
  const items = `${suggestion.selectionCount} billing ${suggestion.selectionCount === 1 ? 'item' : 'items'}`
  const warnings = [
    suggestion.needsWorksheetReview ? 'Worksheet setup needs review' : null,
    suggestion.unpricedOptionCount > 0
      ? `${suggestion.unpricedOptionCount} ${suggestion.unpricedOptionCount === 1 ? 'option needs' : 'options need'} pricing`
      : null,
  ].filter(Boolean)

  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 2 },
        py: 1.1,
        display: 'grid',
        gap: { xs: 0.75, lg: 2 },
        alignItems: 'center',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.5fr) minmax(0, 1fr) 130px auto' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.25 }}>
          <Typography fontWeight={800}>Job #{suggestion.job.code}</Typography>
          <Chip
            size="small"
            color={needsAttention ? 'warning' : 'success'}
            variant="outlined"
            icon={needsAttention ? <WarningAmberRoundedIcon /> : <CheckCircleRoundedIcon />}
            label={needsAttention ? 'Needs attention' : 'Ready to review'}
            sx={{ height: 22 }}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" noWrap title={`${suggestion.job.builder} · ${suggestion.job.community} · ${phaseScope}`}>
          {suggestion.job.builder} · {suggestion.job.community} · {phaseScope}
        </Typography>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={750}>
          {items}
          <Typography component="span" variant="body2" color="text.secondary" fontWeight={400}>
            {' · '}
            {suggestion.eventTypes.length > 0 ? suggestion.eventTypes.join(' / ') : 'Calendar-linked work'}
          </Typography>
        </Typography>
        {suggestion.hardwareSelectionCount > 0 && (
          <Typography variant="caption" color="text.secondary" component="div">
            {suggestion.drawSelectionCount} Draw cells · {suggestion.hardwareSelectionCount} Separate Hardware
          </Typography>
        )}
        {warnings.length > 0 && (
          <Typography variant="caption" color="warning.main" component="div">
            {warnings.join(' · ')}
          </Typography>
        )}
      </Box>

      <Box sx={{ textAlign: { lg: 'right' } }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: { lg: 'block' } }}>
          Estimated{' '}
        </Typography>
        <Typography fontWeight={800} component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(suggestion.estimatedInvoiceAmount)}
        </Typography>
      </Box>

      <Button
        variant="contained"
        size="small"
        onClick={() => onReview(suggestion)}
        aria-label={`Review Package for Job #${suggestion.job.code}`}
        disabled={disabled}
        disableElevation
        sx={{ flexShrink: 0, justifySelf: { xs: 'stretch', lg: 'end' } }}
      >
        Review
      </Button>
    </Box>
  )
}

export default function PackageSuggestionsPanel({
  suggestions,
  loading,
  error,
  disabled,
  open,
  onToggle,
  onReview,
}) {
  const groups = groupSuggestions(suggestions)
  const empty = !loading && !error && groups.length === 0

  return (
    <SuggestionsCard
      id="package-suggestions"
      icon={<AutoAwesomeRoundedIcon />}
      iconSx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}
      title="Package Suggestions"
      count={loading || error ? null : suggestions.length}
      hint={empty
        ? 'Nothing is ready within the next 5 business days, and no cutoff was missed.'
        : 'Calendar-based recommendations for upcoming Builder cutoffs, and for work left unbilled after a missed one.'}
      loading={loading}
      open={open}
      onToggle={onToggle}
    >
      {error && (
        <Box sx={{ p: 1.5 }}>
          <Alert severity="warning">
            Package Suggestions are unavailable: {error}
          </Alert>
        </Box>
      )}

      {empty && (
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="body2" fontWeight={750}>No Package Suggestions right now</Typography>
          <Typography variant="body2" color="text.secondary">
            No Calendar-linked work is ready within the next 5 business days, and no cutoff went by
            with work still unbilled.
          </Typography>
        </Box>
      )}

      {!loading && !error && groups.map(({ key, items }, groupIndex) => {
        const first = items[0]
        const anyDate = first.mode === 'ANY_DATE'
        const missed = Boolean(first.isMissedCutoff)

        return (
          <Box key={key}>
            {groupIndex > 0 && <Divider />}
            <Stack
              direction="row"
              spacing={1}
              sx={{
                px: { xs: 1.5, md: 2 },
                py: 0.6,
                alignItems: 'center',
                bgcolor: 'action.hover',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <EventRoundedIcon color={missed ? 'warning' : 'action'} sx={{ fontSize: 16 }} />
              <Typography variant="body2" fontWeight={800}>
                {anyDate
                  ? 'Ready anytime'
                  : missed
                    ? `Missed cutoff ${formatLongDate(first.cutoffDate)}`
                    : `Cutoff ${formatLongDate(first.cutoffDate)}`}
              </Typography>
              {missed && (
                <Chip size="small" color="warning" label="Missed cutoff" sx={{ height: 20 }} />
              )}
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {anyDate
                  ? 'Highest-value rolling Calendar window'
                  : missed
                    ? `Ready by then and still unbilled · next cutoff ${formatLongDate(first.nextCutoffDate)}`
                    : businessDaysLabel(first)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {items.length} {items.length === 1 ? 'Job' : 'Jobs'}
              </Typography>
            </Stack>
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
    </SuggestionsCard>
  )
}
