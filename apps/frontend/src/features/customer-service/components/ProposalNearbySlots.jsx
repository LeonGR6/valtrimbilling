import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import {
  deadlineLabel, nearbySlotSuggestions, recommendSlot, secondOptionSlot, suggestionLegsToCheck,
} from '../utils/nearbySlotSuggestions.js'
import { mergeTravelEstimateResults, travelLegsToEstimate } from '../utils/travelEstimates.js'
import { travelLegKey } from '../utils/customerServiceScheduling.js'
import { formatTime, formatWeekdayDate } from '../utils/dates.js'
import {
  fitStatus, fitStatusLabels, proposalSuggestionLeadBusinessDays, proposalSuggestionSearchBusinessDays,
  validatePrototypeProposalDraft,
} from '../utils/proposalDraft.js'
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

// How late the visit can start without it or a later visit leaving its window. Shown as
// information: no minimum is required (decision of 17 Nov 2026).
function MarginChip({ margin }) {
  if (margin === null || margin === undefined) return null
  return <Chip size="small" variant="outlined" label={`Margin ${Math.max(0, margin)} min`} />
}

// Warnings under a slot: a second technician added, or less notice than usual.
const slotWarning = (slot) => [
  slot.warning,
  slot.shortNotice && `Short notice: the due date is sooner than ${proposalSuggestionLeadBusinessDays} business days, so call the customer to confirm.`,
].filter(Boolean).join(' ') || null

const statusColors = { FITS: 'success', TRAVEL_PENDING: 'warning', DOESNT_FIT: 'default' }

// The same three states as the planner's check: Fits, Fits once travel is calculated, Doesn't fit.
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

// The first thing the coordinator reads: one slot, why it was chosen and one button.
function RecommendedSlot({ children }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: 'primary.main', borderWidth: 2 }}>
      <Typography variant="overline" color="primary" fontWeight={800} component="div">Recommended slot</Typography>
      {children}
    </Paper>
  )
}

