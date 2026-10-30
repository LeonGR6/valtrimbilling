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
import { detachVoidedQuickbooksInvoice } from '../../services/quickbooksRepository.js'

/**
 * Confirms letting a Package go of its voided QuickBooks invoice, then opens the
 * QuickBooks invoice form so the Package is sent again. The voided invoice stays in
 * QuickBooks with its number; nothing there is touched.
 */
export default function QuickbooksNewInvoiceDialog({ record, onClose, onDetached, onSend }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    setSubmitting(true)
    setError('')
    try {
      await detachVoidedQuickbooksInvoice(record.id)
      // The Package is read again first, so the invoice form opens on a Package with no invoice.
      await Promise.resolve(onDetached?.()).catch(() => {})
      onClose()
      onSend?.()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSubmitting(false)
    }
  }

  const voided = record.quickbooksReference ? `Invoice ${record.quickbooksReference}` : 'The invoice'

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create a new invoice for {record.packageNumber}?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography>
            {voided} was voided. The Package stops pointing at it and goes back to not invoiced,
            and the QuickBooks invoice form opens so you can send it again with a new invoice number.
          </Typography>
          <Typography color="text.secondary">
            The voided invoice stays in QuickBooks with its number and its amounts at $0, so that
            number cannot be used again unless it is deleted there. Nothing in QuickBooks is
            touched, and the voided invoice is kept in a history for reference. This can only be
            done while the Package is unpaid and was not sent to the Builder.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" disableElevation onClick={confirm} disabled={submitting}>
          {submitting ? 'Preparing…' : 'Create a new invoice'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
