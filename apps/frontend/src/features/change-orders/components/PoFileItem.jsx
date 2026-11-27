import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'

import { formatFileSize } from '../../draw-invoice/components/documents/jobDocumentTypes.js'
import { formatCurrency, formatDate, formatDateTime } from '../../draw-invoice/utils/drawInvoiceFormatters.js'
import { describeOrderLots, readStatusLabel } from '../services/changeOrderPoFileRecord.js'

const lotsLabel = (lots) => (lots.length === 0 ? '' : lots.length === 1 ? `Lot ${lots[0]}` : `${lots.length} Lots`)

const statusColor = { READ: 'success', FAILED: 'error', READING: 'info', UNREAD: 'default' }

/** The Extras / COs whose Lots this order backs: each a link to it, amber when only the Lots agree. */
function BackedChangeOrders({ items }) {
  if (items.length === 0) {
    return <Typography variant="body2" color="text.disabled">None yet</Typography>
  }
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {items.map((item) => (
        <Tooltip
          key={item.changeOrderId}
          title={`${item.lots.length > 0 ? `Lots ${item.lots.join(', ')}` : 'A line with no Lot'}${item.level === 'LOT' ? ' · only the Lots match: check the amounts' : ''}`}
        >
          <Chip
            size="small"
            variant="outlined"
            clickable
            component={RouterLink}
            to={`/change-orders/${item.changeOrderId}`}
            onClick={(event) => event.stopPropagation()}
            color={item.level === 'LOT' ? 'warning' : 'success'}
            label={[item.number, lotsLabel(item.lots)].filter(Boolean).join(' · ')}
          />
        </Tooltip>
      ))}
    </Stack>
  )
}