// Slots next to the nearest Near or Medium visits, with the minutes of driving each
// adds, then the final days and the earliest slot (fit plan, block R4). The first one
// that fits is shown as the recommended slot; the rest stay below as other options.
// Traffic minutes are asked only for the legs of those slots and the direct drives they
// replace, through the same travel Edge Function the planner uses (saved minutes are
// reused there).
// A proposal offers a second day with the slot in the form (formDate, once the form is
// complete; formFits when it can be offered), or with the recommended slot until then.
export default function ProposalNearbySlots({
  request, requests, technicians, candidates, hasCoordinates = true, distanceBands = null, drivingById, drivingLoading,
  formDate = null, formFits = false, onUseSlot, onRecommendedChange,
}) {
  const {
    estimateTravel, storedTravelMinutes, storedRoutesMinutes, storedTravelDetails, travelTrafficMode,
  } = useCustomerServicePrototype()
  const [traffic, setTraffic] = useState(emptyTraffic)
  // Suggestions are worked out for this moment; a slot that has passed when it is used
  // moves the moment forward and the suggestions are worked out again.
  const [now, setNow] = useState(() => new Date())
  const [expired, setExpired] = useState(false)
  const travelMinutes = useMemo(() => ({ ...storedTravelMinutes, ...traffic.minutes }), [storedTravelMinutes, traffic.minutes])
  const plan = useMemo(
    () => nearbySlotSuggestions({ request, requests, technicians, candidates, drivingById, travelMinutes, now }),
    [request, requests, technicians, candidates, drivingById, travelMinutes, now],
  )
  const groupingMiles = distanceBands?.distanceYellowMaxMiles ?? null
  const recommended = useMemo(() => recommendSlot({ plan, hasCoordinates, groupingMiles }), [plan, hasCoordinates, groupingMiles])
  // A form that does not fit cannot be offered, so it gets no second day.
  const firstOption = formDate
    ? (formFits ? { date: formDate, label: 'the slot in the form' } : null)
    : recommended && { date: recommended.slot.date, label: 'the recommended slot' }
  const firstDate = drivingLoading ? null : firstOption?.date ?? null
  const second = useMemo(
    () => (firstDate ? secondOptionSlot({ request, requests, technicians, firstDate, drivingById, travelMinutes, now }) : null),
    [request, requests, technicians, firstDate, drivingById, travelMinutes, now],
  )

  // Legs of the suggested slots, the direct drives they replace, the earliest slot and the
  // second day, still without minutes or saved without the current traffic setting or
  // departure slot; each is asked once.
  const unchecked = travelLegsToEstimate(
    suggestionLegsToCheck({ ...plan, second: second?.slot }), { ...storedRoutesMinutes, ...traffic.routes }, { ...storedTravelDetails, ...traffic.details },
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

  // The planner previews the recommended slot in its day agenda until a slot is chosen. Only
  // plain values travel up; the key keeps the parent from updating on every render.
  const previewKey = !drivingLoading && recommended
    ? JSON.stringify({
      date: recommended.slot.date, windowStart: recommended.slot.windowStart,
      internalStart: recommended.slot.internalStart, internalEnd: recommended.slot.internalEnd,
      pickupEnd: recommended.slot.pickupEnd, technicianIds: recommended.slot.technicianIds,
      technicianNames: recommended.slot.technicianNames, margin: recommended.slot.margin ?? null,
    })
    : ''
  useEffect(() => {
    onRecommendedChange?.(previewKey ? JSON.parse(previewKey) : null)
  }, [previewKey, onRecommendedChange])

  // Checked again at the moment it is used: a slot from a screen left open may be in the past.
  const use = (slot) => () => {
    const values = { technicianIds: slot.technicianIds, date: slot.date, windowStart: slot.windowStart, internalStart: slot.internalStart }
    const check = validatePrototypeProposalDraft({
      requestId: request.id, values: { ...values, travelMinutes }, requests, technicians,
    })
    if (!check.isValid || check.pastDue) {
      setExpired(true)
      setNow(new Date())
      return
    }
    setExpired(false)
    onUseSlot(values, (slot.travelLegs ?? []).map((leg) => traffic.results[leg.key]).filter(Boolean))
  }
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

  // The final days and the earliest time are often the same slot; it is shown only once.
  const isRecommended = (slot) => Boolean(recommended) && (recommended.slot === slot || (
    slot.date === recommended.slot.date && slot.internalStart === recommended.slot.internalStart
    && slot.technicianIds?.join() === recommended.slot.technicianIds.join()))
  const otherNextTo = plan.suggestions.filter((slot) => !isRecommended(slot))
  const otherFinalDays = plan.finalDays && !isRecommended(plan.finalDays) ? plan.finalDays : null
  const otherEarliest = plan.earliest && !isRecommended(plan.earliest) ? plan.earliest : null
  const hasOthers = otherNextTo.length > 0 || otherFinalDays || otherEarliest

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="subtitle2" fontWeight={800}>Suggested slots</Typography>
        <Typography variant="caption" color="text.secondary">
          Using a slot fills the form below and calculates its travel; nothing is sent or reserved.
        </Typography>
      </Box>
      {expired && (
        <Alert severity="info" variant="outlined" onClose={() => setExpired(false)}>
          That slot is no longer available because its time has passed or the schedule changed. The suggestions were updated.
        </Alert>
      )}
      {drivingLoading ? (
        <RecommendedSlot>
          <Typography variant="body2" color="text.secondary">Finding the best slot: checking driving miles with Google Maps…</Typography>
        </RecommendedSlot>
      ) : recommended ? (
        <RecommendedSlot>
          <Stack spacing={1}>
            <Box>
              <Typography variant="subtitle1" fontWeight={800}>
                {formatWeekdayDate(recommended.slot.date)} · {recommended.slot.windowLabel} window
              </Typography>
              <Typography variant="body2">
                Work {formatTime(recommended.slot.internalStart)}–{formatTime(recommended.slot.internalEnd)}
                {' · '}{recommended.slot.technicianNames.join(', ')}
              </Typography>
              {deadline(recommended.slot.date) && (
                <Typography variant="caption" color="text.secondary" component="div">{deadline(recommended.slot.date)}</Typography>
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">{recommended.reason}</Typography>
            {slotWarning(recommended.slot) && <Typography variant="caption" color="warning.main">{slotWarning(recommended.slot)}</Typography>}
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {fitChips(recommended.slot, recommended.sharesDay)}
            </Stack>
            {Number.isInteger(recommended.slot.margin) && (
              <Typography variant="caption" color="text.secondary">
                Margin {Math.max(0, recommended.slot.margin)} min: the visit can start that late and still finish, with
                pickup, inside its customer window.
              </Typography>
            )}
            <Button variant="contained" onClick={use(recommended.slot)} sx={{ alignSelf: 'flex-start' }}>Use this slot</Button>
          </Stack>
        </RecommendedSlot>
      ) : (
        <Alert severity="warning" variant="outlined">
          {plan.overdue
            ? `No time fits in the next ${proposalSuggestionSearchBusinessDays} business days for the active technicians.`
            : `No time fits before the due date${request.dueOn ? ` (${formatWeekdayDate(request.dueOn)})` : ''} for the active technicians.`}
          {' '}Check their agendas below or plan it by hand.
        </Alert>
      )}
      {firstOption && second && (
        <Stack spacing={1}>
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>Second day for the customer</Typography>
            <Typography variant="caption" color="text.secondary">
              A proposal offers two days so the customer can choose. This one goes with{' '}
              {formatWeekdayDate(firstOption.date)}, {firstOption.label}. {second.slot && second.reason}
            </Typography>
          </Box>
          {second.slot ? (
            <SlotRow title={second.kind === 'FINAL_DAYS' ? 'Final days' : 'Earliest available'} detail={slotDetail(second.slot)}
              deadline={deadline(second.slot.date)} warning={slotWarning(second.slot)}
              chips={fitChips(second.slot, second.slot.sharesDay ?? false)} />
          ) : (
            <Typography variant="body2" color="text.secondary">{second.reason}</Typography>
          )}
        </Stack>
      )}
      {fetchKey && <Typography variant="caption" color="text.secondary">Checking traffic for the suggested slots…</Typography>}
      {traffic.error && (
        <Typography variant="caption" color="warning.main">Traffic could not be checked: {traffic.error}</Typography>
      )}
      {!drivingLoading && hasOthers && (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>Other options</Typography>
          {otherNextTo.map((slot) => (slot.fits ? (
            <SlotRow key={slot.anchor.requestId} title={anchorTitle(slot.anchor)} detail={slotDetail(slot)}
              deadline={deadline(slot.date)} warning={slotWarning(slot)} chips={fitChips(slot)} onUse={use(slot)} />
          ) : (
            <SlotRow key={slot.anchor.requestId} title={anchorTitle(slot.anchor)}
              detail={[formatWeekdayDate(slot.anchor.date), slot.anchor.technicianNames?.join(', ')].filter(Boolean).join(' · ')}
              warning="No time fits next to it with the same technician."
              chips={<StatusChip status="DOESNT_FIT" />} />
          )))}
          {otherFinalDays && (
            <SlotRow title="Final days" detail={slotDetail(otherFinalDays)} deadline={deadline(otherFinalDays.date)}
              warning={slotWarning(otherFinalDays)} chips={fitChips(otherFinalDays, otherFinalDays.sharesDay)} onUse={use(otherFinalDays)} />
          )}
          {otherEarliest && (
            <SlotRow title="Earliest available" detail={slotDetail(otherEarliest)} deadline={deadline(otherEarliest.date)}
              warning={slotWarning(otherEarliest)} chips={fitChips(otherEarliest, false)} onUse={use(otherEarliest)} />
          )}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary">
        Suggestions start {proposalSuggestionLeadBusinessDays} business days from today so the customer can answer, or on
        the due date when it is sooner. Order: next to a nearby scheduled visit before the due date, then the final days
        from the due date back, then the earliest time. Margin is how late a visit can start and still finish inside its
        customer window.
      </Typography>
    </Stack>
  )
}
