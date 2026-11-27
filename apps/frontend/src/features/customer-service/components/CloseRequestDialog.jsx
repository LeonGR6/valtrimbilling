import { useState } from 'react'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography,
} from '@mui/material'
import { closeReasons, visitChangeProblem } from '../utils/customerServiceVisitChanges.js'
import { effectiveRequestWorkflowStage } from '../utils/requestInbox.js'
import VisitChangeReasonFields from './VisitChangeReasonFields.jsx'

// "Close request" (decision D2, built in the Reschedule block, 27 Nov 2026): a request that
// will not get a visit, before one is confirmed. It leaves Requests and Proposal Workspace
// and stays in History with the reason. The customer is not emailed. A proposal still
// waiting for the customer is closed by the system and its days are released.
// onConfirm({ reason, note, duplicateOfRequestId }) rejects with the error to show.
export default function CloseRequestDialog({ request, requests, onClose, onConfirm }) {
  const [change, setChange] = useState({ reason: 'NOT_VALTRIM_WORK', note: '', duplicateOfRequestId: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const problem = visitChangeProblem({
    action: 'close', reason: change.reason, note: change.note, duplicateOfRequestId: change.duplicateOfRequestId,
  })
  const waiting = effectiveRequestWorkflowStage(request) === 'AWAITING_CUSTOMER'

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      await onConfirm({ reason: change.reason, note: change.note, duplicateOfRequestId: change.duplicateOfRequestId })
    } catch (closeError) {
      setError(closeError.message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>
        Close request
        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block' }}>
          {[request.requestNumber, request.contactName].filter(Boolean).join(' · ')}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            The request leaves Requests and Proposal Workspace and stays in History with the reason. The customer is
            not emailed.
          </Typography>
          {waiting && (
            <Alert severity="warning" variant="outlined">
              A proposal is waiting for the customer. Closing the request closes it too and releases its days; the
              customer&apos;s link will say it is no longer available.
            </Alert>
          )}
          <VisitChangeReasonFields idPrefix={`close-${request.id}`} reasons={closeReasons} value={change}
            onChange={(value) => { setChange(value); setError('') }} request={request} requests={requests}
            asksOriginal disabled={saving} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>Keep open</Button>
        <Button variant="contained" color="error" onClick={submit} disabled={saving || Boolean(problem)}>
          {saving ? 'Closing…' : 'Close request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
