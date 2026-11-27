import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, FormHelperText, InputLabel, MenuItem, Paper, Select, Stack, TextField,
  Typography,
} from '@mui/material'
import DirectionsOutlinedIcon from '@mui/icons-material/DirectionsOutlined'
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import {
  buildAppointmentRegistration, buildProposalSend, changePrototypeProposalWindow, changePrototypeTravelMinutes, fitStatus, fitStatusLabels,
  getPrototypePlanningTechnicians, getPrototypeTechnicianAgenda, proposalDraftFormValues, proposalDraftHasChanges,
  proposalPlanningSignature, timeOnSameDay, validatePrototypeProposalDraft,
} from '../utils/proposalDraft.js'
import { travelLegKey } from '../utils/customerServiceScheduling.js'
import { proposalAlternatives } from '../utils/nearbySlotSuggestions.js'
import { customerChosenSlot } from '../utils/proposalAnswers.js'
import {
  applyTravelEstimates, mergeTravelEstimateResults, outdatedTravelLegs, travelEstimateMessages, travelLegDirectionsUrl,
  travelLegHelperText, travelLegSource, travelLegsToEstimate,
} from '../utils/travelEstimates.js'
import { formatTime, formatWeekdayDate, getCustomerServiceClock } from '../utils/dates.js'
import { buildVisitMove, visitSummary } from '../utils/customerServiceVisitChanges.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import { useAuth } from '../../auth/context/useAuth.js'
import MoveVisitDialog from './MoveVisitDialog.jsx'
import ProposalDayAgenda from './ProposalDayAgenda.jsx'
import ProposalNearbyVisits from './ProposalNearbyVisits.jsx'
import SendToCustomerDialog from './SendToCustomerDialog.jsx'

// The form column sits next to the agenda, so it can be narrow even on a wide screen.
// Its rows wrap by the space they get instead of switching at a screen breakpoint.
const sectionHeaderSx = { flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }
const sectionTitleSx = { flex: '1 1 240px' }
const fieldRowSx = { flexWrap: 'wrap', '& > *': { flex: '1 1 160px' } }
const actionRowSx = { flexWrap: 'wrap', '& > *': { flex: '1 1 200px' } }

