import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl,
  FormControlLabel, Paper, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import {
  confirmationEmail, confirmationTextLimits, confirmationTextProblems, defaultConfirmationText, mailingAddress,
} from '../utils/customerServiceEmailTemplates.js'

const acceptanceOptions = [
  { value: 'CUSTOMER_ACCEPTED_PROPOSAL', label: 'Customer accepted the proposal' },
  { value: 'COUNTER_PROPOSAL_ACCEPTED', label: 'Counter-proposal accepted' },
]

// "Send to customer" (block B, step B4). Path a, "Customer accepted by phone": the visit
// is registered and the customer can get a confirmation email from the coordinator's
// mailbox. The greeting and message can be edited; the visit details come from the
// request and are fixed. Without a customer email the visit is registered without one,
// an exception for visits arranged only by phone (decision of 20 Nov 2026).
// onSend({ acceptance, confirmationEmail }) registers; it rejects with the error to show.
export default function SendToCustomerDialog({ request, values, summary, senderName, senderEmail, onClose, onSend }) {
  const customerEmail = String(request.contactEmail ?? '').trim()
  const [acceptance, setAcceptance] = useState(acceptanceOptions[0].value)
  const [emailOn, setEmailOn] = useState(Boolean(customerEmail))
  const [text, setText] = useState(() => defaultConfirmationText({ homeownerName: request.contactName }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const problems = emailOn ? confirmationTextProblems(text) : []
  const preview = emailOn
    ? confirmationEmail({
      folio: request.requestNumber, homeownerName: request.contactName, date: values.date, windowStart: values.windowStart,
      // Saved requests carry the property's one-line address; the server reads the same column.
      address: mailingAddress({
        street: request.street || request.address, city: request.city, state: request.state, postalCode: request.postalCode,
      }),
      work: request.issue, greeting: text.greeting, message: text.message, senderName,
    })
    : null

  const send = async () => {
    setSaving(true)
    setError('')
    try {
      await onSend({ acceptance, confirmationEmail: emailOn ? text : null })
    } catch (sendError) {
      setError(sendError.message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Send to customer</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">{summary}</Typography>
          <Box>
            <Typography variant="subtitle2" fontWeight={800}>Customer accepted by phone</Typography>
            <Typography variant="caption" color="text.secondary">
              The visit is registered now: it moves to Confirmed, appears in Calendar and reserves the technicians&apos; time.
              The schedule is checked again before saving.
            </Typography>
          </Box>
          <FormControl>
            <Typography variant="caption" color="text.secondary">How did the customer accept?</Typography>
            <RadioGroup value={acceptance} onChange={(event) => setAcceptance(event.target.value)}>
              {acceptanceOptions.map((option) => (
                <FormControlLabel key={option.value} value={option.value} control={<Radio />} label={option.label} />
              ))}
            </RadioGroup>
          </FormControl>
          <Divider />
          <FormControlLabel
            control={<Checkbox checked={emailOn} disabled={!customerEmail} onChange={(event) => setEmailOn(event.target.checked)} />}
            label="Email a confirmation to the customer" />
          {!customerEmail && (
            <Alert severity="info" variant="outlined">
              This request has no customer email, so the visit is registered without a confirmation. Confirm it with the
              customer by phone, or add the email in Requests first.
            </Alert>
          )}
          {preview && (
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                To {customerEmail} · from your mailbox {senderEmail}. The date, window, address and work come from the request.
              </Typography>
              <TextField label="Greeting" value={text.greeting} fullWidth
                onChange={(event) => setText((current) => ({ ...current, greeting: event.target.value }))}
                slotProps={{ htmlInput: { maxLength: confirmationTextLimits.greeting } }}
                error={problems.some((problem) => problem.includes('greeting'))}
                helperText={problems.find((problem) => problem.includes('greeting')) ?? ' '} />
              <TextField label="Message" value={text.message} fullWidth multiline minRows={3}
                onChange={(event) => setText((current) => ({ ...current, message: event.target.value }))}
                slotProps={{ htmlInput: { maxLength: confirmationTextLimits.message } }}
                error={problems.some((problem) => problem.includes('message'))}
                helperText={problems.find((problem) => problem.includes('message')) ?? ' '} />
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="caption" color="text.secondary" component="div">Preview</Typography>
                <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>{preview.subject}</Typography>
                <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.text}</Typography>
              </Paper>
            </Stack>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={saving || problems.length > 0}>
          {saving ? (emailOn ? 'Sending…' : 'Registering…') : emailOn ? 'Register and email' : 'Register appointment'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
