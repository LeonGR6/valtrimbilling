import { useMemo, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

import {
  CatalogEmptyState,
  CatalogPageHeader,
  catalogTableSx,
} from '../../../components/common/CatalogPage'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useChangeOrder } from '../hooks/useChangeOrderData.js'
import { summarizeDetailLines } from '../services/changeOrderRecord.js'
import ChangeOrderActions from './ChangeOrderActions.jsx'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'

const plural = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`

const LIST = { label: 'Extra / Change Orders', to: '/change-orders' }

function DetailItem({ label, children, wide = false }) {
  const empty = children === '' || children == null

  return (
    <Box sx={wide ? { gridColumn: { sm: '1 / -1' } } : undefined}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontWeight={500}
        color={empty ? 'text.disabled' : 'text.primary'}
        sx={{ overflowWrap: 'anywhere' }}
      >
        {empty ? '—' : children}
      </Typography>
    </Box>
  )
}

function DetailsCard({ order }) {
  return (
    <Paper variant="outlined" component="section" aria-label="Details" sx={{ p: { xs: 2, md: 3 }, borderRadius: 2 }}>
      {order.status === 'CANCELLED' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Cancelled on {formatDateTime(order.cancelledAt)}: {order.cancelReason}
        </Alert>
      )}
      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        <DetailItem label="Title" wide>{order.title}</DetailItem>
        <DetailItem label="Internal CO / Extra #">{order.internalNumber}</DetailItem>
        <DetailItem label="Builder">{order.builderName}</DetailItem>
        <DetailItem label="Community">{order.community}</DetailItem>
        <DetailItem label="Job">{order.jobCode ? `#${order.jobCode}` : ''}</DetailItem>
        <DetailItem label="Requested by">{order.requestedBy}</DetailItem>
        <DetailItem label="Request date">{order.requestDate ? formatDate(order.requestDate) : ''}</DetailItem>
        <DetailItem label="Needed by">{order.neededByDate ? formatDate(order.neededByDate) : ''}</DetailItem>
        <DetailItem label="Created">{formatDateTime(order.createdAt)}</DetailItem>
        {order.approvedAt && (
          <DetailItem label="Approved">{formatDateTime(order.approvedAt)}</DetailItem>
        )}
      </Box>
    </Paper>
  )
}

