import { useState } from 'react'
import { Alert, Box, Button, Stack } from '@mui/material'
import { useQuickbooksInvoicePdf } from '../../hooks/useQuickbooksInvoicePdf.js'
import {
  canResetQuickbooksTestInvoice,
  canStartNewQuickbooksInvoice,
  canVoidQuickbooksInvoice,
  isInvoicedThroughQuickbooks,
  isQuickbooksTestPackage,
} from '../../services/quickbooksRecord.js'
import { saveQuickbooksInvoicePdf } from '../../services/quickbooksRepository.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import QuickbooksNewInvoiceDialog from './QuickbooksNewInvoiceDialog.jsx'
import QuickbooksResetDialog from './QuickbooksResetDialog.jsx'
import QuickbooksVoidDialog from './QuickbooksVoidDialog.jsx'

const savedDate = (value) => (value ? new Date(value).toLocaleDateString('en-US') : '')

/**
 * What the Package page says about its QuickBooks invoice: already invoiced
 * (with its saved PDF and the option to void it), voided (with the option to
 * create a new invoice), or the last attempt failed. A Package invoiced in the
 * QuickBooks Test company says so and can be moved back to Production. Shows
 * nothing for a Package that was never sent.
 */
export default function QuickbooksPackageNotice({
  record,
  sync,
  href,
  canSend,
  role,
  onSend,
  onChanged,
}) {
  const { pdf, loading, reload } = useQuickbooksInvoicePdf(record)
  const [savingPdf, setSavingPdf] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [voidOpen, setVoidOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false)

  if (!record || !isInvoicedThroughQuickbooks(record)) return null

  const canVoid = canVoidQuickbooksInvoice(record, role)
  const canStartNewInvoice = canStartNewQuickbooksInvoice(record, role)
  const isTest = isQuickbooksTestPackage(record)
  const canReset = canResetQuickbooksTestInvoice(record, role)
  const resetButton = canReset && (
    <Button color="inherit" size="small" onClick={() => setResetOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
      Move back to Production
    </Button>
  )
  const resetDialog = resetOpen && (
    <QuickbooksResetDialog
      record={record}
      onClose={() => setResetOpen(false)}
      onReset={onChanged}
    />
  )

  const savePdf = async () => {
    setSavingPdf(true)
    setPdfError('')
    try {
      await saveQuickbooksInvoicePdf(record.id)
      reload()
    } catch (failure) {
      setPdfError(failure.message)
    } finally {
      setSavingPdf(false)
    }
  }

  if (record.quickbooksStatus === 'VOIDED') {
    const newInvoiceButton = canStartNewInvoice && (
      <Button color="inherit" size="small" onClick={() => setNewInvoiceOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
        Create a new invoice
      </Button>
    )

    return (
      <>
        <Alert severity="info" action={resetButton || newInvoiceButton || undefined}>
          <strong>The {isTest ? 'Test ' : ''}QuickBooks invoice was voided.</strong>
          {record.quickbooksReference ? ` Invoice ${record.quickbooksReference} stays in QuickBooks with its amounts at $0.` : ''}
          {isTest
            ? ' This was a test: move the Package back to Production to send it for real, or delete it as a draft.'
            : ' Create a new invoice to send this Package again, or delete it as a draft.'}
        </Alert>
        {resetDialog}
        {newInvoiceOpen && (
          <QuickbooksNewInvoiceDialog
            record={record}
            onClose={() => setNewInvoiceOpen(false)}
            onDetached={onChanged}
            onSend={onSend}
          />
        )}
      </>
    )
  }

  if (record.quickbooksStatus === 'SYNC_ERROR') {
    return (
      <>
        <Alert
          severity="warning"
          action={(canSend || canReset) && (
            <Stack direction="row" spacing={0.5}>
              {canSend && <Button color="inherit" size="small" onClick={onSend}>Retry</Button>}
              {resetButton}
            </Stack>
          )}
        >
          <strong>The last QuickBooks {isTest ? 'Test ' : ''}attempt failed.</strong>
          {sync?.error ? ` ${sync.error}` : ''}
        </Alert>
        {resetDialog}
      </>
    )
  }

  if (record.quickbooksStatus !== 'CREATED') return null

  const canSavePdf = ['ADMIN', 'ACCOUNTING'].includes(role)

  return (
    <>
      <Alert
        severity={isTest ? 'warning' : 'success'}
        sx={{ '& .MuiAlert-message': { flex: 1 } }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <strong>
              {isTest ? 'TEST invoice in QuickBooks Test, not a real invoice.' : 'Already invoiced in QuickBooks.'}
            </strong>{' '}
            {record.quickbooksReference ? `Invoice ${record.quickbooksReference}` : 'This Package has an invoice'}
            {sync?.totalAmount != null ? ` · ${formatCurrency(sync.totalAmount)}` : ''}
            {sync?.updatedAt ? ` · sent ${savedDate(sync.updatedAt)}` : ''}
            . It cannot be sent again or edited here.
            {isTest && ' It cannot be sent to the Builder until it is moved back to Production.'}
            <Box sx={{ mt: 0.5, color: 'text.secondary' }}>
              {loading
                ? 'Checking the invoice PDF…'
                : pdf
                  ? `Invoice PDF saved${pdf.savedAt ? ` ${savedDate(pdf.savedAt)}` : ''}; it goes first in the Package PDF.`
                  : 'The invoice PDF is not saved yet, so it is not in the Package PDF.'}
            </Box>
            {pdfError && <Box sx={{ mt: 0.5, color: 'error.main' }}>{pdfError}</Box>}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {href && (
              <Button
                color="inherit"
                size="small"
                component="a"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ whiteSpace: 'nowrap' }}
              >
                Open in QuickBooks
              </Button>
            )}
            {canSavePdf && !loading && (
              <Button
                color="inherit"
                size="small"
                onClick={savePdf}
                disabled={savingPdf}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {savingPdf ? 'Saving PDF…' : pdf ? 'Refresh PDF' : 'Save PDF'}
              </Button>
            )}
            {resetButton}
            {canVoid && (
              <Button
                color="error"
                size="small"
                onClick={() => setVoidOpen(true)}
                sx={{ whiteSpace: 'nowrap' }}
              >
                Void invoice
              </Button>
            )}
          </Stack>
        </Stack>
      </Alert>
      {resetDialog}
      {voidOpen && (
        <QuickbooksVoidDialog
          record={record}
          onClose={() => setVoidOpen(false)}
          onVoided={onChanged}
        />
      )}
    </>
  )
}
