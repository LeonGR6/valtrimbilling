import {
  Box,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import SuggestionsCard from './SuggestionsCard.jsx'
import SuggestionRow from './SuggestionRow.jsx'
import { formatLongDate } from '../../utils/drawInvoiceFormatters.js'

function groupByCutoff(suggestions) {
  const groups = new Map()

  for (const suggestion of suggestions) {
    const items = groups.get(suggestion.cutoffDate) ?? []
    items.push(suggestion)
    groups.set(suggestion.cutoffDate, items)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([cutoffDate, items]) => ({ cutoffDate, items }))
}

/**
 * Work that was ready by a cutoff that has passed and is still unbilled, above Package
 * Suggestions. It is not shown when there is none.
 */
export default function MissedCutoffsPanel({ suggestions, disabled, open, onToggle, onReview }) {
  if (suggestions.length === 0) return null

  const groups = groupByCutoff(suggestions)

  return (
    <SuggestionsCard
      id="missed-cutoffs"
      icon={<EventBusyRoundedIcon />}
      iconSx={{ bgcolor: 'warning.main', color: 'warning.contrastText' }}
      title="Missed cutoffs"
      count={suggestions.length}
      countColor="warning"
      hint="Ready by a cutoff that already passed and still unbilled."
      open={open}
      onToggle={onToggle}
    >
      {groups.map(({ cutoffDate, items }, groupIndex) => (
        <Box key={cutoffDate}>
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
            <EventBusyRoundedIcon color="warning" sx={{ fontSize: 16 }} />
            <Typography variant="body2" fontWeight={800}>
              Cutoff {formatLongDate(cutoffDate)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              Next cutoff {formatLongDate(items[0].nextCutoffDate)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {items.length} {items.length === 1 ? 'Job' : 'Jobs'}
            </Typography>
          </Stack>
          {items.map((suggestion, index) => (
            <Box key={suggestion.job.id}>
              {index > 0 && <Divider />}
              <SuggestionRow suggestion={suggestion} disabled={disabled} onReview={onReview} />
            </Box>
          ))}
        </Box>
      ))}
    </SuggestionsCard>
  )
}