// moving (Reschedule block, 27 Nov 2026): { request, previous } moves the confirmed visit of
// request instead of preparing a proposal. The planner then gets request and requests as
// requestPlanningForMove gives them, so the visit does not occupy its own slot; the final
// button is Move visit and onMoved(result) runs after it.
export default function ProposalDraftPlanner({
  request, requests, technicians: roster, savedDraft, onSave, onDirtyChange, onRegistered, onProposalSent,
  moving = null, onMoved,
}) {
  const {
    registerAppointment, sendProposal, rescheduleVisit, storedTravelMinutes, storedRoutesMinutes, storedTravelDetails,
    travelTrafficMode, estimateTravel, distanceBands,
  } = useCustomerServicePrototype()
  // Customer emails leave from the signed-in coordinator's mailbox.
  const { profile } = useAuth()
  // Travel saved with earlier appointments fills the same legs; typed values win.
  const withStoredTravel = (formValues) => ({
    ...formValues, travelMinutes: { ...storedTravelMinutes, ...formValues.travelMinutes },
  })
  const [initialValues] = useState(() => withStoredTravel(proposalDraftFormValues(savedDraft)))
  const [values, setValues] = useState(initialValues)
  const [saveError, setSaveError] = useState('')
  const [sending, setSending] = useState(false)
  const technicians = useMemo(() => getPrototypePlanningTechnicians(roster), [roster])
  const validation = validatePrototypeProposalDraft({ requestId: request.id, requests, technicians, values })
  const errorFor = (field) => validation.errors.find((error) => error.field === field)?.message
  const savedIsStale = savedDraft && savedDraft.requestSignature !== proposalPlanningSignature(request)
  const hasUnsavedChanges = proposalDraftHasChanges(values, savedDraft ? withStoredTravel(proposalDraftFormValues(savedDraft)) : initialValues)
  // Google Routes results fill only empty legs; a leg keeps its Google label until edited.
  const [travelEstimate, setTravelEstimate] = useState({ loading: false, error: '', results: [], routes: {}, details: {} })
  const routesMinutes = { ...storedRoutesMinutes, ...travelEstimate.routes }
  const travelDetails = { ...storedTravelDetails, ...travelEstimate.details }
  // Empty legs, plus Google legs calculated with another traffic setting or departure slot.
  const legsToEstimate = travelLegsToEstimate(validation.travelLegs, routesMinutes, travelDetails, travelTrafficMode)
  const pendingKeys = new Set(validation.travelLegs.filter((leg) => leg.minutes === null).map((leg) => leg.key))
  const travelMessages = travelEstimateMessages(travelEstimate.results
    .filter((result) => pendingKeys.has(`${result.fromRequestId}>${result.toRequestId}`) || result.status === 'STORED'))
  const calculateTravel = async (legs = legsToEstimate) => {
    setTravelEstimate((current) => ({ ...current, loading: true, error: '', results: [] }))
    try {
      const results = await estimateTravel(legs)
      setSaveError('')
      setValues((current) => applyTravelEstimates(current, results, routesMinutes))
      setTravelEstimate((current) => ({
        loading: false, error: '', results, ...mergeTravelEstimateResults(current, results),
      }))
    } catch (error) {
      setTravelEstimate((current) => ({ ...current, loading: false, error: error.message }))
    }
  }
  // A suggested slot fills technicians, day, window and start, plus the Google minutes
  // already checked for its legs; the coordinator can still change everything. Legs it
  // still lacks are calculated right away, so using a slot needs no second click.
  const applyNearbySlot = (slot, results = []) => {
    setSaveError('')
    const next = applyTravelEstimates({ ...values, ...slot }, results, routesMinutes)
    const known = mergeTravelEstimateResults(travelEstimate, results)
    setValues(next)
    if (results.length) setTravelEstimate((current) => ({ ...current, error: '', results: [], ...known }))
    const nextLegs = validatePrototypeProposalDraft({ requestId: request.id, requests, technicians, values: next }).travelLegs
    const missing = travelLegsToEstimate(
      nextLegs, { ...storedRoutesMinutes, ...known.routes }, { ...storedTravelDetails, ...known.details }, travelTrafficMode,
    )
    if (missing.length) void calculateTravel(missing)
  }
  // "Find a time this day" (decided 25 Nov 2026): the form keeps its day and technicians and
  // moves to the first time that fits, the chosen window first. Travel it still lacks is
  // asked to Google and the search runs again with those minutes, so the time it fills
  // already counts the drive. A message (tied to that day and crew) says when there is no room.
  const [dayAdjust, setDayAdjust] = useState({ loading: false, message: '', key: '' })
  const dayKey = `${values.date}|${values.technicianIds.join()}`
  const findTimeThisDay = async () => {
    const key = dayKey
    setSaveError('')
    setDayAdjust({ loading: true, message: '', key })
    let travelMinutes = values.travelMinutes
    let known = { routes: routesMinutes, details: travelDetails }
    let results = []
    const asked = new Set()
    try {
      for (let attempt = 0; ; attempt += 1) {
        const slot = timeOnSameDay({ requestId: request.id, values: { ...values, travelMinutes }, requests, technicians })
        if (!slot) {
          const names = technicianNames(values.technicianIds)
          setDayAdjust({
            loading: false, key,
            message: `${new Intl.ListFormat('en', { type: 'conjunction' }).format(names)} ${names.length === 1 ? 'has' : 'have'} no room on ${
              formatWeekdayDate(values.date)}. Choose another technician or day.`,
          })
          return
        }
        const missing = travelLegsToEstimate(slot.travelLegs, known.routes, known.details, travelTrafficMode)
          .filter((leg) => !asked.has(travelLegKey(leg.fromRequestId, leg.toRequestId)))
        if (!missing.length || attempt >= 3) {
          applyNearbySlot({ windowStart: slot.windowStart, internalStart: slot.internalStart }, results)
          setDayAdjust({ loading: false, message: '', key })
          return
        }
        missing.forEach((leg) => asked.add(travelLegKey(leg.fromRequestId, leg.toRequestId)))
        const fresh = await estimateTravel(missing)
        results = [...results, ...fresh]
        travelMinutes = applyTravelEstimates({ travelMinutes }, fresh, known.routes).travelMinutes
        known = mergeTravelEstimateResults(known, fresh)
      }
    } catch (error) {
      setDayAdjust({ loading: false, message: `Travel could not be checked: ${error.message}`, key })
    }
  }
  // A Google leg marked "calculate again" cannot be registered; one Google could not
  // refresh keeps its saved value, as the server does.
  const outdatedLegs = outdatedTravelLegs({
    travelLegs: validation.travelLegs, travelMinutes: values.travelMinutes, routesMinutes, travelDetails,
    trafficMode: travelTrafficMode,
    refreshFailedKeys: travelEstimate.results.filter((result) => result.status === 'STORED' && result.message)
      .map((result) => `${result.fromRequestId}>${result.toRequestId}`),
  })
  const canRegister = validation.isValid && !validation.travelPending && !validation.pastDue && outdatedLegs.length === 0
  // A moved visit may go after the due date: the customer asked for it (decision P3).
  const canMove = validation.isValid && !validation.travelPending && outdatedLegs.length === 0
  // Same three states as the suggestions. An unfinished form points to the suggestions
  // and lists only real problems, not "Select…" for each field still empty.
  const formIncomplete = !values.technicianIds.length || !values.date || !values.windowStart || !values.internalStart
  const emptyFields = new Set([
    !values.technicianIds.length && 'technicianIds', !values.date && 'date',
    !values.windowStart && 'windowStart', !values.internalStart && 'internalStart',
  ].filter(Boolean))
  const formProblems = validation.errors.filter((error) => !emptyFields.has(error.field))
  const margin = validation.delay?.margin
  // Until technicians, a window or a start are chosen, the day agenda previews the
  // recommended slot, so it is visible before using it.
  const [recommendedSlot, setRecommendedSlot] = useState(null)
  // The second day suggested with the form's slot, offered as option 2 of a proposal.
  const [secondSlot, setSecondSlot] = useState(null)
  const preview = !values.technicianIds.length && !values.windowStart && !values.internalStart ? recommendedSlot : null
  const technicianNames = (ids) => ids.map((id) => technicians.find((person) => person.id === id)?.name).filter(Boolean)
  const agendaProps = preview
    ? {
      date: preview.date,
      agenda: getPrototypeTechnicianAgenda(requests, preview.technicianIds, preview.date, technicians),
      margins: {},
      hasTechnicians: true,
      proposedVisit: {
        label: request.requestNumber, recommended: true, date: preview.date, windowStart: preview.windowStart,
        start: preview.internalStart, workEnd: preview.internalEnd, end: preview.pickupEnd, margin: preview.margin,
        technicianNames: preview.technicianNames,
      },
    }
    : {
      date: validation.dateIsValid ? values.date : '',
      agenda: validation.agenda,
      margins: validation.delay?.entryMargins ?? {},
      hasTechnicians: values.technicianIds.length > 0,
      proposedVisit: validation.internalEnd && validation.pickupEnd
        ? {
          label: request.requestNumber, date: values.date, windowStart: values.windowStart,
          start: values.internalStart, workEnd: validation.internalEnd, end: validation.pickupEnd,
          margin: validation.delay?.margin ?? null, technicianNames: technicianNames(values.technicianIds),
        }
        : null,
    }
  const draftStatus = fitStatus({
    fits: validation.isValid, travelPending: validation.travelPending || outdatedLegs.length > 0,
  })
  // The collision can be solved by another time that day: not a problem with the day itself
  // (weekend, holiday, past, customer unavailable) or with the technicians.
  const canFindTimeThisDay = !formIncomplete && draftStatus === 'DOESNT_FIT'
    && !validation.errors.some((error) => ['date', 'technicianIds', 'request'].includes(error.field))
  // The other day the customer picked on the proposal page (step B5): the coordinator
  // approves it by using it and registering the visit.
  const customerChoice = moving ? null : customerChosenSlot(request)
  const choiceCheck = customerChoice && validatePrototypeProposalDraft({
    requestId: request.id, requests, technicians, values: { ...customerChoice, travelMinutes: values.travelMinutes },
  })
  const formIsCustomerChoice = Boolean(customerChoice) && values.date === customerChoice.date
    && values.windowStart === customerChoice.windowStart
  // Checked again when the dialog opens, against the same schedule as the form.
  const secondOffer = (() => {
    if (!sending || !secondSlot || secondSlot.firstDate !== values.date) return null
    if (!secondSlot.date) return { available: false, reason: secondSlot.reason }
    if (secondSlot.pending) {
      return { available: false, reason: 'Travel for the second day is still being checked with traffic; close this and try again in a moment to offer it.' }
    }
    const secondValues = {
      technicianIds: secondSlot.technicianIds, date: secondSlot.date, windowStart: secondSlot.windowStart,
      internalStart: secondSlot.internalStart, travelMinutes: { ...storedTravelMinutes, ...secondSlot.travelMinutes },
    }
    const secondValidation = validatePrototypeProposalDraft({ requestId: request.id, requests, technicians, values: secondValues })
    if (!secondValidation.isValid || secondValidation.travelPending || secondValidation.pastDue) {
      return { available: false, reason: 'The suggested second day no longer fits the schedule.' }
    }
    return {
      available: true, values: secondValues, validation: secondValidation,
      summary: {
        date: formatWeekdayDate(secondValues.date),
        detail: `Work ${formatTime(secondValues.internalStart)}–${formatTime(secondValidation.internalEnd)} · ${
          technicianNames(secondValues.technicianIds).join(', ')}`,
      },
    }
  })()
  // Holds the days and emails the invitation; a failure stays in the dialog.
  const sendInvitation = async ({ includeSecond, invitation, customerEmail }) => {
    // Option 1 is the earliest day, as the customer reads them.
    const options = [{ values, validation }, ...(includeSecond && secondOffer?.available ? [secondOffer] : [])]
      .sort((left, right) => left.values.date.localeCompare(right.values.date))
    const result = await sendProposal(buildProposalSend({
      request,
      options,
      invitation,
      // Other days for the customer page, for the same technicians (step B5).
      alternatives: proposalAlternatives({
        request, requests, technicians, technicianIds: values.technicianIds, travelMinutes: values.travelMinutes,
        skipDates: options.map((option) => option.values.date),
      }),
      customerEmail,
    }))
    setSending(false)
    onDirtyChange(false)
    onProposalSent?.(request, result)
  }
  // Moves the confirmed visit to the form's day and, when asked, emails the customer; a
  // failure stays in the dialog.
  const move = async ({ reason, note, email }) => {
    const result = await rescheduleVisit(buildVisitMove({ request: moving.request, values, validation, reason, note, email }))
    setSending(false)
    onDirtyChange(false)
    onMoved?.(result, values)
  }
  // Registers the visit and, when asked, emails the customer; a failure stays in the dialog.
  const send = async ({ acceptance, confirmationEmail, customerEmail }) => {
    const result = await registerAppointment(buildAppointmentRegistration({
      request, values, validation, acceptance, confirmationEmail, customerEmail,
    }))
    setSending(false)
    onDirtyChange(false)
    onRegistered?.(request, result)
  }
  useEffect(() => {
    onDirtyChange(hasUnsavedChanges)
  }, [hasUnsavedChanges, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  const savedNeedsRevalidation = savedDraft && !hasUnsavedChanges && !validation.isValid
  const change = (field, value) => {
    setSaveError('')
    setValues((current) => ({ ...current, [field]: value }))
  }
  const save = () => {
    try { onSave(request.id, values); onDirtyChange(false); setSaveError('') }
    catch (error) { setSaveError(error.message) }
  }
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h6" fontWeight={800}>
            {moving ? 'Move visit' : 'Prepare proposal'} · {request.requestNumber}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {moving
              ? 'Choose the day you agreed with the customer. The current visit does not take up its own time, so it can also move within the same day. Nothing changes until you confirm Move visit.'
              : 'A saved draft lasts until the page is reloaded; it reserves no time and contacts nobody. Send to customer emails a proposal that holds its days until the customer answers, or registers the visit they already accepted by phone.'}
          </Typography>
        </Box>
        {moving && (
          <Alert severity="info" variant="outlined">
            <Typography variant="body2" fontWeight={700}>Current visit</Typography>
            {moving.previous.summary.date} · {moving.previous.summary.detail}
          </Alert>
        )}
        <Alert severity="info" variant="outlined">
          Only registered Customer Service appointments are checked. Production work and days off are not known here, so
          confirm the technician is free.
        </Alert>
        {technicians.length === 0 && <Alert severity="warning">No active technicians are registered. Add them in People → Technicians before planning.</Alert>}
        {savedIsStale && <Alert severity="warning" variant="outlined">The request changed after this draft was saved. Review the selection and save it again using the current duration and crew.</Alert>}
        {savedNeedsRevalidation && !savedIsStale && <Alert severity="warning" variant="outlined">The saved draft is no longer valid against the current date or recorded schedule. Review the conflicts below before using it.</Alert>}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip label={`${request.estimatedDurationMinutes} min · reviewed duration`} variant="outlined" />
          <Chip label={`${request.crewSize} ${Number(request.crewSize) === 1 ? 'person' : 'people'} required · ${values.technicianIds.length} selected`} variant="outlined" />
          {Number.isInteger(margin) && (
            <Chip variant="outlined" label={`Margin ${Math.max(0, margin)} min`} />
          )}
          {!moving && !savedDraft && hasUnsavedChanges && <Chip label="Unsaved draft changes" color="warning" variant="outlined" />}
          {savedDraft && <Chip label={savedIsStale || savedNeedsRevalidation ? 'Saved draft needs review' : hasUnsavedChanges ? 'Unsaved draft changes' : 'Draft saved · not sent'} color={savedIsStale || savedNeedsRevalidation ? 'warning' : hasUnsavedChanges ? 'default' : 'success'} variant="outlined" />}
        </Stack>
        {customerChoice && (
          <Alert severity={choiceCheck?.isValid ? 'info' : 'warning'} variant="outlined"
            action={choiceCheck?.isValid && !formIsCustomerChoice && (
              <Button color="inherit" size="small" onClick={() => applyNearbySlot(customerChoice)}>Use this slot</Button>
            )}>
            <Typography variant="body2" fontWeight={700}>The customer picked this day on the proposal page</Typography>
            {formatWeekdayDate(customerChoice.date)} · {serviceCustomerWindowOptions.find((window) => window.start === customerChoice.windowStart)?.label}
            {' '}window · work from {formatTime(customerChoice.internalStart)} · {technicianNames(customerChoice.technicianIds).join(', ')}.
            {' '}{choiceCheck?.isValid
              ? 'Use it, then Send to customer registers the visit and confirms it by email.'
              : 'It no longer fits the schedule: call the customer and plan another day.'}
          </Alert>
        )}
        <ProposalNearbyVisits request={request} requests={requests} technicians={technicians}
          distanceBands={distanceBands} formDate={formIncomplete ? null : values.date}
          formFits={validation.isValid && !validation.pastDue}
          onUseSlot={applyNearbySlot} onRecommendedChange={setRecommendedSlot} onSecondChange={setSecondSlot}
          showSecondDay={!moving} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2.5 }}>
          <Stack spacing={2}>
            <FormControl fullWidth error={values.technicianIds.length > 0 && Boolean(errorFor('technicianIds'))}>
              <InputLabel id={`draft-technicians-${request.id}`}>Assigned technicians</InputLabel>
              <Select
                multiple labelId={`draft-technicians-${request.id}`} label="Assigned technicians"
                value={values.technicianIds}
                onChange={(event) => change('technicianIds', typeof event.target.value === 'string'
                  ? event.target.value.split(',') : event.target.value)}
                renderValue={(ids) => ids.map((id) => technicians.find((person) => person.id === id)?.name ?? 'Technician no longer available').join(', ')}
              >
                {technicians.map((person) => <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>)}
              </Select>
              <FormHelperText>{errorFor('technicianIds') ?? 'Each selected technician represents one assigned person.'}</FormHelperText>
            </FormControl>
            <TextField
              label="Proposal date" type="date" value={values.date} fullWidth
              onChange={(event) => change('date', event.target.value)}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: getCustomerServiceClock().date } }}
              error={Boolean(errorFor('date'))} helperText={errorFor('date') ?? 'California time · Monday–Friday · 7:00 AM–3:30 PM'}
            />
            <FormControl fullWidth>
              <InputLabel id={`draft-window-${request.id}`}>Customer arrival window</InputLabel>
              <Select labelId={`draft-window-${request.id}`} label="Customer arrival window" value={values.windowStart}
                onChange={(event) => {
                  const windowStart = event.target.value
                  setSaveError('')
                  setValues((current) => changePrototypeProposalWindow(current, windowStart))
                }}>
                {serviceCustomerWindowOptions.map((window) => (
                  <MenuItem key={window.start} value={window.start}>
                    {window.label}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>Work plus 10 minutes of pickup must finish before the window closes.</FormHelperText>
            </FormControl>
            <Stack direction="row" spacing={2} useFlexGap sx={fieldRowSx}>
              <TextField
                label="Work starts" type="time" value={values.internalStart} fullWidth
                onChange={(event) => change('internalStart', event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                error={Boolean(values.internalStart && errorFor('internalStart'))}
                helperText={(values.internalStart && errorFor('internalStart'))
                  || 'When the technician starts working. Changing the window resets it to the window start.'}
              />
              <TextField label="Work ends" type="time" value={validation.internalEnd} fullWidth
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly: true } }}
                helperText={validation.pickupEnd
                  ? `From the reviewed duration. Pickup until ${formatTime(validation.pickupEnd)}.`
                  : 'Calculated from the reviewed work duration.'} />
            </Stack>
            {validation.travelLegs.length > 0 && (
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} useFlexGap sx={sectionHeaderSx}>
                  <Box sx={sectionTitleSx}>
                    <Typography variant="subtitle2" fontWeight={800}>Travel between visits</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Minutes from leaving one visit (after pickup) to starting the next. Calculate empty legs with
                      Google Maps or type them; you can adjust any value. Leave blank if unknown.
                    </Typography>
                  </Box>
                  {legsToEstimate.length > 0 && (
                    <Button variant="text" onClick={() => calculateTravel()} disabled={travelEstimate.loading} sx={{ flexShrink: 0 }}>
                      {travelEstimate.loading ? 'Calculating…' : 'Calculate with Google Maps'}
                    </Button>
                  )}
                </Stack>
                {travelEstimate.error && <Alert severity="error" variant="outlined">{travelEstimate.error}</Alert>}
                {travelMessages.length > 0 && (
                  <Alert severity="warning" variant="outlined">
                    <Box component="ul" sx={{ m: 0, pl: 2 }}>{travelMessages.map((message) => <li key={message}>{message}</li>)}</Box>
                  </Alert>
                )}
                {validation.travelLegs.map((leg) => {
                  // Opens the route from the earlier visit to the later one, to check the minutes.
                  const routeUrl = travelLegDirectionsUrl(leg, requests)
                  return (
                    <Stack key={leg.key} direction="row" spacing={1} useFlexGap sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <TextField
                        label={`${leg.fromLabel} → ${leg.toLabel} (minutes)`}
                        type="number"
                        value={values.travelMinutes?.[leg.key] ?? ''}
                        onChange={(event) => {
                          setSaveError('')
                          setValues((current) => changePrototypeTravelMinutes(current, leg.key, event.target.value))
                        }}
                        slotProps={{ htmlInput: { min: 0, max: 999, step: 1, inputMode: 'numeric' } }}
                        helperText={[
                          travelLegHelperText({
                            leg,
                            source: leg.minutes === null ? null : travelLegSource(leg.key, values.travelMinutes, routesMinutes),
                            details: travelDetails[leg.key],
                            trafficMode: travelTrafficMode,
                          }),
                          Number.isInteger(validation.delay?.legAbsorbs[leg.key])
                            && `Absorbs up to ${Math.max(0, validation.delay.legAbsorbs[leg.key])} min of extra driving`,
                        ].filter(Boolean).join(' · ')}
                        fullWidth
                        sx={{ flex: '1 1 240px' }}
                      />
                      {routeUrl && (
                        <Button variant="outlined" component="a" href={routeUrl} target="_blank" rel="noreferrer"
                          startIcon={<DirectionsOutlinedIcon />} aria-label={`View the route from ${leg.fromLabel} to ${leg.toLabel} in Google Maps`}
                          sx={{ flexShrink: 0, minHeight: 56 }}>
                          Route
                        </Button>
                      )}
                    </Stack>
                  )
                })}
              </Stack>
            )}
            {formIncomplete ? (
              <Alert severity={formProblems.length ? 'warning' : 'info'} variant="outlined">
                Use a suggested slot above, or choose the technicians, date, customer window and work start.
                {formProblems.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>{formProblems.map((error, index) => <li key={`${error.field}-${index}`}>{error.message}</li>)}</Box>
                )}
              </Alert>
            ) : (
              <Alert severity={draftStatus === 'FITS' ? 'success' : 'warning'} variant="outlined">
                <Typography variant="body2" fontWeight={700}>{fitStatusLabels[draftStatus]}</Typography>
                {draftStatus === 'FITS' && 'The technicians’ recorded Customer Service schedule has room for it.'}
                {draftStatus === 'FITS' && Number.isInteger(margin) && ` Margin ${Math.max(0, margin)} min: it can start that late and still finish, with pickup, inside its customer window.`}
                {draftStatus === 'TRAVEL_PENDING' && 'Calculate or type the travel marked below to confirm it fits.'}
                {draftStatus === 'DOESNT_FIT' && (
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>{validation.errors.map((error, index) => <li key={`${error.field}-${index}`}>{error.message}</li>)}</Box>
                )}
                {canFindTimeThisDay && (
                  <Button size="small" variant="outlined" color="warning" onClick={findTimeThisDay} disabled={dayAdjust.loading}
                    startIcon={dayAdjust.loading ? <CircularProgress size={14} color="inherit" /> : null} sx={{ mt: 1 }}>
                    {dayAdjust.loading ? 'Finding a time…' : 'Find a time this day'}
                  </Button>
                )}
              </Alert>
            )}
            {dayAdjust.message && dayAdjust.key === dayKey && (
              <Alert severity="info" variant="outlined" onClose={() => setDayAdjust({ loading: false, message: '', key: '' })}>
                {dayAdjust.message}
              </Alert>
            )}
            {validation.warnings.length > 0 && (
              <Alert severity="info" variant="outlined">
                <Box component="ul" sx={{ m: 0, pl: 2 }}>{validation.warnings.map((warning, index) => <li key={`${warning.field}-${index}`}>{warning.message}</li>)}</Box>
              </Alert>
            )}
            {saveError && <Alert severity="error">{saveError}</Alert>}
            <Stack direction="row" spacing={1.5} useFlexGap sx={actionRowSx}>
              {moving ? (
                <Button variant="contained" disabled={!canMove} onClick={() => setSending(true)}>
                  Move visit
                </Button>
              ) : (
                <>
                  <Button variant="outlined" onClick={save} disabled={!validation.isValid}>
                    {savedDraft ? 'Update proposal draft' : 'Save proposal draft'}
                  </Button>
                  <Button variant="contained" disabled={!canRegister} onClick={() => setSending(true)}>
                    Send to customer
                  </Button>
                </>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {moving
                ? (!validation.isValid
                  ? (formIncomplete
                    ? 'Move visit opens once the date, window, work start and technicians fit.'
                    : 'Resolve the problems listed above to move the visit.')
                  : validation.travelPending
                    ? 'Calculate or type every travel time before moving: the visit reserves the technicians’ time.'
                    : outdatedLegs.length > 0
                      ? 'Calculate the travel marked “calculate again” with Google Maps, or type its minutes, before moving.'
                      : 'Move visit: the current date is released and the customer can be emailed the new one.')
                : !validation.isValid
                  ? (formIncomplete
                    ? 'Saving and sending open once the date, window, work start and technicians fit.'
                    : 'Resolve the problems listed above to save the draft or send it to the customer.')
                  : validation.pastDue
                    ? 'Choose a date on or before the due date to send it to the customer.'
                    : validation.travelPending
                      ? 'Calculate or type every travel time before sending: a proposal or a visit reserves the technicians’ time.'
                      : outdatedLegs.length > 0
                        ? 'Calculate the travel marked “calculate again” with Google Maps, or type its minutes, before sending.'
                        : 'Send to customer: email a proposal that holds the days until the customer answers, or register the visit if they already accepted by phone.'}
            </Typography>
          </Stack>
          <ProposalDayAgenda {...agendaProps} requests={requests} plannedRequest={request} />
        </Box>
      </Stack>
      {sending && moving && (
        <MoveVisitDialog request={moving.request} previous={moving.previous}
          next={{
            date: values.date, windowStart: values.windowStart,
            summary: visitSummary({
              date: values.date, windowStart: values.windowStart, workStart: values.internalStart,
              workEnd: validation.internalEnd, technicianNames: technicianNames(values.technicianIds),
            }),
          }}
          warnings={validation.warnings.filter((warning) => warning.pastDue)}
          senderEmail={profile?.email ?? ''} onClose={() => setSending(false)} onMove={move} />
      )}
      {sending && !moving && (
        <SendToCustomerDialog request={request} values={values}
          summary={{
            date: formatWeekdayDate(values.date),
            detail: `Work ${formatTime(values.internalStart)}–${formatTime(validation.internalEnd)} · ${
              technicianNames(values.technicianIds).join(', ')}`,
          }}
          secondOffer={secondOffer} senderEmail={profile?.email ?? ''} customerChoice={formIsCustomerChoice}
          onClose={() => setSending(false)} onSend={send} onSendProposal={sendInvitation} />
      )}
    </Paper>
  )
}
