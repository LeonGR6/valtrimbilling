import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  InputLabel, Link, MenuItem, Paper, Radio, RadioGroup, Select, Stack, TextField, Typography,
} from '@mui/material'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { serviceCustomerWindowOptions } from '../data/serviceCalendarEvents.js'
import { formatPhoneNumber } from '../../../utils/phoneNumbers.js'
import {
  confirmationEmail, confirmationTextProblems, defaultConfirmationText, mailingAddress,
} from '../utils/customerServiceEmailTemplates.js'
import { formatTime, formatWeekdayDate, getCustomerServiceClock } from '../utils/dates.js'
import {
  buildProposalAcceptance, buildProposalDecline, builderCallAfterHours, builderContactedNotice, cancelNotice,
  counterDayParts, counterNoteLimit, counterProposalProblems, declineNotice, proposalFollowUp, proposalOptionsStatus,
  sentAgoLabel,
} from '../utils/proposalAnswers.js'
import { registrationNotice } from '../utils/proposalDraft.js'
import CustomerEmailEditor from './CustomerEmailEditor.jsx'

// A radio whose label has a title and a caption lines up with the title.
const choiceSx = { alignItems: 'flex-start', mb: 1, '& .MuiRadio-root': { pt: 0.25 } }

const windowLabel = (start) => serviceCustomerWindowOptions.find((window) => window.start === start)?.label ?? start

// "Option 1 · Tue, Nov 24 · 8:00 AM–10:00 AM window · work 8:00–8:45 AM · Jorge"
function optionSummary(option, technicians) {
  const names = option.technicianIds
    .map((id) => technicians.find((person) => person.id === id)?.name ?? 'Technician no longer active').join(', ')
  return `${formatWeekdayDate(option.date)} · ${windowLabel(option.windowStart)} window · work ${formatTime(option.start)}–${
    formatTime(option.end)} · ${names}`
}

