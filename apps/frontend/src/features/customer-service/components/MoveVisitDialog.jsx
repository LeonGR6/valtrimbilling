import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography,
} from '@mui/material'
import {
  confirmationTextProblems, defaultVisitMovedText, visitMovedEmail,
} from '../utils/customerServiceEmailTemplates.js'
import { customerEmailDetails, moveReasons, visitChangeProblem } from '../utils/customerServiceVisitChanges.js'
import { DayBox, DayDetails, NoEmailNote, Section } from './CustomerEmailDialogParts.jsx'
import CustomerEmailEditor from './CustomerEmailEditor.jsx'
import CustomerEmailPreview from './CustomerEmailPreview.jsx'
import VisitChangeReasonFields from './VisitChangeReasonFields.jsx'

// "Move visit" (Reschedule block, 27 Nov 2026): the coordinator already agreed the new day
// with the customer (decision P1). The old day is released and the new visit registered in
// one step; the customer is emailed with a calendar file that updates the visit, unless the
// coordinator unchecks it. A date after the due date only warns (decision P3).
// previous: { date, windowStart, summary } of the visit that moves; next: { date,
// windowStart, summary } of the new one. onMove({ reason, note, email }) rejects with the
// error to show.
export default function MoveVisitDialog({ request, previous, next, warnings = [], senderEmail, onClose, onMove }) {
  const customerEmail = String(request.contactEmail ?? '').trim()
  const [change, setChange] = useState({ reason: 'CUSTOMER_ASKED', note: '', duplicateOfRequestId: null })
  const [emailOn, setEmailOn] = useState(Boolean(customerEmail))
  const [text, setText] = useState(() => defaultVisitMovedText({ homeownerName: request.contactName }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reasonProblem = visitChangeProblem({ action: 'move', reason: change.reason, note: change.note })
  const problems = emailOn ? confirmationTextProblems(text) : []
  const preview = emailOn
    ? visitMovedEmail({
      ...customerEmailDetails(request), greeting: text.greeting, message: text.message,
      date: next.date, windowStart: next.windowStart, previousDate: previous.date, previousWindowStart: previous.windowStart,
    })
    : null

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onMove({ reason: change.reason, note: change.note, email: emailOn ? text : null })
    } catch (moveError) {
      setError(moveError.message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="lg"
      slotProps={{ paper: { sx: { height: { md: 'calc(100% - 64px)' }, maxHeight: { md: 900 } } } }}>
      <DialogTitle>
        Move visit
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
            <DayBox><DayDetails label="CURRENT DATE" day={previous.summary} struck /></DayBox>
            <DayBox><DayDetails label="NEW DATE" day={next.summary} /></DayBox>
            {warnings.length > 0 && (
              <Alert severity="warning" variant="outlined">
                {warnings.map((warning) => warning.message).join(' ')} It can move there because the customer asked.
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              The schedule is checked again when you move it. The current date is released for other visits.
            </Typography>
          </Section>

          <Section title="Why it moves">
            <VisitChangeReasonFields idPrefix={`move-${request.id}`} reasons={moveReasons} value={change}
              onChange={(value) => { setChange(value); setError('') }} request={request} disabled={saving} />
          </Section>

          <Section title="Customer email">
            <FormControlLabel sx={{ m: 0 }}
              control={<Checkbox checked={emailOn} disabled={!customerEmail || saving} onChange={(event) => setEmailOn(event.target.checked)} />}
              label={<Typography variant="body2">Email the new date to the customer{customerEmail ? ` (${customerEmail})` : ''}</Typography>} />
            {!customerEmail && (
              <Alert severity="info" variant="outlined">
                This request has no customer email. Tell the customer by phone, or add the email with Edit request.
              </Alert>
            )}
            {preview && (
              <CustomerEmailEditor senderEmail={senderEmail} text={text} problems={problems} onChange={setText} />
            )}
          </Section>
        </Stack>

        <Box sx={{ minHeight: 0 }}>
          {preview ? <CustomerEmailPreview preview={preview} fill /> : (
            <NoEmailNote>No email is sent: tell the customer the new date yourself.</NoEmailNote>
          )}
        </Box>
      </DialogContent>
      {error && <Alert severity="error" sx={{ mx: 3, mt: 2 }}>{error}</Alert>}
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || Boolean(reasonProblem) || problems.length > 0}>
          {saving ? 'Moving…' : emailOn ? 'Move and email' : 'Move visit'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
