import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { useCurrentDate } from '../../../../hooks/useCurrentDate.js'
import { usePersistentState, isStoredString } from '../../../../hooks/usePersistentState.js'
import { getJobBuilderId } from '../../../jobs/utils/jobRoutes.js'
import { useJobDocuments } from '../../hooks/useJobDocuments.js'
import { useQuickbooksConnection } from '../../hooks/useQuickbooksConnection.js'
import { countPackagesMissingRequiredDocuments } from '../../services/jobDocumentRecord.js'
import {
  CancelDrawPackageDialog,
  EditDrawPackageDialog,
  TransferDrawPackageCellsDialog,
} from '../DrawPackageCorrectionDialogs.jsx'
import JobDocumentsCatalog from '../documents/JobDocumentsCatalog.jsx'
import ReceivablesCatalog from '../receivables/ReceivablesCatalog.jsx'
import { DRAW_PACKAGE_STATUS_LABELS } from '../../services/drawInvoicePackageRecord.js'
import { localDateKey } from '../../utils/calendarDrawSuggestions.js'
import { summarizeDrawPackage } from '../../utils/drawPackages.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import { buildPackageSuggestions } from '../../utils/packageSuggestions.js'
import { buildRetentionSuggestions } from '../../utils/retentionSuggestions.js'
import {
  PACKAGE_CATALOG_TABS,
  filterPackageCatalogContexts,
  isValidPackageSort,
  nextPackageSort,
  packageCatalogBuilderOptions,
  packageCatalogCommunityOptions,
  sortPackageCatalogContexts,
  summarizePackageCatalogStatuses,
} from '../../utils/packageCatalog.js'
import MissedCutoffsPanel from './MissedCutoffsPanel.jsx'
import PackageSuggestionsPanel from './PackageSuggestionsPanel.jsx'
import RetentionSuggestionsPanel from './RetentionSuggestionsPanel.jsx'
import PackageTable from './PackageTable.jsx'
import QuickbooksConnectButton from './QuickbooksConnectButton.jsx'
import QuickbooksConnectionsDialog from './QuickbooksConnectionsDialog.jsx'
import QuickbooksCustomersDialog from './QuickbooksCustomersDialog.jsx'
import QuickbooksModeSwitch from './QuickbooksModeSwitch.jsx'

const packageSummaryCards = [
  { status: 'DRAFT', icon: <ReceiptLongRoundedIcon />, color: 'primary.main' },
  { status: 'AWAITING_PAYMENT', icon: <AttachMoneyRoundedIcon />, color: 'info.main' },
  { status: 'PAID_CLOSED', icon: <LockRoundedIcon />, color: 'success.main' },
]

function getPackageContext(record, jobs, schedules, jobBillingSetupVersions) {
  const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
  const jobPhases = job?.sequenceSheet?.phases ?? []
  const phaseIds = new Set(
    (record.phaseIds?.length ? record.phaseIds : [record.phaseId])
      .filter((value) => value != null)
      .map(String),
  )
  const phases = record.retentionRelease?.scopeType === 'JOB'
    ? jobPhases
    : jobPhases.filter((candidate) => phaseIds.has(String(candidate.id)))
  const phase = phases[0] ?? jobPhases[0]
  const schedule = jobBillingSetupVersions.find(
    (candidate) => String(candidate.id) === String(record.setupVersionId),
  ) ?? schedules.find(
    (candidate) =>
      String(candidate.builderId) === String(getJobBuilderId(job)),
  )

  if (!job || !phase) return null
  return {
    record,
    job,
    phase,
    phases,
    schedule,
    summary: summarizeDrawPackage(record, job, phases, schedule),
  }
}

