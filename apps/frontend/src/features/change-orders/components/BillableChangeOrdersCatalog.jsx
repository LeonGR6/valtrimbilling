import { Fragment, useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Collapse,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

import { catalogTableSx } from '../../../components/common/CatalogPage'
import { usePersistentState } from '../../../hooks/usePersistentState.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { DRAW_INVOICE_ROLES, canWork } from '../../auth/authorization/roleAccess.js'
import { formatCurrency } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useJobs } from '../../jobs/context/useJobs.js'
import { jobDrawInvoicePath } from '../../jobs/utils/jobRoutes.js'
import { useBillableChangeOrders } from '../hooks/useChangeOrderData.js'
import {
  BILLABLE_TABS,
  billableTabs,
  filterBillableOrders,
  invoiceProblem,
  invoiceStateOf,
  summarizeToInvoice,
} from '../utils/packageOrders.js'
import ChangeOrderLinesTable from './ChangeOrderLinesTable.jsx'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'

const money = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const COLUMNS = 9
const WORKFLOW_LABELS = {
  DRAFT: 'Draft',
  READY_TO_SUBMIT: 'Ready to submit',
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID_CLOSED: 'Paid / Closed',
}

/**
 * The "Change Orders" tab of Draw & Invoice: every approved (or cancelled) Extra / CO, with the Package that
 * invoices it. A row opens the Extra / CO; "Create invoice" opens it with its invoice preview, where the
 * invoice is created and sent to QuickBooks. Those made from a Package (a Lot of a Plan with an approved
 * Extra / CO billed later) say where they came from. The arrow shows the lines without leaving the list.
 */
