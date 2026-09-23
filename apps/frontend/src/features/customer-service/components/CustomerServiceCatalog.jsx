import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  FormControl,
  InputAdornment,
  InputLabel,
  LinearProgress,
  Menu,
  MenuItem,
  Popover,
  Select,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { useAuth } from '../../auth/context/useAuth.js'
import CustomerServiceCalendar from './CustomerServiceCalendar.jsx'
import CustomerServiceRequestDialog from './CustomerServiceRequestDialog.jsx'
import RequestDetailPanel from './RequestDetailPanel.jsx'
import RequestStateDialog from './RequestStateDialog.jsx'
import ServiceRequestsTable from './ServiceRequestsTable.jsx'
import ServiceSummaryCards from './ServiceSummaryCards.jsx'
import ServiceVisitDialog from './ServiceVisitDialog.jsx'
import {
  appointmentStateOptions,
  isClosed,
  openStatuses,
  priorityOptions,
  statusOptions,
  statusesByValue,
} from '../data/customerService.js'
import {
  closeCustomerServiceRequest,
  createCustomerServiceRequest,
  loadCustomerServiceCatalog,
  reopenCustomerServiceRequest,
  updateCustomerServiceRequest,
} from '../services/customerServiceRepository.js'
import { sortOptions, sortRequests } from '../utils/sorting.js'

const ROWS_PER_PAGE = 6
const DEFAULT_SETTINGS = {
  businessDaysToComplete: 5,
  workdayStartsAt: '08:00',
  workdayEndsAt: '17:00',
  timeZone: 'America/Los_Angeles',
  companyAddress: '',
  companyLatitude: null,
  companyLongitude: null,
  distanceGreenMaxMiles: 10,
  distanceYellowMaxMiles: 20,
}

