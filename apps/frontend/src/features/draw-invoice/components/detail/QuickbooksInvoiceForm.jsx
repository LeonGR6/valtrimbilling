import {
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
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
import { formatCurrency, formatDate } from '../../utils/drawInvoiceFormatters.js'

const NUMBER_COLORS = { success: 'success.main', error: 'error.main', neutral: 'text.secondary' }

/**
 * What a person fills in and checks before a Package's QuickBooks invoice is created: its
 * number (offered as the one after the last used), its date, the Customer, the lines and, in
 * Production, the confirmation that it is real. `draft` is `useQuickbooksInvoiceDraft`.
 */
export default function QuickbooksInvoiceForm({ draft, showLastFailure = true }) {
  const {
    previewData,
    previewError,
    loading,
    submitting,
    submitError,
    numberStatus,
    isProduction,
    typed,
  } = draft

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
              {numberStatus.message}
              {draft.lastNumber ? ` Last used here: ${draft.lastNumber}.` : ''}
            </Box>
          )}
          slotProps={{ htmlInput: { maxLength: 21, autoComplete: 'off' } }}
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
                    checked={draft.confirmed}
                    onChange={(event) => draft.setConfirmed(event.target.checked)}
                    disabled={submitting}
                  />
                )}
                label={`This creates invoice ${typed || '…'} in your real QuickBooks for ${previewData.customerName} (${formatCurrency(previewData.total)}).`}
              />
            </Alert>
          )}
        </>
      )}
    </Stack>
  )
}
