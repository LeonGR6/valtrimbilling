import { useMemo, useState } from 'react'
import {
  Box, Button, FormControl, InputAdornment, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { closedDate, completedRequestHistory, historyOutcome, historyTechnicianOptions } from '../utils/requestHistory.js'
import { inboxPageSizeOptions, paginateRequestInbox, requestLocationLabel } from '../utils/requestInbox.js'
import { serviceWorkTypeLabel } from '../utils/customerServicePlanning.js'
import { formatTime, formatWeekdayDate } from '../utils/dates.js'
import Pill from './Pill.jsx'

const emptyFilters = { search: '', technicianId: 'all', from: '', to: '' }
const filterFieldSx = { flex: '1 1 160px' }

// The History tab (decided 25 Nov 2026): completed requests to look up after the visit,
// for example when a customer calls again about the same lot. Opening one shows the full
// request, as from the Calendar; only its internal notes can be edited. Since the Reschedule
// block (27 Nov 2026) it also lists requests closed without a visit, with their reason.
export default function RequestHistory({ requests, onViewRequest }) {
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(inboxPageSizeOptions[0])
  const technicianOptions = useMemo(() => historyTechnicianOptions(requests), [requests])
  const completedCount = useMemo(() => completedRequestHistory(requests).length, [requests])
  const rows = useMemo(() => completedRequestHistory(requests, filters), [requests, filters])
  const visible = paginateRequestInbox(rows, page, rowsPerPage)
  const filtered = Object.keys(emptyFilters).some((field) => filters[field] !== emptyFilters[field])
  const change = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value }))
    setPage(0)
  }

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            label="Search"
            placeholder="Folio, customer, address or builder"
            value={filters.search}
            onChange={change('search')}
            sx={{ flex: '2 1 260px' }}
            slotProps={{
              input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> },
            }}
          />
          <FormControl size="small" sx={filterFieldSx}>
            <InputLabel id="history-technician-label">Technician</InputLabel>
            <Select labelId="history-technician-label" label="Technician" value={filters.technicianId} onChange={change('technicianId')}>
              <MenuItem value="all">All technicians</MenuItem>
              {technicianOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" type="date" label="From" value={filters.from} onChange={change('from')}
            sx={filterFieldSx} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: filters.to || undefined } }} />
          <TextField size="small" type="date" label="To" value={filters.to} onChange={change('to')}
            sx={filterFieldSx} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: filters.from || undefined } }} />
          {filtered && (
            <Button color="inherit" onClick={() => { setFilters(emptyFilters); setPage(0) }}>Clear filters</Button>
          )}
        </Stack>
      </Paper>

      <Typography variant="body2" color="text.secondary">
        {rows.length} of {completedCount} completed or closed {completedCount === 1 ? 'request' : 'requests'} · most recent first
      </Typography>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Completed and closed requests">
          <TableHead>
            <TableRow>
              <TableCell>Folio</TableCell>
              <TableCell>Outcome</TableCell>
              <TableCell>Visit</TableCell>
              <TableCell>Property</TableCell>
              <TableCell>Work</TableCell>
              <TableCell>Technicians</TableCell>
              <TableCell>Customer</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.items.map((request) => {
              const outcome = historyOutcome(request, requests)
              return (
              <TableRow key={request.id} hover onClick={() => onViewRequest(request)} sx={{ cursor: 'pointer' }}>
                <TableCell>
                  <Button size="small" onClick={(event) => { event.stopPropagation(); onViewRequest(request) }}
                    aria-label={`View ${request.requestNumber}`} sx={{ px: 0.5, minWidth: 0, fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {request.requestNumber}
                  </Button>
                </TableCell>
                <TableCell>
                  <Pill label={outcome.label} color={outcome.closed ? 'neutral' : 'success'}
                    icon={outcome.closed ? null : <CheckCircleRoundedIcon />} />
                  {outcome.detail && (
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>{outcome.detail}</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="body2">
                    {request.customerWindow?.date
                      ? formatWeekdayDate(request.customerWindow.date)
                      : request.closedAt ? `Closed ${formatWeekdayDate(closedDate(request))}` : 'No visit date'}
                  </Typography>
                  {request.customerWindow?.start && (
                    <Typography variant="caption" color="text.secondary">
                      {formatTime(request.customerWindow.start)}–{formatTime(request.customerWindow.end)} window
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{requestLocationLabel(request) || '—'}</Typography>
                  {request.builderName && <Typography variant="caption" color="text.secondary">{request.builderName}</Typography>}
                </TableCell>
                <TableCell>{serviceWorkTypeLabel(request.workType) || '—'}</TableCell>
                <TableCell>{(request.assignedTechnicians ?? []).map((person) => person.name).join(', ') || '—'}</TableCell>
                <TableCell>{request.contactName || '—'}</TableCell>
              </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Box sx={{ py: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      {completedCount === 0
                        ? 'No completed or closed requests yet. A request shows here once its visit is completed or it is closed.'
                        : 'No completed or closed requests match these filters.'}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {rows.length > 0 && (
          <TablePagination
            component="div"
            count={rows.length}
            page={visible.page}
            rowsPerPage={visible.rowsPerPage}
            rowsPerPageOptions={inboxPageSizeOptions}
            onPageChange={(_event, next) => setPage(next)}
            onRowsPerPageChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(0) }}
          />
        )}
      </TableContainer>
    </Stack>
  )
}
