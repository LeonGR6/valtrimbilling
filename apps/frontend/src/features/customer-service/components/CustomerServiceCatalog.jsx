import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
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
  FormHelperText,
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
import RequestDetailPanel from './RequestDetailPanel.jsx'
import ServiceRequestsTable from './ServiceRequestsTable.jsx'
import ServiceSummaryCards from './ServiceSummaryCards.jsx'
import {
  appointmentStateOptions,
  builderLabelsById,
  builderOptions,
  coordinatorLabelsById,
  defaultCoordinatorId,
  emptyRequest,
  formStatusOptions,
  initialRequests,
  isClosed,
  openStatuses,
  priorityOptions,
  requestTagOptions,
  requestTypeOptions,
  statusOptions,
  statusesByValue,
  technicianOptions,
} from '../data/customerService.js'
import { createServiceRequestSchema } from '../schemas/customerServiceSchema.js'
import { toIsoDate } from '../utils/dates.js'
import { nextRequestNumber } from '../utils/requestNumber.js'
import { sortOptions, sortRequests } from '../utils/sorting.js'

// The mockup shows six rows per page, which is also about as much as fits
// before the coordinator has to scroll.
const ROWS_PER_PAGE = 6

function RequestDialog({ request, requests, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(
      createServiceRequestSchema(requests, request?.id ?? null),
    ),
    // A new request arrives with its folio already assigned and logged under
    // the coordinator who owns the screen. Neither is typed.
    defaultValues: request
      ? { ...request }
      : { ...emptyRequest, requestNumber: nextRequestNumber(requests) },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  // The visit fields only apply once there is something to schedule.
  // useWatch rather than watch(): the latter returns a fresh function every
  // render, which makes the React Compiler skip memoizing the whole dialog.
  const appointmentState = useWatch({ control, name: 'appointmentState' })
  const showVisitFields = appointmentState !== 'NOT_SCHEDULED'
  const showVisitWindow =
    appointmentState === 'SCHEDULED' || appointmentState === 'COMPLETED'

  const selectField = (name, label, options, { emptyLabel } = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <FormControl error={Boolean(errors[name])} fullWidth>
          <InputLabel id={`request-${name}-label`}>{label}</InputLabel>
          <Select
            labelId={`request-${name}-label`}
            label={label}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          >
            {emptyLabel && (
              <MenuItem value="">
                <em>{emptyLabel}</em>
              </MenuItem>
            )}
            {options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>{errors[name]?.message ?? ' '}</FormHelperText>
        </FormControl>
      )}
    />
  )

  const sectionTitle = (title) => (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ fontWeight: 700, letterSpacing: '0.08em' }}
    >
      {title}
    </Typography>
  )

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {request ? `Request ${request.requestNumber}` : 'New request'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          What the homeowner reported, where it is and who is going out.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          {sectionTitle('Request')}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Request number"
              {...register('requestNumber')}
              error={Boolean(errors.requestNumber)}
              helperText={
                errors.requestNumber?.message ??
                (request
                  ? 'A folio never changes once issued.'
                  : 'Assigned automatically.')
              }
              fullWidth
              slotProps={{ htmlInput: { maxLength: 30, readOnly: true } }}
              sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
            />
            <TextField
              label="Reported on"
              type="date"
              {...register('reportedAt')}
              error={Boolean(errors.reportedAt)}
              helperText={errors.reportedAt?.message ?? ' '}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {/* Who logged the request is a fact of whose desk this is, not a
                question. Controller keeps the id in the form while the input
                only ever displays the name and takes no input. */}
            <Controller
              name="createdById"
              control={control}
              render={({ field }) => (
                <TextField
                  label="Logged by"
                  value={coordinatorLabelsById[field.value] ?? ''}
                  helperText="Customer Service is logged under this desk."
                  fullWidth
                  slotProps={{ htmlInput: { readOnly: true } }}
                  sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                />
              )}
            />
            {selectField('tag', 'Flag', requestTagOptions, {
              emptyLabel: 'No flag',
            })}
          </Stack>

          <Divider />
          {sectionTitle('Property')}
          {selectField('builder', 'Builder', builderOptions)}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Community"
              {...register('community')}
              error={Boolean(errors.community)}
              helperText={errors.community?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              label="Lot"
              {...register('lotNumber')}
              error={Boolean(errors.lotNumber)}
              helperText={errors.lotNumber?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 20 } }}
            />
            <TextField
              label="Plan"
              {...register('plan')}
              error={Boolean(errors.plan)}
              helperText={errors.plan?.message ?? 'Optional'}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 40 } }}
            />
          </Stack>

          <TextField
            label="Street address"
            {...register('street')}
            error={Boolean(errors.street)}
            helperText={errors.street?.message ?? ' '}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="City"
              {...register('city')}
              error={Boolean(errors.city)}
              helperText={errors.city?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              label="State"
              {...register('state')}
              error={Boolean(errors.state)}
              helperText={errors.state?.message ?? ' '}
              sx={{ width: { xs: '100%', sm: 140 } }}
              slotProps={{ htmlInput: { maxLength: 2 } }}
            />
            <TextField
              label="ZIP code"
              {...register('postalCode')}
              error={Boolean(errors.postalCode)}
              helperText={errors.postalCode?.message ?? ' '}
              sx={{ width: { xs: '100%', sm: 180 } }}
              slotProps={{ htmlInput: { maxLength: 5 } }}
            />
          </Stack>

          <Divider />
          {sectionTitle('Homeowner')}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Name"
              {...register('contactName')}
              error={Boolean(errors.contactName)}
              helperText={errors.contactName?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              label="Phone"
              {...register('contactPhone')}
              error={Boolean(errors.contactPhone)}
              helperText={errors.contactPhone?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 30 } }}
            />
            <TextField
              label="Email"
              {...register('contactEmail')}
              error={Boolean(errors.contactEmail)}
              helperText={errors.contactEmail?.message ?? 'Optional'}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 160 } }}
            />
          </Stack>

          <Divider />
          {sectionTitle('Issue')}
          <TextField
            label="Issue"
            {...register('issue')}
            error={Boolean(errors.issue)}
            helperText={
              errors.issue?.message ?? 'The one line that shows in the table'
            }
            fullWidth
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {selectField('type', 'Classification', requestTypeOptions)}
            {selectField('priority', 'Priority', priorityOptions)}
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {selectField('status', 'Status', formStatusOptions)}
            <TextField
              label="Status note"
              {...register('statusNote')}
              error={Boolean(errors.statusNote)}
              helperText={errors.statusNote?.message ?? 'Optional'}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
          </Stack>

          <Divider />
          {sectionTitle('Appointment')}
          {selectField(
            'appointmentState',
            'Appointment',
            appointmentStateOptions,
          )}

          {showVisitFields && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={
                  appointmentState === 'OVERDUE' ? 'Was due on' : 'Visit date'
                }
                type="date"
                {...register('appointmentDate')}
                error={Boolean(errors.appointmentDate)}
                helperText={errors.appointmentDate?.message ?? ' '}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              {showVisitWindow && (
                <>
                  <TextField
                    label="From"
                    type="time"
                    {...register('appointmentStart')}
                    error={Boolean(errors.appointmentStart)}
                    helperText={errors.appointmentStart?.message ?? ' '}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    label="To"
                    type="time"
                    {...register('appointmentEnd')}
                    error={Boolean(errors.appointmentEnd)}
                    helperText={errors.appointmentEnd?.message ?? ' '}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </>
              )}
            </Stack>
          )}

          {showVisitWindow &&
            selectField('technicianId', 'Technician', technicianOptions, {
              emptyLabel: 'Unassigned',
            })}

          <TextField
            label="Notes"
            {...register('notes')}
            error={Boolean(errors.notes)}
            helperText={
              errors.notes?.message ?? 'Access, pets, anything to remember'
            }
            fullWidth
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation>
          {request ? 'Save changes' : 'Create request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function CustomerServiceCatalog() {
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
                    `Builder: ${value === 'all' ? 'All' : builderLabelsById[value]}`
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
