import { useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { getProposalNearbyVisits } from '../utils/proposalNearbyVisits.js'
import { requestWorkflowStages } from '../utils/requestInbox.js'
import { formatLongDate, formatTime } from '../utils/dates.js'
import { proposalSuggestionSearchBusinessDays } from '../utils/proposalDraft.js'

const formatVisitDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
})

function candidateDetail(candidate) {
  if (candidate.kind === 'VISIT') {
    return [
      formatVisitDate(candidate.date),
      `${formatTime(candidate.start)}–${formatTime(candidate.end)}`,
      candidate.technicianNames.join(', '),
    ].filter(Boolean).join(' · ')
  }
  return [
    requestWorkflowStages[candidate.stage]?.label ?? candidate.stage,
    'No appointment',
    candidate.dueOn ? `Due ${formatLongDate(candidate.dueOn)}` : '',
  ].filter(Boolean).join(' · ')
}

// Read-only list: straight-line miles, no color and no Google call. Driving miles and
// colors come with the travel estimates of the next step.
export default function ProposalNearbyVisits({ request, requests, distanceBands }) {
  const [showFarther, setShowFarther] = useState(false)
  const { hasCoordinates, through, candidates } = getProposalNearbyVisits({ request, requests })
  // Beyond the last band in a straight line the drive is longer still, so those go last.
  const limit = distanceBands?.distanceOrangeMaxMiles ?? null
  const isNear = (candidate) => limit === null || (candidate.miles !== null && candidate.miles <= limit)
  const near = candidates.filter(isNear)
  const farther = candidates.filter((candidate) => !isNear(candidate))
  const shown = showFarther ? candidates : near

  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="subtitle2" fontWeight={800}>Nearby visits</Typography>
        <Typography variant="caption" color="text.secondary">
          {through.byDueDate
            ? `Scheduled visits through the due date (${formatVisitDate(through.date)})`
            : `This request is overdue: scheduled visits through ${formatVisitDate(through.date)} (${proposalSuggestionSearchBusinessDays} business days)`}
          {' '}and open requests, nearest first. Miles are in a straight line; driving is longer.
        </Typography>
      </Box>
      {!hasCoordinates ? (
        <Alert severity="info" variant="outlined">
          No coordinates: this request cannot be compared with other visits. Add the property coordinates in Requests.
        </Alert>
      ) : candidates.length === 0 ? (
        <Alert severity="info" variant="outlined">No scheduled visits or open requests to compare in this period.</Alert>
      ) : (
        <>
          {near.length === 0 && !showFarther && (
            <Alert severity="info" variant="outlined">No visits or open requests within {limit} miles.</Alert>
          )}
          {shown.map((candidate) => (
            <Paper key={`${candidate.kind}-${candidate.requestId}`} variant="outlined"
              sx={{ p: 1.25, display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
                <Typography variant="body2" fontWeight={700}>
                  {[candidate.requestNumber, candidate.community].filter(Boolean).join(' · ')}
                </Typography>
                <Typography variant="caption" color="text.secondary">{candidateDetail(candidate)}</Typography>
              </Box>
              <Chip size="small" variant="outlined"
                label={candidate.miles === null ? 'No coordinates' : `≈ ${candidate.miles.toFixed(1)} mi`} />
            </Paper>
          ))}
          {farther.length > 0 && (
            <Button size="small" variant="text" onClick={() => setShowFarther((current) => !current)} sx={{ alignSelf: 'flex-start' }}>
              {showFarther ? `Hide those over ${limit} mi` : `Show ${farther.length} more over ${limit} mi or without coordinates`}
            </Button>
          )}
        </>
      )}
    </Stack>
  )
}
