import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { nearbySlotSuggestions } from '../utils/nearbySlotSuggestions.js'
import { mergeTravelEstimateResults, travelLegsToEstimate } from '../utils/travelEstimates.js'
import { travelLegKey } from '../utils/customerServiceScheduling.js'
import { formatTime, formatWeekdayDate } from '../utils/dates.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'

// The travel Edge Function takes at most this many legs per call.
const maxLegsPerCall = 8
const attemptKey = (leg) => `${leg.fromRequestId}>${leg.toRequestId}@${leg.departureAt ?? ''}`
const emptyTraffic = { minutes: {}, routes: {}, details: {}, results: {}, attempted: [], error: '' }

function slotDetail(slot) {
  return [
    formatWeekdayDate(slot.date),
    `${slot.windowLabel} window`,
    `work ${formatTime(slot.internalStart)}–${formatTime(slot.internalEnd)}`,
    slot.technicianNames.join(', '),
  ].join(' · ')
}

function SlotRow({ title, detail, chips, warning, onUse }) {
  return (
    <Paper variant="outlined"
      sx={{ p: 1.25, display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
        <Typography variant="body2" fontWeight={700}>{title}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">{detail}</Typography>
        {warning && <Typography variant="caption" color="warning.main" component="div">{warning}</Typography>}
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {chips}
        {onUse && <Button size="small" variant="outlined" onClick={onUse}>Use this slot</Button>}
      </Stack>
    </Paper>
  )
}

// Slots next to the nearest Near or Medium visits, with the minutes of driving each
// adds. Traffic minutes are asked only for the legs of those slots, through the same
// travel Edge Function the planner uses (saved minutes are reused there).
export default function ProposalNearbySlots({ request, requests, technicians, candidates, drivingById, drivingLoading, onUseSlot }) {
  const {
    estimateTravel, storedTravelMinutes, storedRoutesMinutes, storedTravelDetails, travelTrafficMode,
  } = useCustomerServicePrototype()
  const [traffic, setTraffic] = useState(emptyTraffic)
  const travelMinutes = useMemo(() => ({ ...storedTravelMinutes, ...traffic.minutes }), [storedTravelMinutes, traffic.minutes])
  const plan = useMemo(
    () => nearbySlotSuggestions({ request, requests, technicians, candidates, drivingById, travelMinutes }),
    [request, requests, technicians, candidates, drivingById, travelMinutes],
  )

  // Legs of the suggested slots still without minutes, or saved without the current
  // traffic setting or departure slot; each is asked once.
  const slotLegs = [...new Map(plan.suggestions.filter((slot) => slot.fits)
    .flatMap((slot) => slot.travelLegs).map((leg) => [leg.key, leg])).values()]
  const toFetch = travelLegsToEstimate(
    slotLegs, { ...storedRoutesMinutes, ...traffic.routes }, { ...storedTravelDetails, ...traffic.details }, travelTrafficMode,
  ).filter((leg) => !traffic.attempted.includes(attemptKey(leg))).slice(0, maxLegsPerCall)
  const fetchKey = toFetch.length ? JSON.stringify(toFetch) : ''

  useEffect(() => {
    if (!fetchKey) return undefined
    const legs = JSON.parse(fetchKey)
    let active = true
    const attempted = (current) => [...current.attempted, ...legs.map(attemptKey)]
    estimateTravel(legs)
      .then((results) => {
        if (!active) return
        setTraffic((current) => ({
          ...current,
          ...mergeTravelEstimateResults(current, results),
          minutes: {
            ...current.minutes,
            ...Object.fromEntries(results.filter((result) => Number.isInteger(result.minutes))
              .map((result) => [travelLegKey(result.fromRequestId, result.toRequestId), result.minutes])),
          },
          results: {
            ...current.results,
            ...Object.fromEntries(results.map((result) => [travelLegKey(result.fromRequestId, result.toRequestId), result])),
          },
          attempted: attempted(current),
          error: '',
        }))
      })
      .catch((error) => {
        if (active) setTraffic((current) => ({ ...current, attempted: attempted(current), error: error.message }))
      })
    return () => { active = false }
  }, [fetchKey, estimateTravel])

  const use = (slot) => () => onUseSlot(
    { technicianIds: slot.technicianIds, date: slot.date, windowStart: slot.windowStart, internalStart: slot.internalStart },
    (slot.travelLegs ?? []).map((leg) => traffic.results[leg.key]).filter(Boolean),
  )
  const anchorTitle = (anchor) => `Next to ${[anchor.requestNumber, anchor.community].filter(Boolean).join(' · ')}`

  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="subtitle2" fontWeight={800}>Suggested slots</Typography>
        <Typography variant="caption" color="text.secondary">
          Next to the nearest Near or Medium scheduled visits, with the same technician. Extra minutes are the driving
          the visit adds to that technician&apos;s day. Using one only fills this form.
          {plan.highPriority && ' High priority: only visits on its earliest available date are used.'}
        </Typography>
      </Box>
      {plan.earliest ? (
        <SlotRow title="Earliest available" detail={slotDetail(plan.earliest)}
          chips={plan.earliest.travelPending && <Chip size="small" variant="outlined" color="warning" label="Travel time pending" />}
          onUse={use(plan.earliest)} />
      ) : (
        <Typography variant="caption" color="text.secondary">No available time found in this period.</Typography>
      )}
      {drivingLoading && <Typography variant="caption" color="text.secondary">Waiting for driving miles…</Typography>}
      {!drivingLoading && plan.suggestions.length === 0 && (
        <Typography variant="caption" color="text.secondary">No Near or Medium scheduled visit to group with.</Typography>
      )}
      {fetchKey && <Typography variant="caption" color="text.secondary">Checking traffic for the suggested slots…</Typography>}
      {traffic.error && (
        <Typography variant="caption" color="warning.main">Traffic could not be checked: {traffic.error}</Typography>
      )}
      {plan.suggestions.map((slot) => (slot.fits ? (
        <SlotRow key={slot.anchor.requestId} title={anchorTitle(slot.anchor)} detail={slotDetail(slot)} warning={slot.warning}
          chips={slot.extraMinutes === null
            ? <Chip size="small" variant="outlined" color="warning" label="Fits · travel time pending" />
            : <Chip size="small" variant="outlined" color="success" label={`+${slot.extraMinutes} min · Fits`} />}
          onUse={use(slot)} />
      ) : (
        <SlotRow key={slot.anchor.requestId} title={anchorTitle(slot.anchor)}
          detail={[formatWeekdayDate(slot.anchor.date), slot.anchor.technicianNames?.join(', ')].filter(Boolean).join(' · ')}
          chips={<Chip size="small" variant="outlined" label="Doesn't fit next to it" />} />
      )))}
    </Stack>
  )
}
