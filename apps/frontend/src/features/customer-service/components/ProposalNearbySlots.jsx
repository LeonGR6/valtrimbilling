import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import { deadlineLabel, nearbySlotSuggestions, suggestionLegsToCheck } from '../utils/nearbySlotSuggestions.js'
import { mergeTravelEstimateResults, travelLegsToEstimate } from '../utils/travelEstimates.js'
import { customerServiceMinimumMarginMinutes, travelLegKey } from '../utils/customerServiceScheduling.js'
import { formatTime, formatWeekdayDate } from '../utils/dates.js'
import { fitStatus, fitStatusLabels } from '../utils/proposalDraft.js'
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

// How late the visit can start without it or a later visit leaving its window.
function MarginChip({ margin }) {
  if (margin === null || margin === undefined) return null
  const tight = margin < customerServiceMinimumMarginMinutes
  return <Chip size="small" variant="outlined" color={tight ? 'warning' : 'default'} label={`Margin ${Math.max(0, margin)} min`} />
}

const statusColors = { FITS: 'success', TRAVEL_PENDING: 'warning', DOESNT_FIT: 'default' }

// The same three states as the planner's check: Fits, Fits · travel pending, Doesn't fit.
function StatusChip({ status }) {
  return <Chip size="small" variant="outlined" color={statusColors[status]} label={fitStatusLabels[status]} />
}

function SlotRow({ title, detail, deadline, chips, warning, onUse }) {
  return (
    <Paper variant="outlined"
      sx={{ p: 1.25, display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
        <Typography variant="body2" fontWeight={700}>{title}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">{detail}</Typography>
        {deadline && <Typography variant="caption" color="text.secondary" component="div">{deadline}</Typography>}
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
// adds, then the final days and the earliest slot (fit plan, block R4). Traffic minutes
// are asked only for the legs of those slots and the direct drives they replace, through
// the same travel Edge Function the planner uses (saved minutes are reused there).
export default function ProposalNearbySlots({
  request, requests, technicians, candidates, hasCoordinates = true, drivingById, drivingLoading, onUseSlot,
}) {
  const {
    estimateTravel, storedTravelMinutes, storedRoutesMinutes, storedTravelDetails, travelTrafficMode,
  } = useCustomerServicePrototype()
  const [traffic, setTraffic] = useState(emptyTraffic)
  const travelMinutes = useMemo(() => ({ ...storedTravelMinutes, ...traffic.minutes }), [storedTravelMinutes, traffic.minutes])
  const plan = useMemo(
    () => nearbySlotSuggestions({ request, requests, technicians, candidates, drivingById, travelMinutes }),
    [request, requests, technicians, candidates, drivingById, travelMinutes],
  )

  // Legs of the suggested slots, the direct drives they replace and the earliest slot,
  // still without minutes or saved without the current traffic setting or departure
  // slot; each is asked once.
  const unchecked = travelLegsToEstimate(
    suggestionLegsToCheck(plan), { ...storedRoutesMinutes, ...traffic.routes }, { ...storedTravelDetails, ...traffic.details },
    travelTrafficMode,
  ).filter((leg) => !traffic.attempted.includes(attemptKey(leg)))
  const toFetch = unchecked.slice(0, maxLegsPerCall)
  // A row whose legs are still being checked with traffic is not "Fits" yet.
  const uncheckedKeys = new Set(unchecked.map((leg) => travelLegKey(leg.fromRequestId, leg.toRequestId)))
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
  const deadline = (date) => deadlineLabel({ date, request })
  // Status, the driving it adds when it shares the day, and its margin.
  const fitChips = (slot, sharesDay = true) => {
    const legs = [...(slot.travelLegs ?? []), slot.baselineLeg, ...(slot.baselineLegs ?? [])].filter(Boolean)
    const pending = slot.travelPending || (sharesDay && slot.extraMinutes === null)
      || legs.some((leg) => uncheckedKeys.has(leg.key))
    return (
      <>
        <StatusChip status={fitStatus({ fits: true, travelPending: pending })} />
        {sharesDay && Number.isInteger(slot.extraMinutes) && (
          <Chip size="small" variant="outlined" label={`+${slot.extraMinutes} min driving`} />
        )}
        <MarginChip margin={slot.margin} />
      </>
    )
  }

  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="subtitle2" fontWeight={800}>Suggested slots</Typography>
        <Typography variant="caption" color="text.secondary">
          First next to the nearest Near or Medium scheduled visits before the due date, with the same technician and at
          least{` ${customerServiceMinimumMarginMinutes} `}min of margin; then the final days, from the due date back; then
          the earliest available time. Extra minutes are the driving the visit adds to that technician&apos;s day; margin is
          how late it can start without it or a later visit leaving its customer window. Using one only fills this form.
        </Typography>
      </Box>
      {drivingLoading && <Typography variant="caption" color="text.secondary">Waiting for driving miles…</Typography>}
      {!drivingLoading && plan.suggestions.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          {hasCoordinates
            ? 'No Near or Medium scheduled visit to group with.'
            : 'No coordinates: nearby visits cannot be used, so the final days only use a technician with a free day.'}
        </Typography>
      )}
      {fetchKey && <Typography variant="caption" color="text.secondary">Checking traffic for the suggested slots…</Typography>}
      {traffic.error && (
        <Typography variant="caption" color="warning.main">Traffic could not be checked: {traffic.error}</Typography>
      )}
      {plan.suggestions.map((slot) => (slot.fits ? (
        <SlotRow key={slot.anchor.requestId} title={anchorTitle(slot.anchor)} detail={slotDetail(slot)}
          deadline={deadline(slot.date)} warning={slot.warning} chips={fitChips(slot)} onUse={use(slot)} />
      ) : (
        <SlotRow key={slot.anchor.requestId} title={anchorTitle(slot.anchor)}
          detail={[formatWeekdayDate(slot.anchor.date), slot.anchor.technicianNames?.join(', ')].filter(Boolean).join(' · ')}
          warning={slot.tightMargin === null || slot.tightMargin === undefined
            ? 'No time fits next to it with the same technician.'
            : `Only ${slot.tightMargin} min of margin next to it; suggestions keep at least ${customerServiceMinimumMarginMinutes}.`}
          chips={<StatusChip status="DOESNT_FIT" />} />
      )))}
      {plan.finalDays ? (
        <SlotRow title="Final days" detail={slotDetail(plan.finalDays)} deadline={deadline(plan.finalDays.date)}
          chips={fitChips(plan.finalDays, plan.finalDays.sharesDay)} onUse={use(plan.finalDays)} />
      ) : (
        <Typography variant="caption" color="text.secondary">
          {plan.overdue
            ? 'Overdue: no on-time day is left, so the earliest available time is the suggestion.'
            : 'No time fits on the final days or any earlier day before the due date.'}
        </Typography>
      )}
      {plan.earliest ? (
        <SlotRow title="Earliest available" detail={slotDetail(plan.earliest)} deadline={deadline(plan.earliest.date)}
          chips={fitChips(plan.earliest, false)} onUse={use(plan.earliest)} />
      ) : (
        <Typography variant="caption" color="text.secondary">No available time found in this period.</Typography>
      )}
    </Stack>
  )
}