const summaryCardSx = (color, selected, interactive) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  minWidth: 0,
  width: '100%',
  px: 1.5,
  py: 1,
  textAlign: 'left',
  border: 1,
  borderColor: selected ? color : 'divider',
  borderRadius: 2,
  bgcolor: 'background.paper',
  boxShadow: selected ? (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` : 'none',
  transition: 'border-color 120ms, background-color 120ms',
  cursor: interactive ? 'pointer' : 'default',
  '&:hover': interactive ? { bgcolor: 'action.hover' } : undefined,
  '&.Mui-focusVisible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
})

function SummaryIcon({ children, color, bgcolor }) {
  return (
    <Box sx={{
      width: 34, height: 34, flexShrink: 0, borderRadius: 1.5,
      display: 'grid', placeItems: 'center', '& svg': { fontSize: 20 },
      bgcolor: bgcolor ?? 'action.hover', color,
    }}>
      {children}
    </Box>
  )
}

function PackageSummaryCard({ status, icon, color, count, total, selected, onSelect }) {
  return (
    <ButtonBase
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Show ${DRAW_PACKAGE_STATUS_LABELS[status]} Packages`}
      sx={summaryCardSx(color, selected, true)}
    >
      <SummaryIcon color={color}>{icon}</SummaryIcon>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
          <Typography variant="h6" fontWeight={850} sx={{ lineHeight: 1.2 }}>
            {count}
          </Typography>
          <Typography variant="body2" fontWeight={750} color="text.secondary" noWrap>
            {DRAW_PACKAGE_STATUS_LABELS[status]}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(total)} invoice total
        </Typography>
      </Box>
    </ButtonBase>
  )
}

function MissingDocumentsSummaryCard({ count, loading, unavailable }) {
  return (
    <Box sx={summaryCardSx('divider', false, false)}>
      <SummaryIcon color="warning.dark" bgcolor="warning.light">
        <FolderOpenRoundedIcon />
      </SummaryIcon>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
          {loading ? (
            <CircularProgress size={16} aria-label="Loading missing document Jobs" />
          ) : (
            <Typography variant="h6" fontWeight={850} sx={{ lineHeight: 1.2 }}>
              {unavailable ? '—' : count}
            </Typography>
          )}
          <Typography variant="body2" fontWeight={750} color="text.secondary" noWrap>
            Missing Documents
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {unavailable ? 'Document status unavailable' : 'Packages with pending requirements'}
        </Typography>
      </Box>
    </Box>
  )
}