export default function BillableChangeOrdersCatalog() {
  const { orders, loading, error, reload } = useBillableChangeOrders()
  const { profile } = useAuth()
  const { jobs } = useJobs()
  const navigate = useNavigate()
  const canInvoice = canWork(profile?.role, DRAW_INVOICE_ROLES)
  const [search, setSearch] = useState('')
  const [tab, setTab] = usePersistentState(
    'draw-invoice:change-orders:tab',
    'TO_INVOICE',
    (value) => BILLABLE_TABS.some((item) => item.value === value),
  )
  const [open, setOpen] = useState(() => new Set())

  const tabs = useMemo(() => billableTabs(orders), [orders])
  const visible = useMemo(() => filterBillableOrders(orders, { tab, search }), [orders, tab, search])
  const pending = useMemo(() => summarizeToInvoice(orders), [orders])

  // A Package opens on one of its Phases; one of an Extra / CO may have none, so the first Phase of the Job.
  const packagePath = (order, packageId, phaseId) => {
    const job = jobs.find((item) => String(item.id) === String(order.jobId))
    const phase = phaseId ?? job?.sequenceSheet?.phases?.[0]?.id ?? null
    return phase == null ? '' : jobDrawInvoicePath(order.builderId, order.jobId, phase, packageId)
  }

  const toggle = (id) => setOpen((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })

  const openOrder = (order, state) => navigate(`/change-orders/${order.id}`, state ? { state } : undefined)

  return (
    <Stack spacing={1.5} sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 820 }}>
        Every approved Extra / CO is invoiced on a Package of its own, sent to QuickBooks like any other Package,
        one line for each piece of work. Those marked "From package" were made by a Package that billed a Lot of
        a Plan with an approved Extra / CO.
      </Typography>

      {error && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={reload}>Retry</Button>}>
          {error}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        useFlexGap
        sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}
      >
        <TextField
          size="small"
          placeholder="Search CO, PO / CO #, Package, Builder or Job..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ flex: { md: '0 1 420px' } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment>
              ),
            },
            htmlInput: { 'aria-label': 'Search Extras / Change Orders' },
          }}
        />
        <Typography variant="body2" sx={{ ml: { md: 'auto' } }}>
          To invoice: {pending.count} {pending.count === 1 ? 'Extra / CO' : 'Extras / COs'} ·{' '}
          <Box component="strong" sx={money}>{formatCurrency(pending.total)}</Box>
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value)}
          aria-label="Invoice"
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ px: 1, borderBottom: 1, borderColor: 'divider', minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}
        >
          {tabs.map((item) => (
            <Tab key={item.value} value={item.value} label={`${item.label} (${item.count})`} />
          ))}
        </Tabs>

        {loading ? (
          <Box sx={{ p: 2 }}>
            <Skeleton variant="rounded" height={44} sx={{ mb: 1 }} />
            <Skeleton variant="rounded" height={44} sx={{ mb: 1 }} />
            <Skeleton variant="rounded" height={44} />
          </Box>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Extras / Change Orders to invoice" sx={[{ minWidth: 1040 }, catalogTableSx]}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Extra / CO</TableCell>
                  <TableCell>From</TableCell>
                  <TableCell>Builder · Job</TableCell>
                  <TableCell align="right">Lines</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Invoice</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMNS}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                        {orders.length === 0 ? 'No Extra / CO has been approved yet.' : 'Nothing here matches.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {visible.map((order) => {
                  const expanded = open.has(order.id)
                  const problem = invoiceProblem(order)
                  const sourcePath = order.sourcePackageId
                    ? packagePath(order, order.sourcePackageId, order.sourcePackagePhaseId)
                    : ''
                  const invoicePath = order.invoicePackageId
                    ? packagePath(order, order.invoicePackageId, order.invoicePackagePhaseId)
                    : ''

                  return (
                    <Fragment key={order.id}>
                      <TableRow
                        hover
                        onClick={() => openOrder(order)}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell padding="checkbox">
                          <IconButton
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation()
                              toggle(order.id)
                            }}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} the lines of ${order.number}`}
                          >
                            {expanded
                              ? <KeyboardArrowDownRoundedIcon fontSize="small" />
                              : <KeyboardArrowRightRoundedIcon fontSize="small" />}
                          </IconButton>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <Link onClick={(event) => event.stopPropagation()} component={RouterLink} to={`/change-orders/${order.id}`} fontWeight={700} underline="hover">
                            {order.number}
                          </Link>
                          {order.poCoNumber && (
                            <Typography variant="caption" color="text.secondary" component="div">
                              PO / CO # {order.poCoNumber}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {order.fromPackage ? (
                            <>
                              <Typography variant="caption" color="primary.main" fontWeight={700} component="div">
                                From package
                              </Typography>
                              <Typography variant="body2" component="div">
                                {order.sourceChangeOrderId ? (
                                  <Link onClick={(event) => event.stopPropagation()} component={RouterLink} to={`/change-orders/${order.sourceChangeOrderId}`} underline="hover">
                                    {order.sourceNumber}
                                  </Link>
                                ) : order.sourceNumber}
                                {' · '}
                                {sourcePath ? (
                                  <Link onClick={(event) => event.stopPropagation()} component={RouterLink} to={sourcePath} underline="hover">{order.sourcePackageNumber}</Link>
                                ) : order.sourcePackageNumber}
                              </Typography>
                            </>
                          ) : (
                            <Typography variant="body2" color="text.secondary">Written by hand</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 240 }}>
                          <Typography variant="body2" noWrap title={order.builderName}>{order.builderName}</Typography>
                          <Typography variant="caption" color="text.secondary" component="div" noWrap>
                            {[order.jobCode && `#${order.jobCode}`, order.community].filter(Boolean).join(' · ')}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={money}>{order.lineCount}</TableCell>
                        <TableCell align="right" sx={{ ...money, fontWeight: 700 }}>{formatCurrency(order.totalAmount)}</TableCell>
                        <TableCell><ChangeOrderStatusChip status={order.status} /></TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {order.invoicePackageId ? (
                            <>
                              {invoicePath ? (
                                <Link onClick={(event) => event.stopPropagation()} component={RouterLink} to={invoicePath} fontWeight={700} underline="hover">
                                  {order.invoicePackageNumber}
                                </Link>
                              ) : order.invoicePackageNumber}
                              <Typography variant="caption" color="text.secondary" component="div">
                                {WORKFLOW_LABELS[order.invoiceWorkflowStatus] ?? order.invoiceWorkflowStatus}
                              </Typography>
                            </>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              {invoiceStateOf(order) === 'CANCELLED' ? '—' : 'Not invoiced'}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {canInvoice && invoiceStateOf(order) === 'TO_INVOICE' && (
                            <Tooltip title={problem}>
                              {/* A disabled button gives no hover: the span carries the reason. */}
                              <span>
                                <Button
                                  size="small"
                                  variant="contained"
                                  disableElevation
                                  disabled={Boolean(problem)}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openOrder(order, { openInvoice: true })
                                  }}
                                  sx={{ whiteSpace: 'nowrap' }}
                                >
                                  Create invoice
                                </Button>
                              </span>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={COLUMNS} sx={{ p: 0, borderBottom: expanded ? undefined : 0 }}>
                          <Collapse in={expanded} unmountOnExit>
                            <Box sx={{ px: { xs: 2, md: 6 }, py: 1.5, bgcolor: 'action.hover', overflowX: 'auto' }}>
                              <ChangeOrderLinesTable changeOrderId={order.id} number={order.number} />
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

    </Stack>
  )
}
