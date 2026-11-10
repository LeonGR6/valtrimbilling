import { lazy, Suspense, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

import { useAuth } from '../../auth/context/useAuth.js'
import { DRAW_INVOICE_ROLES, canOpenPage, canWork } from '../../auth/authorization/roleAccess.js'
import QuickbooksStatusCard from '../../draw-invoice/components/shared/QuickbooksStatusCard.jsx'
import { useDrawInvoicePackages } from '../../draw-invoice/context/useDrawInvoicePackages.js'
import { useQuickbooksInvoiceSync } from '../../draw-invoice/hooks/useQuickbooksInvoiceSync.js'
import { canCreateQuickbooksInvoice, quickbooksPackageStatusView } from '../../draw-invoice/services/quickbooksRecord.js'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { jobDrawInvoicePath } from '../../jobs/utils/jobRoutes.js'
import { createChangeOrderPackage } from '../services/changeOrderRepository.js'
import { changeOrderInvoiceLines, invoiceLinesTotal } from '../utils/invoiceLines.js'
import { invoiceProblem } from '../utils/packageOrders.js'

const QuickbooksInvoiceDialog = lazy(() => import('../../draw-invoice/components/detail/QuickbooksInvoiceDialog.jsx'))

const money = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

/**
 * The QuickBooks button of an Extra / CO, in its header, like the one of a Package: the state of its invoice
 * in QuickBooks. A click opens the preview of the invoice (the same lines and wording it is sent with) and
 * what can be done from there: create the invoice (Admin, Accounting, Draw & Invoice), which makes the
 * Package of the Extra / CO and opens the QuickBooks window of Packages to send it; send it, when its Package
 * was not sent yet; or open it in QuickBooks once it exists there.
 */
export default function ChangeOrderInvoiceButton({ order, onChanged, startOpen = false }) {
  const { profile } = useAuth()
  const { jobs } = useJobs()
  const { drawInvoicePackages, refreshDrawInvoicePackages } = useDrawInvoicePackages()
  const canInvoice = canWork(profile?.role, DRAW_INVOICE_ROLES)
  const canOpenPackages = canOpenPage(profile?.role, 'drawInvoice')

  // Opened from Draw & Invoice › Change Orders with "Create invoice", the page starts with the preview open.
  const [previewOpen, setPreviewOpen] = useState(startOpen)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [sending, setSending] = useState(null)
  const [syncKey, setSyncKey] = useState(0)

  const record = order.invoicePackageId
    ? drawInvoicePackages.find((item) => item.id === order.invoicePackageId) ?? null
    : null
  const sync = useQuickbooksInvoiceSync(record, syncKey)
  const lines = useMemo(
    () => changeOrderInvoiceLines(order.lines, { poCoNumber: order.poCoNumber }),
    [order.lines, order.poCoNumber],
  )
  const total = invoiceLinesTotal(lines)
  const problem = invoiceProblem(order)
  const canSend = record ? canCreateQuickbooksInvoice(record, profile?.role) : false

  if (order.status === 'CANCELLED' && !order.invoicePackageId) return null

  // The state shown on the button: the one of its Package once it has one, as on the Package itself.
  const packageView = record ? quickbooksPackageStatusView({ record, sync, canSend }) : null
  const view = packageView ?? (order.invoicePackageId
    ? { tone: 'neutral', status: 'Not sent', detail: `Package ${order.invoicePackageNumber} · Click to see it` }
    : {
      tone: 'neutral',
      status: 'Not invoiced',
      detail: order.status === 'APPROVED' ? `${formatCurrency(total)} · Click to see the invoice` : 'Click to see the invoice',
    })
  // Whatever the state, the click shows the invoice: the button of a Package opens QuickBooks, this one the preview.
  const detail = packageView?.action === 'send' ? `${formatCurrency(total)} · Click to see the invoice` : view.detail

  const packagePath = () => {
    if (!record) return ''
    const job = jobs.find((item) => String(item.id) === String(order.jobId))
    const phase = record.phaseId ?? job?.sequenceSheet?.phases?.[0]?.id ?? null
    return phase == null ? '' : jobDrawInvoicePath(order.builderId, order.jobId, phase, record.id)
  }

  const createInvoice = async () => {
    setCreating(true)
    setCreateError('')
    try {
      const packageId = await createChangeOrderPackage(order.id)
      const packages = await refreshDrawInvoicePackages()
      await onChanged?.()
      const created = packages?.find((item) => item.id === packageId)
      setPreviewOpen(false)
      // The QuickBooks window opens on the new Package: invoice number, date, the real preview, and send.
      if (created && canCreateQuickbooksInvoice(created, profile?.role)) setSending(created)
    } catch (failure) {
      setCreateError(failure.message)
    } finally {
      setCreating(false)
    }
  }

  const settled = async () => {
    await refreshDrawInvoicePackages().catch(() => {})
    setSyncKey((value) => value + 1)
    await onChanged?.()
  }

  const path = packagePath()

  return (
    <>
      <QuickbooksStatusCard
        compact
        tone={view.tone}
        status={view.status}
        detail={detail}
        title="See the invoice"
        onClick={() => {
          setCreateError('')
          setPreviewOpen(true)
        }}
      />

      <Dialog open={previewOpen} onClose={() => !creating && setPreviewOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>
          {order.invoicePackageId ? `Invoice of ${order.number}` : `Invoice preview of ${order.number}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {order.invoicePackageId ? (
              <Typography variant="body2" color="text.secondary">
                Invoiced on Package{' '}
                {path && canOpenPackages ? (
                  <Link component={RouterLink} to={path} fontWeight={700}>{order.invoicePackageNumber}</Link>
                ) : (
                  <Box component="strong">{order.invoicePackageNumber}</Box>
                )}
                {record?.invoiceNumber ? ` · Invoice ${record.invoiceNumber}` : ''}
                {packageView ? ` · QuickBooks: ${packageView.status}` : ''}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {order.status === 'APPROVED'
                  ? 'Not invoiced yet. This is what the invoice will say in QuickBooks.'
                  : 'It can be invoiced once it is approved. This is what the invoice will say in QuickBooks.'}
              </Typography>
            )}
            {!order.invoicePackageId && order.status === 'APPROVED' && problem && <Alert severity="info">{problem}</Alert>}
            {!order.invoicePackageId && order.status === 'APPROVED' && !canInvoice && !problem && (
              <Alert severity="info">
                Admin, Accounting or Draw & Invoice create the invoice, here or in Draw & Invoice › Change Orders.
              </Alert>
            )}
            {createError && <Alert severity="error">{createError}</Alert>}

            {/* What QuickBooks receives: the Builder's customer, Job Name and Job #, one Product, no Retention or WRAP. */}
            <Box component="dl" sx={{ m: 0, display: 'flex', flexWrap: 'wrap', columnGap: 4, rowGap: 1 }}>
              {[
                ['Customer', order.builderName],
                ['Job Name', order.community || 'Not set'],
                ['Job #', order.jobCode || 'Not set'],
                ['Product / Service', 'Material Installation & Supply'],
                ['Retention / WRAP', 'None'],
              ].map(([label, value]) => (
                <Box key={label} sx={{ minWidth: 0 }}>
                  <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
                  <Typography component="dd" variant="body2" fontWeight={600} sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
                </Box>
              ))}
            </Box>

            {/* On a phone each line is a block with its amount in view; from sm, the table QuickBooks shows. */}
            <Box component="ul" aria-label="Invoice lines" sx={{ display: { xs: 'block', sm: 'none' }, m: 0, p: 0, listStyle: 'none', border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
              {lines.map((line, index) => (
                <Box component="li" key={`${index}-${line.description}`} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{line.description}</Typography>
                  <Typography variant="body2" fontWeight={700} sx={{ ...money, mt: 0.5, color: line.amount < 0 ? 'error.main' : undefined }}>
                    1 × {formatCurrency(line.amount)}
                  </Typography>
                </Box>
              ))}
              <Box component="li" sx={{ px: 1.5, py: 1, display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" fontWeight={800}>Total</Typography>
                <Typography variant="body2" fontWeight={800} sx={money}>{formatCurrency(total)}</Typography>
              </Box>
            </Box>

            <TableContainer sx={{ display: { xs: 'none', sm: 'block' }, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
              <Table size="small" aria-label="Invoice lines" sx={{ minWidth: 620 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Description</TableCell>
                    <TableCell align="right" sx={{ width: 60 }}>Qty</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>Rate</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((line, index) => (
                    <TableRow key={`${index}-${line.description}`}>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>{line.description}</TableCell>
                      <TableCell align="right" sx={money}>1</TableCell>
                      <TableCell align="right" sx={money}>{formatCurrency(line.amount)}</TableCell>
                      <TableCell align="right" sx={{ ...money, color: line.amount < 0 ? 'error.main' : undefined }}>
                        {formatCurrency(line.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} sx={{ fontWeight: 800 }}>Total</TableCell>
                    <TableCell align="right" sx={{ ...money, fontWeight: 800 }}>{formatCurrency(total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {!order.invoicePackageId && order.status === 'APPROVED' && canInvoice && !problem && (
              <Typography variant="body2" color="text.secondary">
                "Create invoice" makes its Package, with no Retention or WRAP, and opens the QuickBooks window: there you
                choose the invoice number and date, see the invoice as QuickBooks will get it, and send it.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setPreviewOpen(false)} disabled={creating}>Close</Button>
          {packageView?.href && (
            <Button href={packageView.href} target="_blank" rel="noopener noreferrer">Open in QuickBooks</Button>
          )}
          {record && canSend && (
            <Button
              variant="contained"
              disableElevation
              onClick={() => {
                setPreviewOpen(false)
                setSending(record)
              }}
            >
              Send to QuickBooks
            </Button>
          )}
          {!order.invoicePackageId && order.status === 'APPROVED' && canInvoice && (
            <Button variant="contained" disableElevation onClick={createInvoice} disabled={creating || Boolean(problem)}>
              {creating ? 'Creating…' : 'Create invoice'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {sending && (
        <Suspense fallback={null}>
          <QuickbooksInvoiceDialog record={sending} onClose={() => setSending(null)} onSettled={settled} />
        </Suspense>
      )}
    </>
  )
}
