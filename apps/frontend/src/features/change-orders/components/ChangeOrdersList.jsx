import { useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'

import {
  CatalogEmptyState,
  CatalogPageHeader,
  CatalogSkeletonRows,
  FigureStrip,
  StatusTabs,
  catalogTableSx,
  focusRingSx,
} from '../../../components/common/CatalogPage'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { formatCurrency, formatDate } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { useChangeOrders } from '../hooks/useChangeOrderData.js'
import {
  canEditChangeOrders,
  changeOrderListDate,
  changeOrderStatusTabs,
  filterChangeOrders,
  summarizeChangeOrders,
} from '../services/changeOrderRecord.js'
import ChangeOrderStatusChip from './ChangeOrderStatusChip.jsx'

const COLUMNS = 8

/** Every Extra / Change Order, newest first; a row opens its detail. */
export default function ChangeOrdersList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const canEdit = canEditChangeOrders(profile?.role)
  const { orders, loading, error, reload } = useChangeOrders()

  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  const tabs = useMemo(() => changeOrderStatusTabs(orders), [orders])
  const totals = useMemo(() => summarizeChangeOrders(orders), [orders])
  const filtered = useMemo(
    () => filterChangeOrders(orders, { status, search }),
    [orders, status, search],
  )
  const visible = filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage)

  const changeStatus = (next) => {
    setStatus(next)
    setPage(0)
  }
  const changeSearch = (next) => {
    setSearch(next)
    setPage(0)
  }

  const createAction = canEdit && (
    <ResponsiveCreateButton
      label="New Extra / Change Order"
      onClick={() => navigate('/change-orders/new')}
    />
  )

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        title="Extra / Change Orders"
        subtitle="Extra work asked by a builder, priced lot by lot."
        meta={!loading && !error && orders.length > 0 && (
          <FigureStrip
            label="Extras / Change Orders summary"
            figures={[
              { label: 'Extras / COs', value: totals.count },
              { label: 'Total, without cancelled', value: formatCurrency(totals.total) },
            ]}
          />
        )}
        actions={createAction}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            sx={{
              alignItems: { lg: 'center' },
              justifyContent: 'space-between',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Box sx={{ px: 1, borderBottom: { xs: 1, lg: 0 }, borderColor: 'divider' }}>
              <StatusTabs
                label="Filter Extras / Change Orders by status"
                value={status}
                onChange={changeStatus}
                options={tabs}
              />
            </Box>
            <Box sx={{ p: 1.25 }}>
              <TextField
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                size="small"
                placeholder="Search number, title, builder, job or who requested"
                sx={{ width: { xs: '100%', lg: 380 } }}
                slotProps={{
                  htmlInput: { 'aria-label': 'Search Extras / Change Orders' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label="Clear search"
                          onClick={() => changeSearch('')}
                        >
                          <ClearRoundedIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />
            </Box>
          </Stack>

          {error && (
            <Alert
              severity="error"
              action={<Button color="inherit" size="small" onClick={reload}>Retry</Button>}
              sx={{ borderRadius: 0 }}
            >
              {error}
            </Alert>
          )}

          <TableContainer>
            <Table
              size="small"
              aria-label="Extras / Change Orders"
              aria-busy={loading}
              sx={[{ minWidth: 980 }, catalogTableSx]}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Extra / CO</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Builder</TableCell>
                  <TableCell>Requested by</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Lines</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && <CatalogSkeletonRows columns={COLUMNS} />}
                {!loading && visible.map((order) => (
                  <TableRow
                    key={order.id}
                    hover
                    onClick={() => navigate(`/change-orders/${order.id}`)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Link
                        component={RouterLink}
                        to={`/change-orders/${order.id}`}
                        onClick={(event) => event.stopPropagation()}
                        underline="hover"
                        variant="body2"
                        fontWeight={700}
                        color="text.primary"
                        sx={focusRingSx}
                      >
                        {order.number}
                      </Link>
                      {order.internalNumber && (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {order.internalNumber}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2" fontWeight={500} noWrap title={order.title}>
                        {order.title}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {order.builderName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        #{order.jobCode} · {order.community}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>{order.requestedBy}</Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatDate(changeOrderListDate(order))}
                    </TableCell>
                    <TableCell align="right">{order.lineCount}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {formatCurrency(order.totalAmount)}
                    </TableCell>
                    <TableCell>
                      <ChangeOrderStatusChip status={order.status} />
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && !error && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMNS} sx={{ p: 0 }}>
                      {orders.length === 0 ? (
                        <CatalogEmptyState
                          icon={<ReceiptLongOutlinedIcon color="disabled" sx={{ fontSize: 36 }} />}
                          title="No Extras / Change Orders yet"
                          description="Extra work asked by a builder shows up here once it is created."
                          action={createAction || undefined}
                        />
                      ) : (
                        <CatalogEmptyState
                          title="No Extras / Change Orders match"
                          description="Try another status or other words."
                          action={(
                            <Button
                              size="small"
                              onClick={() => {
                                setStatus('ALL')
                                changeSearch('')
                              }}
                            >
                              Clear filters
                            </Button>
                          )}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filtered.length}
            page={page}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value))
              setPage(0)
            }}
            rowsPerPageOptions={[10, 25, 50]}
            labelRowsPerPage="Rows"
          />
        </Box>
      </Box>
    </Box>
  )
}
