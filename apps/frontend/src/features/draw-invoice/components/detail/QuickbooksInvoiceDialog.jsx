import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  createQuickbooksInvoice,
  getQuickbooksInvoiceSync,
  previewQuickbooksInvoice,
} from '../../services/quickbooksRepository.js'
import { localDateKey } from '../../utils/calendarDrawSuggestions.js'
import { formatCurrency, formatDate } from '../../utils/drawInvoiceFormatters.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

/**
 * Previews the QuickBooks invoice of a Package (a dry run that sends nothing),
 * then creates it. The preview is requested again whenever the date changes.
 */
export default function QuickbooksInvoiceDialog({ record, onClose, onSettled }) {
  const [txnDate, setTxnDate] = useState(() => localDateKey(new Date()))
  const [preview, setPreview] = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)

  const validDate = DATE_PATTERN.test(txnDate)
  // A preview belongs to the date it was requested for; any other date is loading.
  const currentPreview = preview?.key === txnDate ? preview : null
  const loading = validDate && !result && currentPreview == null
  const previewError = currentPreview?.error ?? null
  const previewData = currentPreview?.data ?? null

  useEffect(() => {
    if (!validDate || result) return undefined

    let cancelled = false
    previewQuickbooksInvoice(record.id, txnDate)
      .then((data) => {
        if (!cancelled) setPreview({ key: txnDate, data, error: null })
      })
      .catch((error) => {
        if (!cancelled) setPreview({ key: txnDate, data: null, error })
      })
    return () => {
      cancelled = true
    }
  }, [record.id, txnDate, validDate, result])

  const hadSyncError = record.quickbooksStatus === 'SYNC_ERROR'
  useEffect(() => {
    if (!hadSyncError) return undefined

    let cancelled = false
    getQuickbooksInvoiceSync(record.id)
      .then((sync) => {
        if (!cancelled) setLastSync(sync)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hadSyncError, record.id])

  const create = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      setResult(await createQuickbooksInvoice(record.id, txnDate))
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitting(false)
      // Refresh either way: a failure leaves the Package in SYNC_ERROR.
      Promise.resolve(onSettled?.()).catch(() => {})
    }
  }

  const canCreate = Boolean(previewData) && !submitting && !result

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>Send {record.packageNumber} to QuickBooks</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {result ? (
            <>
              <Alert severity="success">
                Invoice <strong>{result.docNumber || result.invoiceId}</strong> was created in
                QuickBooks{result.customerName ? ` for ${result.customerName}` : ''}
                {result.totalAmount != null ? ` · ${formatCurrency(result.totalAmount)}` : ''}.
              </Alert>
              {result.warnings.map((warning) => (
                <Alert key={warning} severity="info">{warning}</Alert>
              ))}
            </>
          ) : (
            <>
              {hadSyncError && lastSync?.error && !submitError && (
                <Alert severity="warning">
                  The last attempt failed: {lastSync.error}
                </Alert>
              )}
              {submitError && <Alert severity="error">{submitError}</Alert>}
              <TextField
                label="Invoice date"
                type="date"
                value={txnDate}
                onChange={(event) => setTxnDate(event.target.value)}
                disabled={submitting}
                error={!validDate}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ maxWidth: 220 }}
              />
              {loading && (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <CircularProgress size={20} />
                  <Typography color="text.secondary">Preparing the invoice…</Typography>
                </Stack>
              )}
              {previewError && <Alert severity="error">{previewError.message}</Alert>}
              {previewData && (
                <>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography>
                      Customer: <strong>{previewData.customerName}</strong>
                    </Typography>
                    {previewData.customerIsNew && (
                      <Chip size="small" label="Matched by name · will be remembered" />
                    )}
                    <Typography color="text.secondary">
                      · Due {formatDate(previewData.dueDate)}
                    </Typography>
                  </Stack>
                  {previewData.customFields.length > 0 && (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {previewData.customFields.map((field) => (
                        <Chip
                          key={field.name}
                          size="small"
                          variant="outlined"
                          label={`${field.name}: ${field.value}`}
                        />
                      ))}
                    </Stack>
                  )}
                  {previewData.warnings.map((warning) => (
                    <Alert key={warning} severity="info">{warning}</Alert>
                  ))}
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small" aria-label="QuickBooks invoice lines">
                      <TableHead>
                        <TableRow>
                          <TableCell>Description</TableCell>
                          <TableCell align="right">Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewData.lines.map((line, index) => (
                          <TableRow key={`${index}-${line.description}`}>
                            <TableCell sx={{ whiteSpace: 'pre-line' }}>{line.description}</TableCell>
                            <TableCell
                              align="right"
                              sx={{ color: line.amount < 0 ? 'error.main' : undefined, fontWeight: 700 }}
                            >
                              {formatCurrency(line.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800 }}>Total</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 800 }}>
                            {formatCurrency(previewData.total)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </Box>
                </>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result && (
          <Button variant="contained" onClick={create} disabled={!canCreate} disableElevation>
            {submitting ? 'Creating…' : 'Create invoice in QuickBooks'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
