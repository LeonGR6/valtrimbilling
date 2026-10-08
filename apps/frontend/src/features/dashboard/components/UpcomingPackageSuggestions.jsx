import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItemButton,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import {
  formatCurrency,
  formatLongDate,
} from '../../draw-invoice/utils/drawInvoiceFormatters.js'

const PACKAGE_SUGGESTIONS_PATH = '/draw-invoice#package-suggestions'

function urgencyLabel(suggestion) {
  if (suggestion.isCutoffToday) return 'Cutoff today'

  const count = suggestion.businessDaysRemaining
  return `${count} business ${count === 1 ? 'day' : 'days'}`
}

export default function UpcomingPackageSuggestions({
  suggestions,
  totalCount = suggestions.length,
  loading,
  error,
}) {
  const hiddenCount = Math.max(0, totalCount - suggestions.length)

  if (loading) return <Skeleton variant="rounded" height={158} sx={{ mt: 2 }} />

  if (error) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        Package Suggestions are unavailable right now.
      </Alert>
    )
  }

  if (suggestions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        No fixed cutoffs with Calendar-linked work are due within 5 business days.
      </Typography>
    )
  }

  return (
    <>
      <List disablePadding sx={{ mt: 1.5 }}>
        {suggestions.map((suggestion, index) => (
          <Box component="li" key={suggestion.job.id} sx={{ listStyle: 'none' }}>
            {index > 0 && <Divider />}
            <ListItemButton
              component={RouterLink}
              to={PACKAGE_SUGGESTIONS_PATH}
              sx={{ px: 1, py: 1.25, borderRadius: 1.5 }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.25}
                sx={{ alignItems: { md: 'center' }, width: '100%', minWidth: 0 }}
              >
                <Chip
                  label={urgencyLabel(suggestion)}
                  size="small"
                  color={suggestion.isCutoffToday ? 'error' : 'warning'}
                  variant="outlined"
                  sx={{ minWidth: 118, flexShrink: 0 }}
                />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={750} noWrap>
                    Job #{suggestion.job.code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {suggestion.job.builder} · {suggestion.job.community}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: { md: 156 }, textAlign: { md: 'right' } }}>
                  <Typography variant="body2" fontWeight={750}>
                    Cutoff {formatLongDate(suggestion.cutoffDate)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {suggestion.selectionCount}{' '}
                    {suggestion.selectionCount === 1 ? 'suggested cell' : 'suggested cells'}
                    {' · '}
                    {suggestion.isReady ? 'Ready to review' : 'Needs attention'}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: { md: 104 }, textAlign: { md: 'right' } }}>
                  <Typography variant="caption" color="text.secondary" component="div">
                    Estimated
                  </Typography>
                  <Typography variant="body2" fontWeight={800}>
                    {formatCurrency(suggestion.estimatedInvoiceAmount)}
                  </Typography>
                </Box>
              </Stack>
            </ListItemButton>
          </Box>
        ))}
      </List>
      {hiddenCount > 0 && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1 }}>
          <Button component={RouterLink} to={PACKAGE_SUGGESTIONS_PATH} size="small">
            +{hiddenCount} more {hiddenCount === 1 ? 'cutoff' : 'cutoffs'}
          </Button>
        </Stack>
      )}
    </>
  )
}
