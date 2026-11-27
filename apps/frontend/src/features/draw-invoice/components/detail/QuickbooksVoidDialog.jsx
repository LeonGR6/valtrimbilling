import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { voidQuickbooksInvoice } from '../../services/quickbooksRepository.js'

const OUTCOMES = {
  voided: 'The invoice was voided in QuickBooks.',
  already_voided: 'The invoice was already voided in QuickBooks; the Package was updated to match.',
  missing: 'The invoice no longer exists in QuickBooks; the Package was updated to match.',
}

/** Confirms and voids the QuickBooks invoice of a Package. */
export default function QuickbooksVoidDialog({ record, onClose, onVoided }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState(null)

  const confirm = async () => {
    setSubmitting(true)
    setError('')
    try {
      const result = await voidQuickbooksInvoice(record.id)
      setOutcome(result.quickbooks)
      await Promise.resolve(onVoided?.()).catch(() => {})
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSubmitting(false)
    }
  }

  const invoice = record.quickbooksReference ? `invoice ${record.quickbooksReference}` : 'the invoice'

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Void {invoice} in QuickBooks?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {outcome ? (
            <Alert severity="success">
              {OUTCOMES[outcome] ?? OUTCOMES.voided} You can now create a new invoice for this
              Package, or delete it as a draft.
            </Alert>
          ) : (
            <>
              <Typography>
                QuickBooks keeps a voided invoice with its number, but its amounts become $0 and
                it cannot be used again. The invoice PDF saved on this Package is removed.
              </Typography>
              <Typography color="text.secondary">
                It can only be voided while nothing was paid or credited against it and the
                Package was not submitted. To invoice these cells again, create a new invoice
                for the Package afterwards, or delete the draft.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>{outcome ? 'Close' : 'Cancel'}</Button>
        {!outcome && (
          <Button
            color="error"
            variant="contained"
            disableElevation
            onClick={confirm}
            disabled={submitting}
          >
            {submitting ? 'Voiding…' : 'Void invoice'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
