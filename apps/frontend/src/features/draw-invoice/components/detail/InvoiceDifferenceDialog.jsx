import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { invoicedEditLeftNothingSaved } from '../../services/drawInvoicePackageRecord.js'
import { applyInvoiceDifference } from '../../services/quickbooksRepository.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import {
  DEFAULT_DIFFERENCE_DESCRIPTION,
  DIFFERENCE_DESCRIPTION_MAX,
  DIFFERENCE_REASON_MAX,
  describeDifferenceChange,
  differenceLimit,
  formatSignedCurrency,
  readDifferenceDraft,
  sameDifference,
} from '../../utils/invoiceDifference.js'

// The box holds the total the Builder requires: for a line the invoice has, that is the Package plus the line.
const toInput = (difference, net) => ({
  description: difference?.description ?? DEFAULT_DIFFERENCE_DESCRIPTION,
  reason: difference?.reason ?? '',
  totalText: difference && net != null ? (Math.round((net + difference.amount) * 100) / 100).toFixed(2) : '',
})

/**
 * Adds, changes or takes off the manual difference line of a QuickBooks invoice that already exists (the
 * Package is waiting for payment). Saving updates the SAME QuickBooks invoice: same number and date, the
 * lines of the Package plus this one, and the new total. The Release, which printed the old total, is
 * removed and has to be generated again.
 *
 * `onChanged` is called after anything was saved, even if QuickBooks did not take it (the Package then waits
 * for the change to be sent again from its notice).
 */
export default function InvoiceDifferenceDialog({ record, submissions = [], onClose, onChanged }) {
  const current = record.invoiceDifference ?? null
  const net = record.persistedInvoice?.netAmount ?? null
  const limit = net == null ? null : differenceLimit(net)
  const [input, setInput] = useState(() => toInput(current, net))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState(null)
  const [done, setDone] = useState(null)

  const draft = net == null
    ? { difference: null, problem: null, total: null }
    : readDifferenceDraft({ open: true, ...input }, net, limit)
  const typed = input.totalText.trim() !== ''
  const unchanged = typed && draft.difference != null && sameDifference(current, draft.difference)
  const canSave = !saving && !done && draft.difference != null && !unchanged
  const invoiceNumber = record.invoiceNumber ?? record.quickbooksReference ?? null
  const totalNow = net == null ? null : Math.round((net + (current?.amount ?? 0)) * 100) / 100

  const save = async (difference) => {
    setSaving(true)
    setFailure(null)
    try {
      const result = await applyInvoiceDifference(record.id, difference)
      setDone({ difference, totalAmount: result?.totalAmount ?? null, warnings: result?.warnings ?? [] })
      await onChanged?.(result)
    } catch (error) {
      // After the checks the Package may have been changed even though QuickBooks refused.
      const nothingSaved = invoicedEditLeftNothingSaved(error.code)
      setFailure({ message: error.message, nothingSaved })
      if (!nothingSaved) await onChanged?.(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="invoice-difference-title">
      <DialogTitle id="invoice-difference-title">
        {current ? 'Difference line' : 'Add a difference line'}
        {invoiceNumber ? ` · Invoice ${invoiceNumber}` : ''}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {done ? (
            <Alert severity="success" data-testid="difference-saved">
              <strong>The QuickBooks invoice was updated.</strong>{' '}
              {describeDifferenceChange(current, done.difference)}
              {done.totalAmount != null ? ` Its total is now ${formatCurrency(done.totalAmount)}.` : ''}
              {' '}If the Release was generated, generate it again.
              {done.warnings.map((warning) => <Box key={warning} sx={{ mt: 0.5 }}>{warning}</Box>)}
            </Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                The same QuickBooks invoice is updated: its number and date stay, and it gets the lines of the
                Package plus the difference line, with the new total. Type the total the Builder requires: the line
                is its difference with the Package total{limit != null ? ` (a line that takes off may be up to ${formatCurrency(limit)} for this invoice; one that adds money has no limit but needs a reason)` : ''}.
              </Typography>
              {current && (
                <Alert severity="info" icon={false} data-testid="difference-current">
                  The invoice has a <strong>"{current.description}"</strong> line of{' '}
                  <strong>{formatSignedCurrency(current.amount)}</strong>.
                  {current.reason ? <Box sx={{ mt: 0.5 }}>Reason: {current.reason}</Box> : null}
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
                <TextField
                  label="Description"
                  size="small"
                  value={input.description}
                  onChange={(event) => setInput((value) => ({ ...value, description: event.target.value }))}
                  disabled={saving}
                  placeholder={DEFAULT_DIFFERENCE_DESCRIPTION}
                  slotProps={{ htmlInput: { maxLength: DIFFERENCE_DESCRIPTION_MAX, autoComplete: 'off' } }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Total the Builder requires"
                  size="small"
                  value={input.totalText}
                  onChange={(event) => setInput((value) => ({ ...value, totalText: event.target.value }))}
                  disabled={saving}
                  error={Boolean(draft.problem)}
                  autoFocus
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                    htmlInput: { inputMode: 'decimal', autoComplete: 'off', 'aria-label': 'Total the Builder requires' },
                  }}
                  sx={{ width: { sm: 240 } }}
                />
              </Stack>
              {draft.amount > 0 && (
                <TextField
                  label="Why does the Builder pay more?"
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  value={input.reason}
                  onChange={(event) => setInput((value) => ({ ...value, reason: event.target.value }))}
                  disabled={saving}
                  required
                  error={!input.reason.trim()}
                  helperText="Internal note: it stays in the app and is not sent to QuickBooks."
                  slotProps={{ htmlInput: { maxLength: DIFFERENCE_REASON_MAX, autoComplete: 'off' } }}
                />
              )}
              {draft.problem && (
                <Typography variant="body2" color="error" role="alert">{draft.problem}</Typography>
              )}
              {!draft.problem && net != null && (
                <Typography variant="body2" data-testid="difference-totals">
                  Package {formatCurrency(net)} · invoice total now <strong>{formatCurrency(totalNow)}</strong>
                  {draft.difference && !unchanged
                    ? <> → <strong>{formatCurrency(draft.total)}</strong>, a line of <strong>{formatSignedCurrency(draft.amount)}</strong></>
                    : null}
                  .
                </Typography>
              )}
              {unchanged && (
                <Typography variant="caption" color="text.secondary">The invoice already has this line.</Typography>
              )}
              {submissions.length > 0 && (
                <Alert severity="warning">
                  This Package was already sent to the Builder. After the change, send the new Package PDF
                  again so the Builder has the right total.
                </Alert>
              )}
              {failure && (
                <Alert severity={failure.nothingSaved ? 'error' : 'warning'} data-testid="difference-failure">
                  {failure.nothingSaved
                    ? `Nothing was saved. ${failure.message}`
                    : `The line was saved on the Package, but QuickBooks did not take it: ${failure.message} `
                      + 'Send it again from the notice on the Package page.'}
                </Alert>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {!done && current && (
          <Button
            color="error"
            onClick={() => save(null)}
            disabled={saving || failure?.nothingSaved === false}
            sx={{ mr: 'auto' }}
          >
            Take it off
          </Button>
        )}
        <Button onClick={onClose} disabled={saving}>{done ? 'Close' : 'Cancel'}</Button>
        {!done && (
          <Button
            variant="contained"
            disableElevation
            disabled={!canSave || failure?.nothingSaved === false}
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
            onClick={() => save(draft.difference)}
          >
            {saving ? 'Updating QuickBooks…' : 'Save and update QuickBooks'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
