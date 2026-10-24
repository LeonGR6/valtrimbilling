import {
  Alert,
  Box,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import SuggestionsCard from './SuggestionsCard.jsx'
import SuggestionRow from './SuggestionRow.jsx'
import { formatLongDate } from '../../utils/drawInvoiceFormatters.js'

function businessDaysLabel(suggestion) {
  if (suggestion.isCutoffToday) return 'Cutoff today'

  const count = suggestion.businessDaysRemaining
  return `${count} business ${count === 1 ? 'day' : 'days'} remaining`
}

function groupSuggestions(suggestions) {
  const groups = new Map()

  for (const suggestion of suggestions) {
    const key = suggestion.mode === 'ANY_DATE' ? 'ANY_DATE' : `CUTOFF:${suggestion.cutoffDate}`
    const items = groups.get(key) ?? []
    items.push(suggestion)
    groups.set(key, items)
  }

  return [...groups.entries()].map(([key, items]) => ({ key, items }))
}

/** What is ready for the next cutoffs, and the Jobs that bill on any date. A missed cutoff has its own card. */
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
        ? 'Nothing is ready within the next 5 business days.'
        : 'Calendar-based recommendations for upcoming Builder cutoffs.'}
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
            No Calendar-linked work is ready within the next 5 business days.
          </Typography>
        </Box>
      )}

      {!loading && !error && groups.map(({ key, items }, groupIndex) => {
        const first = items[0]
        const anyDate = first.mode === 'ANY_DATE'

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
              <EventRoundedIcon color="action" sx={{ fontSize: 16 }} />
              <Typography variant="body2" fontWeight={800}>
                {anyDate ? 'Ready anytime' : `Cutoff ${formatLongDate(first.cutoffDate)}`}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {anyDate ? 'Highest-value rolling Calendar window' : businessDaysLabel(first)}
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
