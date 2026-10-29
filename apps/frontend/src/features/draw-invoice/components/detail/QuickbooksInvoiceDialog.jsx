import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from '@mui/material'
import { useQuickbooksInvoiceDraft } from '../../hooks/useQuickbooksInvoiceDraft.js'
import { quickbooksEnvironmentLabel } from '../../services/quickbooksRecord.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import QuickbooksEnvironmentChip from './QuickbooksEnvironmentChip.jsx'
import QuickbooksInvoiceForm from './QuickbooksInvoiceForm.jsx'

/**
 * Previews the QuickBooks invoice of a Package (a dry run that sends nothing),
 * then creates it. The mode (Test or Production) is shown and, once seen, sent
 * back with the request: if the platform was switched in between, the server
 * sends nothing.
 */
export default function QuickbooksInvoiceDialog({ record, onClose, onSettled }) {
  const draft = useQuickbooksInvoiceDraft(record, { onSettled })
  const { result, submitting, submitError, isProduction, environmentLabel } = draft

  const create = () => draft.create().catch(() => {})

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Send {record.packageNumber} to QuickBooks</span>
          <QuickbooksEnvironmentChip environment={draft.environment} />
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
              {submitError && <Alert severity="error">{submitError}</Alert>}
              <QuickbooksInvoiceForm draft={draft} />
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
            disabled={!draft.canCreate}
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
