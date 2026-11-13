import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  FormHelperText, InputLabel, MenuItem, Paper, Radio, RadioGroup, Select, Stack, TextField, Typography,
} from '@mui/material'
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import {
  buildAppointmentRegistration, changePrototypeProposalWindow, changePrototypeTravelMinutes, fitStatus, fitStatusLabels,
  getPrototypePlanningTechnicians, proposalDraftFormValues, proposalDraftHasChanges, proposalPlanningSignature,
  validatePrototypeProposalDraft,
} from '../utils/proposalDraft.js'
import {
  applyTravelEstimates, mergeTravelEstimateResults, outdatedTravelLegs, travelEstimateMessages, travelLegHelperText,
  travelLegSource, travelLegsToEstimate,
} from '../utils/travelEstimates.js'
import { getCustomerServiceClock } from '../utils/dates.js'
import { customerServiceMinimumMarginMinutes } from '../utils/customerServiceScheduling.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import ProposalDayAgenda from './ProposalDayAgenda.jsx'
import ProposalNearbyVisits from './ProposalNearbyVisits.jsx'

// The form column sits next to the agenda, so it can be narrow even on a wide screen.
// Its rows wrap by the space they get instead of switching at a screen breakpoint.
const sectionHeaderSx = { flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }
const sectionTitleSx = { flex: '1 1 240px' }
const fieldRowSx = { flexWrap: 'wrap', '& > *': { flex: '1 1 160px' } }
const actionRowSx = { flexWrap: 'wrap', '& > *': { flex: '1 1 200px' } }

const acceptanceOptions = [
  { value: 'CUSTOMER_ACCEPTED_PROPOSAL', label: 'Customer accepted the proposal' },
  { value: 'COUNTER_PROPOSAL_ACCEPTED', label: 'Counter-proposal accepted' },
]

