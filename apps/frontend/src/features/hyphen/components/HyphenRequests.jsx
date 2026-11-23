import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import MoveToInboxRoundedIcon from '@mui/icons-material/MoveToInboxRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  isSpconnectUatConfigured,
  listSpconnectMessages,
} from '../services/spconnectMessagesRepository.js'
import {
  listSpconnectLines,
  listSpconnectOptions,
  matchesSpconnectSearch,
  summarizeSpconnectMessage,
} from '../utils/spconnectMessage.js'

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'medium',
})

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function formatDateTime(value) {
  return value ? dateTimeFormatter.format(new Date(value)) : '—'
}

function formatCurrency(value) {
  return value === null ? '—' : currencyFormatter.format(value)
}

function joinParts(parts, separator = ' · ') {
  const text = parts.filter(Boolean).join(separator)
  return text || '—'
}

const headerRowSx = {
  bgcolor: 'sidebar.bg',
  '& .MuiTableCell-root': {
    color: 'text.secondary',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
}

function KindChip({ summary }) {
  if (summary.kind === 'CHANGE_ORDER') {
    return (
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        label={summary.changeOrderNumber ? `Change Order ${summary.changeOrderNumber}` : 'Change Order'}
      />
    )
  }
  return <Chip size="small" color="primary" variant="outlined" label="Order" />
}

function DetailField({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" color="text.primary" sx={{ overflowWrap: 'anywhere' }}>
        {value ?? '—'}
      </Typography>
    </Box>
  )
}

function SectionTitle({ children }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ display: 'block', fontWeight: 700, mt: 3, mb: 1 }}
    >
      {children}
    </Typography>
  )
}

