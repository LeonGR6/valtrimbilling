import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material'
import {
  getProposalNearbyVisits, isWithinNearbyRange, nearbyIdsToMeasure, nearbyVisitDistance,
} from '../utils/proposalNearbyVisits.js'
import { requestWorkflowStages } from '../utils/requestInbox.js'
import { formatLongDate, formatTime, formatWeekdayDate as formatVisitDate } from '../utils/dates.js'
import { proposalSuggestionSearchBusinessDays } from '../utils/proposalDraft.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import ProposalNearbySlots from './ProposalNearbySlots.jsx'

const bandColors = { GREEN: 'proximity.near', YELLOW: 'proximity.medium', ORANGE: 'proximity.far', RED: 'proximity.veryFar' }
// One shared empty map keeps memoized suggestions stable while driving miles load.
const noDriving = {}

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

// Driving miles for the nearby candidates, asked once per request and candidate list
// when the planner opens (decision 8). The server reuses saved distances, so opening
// the same planner again does not call Google again.
function useNearbyDriving(requestId, ids) {
  const { estimateNearby } = useCustomerServicePrototype()
  const key = `${requestId}:${ids.join(',')}`
  const [result, setResult] = useState({ key: null, byId: {}, error: '' })
  useEffect(() => {
    const [planned, list] = key.split(':')
    if (!list || !estimateNearby) return undefined
    let active = true
    estimateNearby({ requestId: Number(planned), candidateIds: list.split(',').map(Number) })
      .then((candidates) => {
        if (active) setResult({ key, byId: Object.fromEntries(candidates.map((entry) => [String(entry.requestId), entry])), error: '' })
      })
      .catch((error) => {
        if (active) setResult({ key, byId: {}, error: error.message })
      })
    return () => { active = false }
  }, [key, estimateNearby])
  const current = result.key === key
  return {
    loading: ids.length > 0 && !current,
    byId: current ? result.byId : noDriving,
    error: current ? result.error : '',
  }
}

// Read-only list. Colors come from driving miles (Google Route Matrix, no traffic);
// "≈" marks straight-line miles while they are being checked or when Google fails.
export default function ProposalNearbyVisits({ request, requests, technicians, distanceBands, onUseSlot }) {
  const [showFarther, setShowFarther] = useState(false)
  const { hasCoordinates, through, candidates } = useMemo(() => getProposalNearbyVisits({ request, requests }), [request, requests])
  const driving = useNearbyDriving(request.id, hasCoordinates && distanceBands ? nearbyIdsToMeasure(candidates, distanceBands) : [])
  // Beyond the last band in a straight line the drive is longer still, so those go last.
  const limit = distanceBands?.distanceOrangeMaxMiles ?? null
  const near = candidates.filter((candidate) => isWithinNearbyRange(candidate, distanceBands))
  const farther = candidates.filter((candidate) => !isWithinNearbyRange(candidate, distanceBands))
  const shown = showFarther ? candidates : near
  const unmeasured = near.some((candidate) => ['FAILED', 'NO_ROUTE'].includes(driving.byId[candidate.requestId]?.status))

  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="subtitle2" fontWeight={800}>Nearby visits</Typography>
        <Typography variant="caption" color="text.secondary">
          {through.byDueDate
            ? `Scheduled visits through the due date (${formatVisitDate(through.date)})`
            : `This request is overdue: scheduled visits through ${formatVisitDate(through.date)} (${proposalSuggestionSearchBusinessDays} business days)`}
          {' '}and open requests, nearest first. Colors use Google Maps driving miles; ≈ marks straight-line miles.
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
          {driving.loading && <Typography variant="caption" color="text.secondary">Checking driving miles with Google Maps…</Typography>}
          {(driving.error || unmeasured) && (
            <Alert severity="warning" variant="outlined">
              {driving.error
                ? `Driving miles could not be checked: ${driving.error} Straight-line miles are shown.`
                : 'Google Maps could not measure some driving miles; those show straight-line miles.'}
            </Alert>
          )}
          {near.length === 0 && !showFarther && (
            <Alert severity="info" variant="outlined">No visits or open requests within {limit} miles.</Alert>
          )}
          {shown.map((candidate) => {
            const distance = nearbyVisitDistance(candidate, driving.byId[candidate.requestId], distanceBands)
            const color = bandColors[distance.band]
            return (
              <Paper key={`${candidate.kind}-${candidate.requestId}`} variant="outlined"
                sx={{ p: 1.25, display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
                  <Typography variant="body2" fontWeight={700}>
                    {[candidate.requestNumber, candidate.community].filter(Boolean).join(' · ')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{candidateDetail(candidate)}</Typography>
                </Box>
                <Chip size="small" variant="outlined" label={distance.text}
                  sx={color ? { color, borderColor: color, fontWeight: 700 } : undefined} />
              </Paper>
            )
          })}
          {farther.length > 0 && (
            <Button size="small" variant="text" onClick={() => setShowFarther((current) => !current)} sx={{ alignSelf: 'flex-start' }}>
              {showFarther
                ? 'Show nearby only'
                : `Show ${farther.length} more ${limit === null ? 'without coordinates' : `over ${limit} mi or without coordinates`}`}
            </Button>
          )}
        </>
      )}
      {hasCoordinates && (
        <>
          <Divider />
          <ProposalNearbySlots request={request} requests={requests} technicians={technicians} candidates={candidates}
            drivingById={driving.byId} drivingLoading={driving.loading} onUseSlot={onUseSlot} />
        </>
      )}
    </Stack>
  )
}
