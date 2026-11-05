import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  FormHelperText, InputLabel, MenuItem, Paper, Radio, RadioGroup, Select, Stack, TextField, Typography,
} from '@mui/material'
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import {
  buildAppointmentRegistration, changePrototypeProposalWindow, changePrototypeTravelMinutes, getPrototypePlanningTechnicians,
  proposalDraftFormValues, proposalDraftHasChanges, proposalPlanningSignature, validatePrototypeProposalDraft,
} from '../utils/proposalDraft.js'
import { getCustomerServiceClock } from '../utils/dates.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import ProposalDayAgenda from './ProposalDayAgenda.jsx'

const acceptanceOptions = [
  { value: 'CUSTOMER_ACCEPTED_PROPOSAL', label: 'Customer accepted the proposal' },
  { value: 'COUNTER_PROPOSAL_ACCEPTED', label: 'Counter-proposal accepted' },
]

export default function ProposalDraftPlanner({ request, requests, technicians: roster, savedDraft, onSave, onDirtyChange, onRegistered }) {
  const { registerAppointment, storedTravelMinutes } = useCustomerServicePrototype()
  // Travel saved with earlier appointments fills the same legs; typed values win.
  const withStoredTravel = (formValues) => ({
    ...formValues, travelMinutes: { ...storedTravelMinutes, ...formValues.travelMinutes },
  })
  const [initialValues] = useState(() => withStoredTravel(proposalDraftFormValues(savedDraft)))
  const [values, setValues] = useState(initialValues)
  const [saveError, setSaveError] = useState('')
  const [registration, setRegistration] = useState(null)
  const technicians = getPrototypePlanningTechnicians(roster)
  const validation = validatePrototypeProposalDraft({ requestId: request.id, requests, technicians, values })
  const errorFor = (field) => validation.errors.find((error) => error.field === field)?.message
  const savedIsStale = savedDraft && savedDraft.requestSignature !== proposalPlanningSignature(request)
  const hasUnsavedChanges = proposalDraftHasChanges(values, savedDraft ? withStoredTravel(proposalDraftFormValues(savedDraft)) : initialValues)
  const canRegister = validation.isValid && !validation.travelPending && !validation.pastDue
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
          not Production work. Travel uses manual estimates only; no fixed travel buffer is added.
        </Alert>
        {technicians.length === 0 && <Alert severity="warning">No active technicians are registered. Add them in People → Technicians before planning.</Alert>}
        {savedIsStale && <Alert severity="warning" variant="outlined">The request changed after this draft was saved. Review the selection and save it again using the current duration and crew.</Alert>}
        {savedNeedsRevalidation && !savedIsStale && <Alert severity="warning" variant="outlined">The saved draft is no longer valid against the current date or recorded schedule. Review the conflicts below before using it.</Alert>}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip label={`${request.estimatedDurationMinutes} min · reviewed duration`} variant="outlined" />
          <Chip label={`${request.crewSize} ${Number(request.crewSize) === 1 ? 'person' : 'people'} required · ${values.technicianIds.length} selected`} variant="outlined" />
          {!savedDraft && hasUnsavedChanges && <Chip label="Unsaved draft changes" color="warning" variant="outlined" />}
          {savedDraft && <Chip label={savedIsStale || savedNeedsRevalidation ? 'Saved draft needs review' : hasUnsavedChanges ? 'Unsaved draft changes' : 'Draft saved · not sent'} color={savedIsStale || savedNeedsRevalidation ? 'warning' : hasUnsavedChanges ? 'default' : 'success'} variant="outlined" />}
        </Stack>
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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
                <Box>
                  <Typography variant="subtitle2" fontWeight={800}>Travel between visits · Manual estimate</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Minutes from leaving one visit (after pickup) to starting the next. Not a Google Maps result. Leave blank if unknown.
                  </Typography>
                </Box>
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
                    helperText={leg.minutes === null
                      ? `Travel time pending · ${leg.technicianNames.join(', ')}`
                      : `Manual estimate · ${leg.technicianNames.join(', ')}`}
                    fullWidth
                  />
                ))}
              </Stack>
            )}
            <Alert severity={validation.isValid ? 'success' : 'warning'} variant="outlined">
              {validation.isValid
                ? (validation.warnings.length
                  ? 'No conflicts found with the data available. The draft can be saved, but the items below are not verified.'
                  : 'No conflicts found in the recorded Customer Service schedule. The draft can be saved.')
                : (
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>{validation.errors.map((error, index) => <li key={`${error.field}-${index}`}>{error.message}</li>)}</Box>
                )}
            </Alert>
            {validation.warnings.length > 0 && (
              <Alert severity="info" variant="outlined">
                <Box component="ul" sx={{ m: 0, pl: 2 }}>{validation.warnings.map((warning, index) => <li key={`${warning.field}-${index}`}>{warning.message}</li>)}</Box>
              </Alert>
            )}
            {saveError && <Alert severity="error">{saveError}</Alert>}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
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
                  : 'Drafts are kept while navigating during the session; reloading removes them. Registered appointments are saved.'}
            </Typography>
          </Stack>
          <ProposalDayAgenda
            date={validation.dateIsValid ? values.date : ''}
            agenda={validation.agenda}
            hasTechnicians={values.technicianIds.length > 0}
            proposedVisit={validation.internalEnd && validation.pickupEnd
              ? { label: request.requestNumber, start: values.internalStart, workEnd: validation.internalEnd, end: validation.pickupEnd }
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