function MessageDetailsDrawer({ row, onClose }) {
  const [copiedRow, setCopiedRow] = useState(null)
  const copied = Boolean(row) && copiedRow === row
  const summary = row ? summarizeSpconnectMessage(row) : null
  const lines = row ? listSpconnectLines(row.payload) : []
  const options = row ? listSpconnectOptions(row.payload) : []

  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(row.payload, null, 2))
      setCopiedRow(row)
    } catch {
      setCopiedRow(null)
    }
  }

  return (
    <Drawer
      anchor="right"
      open={Boolean(row)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', md: 760 } } } }}
    >
      {summary && (
        <Box sx={{ p: { xs: 2.5, md: 3 } }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <KindChip summary={summary} />
                {summary.environment && <Chip size="small" label={summary.environment} />}
              </Stack>
              <Typography variant="h6" fontWeight={700}>
                {summary.poNumber ? `PO ${summary.poNumber}` : `Order ${summary.orderId ?? '—'}`}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Received {formatDateTime(summary.receivedAt)}
              </Typography>
            </Box>
            <IconButton aria-label="Close request details" onClick={onClose}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          <SectionTitle>Order</SectionTitle>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' } }}>
            <DetailField label="Hyphen order ID" value={summary.orderId} />
            <DetailField label="Builder PO" value={summary.poNumber} />
            <DetailField label="Account" value={summary.accountNumber} />
            <DetailField label="Order type" value={summary.orderType} />
            <DetailField label="Purpose" value={summary.purpose} />
            <DetailField label="Issued" value={summary.issuedAt} />
            {summary.kind === 'CHANGE_ORDER' && (
              <>
                <DetailField label="Change type" value={summary.changeType} />
                <DetailField label="Change order" value={summary.changeOrderNumber} />
                <DetailField label="Sequence" value={summary.changeOrderSequence} />
              </>
            )}
            <DetailField label="Work start" value={summary.workStart} />
            <DetailField label="Work end" value={summary.workEnd} />
            <DetailField label="Order total" value={formatCurrency(summary.orderTotal)} />
          </Box>

          <SectionTitle>House</SectionTitle>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' } }}>
            <DetailField label="Builder" value={summary.builderName} />
            <DetailField label="Community" value={joinParts([summary.community, summary.city])} />
            <DetailField label="Phase" value={summary.phase} />
            <DetailField label="Lot" value={joinParts([summary.lot, summary.block && `Block ${summary.block}`])} />
            <DetailField label="Plan" value={joinParts([summary.plan, summary.elevation, summary.swing && `Swing ${summary.swing}`])} />
            <DetailField label="Address" value={summary.address} />
            <DetailField label="Task" value={summary.taskName} />
          </Box>

          <SectionTitle>{`Lines (${lines.length})`}</SectionTitle>
          <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={headerRowSx}>
                  <TableCell>Line</TableCell>
                  <TableCell>Description and options</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.key} sx={{ verticalAlign: 'top' }}>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {line.lineNumber ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{line.description ?? '—'}</Typography>
                      {line.options.map((option) => (
                        <Box key={option.name} sx={{ mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary" component="div">
                            {joinParts([option.name, option.description])}
                          </Typography>
                          {option.locations.map((location) => (
                            <Typography
                              key={location.location}
                              variant="caption"
                              color="text.secondary"
                              component="div"
                            >
                              {joinParts([location.location, ...location.preferences])}
                            </Typography>
                          ))}
                        </Box>
                      ))}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" noWrap>
                        {line.quantity === null ? '—' : `${line.quantity} ${line.unit ?? ''}`.trim()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" noWrap>{formatCurrency(line.total)}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">This message has no lines.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {options.length > 0 && (
            <>
              <SectionTitle>{`Options (${options.length})`}</SectionTitle>
              <Stack spacing={0.5}>
                {options.map((option) => (
                  <Typography key={option.name} variant="body2">
                    <Box component="span" sx={{ fontWeight: 600 }}>{option.name}</Box>
                    {option.description ? ` — ${option.description}` : ''}
                  </Typography>
                ))}
              </Stack>
            </>
          )}

          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 3, mb: 1 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
              Payload as received
            </Typography>
            <Button size="small" startIcon={<ContentCopyRoundedIcon />} onClick={copyPayload}>
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </Stack>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              maxHeight: 420,
              overflow: 'auto',
              fontSize: 12,
              fontFamily: 'monospace',
              bgcolor: 'sidebar.bg',
              color: 'text.primary',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            {JSON.stringify(row.payload, null, 2)}
          </Box>
        </Box>
      )}
    </Drawer>
  )
}

export default function HyphenRequests() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(isSpconnectUatConfigured)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)

  const loadMessages = useCallback(async () => {
    if (!isSpconnectUatConfigured) return
    setLoading(true)
    setLoadError(null)
    try {
      setRows(await listSpconnectMessages())
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // The UAT project is the external source for this read-only view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMessages()
  }, [loadMessages])

  const messages = useMemo(
    () => rows.map((row) => ({ row, summary: summarizeSpconnectMessage(row) })),
    [rows],
  )
  const visibleMessages = messages.filter(({ summary }) => matchesSpconnectSearch(summary, search))

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          px: { xs: 2.5, md: 4 },
          py: 3,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Hyphen Requests
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Orders and change orders that Hyphen SPConnect sent to the UAT webhook, as they arrived.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={16} /> : <RefreshRoundedIcon />}
          disabled={loading || !isSpconnectUatConfigured}
          onClick={loadMessages}
        >
          Refresh
        </Button>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {!isSpconnectUatConfigured && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            The Hyphen UAT connection is not configured. Add VITE_SPCONNECT_UAT_URL and
            VITE_SPCONNECT_UAT_PUBLISHABLE_KEY to apps/frontend/.env.
          </Alert>
        )}

        {loadError && (
          <Alert
            severity="error"
            action={(
              <Button color="inherit" size="small" onClick={loadMessages}>
                Retry
              </Button>
            )}
            sx={{ mb: 2.5 }}
          >
            {loadError}
          </Alert>
        )}

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
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ p: 2.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
          >
            <TextField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              size="small"
              placeholder="Search PO, order ID, builder, community or lot..."
              sx={{ width: { xs: '100%', sm: 380 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Typography variant="body2" color="text.secondary">
              {`${visibleMessages.length} of ${messages.length} ${messages.length === 1 ? 'request' : 'requests'}`}
            </Typography>
          </Stack>
          <Divider />

          <TableContainer>
            <Table sx={{ minWidth: 1100 }}>
              <TableHead>
                <TableRow sx={headerRowSx}>
                  <TableCell>Received</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Builder PO</TableCell>
                  <TableCell>Builder</TableCell>
                  <TableCell>Community and lot</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell>Work dates</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ py: 8, textAlign: 'center' }}>
                      <CircularProgress size={32} aria-label="Loading Hyphen requests" />
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                        Loading Hyphen requests…
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && visibleMessages.map(({ row, summary }) => (
                  <TableRow
                    key={summary.id}
                    hover
                    selected={selectedRow === row}
                    onClick={() => setSelectedRow(row)}
                    sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {formatDateTime(summary.receivedAt)}
                      </Typography>
                    </TableCell>
                    <TableCell><KindChip summary={summary} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap>{summary.poNumber ?? '—'}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {`ID ${summary.orderId ?? '—'}`}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Typography variant="body2">{summary.builderName ?? '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{summary.community ?? '—'}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {joinParts([summary.phase, summary.lot && `Lot ${summary.lot}`])}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {joinParts([summary.plan, summary.elevation])}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {joinParts([summary.workStart, summary.workEnd], ' – ')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" noWrap>{formatCurrency(summary.orderTotal)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {`${summary.lineCount} ${summary.lineCount === 1 ? 'line' : 'lines'}`}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}

                {!loading && !loadError && isSpconnectUatConfigured && visibleMessages.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ py: 8, textAlign: 'center' }}>
                      <MoveToInboxRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>
                        {messages.length === 0 ? 'No requests yet' : 'No requests match your search'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {messages.length === 0
                          ? 'Orders appear here as soon as Hyphen sends them.'
                          : 'Try a PO, order ID, builder, community or lot.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Box>

      <MessageDetailsDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </Box>
  )
}
