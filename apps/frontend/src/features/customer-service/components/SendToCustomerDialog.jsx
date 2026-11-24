import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl,
  FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import {
  confirmationEmail, confirmationTextProblems, defaultConfirmationText, defaultInvitationText, invitationEmail,
  mailingAddress,
} from '../utils/customerServiceEmailTemplates.js'
import { serviceWorkTypeLabel } from '../utils/customerServicePlanning.js'
import { normalizeCustomerEmail } from '../utils/proposalDraft.js'
import CustomerEmailEditor from './CustomerEmailEditor.jsx'

// A radio whose label has a title and a caption lines up with the title.
const choiceSx = { alignItems: 'flex-start', mb: 1, '& .MuiRadio-root': { pt: 0.25 } }

const acceptanceOptions = [
  { value: 'CUSTOMER_ACCEPTED_PROPOSAL', label: 'Customer accepted the proposal' },
  { value: 'COUNTER_PROPOSAL_ACCEPTED', label: 'Counter-proposal accepted' },
]

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
// secondOffer: { available, values, summary } or { available: false, reason }.
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

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Send to customer</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <FormControl>
            <RadioGroup value={path} onChange={(event) => { setPath(event.target.value); setError('') }}>
              <FormControlLabel value="PROPOSAL" sx={choiceSx} disabled={!customerEmail || saving} control={<Radio />} label={(
                <Box>
                  <Typography variant="body2" fontWeight={700}>Send a proposal</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    Email the customer the days to choose from. They are held until you record the answer.
                  </Typography>
                </Box>
              )} />
              <FormControlLabel value="ACCEPTED" sx={choiceSx} disabled={saving} control={<Radio />} label={(
                <Box>
                  <Typography variant="body2" fontWeight={700}>Customer accepted by phone</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    Register the visit now: it moves to Confirmed, appears in Calendar and reserves the technicians&apos; time.
                  </Typography>
                </Box>
              )} />
            </RadioGroup>
          </FormControl>
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
          <Divider />

          {proposing ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2" fontWeight={800}>Days offered</Typography>
              <Typography variant="body2">{secondOffer?.available ? 'Option 1 · ' : ''}{summary}</Typography>
              {secondOffer?.available ? (
                <FormControlLabel
                  control={<Checkbox checked={includeSecond} disabled={saving} onChange={(event) => setIncludeSecond(event.target.checked)} />}
                  label={<Typography variant="body2">Option 2 · {secondOffer.summary}</Typography>} />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Only this day is offered. {secondOffer?.reason ?? ''}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                The schedule is checked again before sending, and each day stays held until you record the customer&apos;s
                answer in Awaiting customer.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2">{summary}</Typography>
              <FormControl>
                <Typography variant="caption" color="text.secondary">How did the customer accept?</Typography>
                <RadioGroup value={acceptance} onChange={(event) => setAcceptance(event.target.value)}>
                  {acceptanceOptions.map((option) => (
                    <FormControlLabel key={option.value} value={option.value} control={<Radio />} label={option.label} />
                  ))}
                </RadioGroup>
              </FormControl>
              <FormControlLabel
                control={<Checkbox checked={emailOn} disabled={!customerEmail} onChange={(event) => setEmailOn(event.target.checked)} />}
                label="Email a confirmation to the customer" />
            </Stack>
          )}

          {preview && (
            <CustomerEmailEditor to={customerEmail} senderEmail={senderEmail} text={text} problems={problems} preview={preview}
              onChange={proposing ? setInvitationText : setConfirmationText} />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || problems.length > 0 || emailBlocked}>{buttonLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}
