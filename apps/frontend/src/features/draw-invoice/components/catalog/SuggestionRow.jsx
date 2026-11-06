import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  formatPhaseBuilding,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'

/** One Job's suggested Package: what it holds, what it is worth and the button to review it. */
export default function SuggestionRow({ suggestion, disabled, onReview }) {
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