function AcceptDialog({ request, option, summary, senderName, senderEmail, onClose, onAccept }) {
  const customerEmail = String(request.contactEmail ?? '').trim()
  const [emailOn, setEmailOn] = useState(Boolean(customerEmail))
  const [text, setText] = useState(() => defaultConfirmationText({ homeownerName: request.contactName }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const problems = emailOn ? confirmationTextProblems(text) : []
  const preview = emailOn
    ? confirmationEmail({
      folio: request.requestNumber, homeownerName: request.contactName, date: option.date, windowStart: option.windowStart,
      address: mailingAddress({
        street: request.street || request.address, city: request.city, state: request.state, postalCode: request.postalCode,
      }),
      work: request.issue, greeting: text.greeting, message: text.message, senderName, senderEmail,
    })
    : null
  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onAccept(emailOn ? text : null)
    } catch (acceptError) {
      setError(acceptError.message)
      setSaving(false)
    }
  }
  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Customer accepted option {option.optionNumber}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">{summary}</Typography>
          <Typography variant="caption" color="text.secondary">
            The visit is registered: it moves to Confirmed and appears in Calendar. The other held day is released.
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={emailOn} disabled={!customerEmail || saving} onChange={(event) => setEmailOn(event.target.checked)} />}
            label="Email a confirmation to the customer" />
          {preview && (
            <CustomerEmailEditor to={customerEmail} senderEmail={senderEmail} text={text} problems={problems} preview={preview}
              onChange={setText} />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || problems.length > 0}>
          {saving ? (emailOn ? 'Sending…' : 'Registering…') : emailOn ? 'Register and email' : 'Register appointment'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// The Builder to call when the customer has not answered in 48 hours (step B7): the
// Job's jobsite superintendent, decided 23 Nov 2026.
function BuilderCall({ contact, onContacted }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const record = async () => {
    setSaving(true)
    setError('')
    try {
      await onContacted()
    } catch (recordError) {
      setError(recordError.message)
      setSaving(false)
    }
  }
  const phones = [contact?.phone, contact?.officePhone].filter(Boolean)
  return (
    <Alert severity="warning" variant="outlined"
      action={<Button color="inherit" size="small" onClick={record} disabled={saving}>{saving ? 'Saving…' : 'Builder contacted'}</Button>}>
      <Typography variant="body2" fontWeight={700}>No answer in {builderCallAfterHours} hours: call the Builder</Typography>
      <Typography variant="body2">Ask them to help reach the customer, then record the call.</Typography>
      {contact ? (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {[contact.builderName, contact.name && `${contact.name} (jobsite superintendent)`].filter(Boolean).join(' · ')}
          {phones.map((phone) => (
            <span key={phone}>{' · '}<Link href={`tel:${phone}`}>{formatPhoneNumber(phone)}</Link></span>
          ))}
          {contact.email && <span>{' · '}<Link href={`mailto:${contact.email}`}>{contact.email}</Link></span>}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          This request&apos;s Job has no jobsite superintendent recorded. Find the Builder contact in Jobs.
        </Typography>
      )}
      {error && <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>{error}</Typography>}
    </Alert>
  )
}

function DeclineDialog({ onClose, onDecline }) {
  const [counter, setCounter] = useState(false)
  const [dates, setDates] = useState(['', '', ''])
  const [dayPart, setDayPart] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const today = getCustomerServiceClock().date
  const problems = counter
    ? counterProposalProblems({ dates, note }, today)
    : note.trim().length > counterNoteLimit ? [`Keep the note to ${counterNoteLimit} characters.`] : []
  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onDecline({ counter, dates, dayPart, note })
    } catch (declineError) {
      setError(declineError.message)
      setSaving(false)
    }
  }
  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Customer did not accept</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <RadioGroup value={counter ? 'COUNTER' : 'REJECTED'} onChange={(event) => setCounter(event.target.value === 'COUNTER')}>
            <FormControlLabel value="COUNTER" sx={choiceSx} disabled={saving} control={<Radio />} label={(
              <Box>
                <Typography variant="body2" fontWeight={700}>Asked for other dates</Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  The request goes back to Ready to propose with these dates, to plan a new proposal.
                </Typography>
              </Box>
            )} />
            <FormControlLabel value="REJECTED" sx={choiceSx} disabled={saving} control={<Radio />} label={(
              <Box>
                <Typography variant="body2" fontWeight={700}>Declined without other dates</Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  The request moves to Needs contact so you can call the customer.
                </Typography>
              </Box>
            )} />
          </RadioGroup>
          {counter && (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', '& > *': { flex: '1 1 150px' } }}>
                {dates.map((date, index) => (
                  <TextField key={index} label={`Date ${index + 1}${index ? ' (optional)' : ''}`} type="date" value={date}
                    onChange={(event) => setDates((current) => current.map((entry, at) => (at === index ? event.target.value : entry)))}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }} />
                ))}
              </Stack>
              <FormControl fullWidth>
                <InputLabel id="counter-day-part">Part of the day</InputLabel>
                <Select labelId="counter-day-part" label="Part of the day" value={dayPart} onChange={(event) => setDayPart(event.target.value)}>
                  <MenuItem value="">Any time</MenuItem>
                  {counterDayParts.map((part) => <MenuItem key={part.value} value={part.value}>{part.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
          )}
          <TextField label="Customer note (optional)" value={note} onChange={(event) => setNote(event.target.value)}
            multiline minRows={2} fullWidth slotProps={{ htmlInput: { maxLength: counterNoteLimit } }}
            helperText="What the customer said, for whoever plans the next step." />
          {problems.length > 0 && <Alert severity="warning" variant="outlined">{problems.join(' ')}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Back</Button>
        <Button variant="contained" onClick={submit} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : 'Record answer'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function CancelDialog({ onClose, onCancel }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onCancel(reason.trim())
    } catch (cancelError) {
      setError(cancelError.message)
      setSaving(false)
    }
  }
  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>Cancel proposal</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            The held days are released and the request goes back to Ready to propose. The customer is not emailed.
          </Typography>
          <TextField label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} fullWidth required
            multiline minRows={2} slotProps={{ htmlInput: { maxLength: 500 } }} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Back</Button>
        <Button variant="contained" color="error" onClick={submit} disabled={saving || !reason.trim()}>
          {saving ? 'Cancelling…' : 'Cancel proposal'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Awaiting customer (block B, step B6): the proposal a request is waiting on, how long ago
// it was sent and its held days, with the answers a coordinator records from the
// customer's email reply or call. onAnswered(request, notice) reports the outcome.
export default function ProposalAnswerPanel({ request, technicians, onAnswered }) {
  const { answerProposal, cancelProposal, markBuilderContacted } = useCustomerServicePrototype()
  const { profile } = useAuth()
  const [dialog, setDialog] = useState(null)
  const proposal = request.latestProposal?.status === 'SENT' ? request.latestProposal : null
  const { options, allStarted } = proposalOptionsStatus(request)

  if (!proposal || !options.length) {
    return (
      <Alert severity="warning" variant="outlined">
        The proposal this request is waiting on could not be loaded. Reload the page; if it persists, check the request in
        Requests.
      </Alert>
    )
  }

  const accept = async (option, confirmation) => {
    const result = await answerProposal(buildProposalAcceptance({
      proposalId: proposal.id, optionId: option.optionId, confirmationEmail: confirmation,
    }))
    setDialog(null)
    onAnswered(request, registrationNotice(request.requestNumber, result))
  }
  const decline = async (answer) => {
    await answerProposal(buildProposalDecline({ proposalId: proposal.id, ...answer }))
    setDialog(null)
    onAnswered(request, declineNotice(request.requestNumber, answer.counter))
  }
  const cancel = async (reason) => {
    await cancelProposal({ proposalId: proposal.id, reason })
    setDialog(null)
    onAnswered(request, cancelNotice(request.requestNumber))
  }
  const followUp = proposalFollowUp(proposal, new Date(), options)
  const builderContacted = async () => {
    await markBuilderContacted(proposal.id)
    onAnswered(request, builderContactedNotice(request.requestNumber))
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6" fontWeight={800}>Waiting for the customer · {request.requestNumber}</Typography>
          <Typography variant="body2" color="text.secondary">
            {sentAgoLabel(proposal)} from {proposal.senderMailbox}. Record the answer from their email reply or a call.
          </Typography>
        </Box>
        {allStarted && (
          <Alert severity="warning" variant="outlined">
            Every offered day has started without an answer. Cancel this proposal and send a new one.
          </Alert>
        )}
        {followUp.reminder.severity === 'warning'
          ? <Alert severity="warning" variant="outlined">{followUp.reminder.text}</Alert>
          : <Typography variant="body2" color="text.secondary">{followUp.reminder.text}</Typography>}
        {followUp.builderCallDue && !allStarted && (
          <BuilderCall contact={followUp.builderContact} onContacted={builderContacted} />
        )}
        {followUp.builderContacted && (
          <Typography variant="body2" color="text.secondary">{followUp.builderContacted}</Typography>
        )}
        <Stack spacing={1}>
          {options.map((option) => (
            <Paper key={option.optionId} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>Option {option.optionNumber}</Typography>
                  <Typography variant="body2">{optionSummary(option, technicians)}</Typography>
                </Box>
                {option.started && <Chip size="small" color="warning" variant="outlined" label="Day started" />}
                <Button variant="outlined" size="small" disabled={option.started} onClick={() => setDialog({ kind: 'ACCEPT', option })}>
                  Customer accepted
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={() => setDialog({ kind: 'DECLINE' })}>Customer did not accept</Button>
          <Button color="error" onClick={() => setDialog({ kind: 'CANCEL' })}>Cancel proposal</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Each day stays held for its technicians until you record the answer or cancel. Accepting registers the visit;
          any other answer releases the days.
        </Typography>
      </Stack>
      {dialog?.kind === 'ACCEPT' && (
        <AcceptDialog request={request} option={dialog.option} summary={optionSummary(dialog.option, technicians)}
          senderName={profile?.name ?? ''} senderEmail={profile?.email ?? ''}
          onClose={() => setDialog(null)} onAccept={(confirmation) => accept(dialog.option, confirmation)} />
      )}
      {dialog?.kind === 'DECLINE' && <DeclineDialog onClose={() => setDialog(null)} onDecline={decline} />}
      {dialog?.kind === 'CANCEL' && <CancelDialog onClose={() => setDialog(null)} onCancel={cancel} />}
    </Paper>
  )
}
