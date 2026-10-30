import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  formatPhaseBuilding,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import {
  formatCurrency,
  formatLongDate,
} from '../../utils/drawInvoiceFormatters.js'
import { NEW_PACKAGE_NOTE_MAX_LENGTH, newPackageNoteHelp } from '../../services/packageNotesRecord.js'

function scopeLabel(suggestion) {
  if (suggestion.scopeType === 'JOB') return 'Per Job'
  return formatPhaseBuilding(suggestion.phase?.name, suggestion.phase?.building, { separator: ' / ' })
}

export default function CreateRetentionReleaseDialog({
  suggestion,
  onClose,
  onCreate,
}) {
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Before the available date the release can be reviewed but not created; the database refuses it
  // too.
  const waitingForDate = !suggestion.isReady

  const handleCreate = async () => {
    if (waitingForDate) return
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({
        jobId: suggestion.job.id,
        phaseId: suggestion.scopeType === 'BUILDING'
          ? suggestion.phaseId
          : null,
        notes,
      })
    } catch (createError) {
      setError(createError.message)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Review Retention Package</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {waitingForDate && (
            <Alert severity="info">
              Retention can be created from {formatLongDate(suggestion.availableDate)}, one month
              after the final Hardware cutoff. You can review it now.
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            The database will revalidate Hardware completion, source Package
            statuses, cutoff timing, and the unreleased balance before creation.
          </Typography>
          <Stack spacing={0.5}>
            <Typography fontWeight={850}>Job #{suggestion.job.code}</Typography>
            <Typography variant="body2" color="text.secondary">
              {suggestion.job.builder} · {suggestion.job.community}
            </Typography>
            <Typography variant="body2">Scope: {scopeLabel(suggestion)}</Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Stack sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary">Positive release amount</Typography>
              <Typography variant="h5" fontWeight={900} color="success.dark">
                {formatCurrency(suggestion.releasableRetention)}
              </Typography>
            </Stack>
            <Stack sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary">Final Hardware cutoff</Typography>
              <Typography fontWeight={750}>{formatLongDate(suggestion.sourceCutoffDate)}</Typography>
              <Typography variant="caption" color="text.secondary">
                Available {formatLongDate(suggestion.availableDate)}
              </Typography>
            </Stack>
          </Stack>
          {suggestion.draftRetention > 0 && (
            <Alert severity="info">
              {formatCurrency(suggestion.draftRetention)} from Draft Packages is
              projected only and will not be included.
            </Alert>
          )}
          <TextField
            label="Note (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={3}
            slotProps={{ htmlInput: { maxLength: NEW_PACKAGE_NOTE_MAX_LENGTH } }}
            helperText={newPackageNoteHelp(notes)}
            disabled={submitting}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {waitingForDate ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={handleCreate}
          disabled={submitting || waitingForDate}
          disableElevation
        >
          {submitting ? 'Creating…' : 'Create Retention Package'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