/** One order read from the PDF: its number, kind, Lots and amount, and what could not be checked. */
function OrderRow({ order, changeOrders = [] }) {
  const [open, setOpen] = useState(false)
  const hasWarnings = order.warnings.length > 0
  return (
    <>
      <TableRow hover onClick={() => setOpen(!open)} sx={{ cursor: 'pointer', '& > td': { borderBottom: open ? 0 : undefined } }}>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>
          <Typography variant="body2" fontWeight={700}>
            {order.number || <Typography component="span" variant="body2" color="text.disabled">No number</Typography>}
          </Typography>
          <Typography variant="caption" color="text.secondary">{order.kindLabel}</Typography>
        </TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>{order.issuedDate ? formatDate(order.issuedDate) : '—'}</TableCell>
        <TableCell sx={{ maxWidth: 240 }}>
          <Typography variant="body2" noWrap title={describeOrderLots(order)}>{describeOrderLots(order)}</Typography>
        </TableCell>
        <TableCell sx={{ maxWidth: 320 }}>
          <Typography variant="body2" noWrap title={order.description}>{order.description || '—'}</Typography>
        </TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
          {order.total === null ? '—' : formatCurrency(order.total)}
          {order.netTotal !== null && (
            <Typography variant="caption" color="text.secondary" component="div">
              net {formatCurrency(order.netTotal)}
            </Typography>
          )}
        </TableCell>
        <TableCell sx={{ minWidth: 140 }}>
          <BackedChangeOrders items={changeOrders} />
        </TableCell>
        <TableCell align="right" sx={{ width: 72, whiteSpace: 'nowrap' }}>
          {hasWarnings && (
            <Tooltip title={`${order.warnings.length} to check`}>
              <WarningAmberRoundedIcon color="warning" fontSize="small" sx={{ verticalAlign: 'middle' }} />
            </Tooltip>
          )}
          <ExpandMoreRoundedIcon
            fontSize="small"
            sx={{ verticalAlign: 'middle', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
          />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ py: 0, bgcolor: 'action.hover' }}>
          <Collapse in={open} unmountOnExit>
            <Stack spacing={1.25} sx={{ py: 1.5 }}>
              {hasWarnings && (
                <Alert severity="warning" sx={{ py: 0 }}>
                  {order.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                </Alert>
              )}
              <Typography variant="caption" color="text.secondary">
                {[
                  order.builder,
                  order.project,
                  order.pages.length > 0 && `page${order.pages.length === 1 ? '' : 's'} ${order.pages.join(', ')}`,
                  ...order.otherNumbers.map((item) => `${item.label} ${item.value}`),
                ].filter(Boolean).join(' · ')}
              </Typography>
              {order.lines.length > 0 && (
                <Table size="small" aria-label={`Lines of ${order.number || 'the order'}`}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Lots</TableCell>
                      <TableCell>Phase / Plan</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {order.lines.map((line) => (
                      <TableRow key={line.lineNumber}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {line.lots.length > 0 ? line.lots.join(', ') : '—'}
                          {line.lots.length > 0 && !line.lotsChecked && (
                            <Tooltip title="Not found printed in the PDF">
                              <WarningAmberRoundedIcon color="warning" sx={{ fontSize: 16, ml: 0.5, verticalAlign: 'text-bottom' }} />
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>{[line.building, line.phase, line.plan].filter(Boolean).join(' · ') || '—'}</TableCell>
                        <TableCell>{line.description || '—'}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          {line.amount === null ? '—' : formatCurrency(line.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  )
}

/** A Purchase Order PDF of a Job: open, read, delete, and the orders read from it. */
export default function PoFileItem({ file, orders = [], changeOrdersByOrder = {}, reading, readError, canManage, opening, onOpen, onRead, onDelete }) {
  const status = reading ? 'READING' : file.readStatus
  const error = readError || (file.readStatus === 'FAILED' ? file.readError : '')
  const keptAfterError = !readError && file.readStatus === 'READ' && file.readError

  return (
    <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 1.25, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <PictureAsPdfRoundedIcon color="error" fontSize="small" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={600} noWrap title={file.name}>{file.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {formatFileSize(file.sizeBytes)} · uploaded {formatDateTime(file.createdAt)}
            {file.ocrPages.length > 0 && ` · scanned page${file.ocrPages.length === 1 ? '' : 's'} read with OCR`}
          </Typography>
        </Box>
        <Chip
          size="small"
          color={statusColor[status] ?? 'default'}
          variant={status === 'READ' ? 'outlined' : 'filled'}
          icon={status === 'READING' ? <CircularProgress size={12} color="inherit" /> : undefined}
          label={readStatusLabel({ readStatus: status }, orders.length)}
        />
        {canManage && (
          <Tooltip title={file.readStatus === 'UNREAD' ? 'Read the orders in this PDF with AI' : 'Read this PDF again'}>
            <span>
              <Button
                size="small"
                startIcon={<AutoAwesomeRoundedIcon />}
                onClick={onRead}
                disabled={reading}
              >
                {file.readStatus === 'UNREAD' ? 'Read' : 'Read again'}
              </Button>
            </span>
          </Tooltip>
        )}
        <Tooltip title="Open PDF">
          <span>
            <IconButton aria-label={`Open ${file.name}`} onClick={onOpen} disabled={opening}>
              <OpenInNewRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {canManage && (
          <Tooltip title="Delete PDF">
            <span>
              <IconButton aria-label={`Delete ${file.name}`} onClick={onDelete} disabled={reading}>
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mt: 1, py: 0 }}>{error}</Alert>}
      {keptAfterError && (
        <Alert severity="info" sx={{ mt: 1, py: 0 }}>
          The last reading failed ({file.readError}); the orders below are from the reading before.
        </Alert>
      )}

      {orders.length > 0 && (
        // On a narrow screen the orders scroll sideways inside the PDF's row instead of leaving the card.
        <Box sx={{ mt: 1, overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 760 }} aria-label={`Orders read from ${file.name}`}>
          <TableHead>
            <TableRow>
              <TableCell>Number</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Lots</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell>Extras / COs</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} changeOrders={changeOrdersByOrder[String(order.id)] ?? []} />
            ))}
          </TableBody>
        </Table>
        </Box>
      )}
    </Box>
  )
}