export default function PackageCatalog({
  jobs,
  schedules,
  jobBillingSetupVersions,
  packages,
  productionActivities,
  productionActivitiesLoading,
  productionActivitiesError,
  canManage,
  createDisabled,
  error,
  onRetry,
  onOpen,
  onCreate,
  onReviewSuggestion,
  onReviewRetention,
  onEdit,
  onTransfer,
  onDelete,
}) {
  const [catalogTab, setCatalogTab] = usePersistentState(
    'draw-invoice:section',
    'packages',
    (value) => value === 'packages' || value === 'documents' || value === 'ar',
  )
  const [search, setSearch] = usePersistentState('draw-invoice:packages:search', '', isStoredString)
  const [statusTab, setStatusTab] = usePersistentState(
    'draw-invoice:packages:status',
    'ALL',
    (value) => PACKAGE_CATALOG_TABS.some((tab) => tab.value === value),
  )
  const [storedBuilderFilter, setBuilderFilter] = usePersistentState(
    'draw-invoice:packages:builder',
    'ALL',
    isStoredString,
  )
  const [storedCommunityFilter, setCommunityFilter] = usePersistentState(
    'draw-invoice:packages:community',
    'ALL',
    isStoredString,
  )
  const [packageSort, setPackageSort] = usePersistentState(
    'draw-invoice:packages:sort',
    null,
    isValidPackageSort,
  )
  const [catalogAction, setCatalogAction] = useState(null)
  const [customersDialogOpen, setCustomersDialogOpen] = useState(false)
  const [connectionsDialogOpen, setConnectionsDialogOpen] = useState(false)
  const [today] = useCurrentDate()
  const asOfDate = localDateKey(today)
  const jobDocuments = useJobDocuments(jobs)
  const quickbooks = useQuickbooksConnection()
  const packageSuggestions = useMemo(
    () => buildPackageSuggestions({
      jobs,
      schedules,
      jobBillingSetupVersions,
      packages,
      productionActivities,
      asOfDate,
    }),
    [
      asOfDate,
      jobBillingSetupVersions,
      jobs,
      packages,
      productionActivities,
      schedules,
    ],
  )
  const retentionSuggestions = useMemo(
    () => buildRetentionSuggestions({
      jobs,
      schedules,
      jobBillingSetupVersions,
      packages,
      asOfDate,
    }),
    [asOfDate, jobBillingSetupVersions, jobs, packages, schedules],
  )
  const contexts = useMemo(
    () => packages.map((record) => getPackageContext(
      record,
      jobs,
      schedules,
      jobBillingSetupVersions,
    )).filter(Boolean),
    [jobBillingSetupVersions, jobs, packages, schedules],
  )
  const activeContexts = useMemo(
    () => filterPackageCatalogContexts(contexts),
    [contexts],
  )
  const builderOptions = useMemo(
    () => packageCatalogBuilderOptions(contexts),
    [contexts],
  )
  // A remembered Builder or Community that no longer exists falls back to "All".
  const builderFilter = storedBuilderFilter === 'ALL'
    || builderOptions.some(({ id }) => id === storedBuilderFilter)
    ? storedBuilderFilter
    : 'ALL'
  const communityOptions = useMemo(
    () => packageCatalogCommunityOptions(contexts, builderFilter),
    [contexts, builderFilter],
  )
  const communityFilter = storedCommunityFilter === 'ALL'
    || communityOptions.includes(storedCommunityFilter)
    ? storedCommunityFilter
    : 'ALL'
  const scopedContexts = useMemo(
    () => filterPackageCatalogContexts(activeContexts, {
      search, builderId: builderFilter, community: communityFilter,
    }),
    [activeContexts, search, builderFilter, communityFilter],
  )
  const statusSummary = useMemo(
    () => summarizePackageCatalogStatuses(scopedContexts),
    [scopedContexts],
  )
  const missingDocumentsPackageCount = useMemo(() => {
    if (!jobDocuments.initialized) return null

    return countPackagesMissingRequiredDocuments(
      scopedContexts.map(({ record }) => record.jobId),
      jobDocuments.documentsByJob,
      jobDocuments.requiredTypeKeysByJob,
    )
  }, [
    jobDocuments.documentsByJob,
    jobDocuments.initialized,
    jobDocuments.requiredTypeKeysByJob,
    scopedContexts,
  ])
  const filteredContexts = useMemo(
    () => sortPackageCatalogContexts(
      filterPackageCatalogContexts(scopedContexts, { status: statusTab }),
      packageSort,
    ),
    [packageSort, scopedContexts, statusTab],
  )
  const selectedContext = contexts.find(
    ({ record }) => String(record.id) === String(catalogAction?.packageId),
  )
  const clearFilters = () => {
    setSearch('')
    setBuilderFilter('ALL')
    setCommunityFilter('ALL')
    setStatusTab('ALL')
  }

  const location = useLocation()
  const navigate = useNavigate()
  const [suggestionsOpen, setSuggestionsOpen] = usePersistentState(
    'draw-invoice:packages:suggestions-open',
    true,
    (value) => typeof value === 'boolean',
  )
  const [missedOpen, setMissedOpen] = usePersistentState(
    'draw-invoice:packages:missed-open',
    true,
    (value) => typeof value === 'boolean',
  )
  const [retentionOpen, setRetentionOpen] = usePersistentState(
    'draw-invoice:packages:retention-open',
    true,
    (value) => typeof value === 'boolean',
  )
  // A link to the suggestions (from Home) always shows them.
  const linkedToSuggestions = location.hash === '#package-suggestions'
  const showSuggestions = suggestionsOpen || linkedToSuggestions
  const toggleSuggestions = () => {
    // Folding the list must also drop the link's hash, or it would stay forced open.
    if (linkedToSuggestions) navigate({ hash: '' }, { replace: true })
    setSuggestionsOpen(!showSuggestions)
  }
  const missedCutoffSuggestions = packageSuggestions.filter((suggestion) => suggestion.isMissedCutoff)
  const upcomingSuggestions = packageSuggestions.filter((suggestion) => !suggestion.isMissedCutoff)
  const filtersActive = search !== '' || builderFilter !== 'ALL'
    || communityFilter !== 'ALL' || statusTab !== 'ALL'

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2, md: 3 },
          pt: 1.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 3, rowGap: 0.5 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h1" fontWeight={800} letterSpacing="-0.01em" sx={{ lineHeight: 1.2 }}>
              Draw & Invoice
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              {catalogTab === 'packages'
                ? 'Review active Packages by status and manage their billing workflow.'
                : catalogTab === 'documents'
                  ? 'Keep each Job’s releases, purchase orders, and payment schedules together.'
                  : 'See what is owed on QuickBooks invoices and how long it has been past due.'}
            </Typography>
          </Box>
          {catalogTab === 'packages' && (
            <Stack
              direction="row"
              spacing={1}
              sx={{ ml: 'auto', alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
            >
              <QuickbooksModeSwitch
                activeEnvironment={quickbooks.activeEnvironment}
                connections={quickbooks.connections}
                canSwitch={quickbooks.canSwitch}
                switching={quickbooks.switching}
                loading={quickbooks.loading}
                onSwitch={quickbooks.switchMode}
              />
              <QuickbooksConnectButton
                compact
                connection={quickbooks.connection}
                loading={quickbooks.loading}
                canConnect={quickbooks.canConnect}
                lastInvoiceAt={quickbooks.lastInvoiceAt}
                onConnect={quickbooks.connect}
              />
              {quickbooks.canManageCustomers && (
                <Tooltip title="QuickBooks connections">
                  <IconButton
                    aria-label="QuickBooks connections"
                    onClick={() => setConnectionsDialogOpen(true)}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}
                  >
                    <LinkRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {quickbooks.connection?.status === 'CONNECTED' && quickbooks.canManageCustomers && (
                <Tooltip title="QuickBooks customers">
                  <IconButton
                    aria-label="QuickBooks customers"
                    onClick={() => setCustomersDialogOpen(true)}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}
                  >
                    <PeopleAltRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={onCreate}
                disabled={!canManage || createDisabled}
                disableElevation
              >
                New Package
              </Button>
            </Stack>
          )}
        </Stack>

        <Tabs
          value={catalogTab}
          onChange={(_event, value) => setCatalogTab(value)}
          aria-label="Draw and Invoice sections"
          sx={{ mt: 0.5, minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0 } }}
        >
          <Tab
            value="packages"
            icon={<ReceiptLongRoundedIcon />}
            iconPosition="start"
            label="Packages"
          />
          <Tab
            value="documents"
            icon={<FolderOpenRoundedIcon />}
            iconPosition="start"
            label="Documents"
          />
          <Tab
            value="ar"
            icon={<AccountBalanceWalletRoundedIcon />}
            iconPosition="start"
            label="A/R"
          />
        </Tabs>
      </Box>

      {catalogTab === 'documents' ? (
        <JobDocumentsCatalog jobs={jobs} documentState={jobDocuments} />
      ) : catalogTab === 'ar' ? (
        <ReceivablesCatalog jobs={jobs} />
      ) : (
        <Stack spacing={1.5} sx={{ p: { xs: 2, md: 3 } }}>
          {error && (
            <Alert
              severity="error"
              action={<Button color="inherit" onClick={onRetry}>Retry</Button>}
            >
              {error}
            </Alert>
          )}
          {quickbooks.error && (
            <Alert severity="error" onClose={quickbooks.dismissError}>
              {quickbooks.error}
            </Alert>
          )}
          {quickbooks.notice && (
            <Alert severity="success" onClose={quickbooks.dismissNotice}>
              {quickbooks.notice}
            </Alert>
          )}
          <MissedCutoffsPanel
            suggestions={missedCutoffSuggestions}
            disabled={!canManage || createDisabled}
            open={missedOpen}
            onToggle={() => setMissedOpen((current) => !current)}
            onReview={onReviewSuggestion}
          />
          <PackageSuggestionsPanel
            suggestions={upcomingSuggestions}
            loading={productionActivitiesLoading}
            error={productionActivitiesError}
            disabled={!canManage || createDisabled}
            open={showSuggestions}
            onToggle={toggleSuggestions}
            onReview={onReviewSuggestion}
          />
          <RetentionSuggestionsPanel
            suggestions={retentionSuggestions}
            disabled={!canManage || createDisabled}
            open={retentionOpen}
            onToggle={() => setRetentionOpen((current) => !current)}
            onReview={onReviewRetention}
          />
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 1.5,
          }}>
            {packageSummaryCards.map(({ status, icon, color }) => (
              <PackageSummaryCard
                key={status}
                status={status}
                icon={icon}
                color={color}
                count={statusSummary[status].count}
                total={statusSummary[status].total}
                selected={statusTab === status}
                onSelect={() => setStatusTab(statusTab === status ? 'ALL' : status)}
              />
            ))}
            <MissingDocumentsSummaryCard
              count={missingDocumentsPackageCount ?? 0}
              loading={jobDocuments.loading && !jobDocuments.initialized}
              unavailable={!jobDocuments.loading && missingDocumentsPackageCount == null}
            />
          </Box>

          <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            <Stack
              direction={{ xs: 'column', lg: 'row' }}
              sx={{ alignItems: { lg: 'center' } }}
            >
              <Tabs
                value={statusTab}
                onChange={(_, value) => setStatusTab(value)}
                variant="scrollable"
                scrollButtons="auto"
                aria-label="Filter Packages by status"
                sx={{
                  flexShrink: 0,
                  minHeight: 44,
                  px: 1,
                  maxWidth: '100%',
                  borderBottom: { xs: 1, lg: 0 },
                  borderColor: 'divider',
                  '& .MuiTab-root': { minHeight: 44, py: 0 },
                }}
              >
                {PACKAGE_CATALOG_TABS.map(({ value, label }) => (
                  <Tab
                    key={value}
                    value={value}
                    label={`${label} (${value === 'ALL'
                      ? scopedContexts.length
                      : statusSummary[value].count})`}
                  />
                ))}
              </Tabs>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                sx={{ flex: 1, minWidth: 0, p: 1, alignItems: { md: 'center' } }}
              >
                <TextField
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search Package, Invoice, Job or Phase"
                  size="small"
                  aria-label="Search Packages"
                  sx={{ flex: 2, minWidth: { md: 200 } }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchRoundedIcon color="action" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <TextField
                  select
                  size="small"
                  label="Builder"
                  value={builderFilter}
                  onChange={(event) => {
                    setBuilderFilter(event.target.value)
                    setCommunityFilter('ALL')
                  }}
                  sx={{ flex: 1, minWidth: { md: 150 } }}
                >
                  <MenuItem value="ALL">All builders</MenuItem>
                  {builderOptions.map(({ id, name }) => (
                    <MenuItem key={id} value={id}>{name}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Community"
                  value={communityFilter}
                  onChange={(event) => setCommunityFilter(event.target.value)}
                  sx={{ flex: 1, minWidth: { md: 150 } }}
                >
                  <MenuItem value="ALL">All communities</MenuItem>
                  {communityOptions.map((community) => (
                    <MenuItem key={community} value={community}>{community}</MenuItem>
                  ))}
                </TextField>
                <Button
                  color="inherit"
                  onClick={clearFilters}
                  disabled={!filtersActive}
                  sx={{ flexShrink: 0 }}
                >
                  Clear filters
                </Button>
                <Tooltip title="The cards follow the current filters. Missing Documents counts each Package whose Job still has pending requirements.">
                  <IconButton
                    size="small"
                    aria-label="About the summary cards"
                    sx={{ display: { xs: 'none', md: 'inline-flex' }, flexShrink: 0 }}
                  >
                    <InfoOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>

          <PackageTable
            filteredContexts={filteredContexts}
            activeContexts={activeContexts}
            documentState={jobDocuments}
            canManage={canManage}
            sort={packageSort}
            onSort={(column) => setPackageSort((current) => nextPackageSort(current, column))}
            onOpen={onOpen}
            onAction={(action, selected) => setCatalogAction({
              action,
              packageId: selected.record.id,
            })}
            onClearFilters={clearFilters}
          />
        </Stack>
      )}

      {catalogAction?.action === 'edit' && selectedContext && (
        <EditDrawPackageDialog
          record={selectedContext.record}
          job={selectedContext.job}
          phase={selectedContext.phase}
          phases={selectedContext.phases}
          schedule={selectedContext.schedule}
          packages={packages}
          productionActivities={productionActivities}
          onClose={() => setCatalogAction(null)}
          onSave={onEdit}
        />
      )}
      {catalogAction?.action === 'transfer' && selectedContext && (
        <TransferDrawPackageCellsDialog
          target={selectedContext.record}
          packages={packages}
          onClose={() => setCatalogAction(null)}
          onTransfer={onTransfer}
        />
      )}
      {catalogAction?.action === 'delete' && selectedContext && (
        <CancelDrawPackageDialog
          record={selectedContext.record}
          onClose={() => setCatalogAction(null)}
          onCancel={onDelete}
        />
      )}
      {connectionsDialogOpen && (
        <QuickbooksConnectionsDialog
          connections={quickbooks.connections}
          activeEnvironment={quickbooks.activeEnvironment}
          canConnect={quickbooks.canConnect}
          onConnect={quickbooks.connectEnvironment}
          onClose={() => setConnectionsDialogOpen(false)}
        />
      )}
      {customersDialogOpen && quickbooks.connection && (
        <QuickbooksCustomersDialog
          environment={quickbooks.connection.environment}
          onClose={() => setCustomersDialogOpen(false)}
        />
      )}
    </Box>
  )
}
