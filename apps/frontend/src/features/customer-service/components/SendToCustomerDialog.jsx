import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel,
  FormLabel, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import {
  confirmationEmail, confirmationTextProblems, defaultConfirmationText, defaultInvitationText, invitationEmail,
  mailingAddress,
} from '../utils/customerServiceEmailTemplates.js'
import { serviceWorkTypeLabel } from '../utils/customerServicePlanning.js'
import { normalizeCustomerEmail } from '../utils/proposalDraft.js'
import CustomerEmailEditor from './CustomerEmailEditor.jsx'
import CustomerEmailPreview from './CustomerEmailPreview.jsx'

const acceptanceOptions = [
  { value: 'CUSTOMER_ACCEPTED_PROPOSAL', label: 'Customer accepted the proposal' },
  { value: 'COUNTER_PROPOSAL_ACCEPTED', label: 'Counter-proposal accepted' },
]

const dayBoxSx = { p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }

// A titled part of the form, kept apart from the next one by the dialog's spacing.
function Section({ title, children }) {
  return (
    <Stack component="section" spacing={1.5}>
      <Typography variant="subtitle2" component="h3" fontWeight={700}>{title}</Typography>
      {children}
    </Stack>
  )
}

// A radio drawn as a card, so the two ways to send read as two separate choices.
function ChoiceCard({ value, title, description, selected, disabled }) {
  return (
    <FormControlLabel value={value} disabled={disabled} control={<Radio />} label={(
      <Box>
        <Typography variant="body2" fontWeight={700}>{title}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">{description}</Typography>
      </Box>
    )} sx={{
      m: 0, py: 1.25, pr: 1.5, pl: 0.5, alignItems: 'flex-start', border: 1, borderRadius: 2,
      borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : 'transparent',
      transition: 'border-color 150ms, background-color 150ms', '& .MuiRadio-root': { pt: 0.25 },
    }} />
  )
}

// A day as the coordinator reads it: { date, detail } with the work hours and technicians.
function DayDetails({ label, day }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      {label && (
        <Typography variant="caption" color="primary" fontWeight={700} component="div" sx={{ letterSpacing: 0.5 }}>
          {label}
        </Typography>
      )}
      <Typography variant="body2" fontWeight={700}>{day.date}</Typography>
      <Typography variant="body2" color="text.secondary">{day.detail}</Typography>
    </Box>
  )
}