function LinesCard({ order, totals }) {
  return (
    <Paper variant="outlined" component="section" aria-label="Lines" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 2, md: 3 }, pt: 2.5, pb: 1.5 }}>
        <Typography variant="subtitle1" component="h2" fontWeight={700}>
          Scope of Work &amp; Amount
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {[
            totals.lots > 0 && plural(totals.lots, 'lot'),
            totals.places > 0 && `${plural(totals.places, 'line')} without a lot`,
          ].filter(Boolean).join(' · ')}
        </Typography>
      </Box>

      <TableContainer>
        <Table size="small" aria-label="Order lines" sx={[{ minWidth: 900 }, catalogTableSx]}>
          <TableHead>
            <TableRow>
              <TableCell width={48}>#</TableCell>
              <TableCell>Phase</TableCell>
              <TableCell>Building</TableCell>
              <TableCell>Lot / Place</TableCell>
              <TableCell>Plan Type</TableCell>
              <TableCell sx={{ minWidth: 260 }}>Scope of Work</TableCell>
              <TableCell>PO</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {order.lines.map((line) => (
              <TableRow key={line.id} hover>
                <TableCell>{line.lineNumber}</TableCell>
                <TableCell>{line.phase || '—'}</TableCell>
                <TableCell>{line.building || '—'}</TableCell>
                <TableCell>
                  {line.isPlace ? (
                    <>
                      <Typography variant="body2" fontWeight={600}>{line.location}</Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        No lot
                      </Typography>
                    </>
                  ) : line.lot}
                </TableCell>
                <TableCell>{line.plan ? `Plan ${line.plan}` : '—'}</TableCell>
                <TableCell sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{line.scope}</TableCell>
                <TableCell>{line.poNumber || '—'}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {formatCurrency(line.amount)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={7} align="right" sx={{ fontWeight: 700 }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                {formatCurrency(totals.total)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

function HistoryCard({ history }) {
  // Newest first: what the Extra / CO is now comes first.
  const steps = [...history].reverse()

  return (
    <Paper variant="outlined" component="section" aria-label="Status history" sx={{ p: 2.5, borderRadius: 2 }}>
      <Typography variant="subtitle1" component="h2" fontWeight={700} sx={{ mb: 1.5 }}>
        Status history
      </Typography>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {steps.map((step) => (
          <Box
            component="li"
            key={step.id}
            sx={{ py: 1.25, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <ChangeOrderStatusChip status={step.to} />
              <Typography variant="caption" color="text.secondary">
                {formatDateTime(step.changedAt)}
              </Typography>
            </Stack>
            {step.note && (
              <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                {step.note}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  )
}

function TotalCard({ totals }) {
  return (
    <Paper variant="outlined" component="section" aria-label="Total" sx={{ p: 2.5, borderRadius: 2 }}>
      <Typography variant="body2" color="text.secondary">Total Amount</Typography>
      <Typography
        variant="h5"
        component="p"
        fontWeight={800}
        sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.25 }}
      >
        {formatCurrency(totals.total)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {[
          totals.lots > 0 && plural(totals.lots, 'lot'),
          totals.places > 0 && `${plural(totals.places, 'line')} without a lot`,
        ].filter(Boolean).join(' · ')}
      </Typography>
    </Paper>
  )
}

/** One Extra / Change Order: who asked, what it covers lot by lot, what it adds up to and how it got here. */
export default function ChangeOrderDetail() {
  const { changeOrderId } = useParams()
  const { order, loading, error, reload, refresh } = useChangeOrder(changeOrderId)
  // What went wrong with a move made from a button (someone else may have moved it first).
  const [actionError, setActionError] = useState('')
  const totals = useMemo(() => summarizeDetailLines(order?.lines ?? []), [order])

  if (loading) {
    return (
      <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }} aria-busy="true">
        <CatalogPageHeader breadcrumbs={[LIST, { label: 'Loading…' }]} title="Extra / Change Order" />
        <Box sx={{ p: { xs: 2.5, md: 4 } }}>
          <Skeleton variant="rounded" height={160} sx={{ mb: 3 }} />
          <Skeleton variant="rounded" height={260} />
        </Box>
      </Box>
    )
  }

  if (error || !order) {
    return (
      <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
        <CatalogPageHeader breadcrumbs={[LIST, { label: 'Not available' }]} title="Extra / Change Order" />
        <Box sx={{ p: { xs: 2.5, md: 4 } }}>
          {error ? (
            <Alert
              severity="error"
              action={<Button color="inherit" size="small" onClick={reload}>Retry</Button>}
            >
              {error}
            </Alert>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: 2 }}>
              <CatalogEmptyState
                title="This Extra / Change Order does not exist"
                description="It may have been opened from an old link."
                action={(
                  <Button component={RouterLink} to="/change-orders" variant="outlined" size="small">
                    Back to Extras / Change Orders
                  </Button>
                )}
              />
            </Paper>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        breadcrumbs={[LIST, { label: order.number }]}
        title={order.number}
        titleAdornment={<ChangeOrderStatusChip status={order.status} />}
        subtitle={order.title}
        actions={<ChangeOrderActions order={order} onChanged={refresh} onError={setActionError} />}
      />

      <Box
        sx={{
          p: { xs: 2.5, md: 4 },
          display: 'grid',
          gap: 3,
          alignItems: 'start',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 320px' },
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          {actionError && (
            <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>
          )}
          <DetailsCard order={order} />
          <LinesCard order={order} totals={totals} />
        </Stack>

        <Stack spacing={3} sx={{ position: { lg: 'sticky' }, top: { lg: 24 } }}>
          <TotalCard totals={totals} />
          <HistoryCard history={order.history} />
        </Stack>
      </Box>
    </Box>
  )
}
