import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import { formatCurrency, formatDate } from '../../utils/drawInvoiceFormatters.js'
import {
  DEFAULT_DIFFERENCE_DESCRIPTION,
  DIFFERENCE_DESCRIPTION_MAX,
  formatSignedCurrency,
} from '../../utils/invoiceDifference.js'

const NUMBER_COLORS = { success: 'success.main', error: 'error.main', neutral: 'text.secondary' }

/**
 * One extra line for the occasions when the total the Builder requires does not match the Package: the
 * person types that required total and the line is the difference with the Package total so far (plus or
 * minus, within a limit that grows with the size of the invoice), with a text that starts as "DIFFERENCE".
 * The table above shows the line once it is valid; a problem is said here, and the invoice cannot be
 * created while there is one.
 */
function DifferenceEditor({ draft }) {
  const {
    differenceInput: input,
    changeDifference,
    differenceProblem,
    differenceAmount,
    differenceLimit,
    packageNet,
  } = draft
  const disabled = draft.submitting

  if (!input.open) {
    return (
      <Box>
        <Button
          size="small"
          startIcon={<AddRoundedIcon />}
          onClick={() => changeDifference({ open: true })}
          disabled={disabled}
        >
          Add a difference line
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          When the total the Builder requires does not match this Package
          {differenceLimit != null ? `: up to ${formatCurrency(differenceLimit)} either way for this invoice.` : '.'}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ border: 1, borderColor: differenceProblem ? 'error.main' : 'divider', borderRadius: 1, p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Difference line</Typography>
        <IconButton
          size="small"
          aria-label="Remove the difference line"
          onClick={() => changeDifference({ open: false, totalText: '' })}
          disabled={disabled}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          label="Description"
          size="small"
          value={input.description}
          onChange={(event) => changeDifference({ description: event.target.value })}
          disabled={disabled}
          placeholder={DEFAULT_DIFFERENCE_DESCRIPTION}
          slotProps={{ htmlInput: { maxLength: DIFFERENCE_DESCRIPTION_MAX, autoComplete: 'off' } }}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Total the Builder requires"
          size="small"
          value={input.totalText}
          onChange={(event) => changeDifference({ totalText: event.target.value })}
          disabled={disabled}
          error={Boolean(differenceProblem)}
          autoFocus
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
            htmlInput: { inputMode: 'decimal', autoComplete: 'off', 'aria-label': 'Total the Builder requires' },
          }}
          sx={{ width: { sm: 240 } }}
        />
      </Stack>
      {differenceProblem ? (
        <Typography variant="body2" color="error" role="alert" sx={{ mt: 1 }}>
          {differenceProblem}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {differenceAmount != null && packageNet != null
            ? `The Package is ${formatCurrency(packageNet)}, so the line is ${formatSignedCurrency(differenceAmount)}. `
            : `The Package total so far is ${packageNet != null ? formatCurrency(packageNet) : '…'}: type the total the Builder requires and the line is the difference. `}
          {differenceLimit != null
            ? `Up to ${formatCurrency(differenceLimit)} either way for this invoice. `
            : ''}
          It is sent to QuickBooks as one more line and recorded on the Package.
        </Typography>
      )}
    </Box>
  )
}

/**
 * What a person checks before a Package's QuickBooks invoice is created: its number (the one
 * after the last used, locked), its date, the Customer, the lines and, in Production, the
 * confirmation that it is real. `draft` is `useQuickbooksInvoiceDraft`.
 */
export default function QuickbooksInvoiceForm({ draft, showLastFailure = true }) {
  const {
    previewData,
    previewError,
    loading,
    submitting,
    submitError,
    numberStatus,
    numberLocked,
    isProduction,
    typed,
  } = draft
  // The total QuickBooks will show: the Package net, plus the difference line when there is one.
  const shownTotal = draft.invoiceTotal ?? previewData?.total

  return (
    <Stack spacing={2}>
      {showLastFailure && draft.hadSyncError && draft.lastSync?.error && !submitError && (
        <Alert severity="warning">
          The last attempt failed: {draft.lastSync.error}
        </Alert>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          label="Invoice number"
          value={draft.invoiceNumber}
          onChange={(event) => draft.setInvoiceNumber(event.target.value)}
          disabled={submitting}
          required
          error={numberStatus.tone === 'error'}
          helperText={(
            <Box component="span" sx={{ color: NUMBER_COLORS[numberStatus.tone] }}>
              {numberLocked && !typed
                ? (previewError ? 'No number yet: the invoice could not be prepared.' : 'Getting the next number…')
                : numberStatus.message}
              {draft.lastNumber ? ` Last used here: ${draft.lastNumber}.` : ''}
            </Box>
          )}
          slotProps={{
            input: {
              readOnly: numberLocked,
              endAdornment: numberLocked ? (
                <InputAdornment position="end">
                  <LockOutlinedIcon fontSize="small" color="disabled" titleAccess="Assigned automatically" />
                </InputAdornment>
              ) : undefined,
            },
            htmlInput: { maxLength: 21, autoComplete: 'off' },
          }}
          sx={{ minWidth: 240 }}
        />
        <TextField
          label="Invoice date"
          type="date"
          value={draft.txnDate}
          onChange={(event) => draft.setTxnDate(event.target.value)}
          disabled={submitting}
          error={!draft.validDate}
          helperText={draft.txnDate !== draft.suggestedDate.date
            ? `Suggested: ${formatDate(draft.suggestedDate.date)}`
            : draft.suggestedDate.source === 'CUTOFF'
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
                {draft.difference && (
                  <TableRow sx={{ bgcolor: 'action.hover' }} data-testid="difference-line">
                    <TableCell sx={{ whiteSpace: 'pre-line' }}>
                      {draft.difference.description}
                      <Chip size="small" variant="outlined" label="added by hand" sx={{ ml: 1 }} />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ color: draft.difference.amount < 0 ? 'error.main' : undefined, fontWeight: 700 }}
                    >
                      {formatCurrency(draft.difference.amount)}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>
                    {formatCurrency(shownTotal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>
          <DifferenceEditor draft={draft} />
          {isProduction && (
            <Alert severity="warning" icon={false}>
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={draft.confirmed}
                    onChange={(event) => draft.setConfirmed(event.target.checked)}
                    disabled={submitting}
                  />
                )}
                label={`This creates invoice ${typed || '…'} in your real QuickBooks for ${previewData.customerName} (${formatCurrency(shownTotal)}).`}
              />
            </Alert>
          )}
        </>
      )}
    </Stack>
  )
}
