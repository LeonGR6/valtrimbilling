import { useNavigate } from 'react-router-dom'
import { jobDrawInvoicePath } from '../../../jobs/utils/jobRoutes.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import { AGING_BUCKETS } from '../../utils/receivablesAging.js'

/** Amounts are held in cents; this is what a person reads. */
export function formatCents(cents) {
  return formatCurrency(cents / 100)
}

// Older money reads warmer: Current is calm, 91 & over is the loudest.
export const BUCKET_COLORS = {
  CURRENT: 'success.main',
  DAYS_1_30: 'info.main',
  DAYS_31_60: 'warning.main',
  DAYS_61_90: 'error.main',
  DAYS_91_PLUS: 'error.dark',
}

export const BUCKET_SHORT_LABELS = Object.fromEntries(
  AGING_BUCKETS.map(({ key, short }) => [key, short]),
)

export const tableHeadRowSx = {
  bgcolor: 'sidebar.bg',
  '& .MuiTableCell-root': {
    color: 'text.secondary',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
}

export const tableSx = {
  tableLayout: 'fixed',
  '& .MuiTableCell-root': { px: 1.5, py: 1.1, verticalAlign: 'middle' },
  '& .MuiTableCell-head': { py: 0.9 },
  '& tbody tr:last-of-type .MuiTableCell-root': { borderBottom: 0 },
}

/** The days past due, in words a person scans: how late, or when it falls due. */
export function describeDaysPastDue(days) {
  if (days == null) return 'No due date'
  if (days > 0) return days === 1 ? '1 day late' : `${days} days late`
  if (days === 0) return 'Due today'
  return days === -1 ? 'Due tomorrow' : `Due in ${-days} days`
}

/** The direction a column sorts in the first time it is chosen: text A–Z, amounts largest first. */
export function nextSort(current, key, firstDirection) {
  if (current?.key !== key) return { key, direction: firstDirection }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

/** The page of the Package this invoice belongs to. */
export function invoicePath(invoice) {
  return jobDrawInvoicePath(invoice.builderId, invoice.jobId, invoice.phaseId, invoice.packageId)
}

/**
 * The click handler that opens an invoice's Package from anywhere on its row. The
 * invoice number is a real link too, so a keyboard or a new tab still works: a click
 * on it (or on any button in the row) is left to it, and so is a click that
 * only selects text.
 */
export function useOpenInvoice() {
  const navigate = useNavigate()

  return (invoice) => (event) => {
    if (event.target.closest('a, button')) return
    if (window.getSelection()?.toString()) return
    navigate(invoicePath(invoice))
  }
}

export const clickableRowSx = { cursor: 'pointer' }
