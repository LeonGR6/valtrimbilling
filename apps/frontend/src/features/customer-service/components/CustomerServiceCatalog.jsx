import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Popover,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { useBuilders } from '../../builders/context/useBuilders.js'
import RequestDetailPanel from './RequestDetailPanel.jsx'
import ServiceRequestsTable from './ServiceRequestsTable.jsx'
import ServiceSummaryCards from './ServiceSummaryCards.jsx'
import {
  appointmentStateOptions,
  defaultCoordinatorId,
  initialRequests,
  isClosed,
  openStatuses,
  priorityOptions,
  statusOptions,
  statusesByValue,
} from '../data/customerService.js'
import { toIsoDate } from '../utils/dates.js'
import { sortOptions, sortRequests } from '../utils/sorting.js'
import RequestDialog from './RequestDialog.jsx'

// The mockup shows six rows per page, which is also about as much as fits
// before the coordinator has to scroll.
const ROWS_PER_PAGE = 6

export default function CustomerServiceCatalog() {
  const { builders } = useBuilders()
  const [requests, setRequests] = useState(initialRequests)
  const [search, setSearch] = useState('')
  const [builderFilter, setBuilderFilter] = useState('all')
  // Closed and completed work piles up month after month, so the screen opens
  // on what is still live.
  const [statusFilter, setStatusFilter] = useState('open')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [appointmentFilter, setAppointmentFilter] = useState('all')
  // Highest folio first. "Next up" stays one pick away in the same control.
  const [sortBy, setSortBy] = useState('FOLIO')
  const [filtersAnchor, setFiltersAnchor] = useState(null)
  const [page, setPage] = useState(0)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [selectedId, setSelectedId] = useState(initialRequests[0]?.id ?? null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  const builderOptions = useMemo(
    () => builders.map((builder) => ({
      value: builder.code,
      label: builder.name,
    })),
    [builders],
  )
  const builderLabelsById = useMemo(
    () => Object.fromEntries(
      builderOptions.map(({ value, label }) => [value, label]),
    ),
    [builderOptions],
  )

  // Wide screens keep the panel beside the table, the way the mockup shows it.
  // Below that it would leave the table unreadable, so it slides over instead.
  const isWide = useMediaQuery((theme) => theme.breakpoints.up('lg'))
  const panelRequest =
    requests.find((request) => request.id === selectedId) ?? null

  const openPanel = (request) => {
    setSelectedId(request.id)
    setPanelOpen(true)
  }

  const extraFilterCount =
    (priorityFilter === 'all' ? 0 : 1) + (appointmentFilter === 'all' ? 0 : 1)

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase()

    const matching = requests.filter((request) => {
      const matchesSearch =
        !query ||
        [
          request.requestNumber,
          request.community,
          request.lotNumber,
          request.street,
          request.contactName,
          request.contactPhone,
          request.contactEmail,
          request.issue,
          builderLabelsById[request.builder],
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesBuilder =
        builderFilter === 'all' || request.builder === builderFilter
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'open'
          ? openStatuses.includes(request.status)
          : request.status === statusFilter)
      const matchesPriority =
        priorityFilter === 'all' || request.priority === priorityFilter
      const matchesAppointment =
        appointmentFilter === 'all' ||
        request.appointmentState === appointmentFilter

      return (
        matchesSearch &&
        matchesBuilder &&
        matchesStatus &&
        matchesPriority &&
        matchesAppointment
      )
    })

    return sortRequests(matching, sortBy)
  }, [
    requests,
    search,
    builderFilter,
    statusFilter,
    priorityFilter,
    appointmentFilter,
    builderLabelsById,
    sortBy,
  ])

  const visibleRequests = filteredRequests.slice(
    page * ROWS_PER_PAGE,
    page * ROWS_PER_PAGE + ROWS_PER_PAGE,
  )

  const handleMenuOpen = (event, request) => {
    setMenuAnchor(event.currentTarget)
    setSelectedRequest(request)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedRequest(null)
  }

  const openEditDialog = () => {
    setDialogState({ mode: 'edit', request: selectedRequest })
    handleMenuClose()
  }

  const openDeleteDialog = () => {
    setDeleteTarget(selectedRequest)
    handleMenuClose()
  }

  // Closing keeps the status the request had, so reopening lands it back where
  // it was instead of guessing. Hiding Edit and Delete is a courtesy, not a
  // lock — the real one is an RLS policy, once the table lives in Postgres.
  const closeRequest = () => {
    const target = selectedRequest

    setRequests((current) =>
      current.map((request) =>
        request.id === target.id
          ? {
              ...request,
              statusBeforeClose: request.status,
              status: 'CLOSED',
              closedAt: toIsoDate(new Date()),
              closedById: defaultCoordinatorId,
            }
          : request,
      ),
    )
    setNotice({
      severity: 'success',
      message: `${target.requestNumber} closed.`,
    })
    handleMenuClose()
  }

  const reopenRequest = () => {
    const target = selectedRequest

    setRequests((current) =>
      current.map((request) =>
        request.id === target.id
          ? {
              ...request,
              status: request.statusBeforeClose || 'CONTACT_NEEDED',
              statusBeforeClose: '',
              closedAt: '',
              closedById: '',
            }
          : request,
      ),
    )
    setNotice({
      severity: 'success',
      message: `${target.requestNumber} reopened.`,
    })
    handleMenuClose()
  }

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setRequests((current) =>
        current.map((request) =>
          request.id === dialogState.request.id
            ? { ...request, ...form }
            : request,
        ),
      )
      setNotice({ severity: 'success', message: 'Request updated.' })
    } else {
      const id = Date.now()
      setRequests((current) => [{ ...form, id }, ...current])
      setSelectedId(id)
      setPage(0)
      setNotice({ severity: 'success', message: 'Request created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setRequests((current) =>
      current.filter((request) => request.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'Request deleted.' })
  }

  const clearFilters = () => {
    setPriorityFilter('all')
    setAppointmentFilter('all')
    setPage(0)
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Customer Service
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Warranty work, punch list items and callbacks reported after
            handover.
          </Typography>
        </Box>
        <ResponsiveCreateButton
          label="New request"
          onClick={() => setDialogState({ mode: 'create' })}
        />
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {/* The tiles read the whole log, not the filtered view: they are the
            triage picture the coordinator starts the day with. */}
        <ServiceSummaryCards requests={requests} />

        <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'flex-start' }}>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              useFlexGap
              sx={{
                flexWrap: 'wrap',
                p: 2.5,
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <TextField
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
                size="small"
                placeholder="Search builder, community, lot, address, phone, email, request #..."
                sx={{ flex: 1 }}
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

              <FormControl size="small" sx={{ minWidth: 190 }}>
                <Select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value)
                    setPage(0)
                  }}
                  renderValue={(value) => {
                    if (value === 'all') return 'Status: All'
                    if (value === 'open') return 'Status: Open'
                    return `Status: ${statusesByValue[value].label}`
                  }}
                  inputProps={{ 'aria-label': 'Filter by status' }}
                >
                  <MenuItem value="all">All statuses</MenuItem>
                  <MenuItem value="open">Still open</MenuItem>
                  <Divider />
                  {statusOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 200 }}>
                <Select
                  value={builderFilter}
                  onChange={(event) => {
                    setBuilderFilter(event.target.value)
                    setPage(0)
                  }}
                  renderValue={(value) =>
                    `Builder: ${value === 'all' ? 'All' : builderLabelsById[value] ?? value}`
                  }
                  inputProps={{ 'aria-label': 'Filter by builder' }}
                >
                  <MenuItem value="all">All builders</MenuItem>
                  <Divider />
                  {builderOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 190 }}>
              <Select
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value)
                  setPage(0)
                }}
                renderValue={(value) =>
                  `Sort: ${sortOptions.find((option) => option.value === value).label}`
                }
                inputProps={{ 'aria-label': 'Sort requests' }}
              >
                {sortOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Badge badgeContent={extraFilterCount} color="primary">
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<FilterListRoundedIcon />}
                  onClick={(event) => setFiltersAnchor(event.currentTarget)}
                  sx={{ height: 40, whiteSpace: 'nowrap' }}
                >
                  Filters
                </Button>
              </Badge>
            </Stack>

            <ServiceRequestsTable
              requests={visibleRequests}
              builderLabelsById={builderLabelsById}
              totalCount={filteredRequests.length}
              page={page}
              rowsPerPage={ROWS_PER_PAGE}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onOpen={openPanel}
              onSchedule={(request) => {
                setSelectedId(request.id)
                setDialogState({ mode: 'edit', request })
              }}
              onMenuOpen={handleMenuOpen}
              onPageChange={setPage}
            />
          </Box>

          {isWide && panelOpen && panelRequest && (
            <Box sx={{ width: 420, flexShrink: 0 }}>
              <RequestDetailPanel
                request={panelRequest}
                builderLabelsById={builderLabelsById}
                onClose={() => setPanelOpen(false)}
                onEdit={(request) => setDialogState({ mode: 'edit', request })}
              />
            </Box>
          )}
        </Box>
      </Box>

      <Drawer
        anchor="right"
        open={!isWide && panelOpen && Boolean(panelRequest)}
        onClose={() => setPanelOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } } } }}
      >
        {panelRequest && (
          <RequestDetailPanel
            request={panelRequest}
            builderLabelsById={builderLabelsById}
            onClose={() => setPanelOpen(false)}
            onEdit={(request) => setDialogState({ mode: 'edit', request })}
          />
        )}
      </Drawer>

      <Popover
        open={Boolean(filtersAnchor)}
        anchorEl={filtersAnchor}
        onClose={() => setFiltersAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Stack spacing={2} sx={{ p: 2.5, width: 260 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            More filters
          </Typography>

          <FormControl size="small" fullWidth>
            <InputLabel id="filter-priority-label">Priority</InputLabel>
            <Select
              labelId="filter-priority-label"
              label="Priority"
              value={priorityFilter}
              onChange={(event) => {
                setPriorityFilter(event.target.value)
                setPage(0)
              }}
            >
              <MenuItem value="all">Any priority</MenuItem>
              {priorityOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel id="filter-appointment-label">Appointment</InputLabel>
            <Select
              labelId="filter-appointment-label"
              label="Appointment"
              value={appointmentFilter}
              onChange={(event) => {
                setAppointmentFilter(event.target.value)
                setPage(0)
              }}
            >
              <MenuItem value="all">Any appointment</MenuItem>
              {appointmentStateOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            color="inherit"
            onClick={clearFilters}
            disabled={extraFilterCount === 0}
          >
            Clear filters
          </Button>
        </Stack>
      </Popover>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {selectedRequest && isClosed(selectedRequest)
          ? [
              <MenuItem key="reopen" onClick={reopenRequest}>
                <LockOpenRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
                Reopen
              </MenuItem>,
            ]
          : [
              <MenuItem key="edit" onClick={openEditDialog}>
                <EditOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                Edit
              </MenuItem>,
              <MenuItem key="close" onClick={closeRequest}>
                <LockOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
                Close request
              </MenuItem>,
              <MenuItem
                key="delete"
                onClick={openDeleteDialog}
                sx={{ color: 'error.main' }}
              >
                <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
                Delete
              </MenuItem>,
            ]}
      </Menu>

      {dialogState && (
        <RequestDialog
          key={dialogState.request?.id ?? 'new'}
          request={dialogState.request}
          requests={requests}
          builderOptions={builderOptions}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete request?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `${deleteTarget.requestNumber} will be removed from the service log.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disableElevation
          >
            Delete request
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={notice?.severity ?? 'success'}
          onClose={() => setNotice(null)}
          variant="filled"
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
