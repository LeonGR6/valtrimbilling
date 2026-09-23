import { useState } from 'react'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'

export default function RequestStateDialog({ action, request, saving, onClose, onConfirm }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const closing = action === 'close'

  const handleConfirm = () => {
    const normalized = note.trim()
    if (closing && !normalized) {
      setError('Enter the reason for closing this request.')
      return
    }
    onConfirm(normalized)
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {closing ? 'Close request?' : 'Reopen request?'}
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {closing
            ? `${request.requestNumber} will remain in the history but cannot be edited until it is reopened.`
            : `${request.requestNumber} will return to its previous workflow status.`}
        </DialogContentText>
        <TextField
          label={closing ? 'Close reason' : 'Reopen note'}
          value={note}
          onChange={(event) => {
            setNote(event.target.value)
            setError('')
          }}
          error={Boolean(error)}
          helperText={error || (closing ? 'Required' : 'Optional')}
          multiline
          minRows={2}
          fullWidth
          autoFocus
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          color={closing ? 'error' : 'primary'}
          variant="contained"
          onClick={handleConfirm}
          disabled={saving}
          disableElevation
        >
          {saving && <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} />}
          {closing ? 'Close request' : 'Reopen request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
