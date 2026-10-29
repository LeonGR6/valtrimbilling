import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
import {
  nextInvoiceNumber,
  quickbooksEnvironmentLabel,
  quickbooksInvoiceDate,
  quickbooksInvoiceNumberStatus,
} from '../../services/quickbooksRecord.js'
import { localDateKey } from '../../utils/calendarDrawSuggestions.js'
import { formatCurrency, formatDate } from '../../utils/drawInvoiceFormatters.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const NUMBER_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]{0,20}$/u
const NUMBER_DELAY_MS = 400

const NUMBER_COLORS = { success: 'success.main', error: 'error.main', neutral: 'text.secondary' }

/**
 * Previews the QuickBooks invoice of a Package (a dry run that sends nothing),
 * then creates it. The preview is read again whenever the date or the typed
 * invoice number changes. The mode (Test or Production) is shown and, once
 * seen, sent back with the request: if the platform was switched in between,
 * the server sends nothing.
 */
export default function QuickbooksInvoiceDialog({ record, onClose, onSettled }) {
  // The invoice is dated with the Package's cut off date, or the day it is created
  // when the Builder bills any date. The person can still change it.
  const [suggestedDate] = useState(() => quickbooksInvoiceDate(record, localDateKey(new Date())))
  const [txnDate, setTxnDate] = useState(suggestedDate.date)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  // The field is filled with the next number once, when the first preview tells the last one used.
  const offeredNextNumber = useRef(false)
  const [settledNumber, setSettledNumber] = useState('')
  const [preview, setPreview] = useState(null)
  const [shownEnvironment, setShownEnvironment] = useState(null)
  const [lastNumber, setLastNumber] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)

  const typed = invoiceNumber.trim()
  const validDate = DATE_PATTERN.test(txnDate)
  // The number goes to the preview once it has stopped changing and is valid.
  const numberForPreview = NUMBER_PATTERN.test(settledNumber) ? settledNumber : null
  const previewKey = `${txnDate}|${numberForPreview ?? ''}`
  // A preview belongs to the date and number it was requested for; any other is loading.
  const currentPreview = preview?.key === previewKey ? preview : null
  const loading = validDate && !result && currentPreview == null
  const previewError = currentPreview?.error ?? null
  const previewData = currentPreview?.data ?? null

  useEffect(() => {
    const timer = setTimeout(() => setSettledNumber(typed), NUMBER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed])

  useEffect(() => {
    if (!validDate || result) return undefined

    let cancelled = false
    previewQuickbooksInvoice(record.id, txnDate, {
      invoiceNumber: numberForPreview,
      expectedEnvironment: shownEnvironment,
    })
      .then((data) => {
        if (cancelled) return
        setPreview({ key: previewKey, data, error: null })
        setShownEnvironment((current) => current ?? data.environment)
        setLastNumber(data.numberCheck.last)
        // A retry keeps the number of the earlier attempt: offer it when nothing was typed.
        if (data.numberCheck.current) {
          setInvoiceNumber((current) => current || data.numberCheck.current)
        } else if (!offeredNextNumber.current) {
          // Otherwise offer the number after the last one used, so the numbers keep their order.
          // It is only a suggestion: it can be changed, or cleared and typed again.
          const next = nextInvoiceNumber(data.numberCheck.last)
          if (next) setInvoiceNumber((current) => current || next)
        }
        offeredNextNumber.current = true
      })
      .catch((error) => {
        if (!cancelled) setPreview({ key: previewKey, data: null, error })
      })
    return () => {
      cancelled = true
    }
    // The environment is read from the first preview and never re-requests one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, txnDate, validDate, result, numberForPreview, previewKey])

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

  const environment = previewData?.environment ?? shownEnvironment
  const environmentLabel = quickbooksEnvironmentLabel(environment)
  const isProduction = environment === 'production'
  const numberStatus = quickbooksInvoiceNumberStatus({
    typed,
    checking: loading || settledNumber !== typed || previewData == null,
    numberCheck: previewData?.numberCheck,
  })

  const create = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      setResult(await createQuickbooksInvoice(record.id, txnDate, {
        invoiceNumber: typed,
        expectedEnvironment: environment,
      }))
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitting(false)
      // Refresh either way: a failure leaves the Package in SYNC_ERROR.
      Promise.resolve(onSettled?.()).catch(() => {})
    }
  }

  const canCreate = Boolean(previewData)
    && !submitting
    && !result
    && !numberStatus.blocking
    && (!isProduction || confirmed)

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Send {record.packageNumber} to QuickBooks</span>
          {environment && (
            <Chip
              size="small"
              color={isProduction ? 'error' : 'warning'}
              label={isProduction ? 'PRODUCTION · real invoice' : 'TEST · not real'}
              sx={{ fontWeight: 800 }}
            />
          )}
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {result ? (
            <>
              <Alert severity="success">
                Invoice <strong>{result.invoiceNumber || result.docNumber || result.invoiceId}</strong>{' '}
                was created in QuickBooks {quickbooksEnvironmentLabel(result.environment)}
                {result.customerName ? ` for ${result.customerName}` : ''}
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
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
                <TextField
                  label="Invoice number"
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  disabled={submitting}
                  required
                  error={numberStatus.tone === 'error'}
                  helperText={(
                    <Box component="span" sx={{ color: NUMBER_COLORS[numberStatus.tone] }}>
                      {numberStatus.message}
                      {lastNumber ? ` Last used here: ${lastNumber}.` : ''}
                    </Box>
                  )}
                  slotProps={{ htmlInput: { maxLength: 21, autoComplete: 'off' } }}
                  sx={{ minWidth: 240 }}
                />
                <TextField
                  label="Invoice date"
                  type="date"
                  value={txnDate}
                  onChange={(event) => setTxnDate(event.target.value)}
                  disabled={submitting}
                  error={!validDate}
                  helperText={txnDate !== suggestedDate.date
                    ? `Suggested: ${formatDate(suggestedDate.date)}`
                    : suggestedDate.source === 'CUTOFF'
                      ? 'Cut off date of this Package'
                      : 'Today, the day the invoice is created'}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ maxWidth: 220 }}
                />
              </Stack>
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
                  {isProduction && (
                    <Alert severity="warning" icon={false}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            checked={confirmed}
                            onChange={(event) => setConfirmed(event.target.checked)}
                            disabled={submitting}
                          />
                        )}
                        label={`This creates invoice ${typed || '…'} in your real QuickBooks for ${previewData.customerName} (${formatCurrency(previewData.total)}).`}
                      />
                    </Alert>
                  )}
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
          <Button
            variant="contained"
            color={isProduction ? 'error' : 'primary'}
            onClick={create}
            disabled={!canCreate}
            disableElevation
          >
            {submitting
              ? 'Creating…'
              : `Create invoice in QuickBooks${environmentLabel ? ` ${environmentLabel}` : ''}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