export default function CustomerServiceCatalog() {
  const { profile } = useAuth()
  const [requests, setRequests] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [activeView, setActiveView] = useState('REQUESTS')
  const [visitDialogOpen, setVisitDialogOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [builderFilter, setBuilderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('open')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [appointmentFilter, setAppointmentFilter] = useState('all')
  const [sortBy, setSortBy] = useState('FOLIO')
  const [filtersAnchor, setFiltersAnchor] = useState(null)
  const [page, setPage] = useState(0)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [dialogState, setDialogState] = useState(null)
  const [stateDialog, setStateDialog] = useState(null)
  const [notice, setNotice] = useState(null)
  const isWide = useMediaQuery((theme) => theme.breakpoints.up('lg'))

  const refreshCatalog = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(true)
    setLoadError('')

    try {
      const catalog = await loadCustomerServiceCatalog()
      setRequests(catalog.requests)
      setSettings(catalog.settings)
      setSelectedId((current) => (
        catalog.requests.some((request) => request.id === current)
          ? current
          : catalog.requests[0]?.id ?? null
      ))
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Supabase is the external source synchronized by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCatalog()
  }, [refreshCatalog])

  const panelRequest = requests.find((request) => request.id === selectedId) ?? null
  const builderOptions = useMemo(() => {
    const builders = new Map()
    for (const request of requests) {
      if (request.builderId) builders.set(request.builderId, request.builderName)
    }
    return [...builders.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [requests])

  const extraFilterCount =
    (priorityFilter === 'all' ? 0 : 1) + (appointmentFilter === 'all' ? 0 : 1)

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matching = requests.filter((request) => {
      const matchesSearch = !query || [
        request.requestNumber,
        request.builderName,
        request.community,
        request.lotNumber,
        request.street,
        request.contactName,
        request.contactPhone,
        request.contactEmail,
        request.issue,
      ].filter(Boolean).join(' ').toLowerCase().includes(query)
      const matchesBuilder =
        builderFilter === 'all' || request.builderId === builderFilter
      const matchesStatus =
        statusFilter === 'all'
        || (statusFilter === 'open'
          ? openStatuses.includes(request.status)
          : request.status === statusFilter)
      const matchesPriority =
        priorityFilter === 'all' || request.priority === priorityFilter
      const matchesAppointment =
        appointmentFilter === 'all'
        || request.appointmentState === appointmentFilter

      return matchesSearch
        && matchesBuilder
        && matchesStatus
        && matchesPriority
        && matchesAppointment
    })

    return sortRequests(matching, sortBy)
  }, [
    appointmentFilter,
    builderFilter,
    priorityFilter,
    requests,
    search,
    sortBy,
    statusFilter,
  ])

  const visibleRequests = filteredRequests.slice(
    page * ROWS_PER_PAGE,
    page * ROWS_PER_PAGE + ROWS_PER_PAGE,
  )

  const openPanel = (request) => {
    setSelectedId(request.id)
    setPanelOpen(true)
  }

  const closeMenu = () => {
    setMenuAnchor(null)
    setSelectedRequest(null)
  }

  const openEditDialog = () => {
    const request = selectedRequest
    closeMenu()
    setDialogState({ mode: 'edit', request })
  }

  const openStateDialog = (action) => {
    const request = selectedRequest
    closeMenu()
    setStateDialog({ action, request })
  }

  const handleSave = async (form) => {
    setSaving(true)
    try {
      const requestId = dialogState.mode === 'edit'
        ? await updateCustomerServiceRequest(
          dialogState.request.id,
          form,
          settings.timeZone,
        )
        : await createCustomerServiceRequest(form, settings.timeZone)

      await refreshCatalog({ background: true })
      setSelectedId(requestId)
      setDialogState(null)
      setPage(0)
      setNotice({
        severity: 'success',
        message: dialogState.mode === 'edit'
          ? 'Request updated in Supabase.'
          : 'Request created in Supabase.',
      })
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally {
      setSaving(false)
    }
  }

  const handleStateChange = async (note) => {
    setSaving(true)
    try {
      if (stateDialog.action === 'close') {
        await closeCustomerServiceRequest(stateDialog.request.id, note)
      } else {
        await reopenCustomerServiceRequest(stateDialog.request.id, note)
      }

      const action = stateDialog.action
      await refreshCatalog({ background: true })
      setStateDialog(null)
      setNotice({
        severity: 'success',
        message: action === 'close' ? 'Request closed.' : 'Request reopened.',
      })
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally {
      setSaving(false)
    }
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
            {activeView === 'REQUESTS'
              ? 'Live requests, customer availability and service deadlines.'
              : 'Schedule service visits and review completed work.'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {activeView === 'REQUESTS' && (
            <Button
              color="inherit"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => refreshCatalog()}
              disabled={loading || saving}
            >
              Refresh
            </Button>
          )}
          <ResponsiveCreateButton
            label={activeView === 'REQUESTS' ? 'New request' : 'New service visit'}
            onClick={() => {
              if (activeView === 'REQUESTS') setDialogState({ mode: 'create' })
              else setVisitDialogOpen(true)
            }}
            disabled={loading || saving}
          />
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 2.5, md: 4 }, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={activeView} onChange={(_, value) => setActiveView(value)} aria-label="Customer Service views">
          <Tab value="REQUESTS" icon={<ViewListRoundedIcon />} iconPosition="start" label="Requests" />
          <Tab value="CALENDAR" icon={<CalendarMonthRoundedIcon />} iconPosition="start" label="Calendar" />
        </Tabs>
      </Box>

      {loading && <LinearProgress />}

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {activeView === 'REQUESTS' ? (
          <>
            {loadError && (
              <Alert
                severity="error"
                sx={{ mb: 2.5 }}
                action={<Button color="inherit" size="small" onClick={() => refreshCatalog()}>Retry</Button>}
              >
                {loadError}
              </Alert>
            )}

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
                  sx={{ flexWrap: 'wrap', p: 2.5, borderBottom: 1, borderColor: 'divider' }}
                >
                  <TextField
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(0)
                    }}
                    size="small"
                    placeholder="Search request #, address, lot, customer, issue..."
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
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {builderOptions.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                      <Select
                        value={builderFilter}
                        onChange={(event) => {
                          setBuilderFilter(event.target.value)
                          setPage(0)
                        }}
                        renderValue={(value) => (
                          `Builder: ${value === 'all'
                            ? 'All'
                            : builderOptions.find((option) => option.value === value)?.label ?? 'Unknown'}`
                        )}
                        inputProps={{ 'aria-label': 'Filter by builder' }}
                      >
                        <MenuItem value="all">All builders</MenuItem>
                        <Divider />
                        {builderOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}

                  <FormControl size="small" sx={{ minWidth: 190 }}>
                    <Select
                      value={sortBy}
                      onChange={(event) => {
                        setSortBy(event.target.value)
                        setPage(0)
                      }}
                      renderValue={(value) => `Sort: ${sortOptions.find((option) => option.value === value).label}`}
                      inputProps={{ 'aria-label': 'Sort requests' }}
                    >
                      {sortOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
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
                  totalCount={filteredRequests.length}
                  page={page}
                  rowsPerPage={ROWS_PER_PAGE}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onOpen={openPanel}
                  onMenuOpen={(event, request) => {
                    setMenuAnchor(event.currentTarget)
                    setSelectedRequest(request)
                  }}
                  onPageChange={setPage}
                />
              </Box>

              {isWide && panelOpen && panelRequest && (
                <Box sx={{ width: 420, flexShrink: 0 }}>
                  <RequestDetailPanel
                    request={panelRequest}
                    settings={settings}
                    onClose={() => setPanelOpen(false)}
                    onEdit={(request) => setDialogState({ mode: 'edit', request })}
                  />
                </Box>
              )}
            </Box>
          </>
        ) : (
          <CustomerServiceCalendar onNotice={(message) => setNotice({ severity: 'info', message })} />
        )}
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
            settings={settings}
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
          <Typography variant="subtitle2" fontWeight={700}>More filters</Typography>
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
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
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
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button color="inherit" onClick={clearFilters} disabled={extraFilterCount === 0}>
            Clear filters
          </Button>
        </Stack>
      </Popover>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {selectedRequest && isClosed(selectedRequest) ? (
          <MenuItem onClick={() => openStateDialog('reopen')}>
            <LockOpenRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
            Reopen
          </MenuItem>
        ) : [
          <MenuItem key="edit" onClick={openEditDialog}>
            <EditOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
            Edit
          </MenuItem>,
          <MenuItem key="close" onClick={() => openStateDialog('close')} sx={{ color: 'error.main' }}>
            <LockOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
            Close request
          </MenuItem>,
        ]}
      </Menu>

      {dialogState && (
        <CustomerServiceRequestDialog
          key={dialogState.request?.id ?? 'new'}
          request={dialogState.request}
          settings={settings}
          currentUserName={profile?.name}
          saving={saving}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
        />
      )}

      {stateDialog && (
        <RequestStateDialog
          key={`${stateDialog.action}-${stateDialog.request.id}`}
          {...stateDialog}
          saving={saving}
          onClose={() => setStateDialog(null)}
          onConfirm={handleStateChange}
        />
      )}

      {visitDialogOpen && (
        <ServiceVisitDialog
          requests={requests}
          onClose={() => setVisitDialogOpen(false)}
          onCreated={(event) => {
            setVisitDialogOpen(false)
            setNotice({
              severity: 'info',
              message: `${event.extendedProps.requestNumber} is still a calendar prototype; appointment persistence comes in the next block.`,
            })
          }}
        />
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={notice?.severity === 'error' ? 6000 : 3000}
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
