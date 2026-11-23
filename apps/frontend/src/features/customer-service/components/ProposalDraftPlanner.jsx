import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, FormControl, FormHelperText, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography,
} from '@mui/material'
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import {
  buildAppointmentRegistration, buildProposalSend, changePrototypeProposalWindow, changePrototypeTravelMinutes, fitStatus, fitStatusLabels,
  getPrototypePlanningTechnicians, getPrototypeTechnicianAgenda, proposalDraftFormValues, proposalDraftHasChanges,
  proposalPlanningSignature, validatePrototypeProposalDraft,
} from '../utils/proposalDraft.js'
import {
  applyTravelEstimates, mergeTravelEstimateResults, outdatedTravelLegs, travelEstimateMessages, travelLegHelperText,
  travelLegSource, travelLegsToEstimate,
} from '../utils/travelEstimates.js'
import { formatTime, formatWeekdayDate, getCustomerServiceClock } from '../utils/dates.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import { useAuth } from '../../auth/context/useAuth.js'
import ProposalDayAgenda from './ProposalDayAgenda.jsx'
import ProposalNearbyVisits from './ProposalNearbyVisits.jsx'
import SendToCustomerDialog from './SendToCustomerDialog.jsx'

// The form column sits next to the agenda, so it can be narrow even on a wide screen.
// Its rows wrap by the space they get instead of switching at a screen breakpoint.
const sectionHeaderSx = { flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }
const sectionTitleSx = { flex: '1 1 240px' }
const fieldRowSx = { flexWrap: 'wrap', '& > *': { flex: '1 1 160px' } }
const actionRowSx = { flexWrap: 'wrap', '& > *': { flex: '1 1 200px' } }

export default function ProposalDraftPlanner({
  request, requests, technicians: roster, savedDraft, onSave, onDirtyChange, onRegistered, onProposalSent,
}) {
  const {
    registerAppointment, sendProposal, storedTravelMinutes, storedRoutesMinutes, storedTravelDetails, travelTrafficMode, estimateTravel,
    distanceBands,
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
  // A Google leg marked "calculate again" cannot be registered; one Google could not
  // refresh keeps its saved value, as the server does.
  const outdatedLegs = outdatedTravelLegs({
    travelLegs: validation.travelLegs, travelMinutes: values.travelMinutes, routesMinutes, travelDetails,
    trafficMode: travelTrafficMode,
    refreshFailedKeys: travelEstimate.results.filter((result) => result.status === 'STORED' && result.message)
      .map((result) => `${result.fromRequestId}>${result.toRequestId}`),
  })
  const canRegister = validation.isValid && !validation.travelPending && !validation.pastDue && outdatedLegs.length === 0
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
      summary: `${formatWeekdayDate(secondValues.date)} · work ${formatTime(secondValues.internalStart)}–${
        formatTime(secondValidation.internalEnd)} · ${technicianNames(secondValues.technicianIds).join(', ')}`,
    }
  })()
  // Holds the days and emails the invitation; a failure stays in the dialog.
  const sendInvitation = async ({ includeSecond, invitation }) => {
    const result = await sendProposal(buildProposalSend({
      request,
      options: [{ values, validation }, ...(includeSecond && secondOffer?.available ? [secondOffer] : [])],
      invitation,
    }))
    setSending(false)
    onDirtyChange(false)
    onProposalSent?.(request, result)
  }
  // Registers the visit and, when asked, emails the customer; a failure stays in the dialog.
  const send = async ({ acceptance, confirmationEmail }) => {
    const result = await registerAppointment(buildAppointmentRegistration({
      request, values, validation, acceptance, confirmationEmail,
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
          <Typography variant="h6" fontWeight={800}>Prepare proposal · {request.requestNumber}</Typography>
          <Typography variant="body2" color="text.secondary">
            A saved draft lasts until the page is reloaded; it reserves no time and contacts nobody. Send to customer
            emails a proposal that holds its days until the customer answers, or registers the visit they already
            accepted by phone.
          </Typography>
        </Box>
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
          {!savedDraft && hasUnsavedChanges && <Chip label="Unsaved draft changes" color="warning" variant="outlined" />}
          {savedDraft && <Chip label={savedIsStale || savedNeedsRevalidation ? 'Saved draft needs review' : hasUnsavedChanges ? 'Unsaved draft changes' : 'Draft saved · not sent'} color={savedIsStale || savedNeedsRevalidation ? 'warning' : hasUnsavedChanges ? 'default' : 'success'} variant="outlined" />}
        </Stack>
        <ProposalNearbyVisits request={request} requests={requests} technicians={technicians}
          distanceBands={distanceBands} formDate={formIncomplete ? null : values.date}
          formFits={validation.isValid && !validation.pastDue}
          onUseSlot={applyNearbySlot} onRecommendedChange={setRecommendedSlot} onSecondChange={setSecondSlot} />
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
                {validation.travelLegs.map((leg) => (
                  <TextField
                    key={leg.key}
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
                  />
                ))}
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
              </Alert>
            )}
            {validation.warnings.length > 0 && (
              <Alert severity="info" variant="outlined">
                <Box component="ul" sx={{ m: 0, pl: 2 }}>{validation.warnings.map((warning, index) => <li key={`${warning.field}-${index}`}>{warning.message}</li>)}</Box>
              </Alert>
            )}
            {saveError && <Alert severity="error">{saveError}</Alert>}
            <Stack direction="row" spacing={1.5} useFlexGap sx={actionRowSx}>
              <Button variant="outlined" onClick={save} disabled={!validation.isValid}>
                {savedDraft ? 'Update proposal draft' : 'Save proposal draft'}
              </Button>
              <Button variant="contained" disabled={!canRegister} onClick={() => setSending(true)}>
                Send to customer
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {!validation.isValid
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
      {sending && (
        <SendToCustomerDialog request={request} values={values}
          summary={`${request.requestNumber} · ${formatWeekdayDate(values.date)} · work ${formatTime(values.internalStart)}–${
            formatTime(validation.internalEnd)} · ${technicianNames(values.technicianIds).join(', ')}`}
          secondOffer={secondOffer} senderEmail={profile?.email ?? ''}
          onClose={() => setSending(false)} onSend={send} onSendProposal={sendInvitation} />
      )}
    </Paper>
  )
}
