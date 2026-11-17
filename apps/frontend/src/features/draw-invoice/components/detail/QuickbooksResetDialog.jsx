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
import { resetQuickbooksTestInvoice } from '../../services/quickbooksRepository.js'

/**
 * Confirms moving a Package invoiced in QuickBooks Test back to a clean Draft,
 * so it can be sent to Production. Nothing in the real QuickBooks is touched.
 */
export default function QuickbooksResetDialog({ record, onClose, onReset }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const confirm = async () => {
    setSubmitting(true)
    setError('')
    try {
      await resetQuickbooksTestInvoice(record.id)
      setDone(true)
      await Promise.resolve(onReset?.()).catch(() => {})
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSubmitting(false)
    }
  }

  const invoice = record.quickbooksReference ? ` (invoice ${record.quickbooksReference})` : ''

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Move {record.packageNumber} back to Production?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {done ? (
            <Alert severity="success">
              The Package is a clean Draft again. Switch the platform to Production (an
              administrator does that) and send it to QuickBooks with its real invoice number.
            </Alert>
          ) : (
            <>
              <Typography>
                This Package was invoiced in the QuickBooks <strong>Test</strong> company{invoice}.
                It goes back to a Draft with no QuickBooks invoice, and its saved invoice PDF is
                removed, so it can be sent to Production.
              </Typography>
              <Typography color="text.secondary">
                The test invoice stays in the Test company, where it does no harm; nothing in your
                real QuickBooks is touched. The attempt is kept in a history for reference. It can
                only be done while the Package is unpaid and was not sent to the Builder.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>{done ? 'Close' : 'Cancel'}</Button>
        {!done && (
          <Button variant="contained" disableElevation onClick={confirm} disabled={submitting}>
            {submitting ? 'Moving…' : 'Move back to Production'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