// "Send to customer" (block B, step B4), with two paths:
// - "Send a proposal" (path b): emails one or two days from the coordinator's mailbox and
//   holds them until the answer is recorded. It needs the customer's email (decision of
//   20 Nov 2026). The second day is the one suggested with the form's slot; it can be left
//   out but not changed here: changing the form's slot recalculates it.
// - "Customer accepted by phone" (path a): registers the visit, optionally with a
//   confirmation email. Without a customer email it is registered without one.
// The greeting and the message can be edited; the visit details come from the request.
// The customer's email is shown to be checked with them and can be corrected here: the
// correction is saved to the request when sending, without a new review (24 Nov 2026).
// The form sits on the left and the email preview on the right, each with its own scroll.
// summary: { date, detail } of the form's day. secondOffer: { available, values, summary }
// or { available: false, reason }.
// onSend({ acceptance, confirmationEmail, customerEmail }) registers; onSendProposal({
// includeSecond, invitation, customerEmail }) sends; customerEmail is set only when it was
// corrected. Both reject with the error to show.
export default function SendToCustomerDialog({
  request, values, summary, secondOffer, senderEmail, onClose, onSend, onSendProposal, customerChoice = false,
}) {
  const savedEmail = String(request.contactEmail ?? '').trim().toLowerCase()
  const [emailInput, setEmailInput] = useState(String(request.contactEmail ?? '').trim())
  const customerEmail = normalizeCustomerEmail(emailInput)
  const emailInvalid = emailInput.trim() !== '' && !customerEmail
  const emailChanged = Boolean(customerEmail) && customerEmail !== savedEmail
  // The day the customer picked on the proposal page: approving it registers the visit.
  const [path, setPath] = useState(customerEmail && !customerChoice ? 'PROPOSAL' : 'ACCEPTED')
  const [acceptance, setAcceptance] = useState(customerChoice ? 'COUNTER_PROPOSAL_ACCEPTED' : acceptanceOptions[0].value)
  const [emailOn, setEmailOn] = useState(Boolean(customerEmail))
  const [confirmationText, setConfirmationText] = useState(() => defaultConfirmationText({ homeownerName: request.contactName }))
  const [invitationText, setInvitationText] = useState(() => defaultInvitationText({ homeownerName: request.contactName }))
  const [includeSecond, setIncludeSecond] = useState(Boolean(secondOffer?.available))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const proposing = path === 'PROPOSAL'
  const writesEmail = proposing || emailOn
  const text = proposing ? invitationText : confirmationText
  const problems = writesEmail ? confirmationTextProblems(text) : []
  // An email that is not valid, or none when one is about to be sent, blocks sending.
  const emailBlocked = emailInvalid || (writesEmail && !customerEmail)
  // The customer reads the days by date, as the server numbers them (decided 23 Nov 2026).
  const days = [
    { date: values.date, windowStart: values.windowStart },
    ...(includeSecond && secondOffer?.available
      ? [{ date: secondOffer.values.date, windowStart: secondOffer.values.windowStart }]
      : []),
  ].sort((left, right) => left.date.localeCompare(right.date))
  const details = {
    folio: request.requestNumber, homeownerName: request.contactName,
    // Saved requests carry the property's one-line address; the server reads the same column.
    address: mailingAddress({
      street: request.street || request.address, city: request.city, state: request.state, postalCode: request.postalCode,
    }),
    // The type of work, never the Builder's text (decided 23 Nov 2026).
    work: serviceWorkTypeLabel(request.workType), greeting: text.greeting, message: text.message,
  }
  const preview = !writesEmail
    ? null
    : proposing
      // The real buttons get the customer's signed link on the server.
      ? invitationEmail({
        ...details, options: days,
        links: { options: days.map((_day, index) => ({ number: index + 1, url: '#' })), none: '#' },
      })
      : confirmationEmail({ ...details, date: values.date, windowStart: values.windowStart })

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const correctedEmail = emailChanged ? customerEmail : undefined
      if (proposing) {
        await onSendProposal({
          includeSecond: includeSecond && Boolean(secondOffer?.available), invitation: invitationText, customerEmail: correctedEmail,
        })
      } else await onSend({ acceptance, confirmationEmail: emailOn ? confirmationText : null, customerEmail: correctedEmail })
    } catch (sendError) {
      setError(sendError.message)
      setSaving(false)
    }
  }
  const buttonLabel = saving
    ? (writesEmail ? 'Sending…' : 'Registering…')
    : proposing ? 'Send proposal' : emailOn ? 'Register and email' : 'Register appointment'
  const editor = preview && (
    <CustomerEmailEditor senderEmail={senderEmail} text={text} problems={problems}
      onChange={proposing ? setInvitationText : setConfirmationText} />
  )

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="lg"
      slotProps={{ paper: { sx: { height: { md: 'calc(100% - 64px)' }, maxHeight: { md: 900 } } } }}>
      <DialogTitle>
        Send to customer
        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
          {[request.requestNumber, request.contactName].filter(Boolean).join(' · ')}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{
        display: 'grid', gap: 3,
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1.25fr)' },
        gridTemplateRows: { md: 'minmax(0, 1fr)' }, overflowY: { md: 'hidden' },
      }}>
        <Stack spacing={3} sx={{ overflowY: { md: 'auto' }, pr: { md: 1.5 }, py: { md: 0.5 } }}>
          <Section title="How to send">
            <RadioGroup aria-label="How to send" value={path} sx={{ gap: 1 }}
              onChange={(event) => { setPath(event.target.value); setError('') }}>
              <ChoiceCard value="PROPOSAL" selected={proposing} disabled={!customerEmail || saving}
                title="Send a proposal"
                description="Email the customer the days to choose from. They are held until you record the answer." />
              <ChoiceCard value="ACCEPTED" selected={!proposing} disabled={saving}
                title="Customer accepted by phone"
                description="Register the visit now: it moves to Confirmed, appears in Calendar and reserves the technicians' time." />
            </RadioGroup>
          </Section>

          <Section title="Customer email">
            <TextField
              label="Customer email" type="email" size="small" value={emailInput} disabled={saving}
              onChange={(event) => { setEmailInput(event.target.value); setError('') }}
              error={emailBlocked}
              helperText={emailInvalid ? 'Enter a valid email, like name@example.com.'
                : writesEmail && !customerEmail ? 'Add the customer email to send it.'
                  : emailChanged ? 'Corrected email: it is saved to the request when you send.'
                    : 'Check it with the customer before sending.'}
              slotProps={{ htmlInput: { maxLength: 254 } }} />
            {!savedEmail && !customerEmail && (
              <Alert severity="info" variant="outlined">
                This request has no customer email. Add it above to email a proposal or a confirmation, or register the
                visit without one.
              </Alert>
            )}
          </Section>

          {proposing ? (
            <Section title="Days offered">
              <Box sx={dayBoxSx}>
                <DayDetails label={secondOffer?.available ? 'OPTION 1' : null} day={summary} />
              </Box>
              {secondOffer?.available ? (
                <Stack direction="row" spacing={1} sx={{ ...dayBoxSx, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <DayDetails label="OPTION 2" day={secondOffer.summary} />
                  <FormControlLabel label="Include" labelPlacement="start" sx={{ m: 0, flexShrink: 0 }}
                    control={(
                      <Checkbox checked={includeSecond} disabled={saving} size="small"
                        slotProps={{ input: { 'aria-label': 'Include option 2' } }}
                        onChange={(event) => setIncludeSecond(event.target.checked)} />
                    )} />
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Only this day is offered. {secondOffer?.reason ?? ''}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                The schedule is checked again before sending, and each day stays held until you record the customer&apos;s
                answer in Awaiting customer.
              </Typography>
            </Section>
          ) : (
            <Section title="Visit">
              <Box sx={dayBoxSx}><DayDetails day={summary} /></Box>
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ typography: 'body2', mb: 0.5 }}>How did the customer accept?</FormLabel>
                <RadioGroup value={acceptance} onChange={(event) => setAcceptance(event.target.value)}>
                  {acceptanceOptions.map((option) => (
                    <FormControlLabel key={option.value} value={option.value} control={<Radio size="small" />}
                      label={<Typography variant="body2">{option.label}</Typography>} />
                  ))}
                </RadioGroup>
              </FormControl>
            </Section>
          )}

          {proposing ? (
            <Section title="Email message">{editor}</Section>
          ) : (
            <Section title="Confirmation email">
              <FormControlLabel sx={{ m: 0 }}
                control={<Checkbox checked={emailOn} disabled={!customerEmail} onChange={(event) => setEmailOn(event.target.checked)} />}
                label={<Typography variant="body2">Email a confirmation to the customer</Typography>} />
              {editor}
            </Section>
          )}
        </Stack>

        <Box sx={{ minHeight: 0 }}>
          {preview ? <CustomerEmailPreview preview={preview} fill /> : (
            <Box sx={{
              height: { md: '100%' }, minHeight: 160, display: 'grid', placeItems: 'center', p: 3, textAlign: 'center',
              border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 2,
            }}>
              <Typography variant="body2" color="text.secondary">
                No email is sent: the visit is registered without one.
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
      {error && <Alert severity="error" sx={{ mx: 3, mt: 2 }}>{error}</Alert>}
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || problems.length > 0 || emailBlocked}>{buttonLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}