export default function ProposalDraftPlanner({ request, requests, technicians: roster, savedDraft, onSave, onDirtyChange, onRegistered }) {
  const {
    registerAppointment, storedTravelMinutes, storedRoutesMinutes, storedTravelDetails, travelTrafficMode, estimateTravel,
    distanceBands,
  } = useCustomerServicePrototype()
  // Travel saved with earlier appointments fills the same legs; typed values win.
  const withStoredTravel = (formValues) => ({
    ...formValues, travelMinutes: { ...storedTravelMinutes, ...formValues.travelMinutes },
  })
  const [initialValues] = useState(() => withStoredTravel(proposalDraftFormValues(savedDraft)))
  const [values, setValues] = useState(initialValues)
  const [saveError, setSaveError] = useState('')
  const [registration, setRegistration] = useState(null)
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
  const calculateTravel = async () => {
    setTravelEstimate((current) => ({ ...current, loading: true, error: '', results: [] }))
    try {
      const results = await estimateTravel(legsToEstimate)
      setSaveError('')
      setValues((current) => applyTravelEstimates(current, results, routesMinutes))
      setTravelEstimate((current) => ({
        loading: false, error: '', results, ...mergeTravelEstimateResults(current, results),
      }))
    } catch (error) {
      setTravelEstimate((current) => ({ ...current, loading: false, error: error.message }))
    }
  }
  // A nearby slot fills technicians, day, window and start, plus the Google minutes
  // already checked for its legs; the coordinator can still change everything.
  const applyNearbySlot = (slot, results = []) => {
    setSaveError('')
    setValues((current) => applyTravelEstimates({ ...current, ...slot }, results, routesMinutes))
    if (results.length) {
      setTravelEstimate((current) => ({ ...current, error: '', results: [], ...mergeTravelEstimateResults(current, results) }))
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
  // Same three states as the suggestions; an unfinished form only lists what is missing.
  const formIncomplete = !values.technicianIds.length || !values.date || !values.windowStart || !values.internalStart
  const draftStatus = fitStatus({
    fits: validation.isValid, travelPending: validation.travelPending || outdatedLegs.length > 0,
  })
  const register = async () => {
    setRegistration((current) => ({ ...current, saving: true, error: '' }))
    try {
      await registerAppointment(buildAppointmentRegistration({
        request, values, validation, acceptance: registration.acceptance,
      }))
      setRegistration(null)
      onDirtyChange(false)
      onRegistered?.(request)
    } catch (error) {
      setRegistration((current) => ({ ...current, saving: false, error: error.message }))
    }
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
            Drafts stay in this session and are never saved. Register the appointment only after the customer
            accepts the proposal, or after you accept the customer&apos;s counter-proposal.
          </Typography>
        </Box>
        <Alert severity="info" variant="outlined">
          Technicians come from the technician catalog in People. This checks registered Customer Service appointments,
          not Production work. Travel comes from Google Maps driving estimates or values you type; no fixed travel buffer is added.
        </Alert>
        {technicians.length === 0 && <Alert severity="warning">No active technicians are registered. Add them in People → Technicians before planning.</Alert>}
        {savedIsStale && <Alert severity="warning" variant="outlined">The request changed after this draft was saved. Review the selection and save it again using the current duration and crew.</Alert>}
        {savedNeedsRevalidation && !savedIsStale && <Alert severity="warning" variant="outlined">The saved draft is no longer valid against the current date or recorded schedule. Review the conflicts below before using it.</Alert>}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip label={`${request.estimatedDurationMinutes} min · reviewed duration`} variant="outlined" />
          <Chip label={`${request.crewSize} ${Number(request.crewSize) === 1 ? 'person' : 'people'} required · ${values.technicianIds.length} selected`} variant="outlined" />
          {validation.delay?.margin !== null && validation.delay?.margin !== undefined && (
            <Chip variant="outlined" color={validation.delay.margin < customerServiceMinimumMarginMinutes ? 'warning' : 'success'}
              label={`Margin ${Math.max(0, validation.delay.margin)} min`}
              title="How late this visit can start without it or a later visit leaving its customer window" />
          )}
          {!savedDraft && hasUnsavedChanges && <Chip label="Unsaved draft changes" color="warning" variant="outlined" />}
          {savedDraft && <Chip label={savedIsStale || savedNeedsRevalidation ? 'Saved draft needs review' : hasUnsavedChanges ? 'Unsaved draft changes' : 'Draft saved · not sent'} color={savedIsStale || savedNeedsRevalidation ? 'warning' : hasUnsavedChanges ? 'default' : 'success'} variant="outlined" />}
        </Stack>
        <ProposalNearbyVisits request={request} requests={requests} technicians={technicians}
          distanceBands={distanceBands} onUseSlot={applyNearbySlot} />
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
                label="Internal work starts" type="time" value={values.internalStart} fullWidth
                onChange={(event) => change('internalStart', event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                error={Boolean(values.internalStart && errorFor('internalStart'))}
                helperText={errorFor('internalStart') ?? 'Changing the window resets this start. Adjust it inside the window.'}
              />
              <TextField label="Internal work ends" type="time" value={validation.internalEnd} fullWidth
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { readOnly: true } }}
                helperText={validation.pickupEnd
                  ? `Reviewed work duration. Pickup until ${validation.pickupEnd}.`
                  : 'Calculated using the reviewed work duration, not the two-hour window.'} />
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
                    <Button variant="text" onClick={calculateTravel} disabled={travelEstimate.loading} sx={{ flexShrink: 0 }}>
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
              <Alert severity="info" variant="outlined">
                <Box component="ul" sx={{ m: 0, pl: 2 }}>{validation.errors.map((error, index) => <li key={`${error.field}-${index}`}>{error.message}</li>)}</Box>
              </Alert>
            ) : (
              <Alert severity={draftStatus === 'FITS' ? 'success' : 'warning'} variant="outlined">
                <Typography variant="body2" fontWeight={700}>{fitStatusLabels[draftStatus]}</Typography>
                {draftStatus === 'FITS' && 'The recorded Customer Service schedule has room for it. The draft can be saved.'}
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
              <Button variant="contained" disabled={!canRegister}
                onClick={() => setRegistration({ acceptance: acceptanceOptions[0].value, saving: false, error: '' })}>
                Register accepted appointment
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {validation.isValid && validation.pastDue
                ? 'Choose a date on or before the due date to register this appointment.'
                : validation.isValid && validation.travelPending
                  ? 'Enter every travel estimate before registering: a registered appointment reserves the technicians’ time.'
                  : validation.isValid && outdatedLegs.length > 0
                    ? 'Calculate the travel marked “calculate again” with Google Maps, or type its minutes, before registering.'
                    : 'Drafts are kept while navigating during the session; reloading removes them. Registered appointments are saved.'}
            </Typography>
          </Stack>
          <ProposalDayAgenda
            date={validation.dateIsValid ? values.date : ''}
            agenda={validation.agenda}
            margins={validation.delay?.entryMargins ?? {}}
            requests={requests}
            hasTechnicians={values.technicianIds.length > 0}
            proposedVisit={validation.internalEnd && validation.pickupEnd
              ? {
                label: request.requestNumber, start: values.internalStart, workEnd: validation.internalEnd, end: validation.pickupEnd,
                margin: validation.delay?.margin ?? null,
              }
              : null}
          />
        </Box>
      </Stack>
      <Dialog open={Boolean(registration)} onClose={() => !registration?.saving && setRegistration(null)} fullWidth maxWidth="xs">
        <DialogTitle>Register accepted appointment</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2">
              {request.requestNumber} · {values.date} · {values.internalStart}–{validation.internalEnd} ·{' '}
              {values.technicianIds.map((id) => technicians.find((person) => person.id === id)?.name).filter(Boolean).join(', ')}
            </Typography>
            <FormControl>
              <Typography variant="caption" color="text.secondary">How was it accepted?</Typography>
              <RadioGroup value={registration?.acceptance ?? ''}
                onChange={(event) => setRegistration((current) => ({ ...current, acceptance: event.target.value }))}>
                {acceptanceOptions.map((option) => (
                  <FormControlLabel key={option.value} value={option.value} control={<Radio />} label={option.label} />
                ))}
              </RadioGroup>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              The schedule is checked again before saving. The request moves to Confirmed and the technicians&apos; time is reserved.
            </Typography>
            {registration?.error && <Alert severity="error">{registration.error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRegistration(null)} disabled={registration?.saving}>Cancel</Button>
          <Button variant="contained" onClick={register} disabled={registration?.saving}>
            {registration?.saving ? 'Registering…' : 'Register appointment'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
