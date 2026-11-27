import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup,
  Stack, Typography,
} from '@mui/material'
import {
  confirmationTextProblems, defaultVisitCancelledText, visitCancelledEmail,
} from '../utils/customerServiceEmailTemplates.js'
import {
  cancelReasons, currentVisit, customerEmailDetails, visitChangeProblem,
} from '../utils/customerServiceVisitChanges.js'
import { DayBox, DayDetails, NoEmailNote, Section } from './CustomerEmailDialogParts.jsx'
import CustomerEmailEditor from './CustomerEmailEditor.jsx'
import CustomerEmailPreview from './CustomerEmailPreview.jsx'
import VisitChangeReasonFields from './VisitChangeReasonFields.jsx'

// "Cancel visit" (Reschedule block, 27 Nov 2026): cancels a confirmed visit, live or in test
// mode, with a reason. The request goes back to Ready to propose, or closes (decision P4);
// a duplicate always closes. The customer is emailed with a calendar file that removes the
// visit, unless the coordinator unchecks it.
// onCancel({ reason, note, closeRequest, duplicateOfRequestId, email }) rejects with the
// error to show.
export default function CancelVisitDialog({ request, requests, senderEmail, onClose, onCancel }) {
  const customerEmail = String(request.contactEmail ?? '').trim()
  const visit = currentVisit(request)
  const [change, setChange] = useState({ reason: 'CUSTOMER_CANCELLED', note: '', duplicateOfRequestId: null })
  const [closeChoice, setCloseChoice] = useState(false)
  const [emailOn, setEmailOn] = useState(Boolean(customerEmail))
  const [text, setText] = useState(() => defaultVisitCancelledText({ homeownerName: request.contactName }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const closeRequest = change.reason === 'DUPLICATE' || closeChoice
  const reasonProblem = visitChangeProblem({
    action: 'cancel', reason: change.reason, note: change.note, closeRequest,
    duplicateOfRequestId: change.duplicateOfRequestId,
  })
  const problems = emailOn ? confirmationTextProblems(text) : []
  const preview = emailOn
    ? visitCancelledEmail({
      ...customerEmailDetails(request), greeting: text.greeting, message: text.message,
      date: visit.date, windowStart: visit.windowStart,
    })
    : null

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onCancel({
        reason: change.reason, note: change.note, closeRequest,
        duplicateOfRequestId: change.duplicateOfRequestId, email: emailOn ? text : null,
      })
    } catch (cancelError) {
      setError(cancelError.message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="lg"
      slotProps={{ paper: { sx: { height: { md: 'calc(100% - 64px)' }, maxHeight: { md: 900 } } } }}>
      <DialogTitle>
        Cancel visit
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
          <Section title="Visit">
            <DayBox><DayDetails label="CANCELLED VISIT" day={visit.summary} struck /></DayBox>
            <Typography variant="caption" color="text.secondary">Its time is released for other visits.</Typography>
          </Section>

          <Section title="Why it is cancelled">
            <VisitChangeReasonFields idPrefix={`cancel-${request.id}`} reasons={cancelReasons} value={change}
              onChange={(value) => { setChange(value); setError('') }} request={request} requests={requests}
              asksOriginal disabled={saving} />
          </Section>

          <Section title="Then">
            <RadioGroup aria-label="What happens to the request" value={closeRequest ? 'CLOSE' : 'PROPOSE'}
              onChange={(event) => setCloseChoice(event.target.value === 'CLOSE')}>
              <FormControlLabel value="PROPOSE" disabled={saving || change.reason === 'DUPLICATE'} control={<Radio size="small" />}
                label={<Typography variant="body2">Propose another day: the request goes back to Ready to propose</Typography>} />
              <FormControlLabel value="CLOSE" disabled={saving} control={<Radio size="small" />}
                label={<Typography variant="body2">Close the request: it leaves the lists and stays in History</Typography>} />
            </RadioGroup>
          </Section>

          <Section title="Customer email">
            <FormControlLabel sx={{ m: 0 }}
              control={<Checkbox checked={emailOn} disabled={!customerEmail || saving} onChange={(event) => setEmailOn(event.target.checked)} />}
              label={<Typography variant="body2">Email the cancellation to the customer{customerEmail ? ` (${customerEmail})` : ''}</Typography>} />
            {!customerEmail && (
              <Alert severity="info" variant="outlined">
                This request has no customer email. Tell the customer by phone.
              </Alert>
            )}
            {preview && (
              <CustomerEmailEditor senderEmail={senderEmail} text={text} problems={problems} onChange={setText} />
            )}
          </Section>
        </Stack>

        <Box sx={{ minHeight: 0 }}>
          {preview ? <CustomerEmailPreview preview={preview} fill /> : (
            <NoEmailNote>No email is sent: tell the customer yourself.</NoEmailNote>
          )}
        </Box>
      </DialogContent>
      {error && <Alert severity="error" sx={{ mx: 3, mt: 2 }}>{error}</Alert>}
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>Keep visit</Button>
        <Button variant="contained" color="error" onClick={submit} disabled={saving || Boolean(reasonProblem) || problems.length > 0}>
          {saving ? 'Cancelling…' : emailOn ? 'Cancel and email' : 'Cancel visit'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
