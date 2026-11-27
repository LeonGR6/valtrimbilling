import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Collapse, Divider, Paper, Stack, Typography } from '@mui/material'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
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

// One line that answers "is anything close?" without opening the list.
function nearbySummary({ candidates, near, limit }) {
  if (candidates.length === 0) return 'No scheduled visits or open requests to compare in this period.'
  if (near.length) {
    return `${near.length} ${limit === null ? 'to compare' : `within ${limit} mi`} · nearest ${near[0].requestNumber}`
  }
  const nearest = candidates.find((candidate) => candidate.miles !== null)
  if (!nearest) return 'None of the visits or open requests have coordinates.'
  return `None within ${limit} mi. The nearest, ${nearest.requestNumber}, is ≈ ${nearest.miles.toFixed(1)} mi away in a straight line.`
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

// The suggestions come first; the nearby list they are based on stays folded below
// (review of 13 Nov 2026). Colors come from driving miles (Google Route Matrix, no
// traffic); "≈" marks straight-line miles while they are being checked or when Google fails.
export default function ProposalNearbyVisits({
  request, requests, technicians, distanceBands, formDate, formFits, onUseSlot, onRecommendedChange, onSecondChange,
}) {
  const [open, setOpen] = useState(false)
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
    <Stack spacing={1.5}>
      <ProposalNearbySlots request={request} requests={requests} technicians={technicians} candidates={candidates}
        hasCoordinates={hasCoordinates} distanceBands={distanceBands} drivingById={driving.byId}
        drivingLoading={driving.loading} formDate={formDate} formFits={formFits}
        onUseSlot={onUseSlot} onRecommendedChange={onRecommendedChange} onSecondChange={onSecondChange} />
      <Divider />
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0, flex: '1 1 240px' }}>
            <Typography variant="subtitle2" fontWeight={800}>Nearby visits</Typography>
            {hasCoordinates && (
              <Typography variant="caption" color="text.secondary">{nearbySummary({ candidates, near, limit })}</Typography>
            )}
          </Box>
          {hasCoordinates && candidates.length > 0 && (
            <Button size="small" variant="text" onClick={() => setOpen((current) => !current)} aria-expanded={open}
              endIcon={open ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}>
              {open ? 'Hide list' : 'Show list'}
            </Button>
          )}
        </Stack>
        {!hasCoordinates && (
          <Alert severity="info" variant="outlined">
            No coordinates: this request cannot be compared with other visits. Add the property coordinates in Requests.
          </Alert>
        )}
        {(driving.error || unmeasured) && (
          <Alert severity="warning" variant="outlined">
            {driving.error
              ? `Driving miles could not be checked: ${driving.error} Nearby visits cannot be used for suggestions; straight-line miles are shown.`
              : 'Google Maps could not measure some driving miles; those show straight-line miles.'}
          </Alert>
        )}
        <Collapse in={open} unmountOnExit>
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              {through.byDueDate
                ? `Scheduled visits through the due date (${formatVisitDate(through.date)})`
                : `Overdue: scheduled visits through ${formatVisitDate(through.date)} (${proposalSuggestionSearchBusinessDays} business days)`}
              {' '}and open requests, nearest first. Colors use Google Maps driving miles, with minutes without traffic;
              {' '}≈ marks straight-line miles.
            </Typography>
            {driving.loading && <Typography variant="caption" color="text.secondary">Checking driving miles with Google Maps…</Typography>}
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
          </Stack>
        </Collapse>
      </Stack>
    </Stack>
  )
}
