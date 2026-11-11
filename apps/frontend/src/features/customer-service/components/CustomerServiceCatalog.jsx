import { useCallback, useMemo, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker, useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputAdornment,
  MenuItem,
  Popover,
  Select,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import EventNoteRoundedIcon from '@mui/icons-material/EventNoteRounded'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ViewListRoundedIcon from '@mui/icons-material/ViewListRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { useAuth } from '../../auth/context/useAuth.js'
import { useCustomerServicePrototype } from '../context/customerServicePrototypeContext.js'
import { priorityOptions } from '../data/customerService.js'
import {
  canEditRequestInView,
  filterAndSortRequestInbox,
  findRequestForView,
  customerServiceViewFromPath,
  customerServiceViewPaths,
  inboxFilterOptions,
  inboxSortOptions,
  paginateRequestInbox,
  proposalWorkspacePath,
  requestsForView,
} from '../utils/requestInbox.js'
import { createPrototypeProposalDraft, prototypePlanningHours } from '../utils/proposalDraft.js'
import CustomerServiceCalendar from './CustomerServiceCalendar.jsx'
import EmailInboxPanel from './EmailInboxPanel.jsx'
import NewRequestPrototypeDialog from './NewRequestPrototypeDialog.jsx'
import ProposalWorkspace from './ProposalWorkspace.jsx'
import RequestInboxList from './RequestInboxList.jsx'
import RequestViewDialog from './RequestViewDialog.jsx'
import ServiceSummaryCards from './ServiceSummaryCards.jsx'
import SourcePdfPreviewDialog from './SourcePdfPreviewDialog.jsx'
import TravelCheckAlert from './TravelCheckAlert.jsx'

const viewCopy = {
  REQUESTS: {
    title: 'Customer Service Requests',
    description: 'Capture, complete and review requests before preparing appointment proposals.',
  },
  PROPOSALS: {
    title: 'Proposal Workspace',
    description: 'Prepare ready requests. Follow up on sent proposals or customers requiring contact.',
  },
  CALENDAR: {
    title: 'Customer Service Calendar',
    description: 'Confirmed service visits, technician schedules and completed work.',
  },
}

export default function CustomerServiceCatalog() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const activeView = customerServiceViewFromPath(location.pathname)
  const selectedWorkspaceId = new URLSearchParams(location.search).get('request')
  const currentUserName = profile?.name || profile?.email || user?.email || 'Signed-in user'
  const {
    requests, loading, error, reloadRequests, emailAutomation, emailAutomationError, refreshEmailAutomation,
    createRequest: persistRequest, updateRequest: persistUpdate, retrySourcePdf, pendingPdfIds,
    recoverRequest: persistRecovery,
    completeRecovery,
    markRequestReady: persistApproval,
    proposalDrafts, setProposalDrafts, technicians,
  } = useCustomerServicePrototype()
  const draftDirty = useRef(false)
  const [pendingDraftNavigation, setPendingDraftNavigation] = useState(null)
  const reportDraftDirty = useCallback((dirty) => { draftDirty.current = dirty }, [])
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => (
    draftDirty.current && (currentLocation.pathname !== nextLocation.pathname
      || currentLocation.search !== nextLocation.search)
  ), []))
  useBeforeUnload(useCallback((event) => {
    if (!draftDirty.current) return
    event.preventDefault()
    event.returnValue = ''
  }, []))
  const beforeDraftNavigation = (action) => {
    if (draftDirty.current) setPendingDraftNavigation(() => action)
    else action()
  }
  const keepDraftEditing = () => {
    setPendingDraftNavigation(null)
    if (blocker.state === 'blocked') blocker.reset()
  }
  const discardDraftChanges = () => {
    reportDraftDirty(false)
    setPendingDraftNavigation(null)
    if (blocker.state === 'blocked') blocker.proceed()
    else pendingDraftNavigation?.()
  }
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [areaFilter, setAreaFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('ACTION_REQUIRED')
  const [requestDialog, setRequestDialog] = useState(null)
  const [viewRequest, setViewRequest] = useState(null)
  const [emailRequestId, setEmailRequestId] = useState(null)
  const [pdfPreviewRequest, setPdfPreviewRequest] = useState(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [filtersAnchor, setFiltersAnchor] = useState(null)
  const [notice, setNotice] = useState(null)
  const [importPanelRevision, setImportPanelRevision] = useState(0)
  const visibleRequest = viewRequest != null
    ? findRequestForView(requests, viewRequest.id, activeView)
    : requests.find((entry) => String(entry.id) === String(emailRequestId)) ?? null
  const editCandidate = findRequestForView(requests, requestDialog?.request?.id, activeView)
  // Keep the record/version opened by the user. A later provider refresh must
  // not turn stale form values into a write using the newest concurrency token.
  const editableRequest = canEditRequestInView(editCandidate, activeView) ? requestDialog.request : null
  const sourceRequest = emailRequestId != null && viewRequest == null
    ? requests.find((entry) => String(entry.id) === String(pdfPreviewRequest?.id)) ?? null
    : findRequestForView(requests, pdfPreviewRequest?.id, activeView)

  const reviewRequests = useMemo(() => requestsForView(requests), [requests])
  const areaOptions = useMemo(
    () => [...new Set(reviewRequests.map((request) => request.community).filter(Boolean))].sort(),
    [reviewRequests],
  )

  const visibleRequests = useMemo(
    () => filterAndSortRequestInbox(requests, {
      search,
      stage: stageFilter,
      area: areaFilter,
      priority: priorityFilter,
      sortBy,
    }),
    [areaFilter, priorityFilter, requests, search, sortBy, stageFilter],
  )

  const paginatedRequests = useMemo(
    () => paginateRequestInbox(visibleRequests, page, rowsPerPage),
    [page, rowsPerPage, visibleRequests],
  )
  const extraFilterCount =
    (priorityFilter === 'all' ? 0 : 1) +
    (sortBy === 'ACTION_REQUIRED' ? 0 : 1)

  const clearFilters = () => {
    setSearch('')
    setStageFilter('all')
    setAreaFilter('all')
    setPriorityFilter('all')
    setSortBy('ACTION_REQUIRED')
    setPage(0)
  }

  const changeView = (view, requestId) => {
    setFiltersAnchor(null)
    setRequestDialog(null)
    setViewRequest(null)
    setEmailRequestId(null)
    setPdfPreviewRequest(null)
    navigate(view === 'PROPOSALS' && requestId
      ? proposalWorkspacePath(requestId)
      : customerServiceViewPaths[view])
  }

  const openProposalWorkspace = (request) => {
    if (!request) {
      changeView('PROPOSALS')
      return
    }
    const current = requests.find((entry) => entry.id === request.id)
    if (!current || requestsForView([current], 'PROPOSALS').length === 0) {
      setNotice({ severity: 'warning', message: 'Review this request before opening Proposal Workspace.' })
      return
    }
    changeView('PROPOSALS', current.id)
  }

  const createRequest = async (values, attachmentNames, submissionKey) => {
    const request = requestDialog?.mode === 'recover'
      ? await persistRecovery(requestDialog.emailImport, values)
      : await persistRequest(values, submissionKey)
    if (requestDialog?.mode === 'recover') setImportPanelRevision((value) => value + 1)
    setSearch('')
    setStageFilter('all')
    setAreaFilter('all')
    setPriorityFilter('all')
    setSortBy('NEWEST')
    setPage(0)
    setRequestDialog(null)
    setViewRequest(request)
    setNotice({
      severity: 'success',
      message: request.sourceDocument?.storage
        ? `${request.requestNumber} was saved in Supabase and its private PDF was retained.`
        : `${request.requestNumber} was saved in Supabase.`,
    })
  }

  const openImportRecovery = async (receipt) => {
    if (!receipt.requestId) {
      setRequestDialog({ mode: 'recover', emailImport: receipt })
      return
    }
    const refreshed = await reloadRequests()
    const existing = refreshed?.find((entry) => String(entry.id) === String(receipt.requestId))
    if (!existing) throw new Error('The linked request could not be loaded. Refresh the inbox.')
    if (receipt.errorCode === 'RECOVERY_PDF_PENDING') {
      if (existing.sourceDocument?.fileStatus === 'AVAILABLE') {
        const completed = await completeRecovery(receipt.id)
        setViewRequest(completed)
        setImportPanelRevision((value) => value + 1)
      } else setRequestDialog({ mode: 'recover', emailImport: receipt, recoveryRequest: existing })
    } else setViewRequest(existing)
  }

  const openEmailRequest = async (requestId) => {
    const refreshed = await reloadRequests()
    const current = refreshed?.find((entry) => String(entry.id) === String(requestId))
    if (!current) throw new Error('The request is no longer available. Refresh the email status.')
    setEmailRequestId(current.id)
    setViewRequest(null)
  }

  const updateRequest = async (values) => {
    const originalRequest = requestDialog?.request
    const current = findRequestForView(requests, originalRequest?.id, activeView)
    if (!current || !canEditRequestInView(current, activeView)) {
      throw new Error('This request can no longer be edited in this view. Close the editor and reload requests.')
    }

    const updatedRequest = await persistUpdate(originalRequest, values)
    setSearch('')
    setStageFilter('all')
    setAreaFilter('all')
    setPriorityFilter('all')
    setPage(0)
    setRequestDialog(null)
    setViewRequest(updatedRequest)
    setNotice({
      severity: 'success',
      message: originalRequest.workflowStage === 'READY_TO_PROPOSE'
        && updatedRequest.workflowStage === 'NEEDS_REVIEW'
        ? `${updatedRequest.requestNumber} saved. Important changes require a new review.`
        : `${updatedRequest.requestNumber} changes saved.`,
    })
  }

  const markReadyToPropose = async (request, reviewDetails) => {
    // Approve the version actually displayed, never silently use a newer token.
    const updatedRequest = await persistApproval(request, reviewDetails)
    setViewRequest(updatedRequest)
    setNotice({
      severity: 'success',
      message: `${updatedRequest.requestNumber} was reviewed and saved as Ready to propose.`,
    })
    return updatedRequest
  }

  const saveProposalDraft = (requestId, values) => {
    const draft = createPrototypeProposalDraft({ requestId, values, requests, technicians })
    setProposalDrafts((current) => ({ ...current, [requestId]: draft }))
    setNotice({ severity: 'success', message: 'Proposal draft saved in session memory. The request remains Ready to propose; no appointment was created or email sent.' })
  }

  const appointmentRegistered = (request) => {
    // The accepted appointment replaces the draft; drafts are never stored.
    setProposalDrafts((current) => {
      const next = { ...current }
      delete next[request.id]
      return next
    })
    setNotice({ severity: 'success', message: `${request.requestNumber} was registered as a confirmed appointment and appears in Calendar.` })
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
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h5" fontWeight={800} color="text.primary">
                {viewCopy[activeView].title}
              </Typography>
              <Chip size="small" label="Requests saved" color="info" variant="outlined" />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {viewCopy[activeView].description}
            </Typography>
          </Box>
          {activeView === 'REQUESTS' && (
            <ResponsiveCreateButton
              label="New request"
              onClick={() => setRequestDialog({ mode: 'create' })}
            />
          )}
        </Stack>
      </Box>

      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tabs
          value={activeView}
          onChange={(_, value) => changeView(value)}
          aria-label="Customer Service views"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab
            value="REQUESTS"
            icon={<ViewListRoundedIcon />}
            iconPosition="start"
            label="Requests"
          />
          <Tab
            value="PROPOSALS"
            icon={<EventNoteRoundedIcon />}
            iconPosition="start"
            label="Proposal Workspace"
          />
          <Tab
            value="CALENDAR"
            icon={<CalendarMonthRoundedIcon />}
            iconPosition="start"
            label="Calendar"
          />
        </Tabs>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <TravelCheckAlert requests={requests} />
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Requests, edits, review approval and original sources are saved. Proposal drafts and planning
          are still session-only and reset when you reload. No email is sent or appointment created by approval.
        </Alert>
        {activeView === 'REQUESTS' && profile?.id && profile.isActive
          && ['ADMIN', 'SCHEDULING'].includes(profile.role) && (
          <EmailInboxPanel key={`${profile.id}-${profile.role}-${importPanelRevision}`}
            requests={requests} automation={emailAutomation} automationError={emailAutomationError}
            onRefreshAutomation={refreshEmailAutomation} onOpenRequest={openEmailRequest}
            onRecover={openImportRecovery} onChanged={reloadRequests} />
        )}
        {loading ? (
          <Stack role="status" direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={24} />
            <Typography>Loading Customer Service requests…</Typography>
          </Stack>
        ) : error ? (
          <Alert severity="error" action={<Button color="inherit" onClick={reloadRequests}>Retry</Button>}>
            Requests could not be loaded. {error}
          </Alert>
        ) : activeView === 'CALENDAR' ? (
          <CustomerServiceCalendar
            requests={requests}
            settings={prototypePlanningHours}
            onViewRequest={setViewRequest}
          />
        ) : activeView === 'PROPOSALS' ? (
          <ProposalWorkspace
            requests={requests}
            selectedRequestId={selectedWorkspaceId}
            onSelectRequest={openProposalWorkspace}
            onView={setViewRequest}
            onViewSource={setPdfPreviewRequest}
            onBackToRequests={() => changeView('REQUESTS')}
            proposalDrafts={proposalDrafts}
            onSaveDraft={saveProposalDraft}
            technicians={technicians}
            onDraftDirtyChange={reportDraftDirty}
            onBeforeLeave={beforeDraftNavigation}
            onRegistered={appointmentRegistered}
          />
        ) : (
          <>
            <ServiceSummaryCards
              requests={reviewRequests}
              activeFilter={stageFilter}
              onFilterChange={(value) => {
                setStageFilter(value)
                setPage(0)
              }}
            />

            <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.25}
          useFlexGap
          sx={{
            flexWrap: 'wrap',
            mb: 2,
            p: 2,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <TextField
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
            size="small"
            placeholder="Search request, customer, property, issue or coordinates..."
            sx={{ flex: 1, minWidth: { md: 300 } }}
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
              value={stageFilter}
              onChange={(event) => {
                setStageFilter(event.target.value)
                setPage(0)
              }}
              renderValue={(value) => (
                `Stage: ${inboxFilterOptions.find((option) => option.value === value)?.label ?? 'All requests'}`
              )}
              inputProps={{ 'aria-label': 'Filter requests by workflow stage' }}
            >
              {inboxFilterOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 210 }}>
            <Select
              value={areaFilter}
              onChange={(event) => {
                setAreaFilter(event.target.value)
                setPage(0)
              }}
              renderValue={(value) => `Community: ${value === 'all' ? 'All' : value}`}
              inputProps={{ 'aria-label': 'Filter requests by community' }}
            >
              <MenuItem value="all">All communities</MenuItem>
              <Divider />
              {areaOptions.map((area) => (
                <MenuItem key={area} value={area}>{area}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Badge badgeContent={extraFilterCount} color="primary">
            <Button
              aria-label="Open more request filters"
              variant="outlined"
              color="inherit"
              startIcon={<FilterListRoundedIcon />}
              onClick={(event) => setFiltersAnchor(event.currentTarget)}
              sx={{ height: 40, whiteSpace: 'nowrap' }}
            >
              More filters
            </Button>
          </Badge>

          {(search || stageFilter !== 'all' || areaFilter !== 'all' || extraFilterCount > 0) && (
            <Button color="inherit" onClick={clearFilters}>Clear</Button>
          )}
            </Stack>

            <Box
              sx={{
                width: '100%',
                minWidth: 0,
                bgcolor: 'background.paper',
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  justifyContent: 'space-between',
                  px: 2.5,
                  py: 1.75,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <Box>
                  <Typography variant="subtitle1" fontWeight={800}>
                    Request inbox
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {visibleRequests.length} of {reviewRequests.length} requests in review
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  View the full record, edit its details or open the source PDF.
                </Typography>
              </Stack>
              <RequestInboxList
                requests={paginatedRequests.items}
                totalCount={visibleRequests.length}
                page={paginatedRequests.page}
                rowsPerPage={paginatedRequests.rowsPerPage}
                onPageChange={setPage}
                onRowsPerPageChange={(value) => {
                  setRowsPerPage(value)
                  setPage(0)
                }}
                onView={setViewRequest}
                onEdit={(request) => setRequestDialog({ mode: 'edit', request })}
                onViewPdf={setPdfPreviewRequest}
                onOpenProposal={openProposalWorkspace}
              />
            </Box>
          </>
        )}
      </Box>

      <Popover
        open={Boolean(filtersAnchor)}
        anchorEl={filtersAnchor}
        onClose={() => setFiltersAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 300, p: 2 } } }}
      >
        <Typography variant="subtitle2" fontWeight={800}>More filters</Typography>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <FormControl size="small" fullWidth>
            <Select
              value={priorityFilter}
              onChange={(event) => {
                setPriorityFilter(event.target.value)
                setPage(0)
              }}
              renderValue={(value) => (
                `Priority: ${value === 'all'
                  ? 'All'
                  : priorityOptions.find((option) => option.value === value)?.label}`
              )}
              inputProps={{ 'aria-label': 'Filter requests by priority' }}
            >
              <MenuItem value="all">All priorities</MenuItem>
              {priorityOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <Select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value)
                setPage(0)
              }}
              renderValue={(value) => (
                `Sort: ${inboxSortOptions.find((option) => option.value === value)?.label}`
              )}
              inputProps={{ 'aria-label': 'Sort requests' }}
            >
              {inboxSortOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button color="inherit" onClick={() => {
            setPriorityFilter('all')
            setSortBy('ACTION_REQUIRED')
            setPage(0)
          }}>
            Reset advanced filters
          </Button>
        </Stack>
      </Popover>

      {visibleRequest && (
        <RequestViewDialog
          key={`${visibleRequest.id}-${visibleRequest.workflowStage}-${visibleRequest.updatedAt}`}
          request={visibleRequest}
          requests={requests}
          currentUserName={currentUserName}
          onClose={() => { setViewRequest(null); setEmailRequestId(null) }}
          onMarkReady={markReadyToPropose}
          onViewSource={setPdfPreviewRequest}
          onOpenProposal={openProposalWorkspace}
          onEdit={canEditRequestInView(visibleRequest, activeView) ? (request) => {
            setViewRequest(null)
            setEmailRequestId(null)
            setRequestDialog({ mode: 'edit', request })
          } : undefined}
        />
      )}

      {sourceRequest && (
        <SourcePdfPreviewDialog
          key={sourceRequest.id}
          request={sourceRequest}
          canRetryPdf={pendingPdfIds.includes(sourceRequest.id)}
          onRetryPdf={async () => {
            await retrySourcePdf(sourceRequest.id)
            setImportPanelRevision((value) => value + 1)
          }}
          onClose={() => setPdfPreviewRequest(null)}
        />
      )}

      {requestDialog && ((['create', 'recover'].includes(requestDialog.mode) && activeView === 'REQUESTS') || editableRequest) && (
        <NewRequestPrototypeDialog
          key={editableRequest ? `${editableRequest.id}-${editableRequest.workflowStage}` : requestDialog.emailImport?.id ?? 'new-request'}
          request={editableRequest}
          emailImport={requestDialog.emailImport}
          recoveryRequest={requestDialog.recoveryRequest}
          currentUserName={currentUserName}
          onClose={() => setRequestDialog(null)}
          onCreate={createRequest}
          onSave={updateRequest}
          onViewSource={setPdfPreviewRequest}
        />
      )}

      <Dialog
        open={Boolean(pendingDraftNavigation) || blocker.state === 'blocked'}
        onClose={keepDraftEditing}
        aria-labelledby="unsaved-proposal-title"
        aria-describedby="unsaved-proposal-description"
        maxWidth="xs" fullWidth
      >
        <DialogTitle id="unsaved-proposal-title">Unsaved proposal changes</DialogTitle>
        <DialogContent>
          <DialogContentText id="unsaved-proposal-description">
            Leaving will discard your unsaved technician, date and time selections.
            Any previously saved draft will remain available during this session.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
          <Button color="warning" onClick={discardDraftChanges}>Leave without saving</Button>
          <Button variant="contained" autoFocus onClick={keepDraftEditing}>Keep editing</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice) && ((!viewRequest && !requestDialog) || notice.severity === 'error')}
        autoHideDuration={3500}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={notice?.severity ?? 'info'}
          variant="filled"
          onClose={() => setNotice(null)}
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
