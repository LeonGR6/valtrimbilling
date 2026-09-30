import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { getJobBuilderId } from '../../../jobs/utils/jobRoutes.js'
import { useJobDocuments } from '../../hooks/useJobDocuments.js'
import { countPackagesMissingRequiredDocuments } from '../../services/jobDocumentRecord.js'
import {
  CancelDrawPackageDialog,
  EditDrawPackageDialog,
  TransferDrawPackageCellsDialog,
} from '../DrawPackageCorrectionDialogs.jsx'
import JobDocumentsCatalog from '../documents/JobDocumentsCatalog.jsx'
import { DRAW_PACKAGE_STATUS_LABELS } from '../../services/drawInvoicePackageRecord.js'
import { summarizeDrawPackage } from '../../utils/drawPackages.js'
import { formatCurrency } from '../../utils/drawInvoiceFormatters.js'
import {
  PACKAGE_CATALOG_TABS,
  filterPackageCatalogContexts,
  packageCatalogBuilderOptions,
  packageCatalogCommunityOptions,
  summarizePackageCatalogStatuses,
} from '../../utils/packageCatalog.js'
import PackageTable from './PackageTable.jsx'

const packageSummaryCards = [
  { status: 'DRAFT', icon: <ReceiptLongRoundedIcon />, color: 'primary.main' },
  { status: 'READY_TO_SUBMIT', icon: <CheckCircleRoundedIcon />, color: 'success.main' },
  { status: 'AWAITING_PAYMENT', icon: <AttachMoneyRoundedIcon />, color: 'info.main' },
  { status: 'PAID_CLOSED', icon: <LockRoundedIcon />, color: 'success.main' },
]

function getPackageContext(record, jobs, schedules) {
  const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
  const jobPhases = job?.sequenceSheet?.phases ?? []
  const phaseIds = new Set(
    (record.phaseIds?.length ? record.phaseIds : [record.phaseId])
      .filter((value) => value != null)
      .map(String),
  )
  const phases = jobPhases.filter((candidate) => phaseIds.has(String(candidate.id)))
  const phase = phases[0]
  const schedule = schedules.find(
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

function PackageSummaryCard({ status, icon, color, count, total, selected, onSelect }) {
  return (
    <Card
      variant="outlined"
      sx={{ borderColor: selected ? color : 'divider', minWidth: 0 }}
    >
      <CardActionArea onClick={onSelect} aria-label={`Show ${DRAW_PACKAGE_STATUS_LABELS[status]} Packages`}>
        <CardContent sx={{ p: '18px !important' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{
              width: 42, height: 42, flexShrink: 0, borderRadius: 1.5,
              display: 'grid', placeItems: 'center',
              bgcolor: 'action.hover', color,
            }}>
              {icon}
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={750} color="text.secondary">
                {DRAW_PACKAGE_STATUS_LABELS[status]}
              </Typography>
              <Typography variant="h5" fontWeight={850} sx={{ lineHeight: 1.3 }}>
                {count}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatCurrency(total)} invoice total
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

function MissingDocumentsSummaryCard({ count, loading, unavailable }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 0 }}>
      <CardContent sx={{ p: '18px !important' }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{
            width: 42, height: 42, flexShrink: 0, borderRadius: 1.5,
            display: 'grid', placeItems: 'center',
            bgcolor: 'warning.light', color: 'warning.dark',
          }}>
            <FolderOpenRoundedIcon />
          </Box>
          <Box>
            <Typography variant="body2" fontWeight={750} color="text.secondary">
              Packages Missing Documents
            </Typography>
            {loading ? (
              <Box sx={{ minHeight: 32, display: 'flex', alignItems: 'center' }}>
                <CircularProgress size={20} aria-label="Loading missing document Jobs" />
              </Box>
            ) : (
              <Typography variant="h5" fontWeight={850} sx={{ lineHeight: 1.3 }}>
                {unavailable ? '—' : count}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {unavailable
                ? 'Document status unavailable'
                : 'Packages with pending requirements'}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function PackageCatalog({
  jobs,
  schedules,
  packages,
  canManage,
  error,
  onRetry,
  onOpen,
  onCreate,
  onEdit,
  onTransfer,
  onDelete,
}) {
  const [catalogTab, setCatalogTab] = useState('packages')
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState('ALL')
  const [builderFilter, setBuilderFilter] = useState('ALL')
  const [communityFilter, setCommunityFilter] = useState('ALL')
  const [catalogAction, setCatalogAction] = useState(null)
  const jobDocuments = useJobDocuments(jobs)
  const contexts = useMemo(
    () => packages.map((record) => getPackageContext(record, jobs, schedules)).filter(Boolean),
    [jobs, packages, schedules],
  )
  const activeContexts = useMemo(
    () => filterPackageCatalogContexts(contexts),
    [contexts],
  )
  const builderOptions = useMemo(
    () => packageCatalogBuilderOptions(contexts),
    [contexts],
  )
  const communityOptions = useMemo(
    () => packageCatalogCommunityOptions(contexts, builderFilter),
    [contexts, builderFilter],
  )
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
    () => filterPackageCatalogContexts(scopedContexts, { status: statusTab }),
    [scopedContexts, statusTab],
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

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          pt: 3,
          pb: 0,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={800}>
              Draw & Invoice Packages
            </Typography>
            <Typography variant="h5" fontWeight={800}>
              {catalogTab === 'packages' ? 'Packages' : 'Documents'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
              {catalogTab === 'packages'
                ? 'Review active Packages by status and manage their billing workflow.'
                : 'Keep each Job’s releases, purchase orders, and payment schedules together.'}
            </Typography>
          </Box>
          {catalogTab === 'packages' && (
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={onCreate}
              disabled={!canManage}s
              disableElevation
            >
              Create Package
            </Button>
          )}
        </Stack>

        <Tabs
          value={catalogTab}
          onChange={(_event, value) => setCatalogTab(value)}
          aria-label="Draw and Invoice sections"
          sx={{ mt: 2.5 }}
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
        </Tabs>
      </Box>

      {catalogTab === 'documents' ? (
        <JobDocumentsCatalog jobs={jobs} documentState={jobDocuments} />
      ) : (
        <Box sx={{ p: { xs: 2.5, md: 4 } }}>
          {error && (
            <Alert
              severity="error"
              action={<Button color="inherit" onClick={onRetry}>Retry</Button>}
              sx={{ mb: 2 }}
            >
              {error}
            </Alert>
          )}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 1.5,
            mb: 2.5,
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
                onSelect={() => setStatusTab(status)}
              />
            ))}
            <MissingDocumentsSummaryCard
              count={missingDocumentsPackageCount ?? 0}
              loading={jobDocuments.loading && !jobDocuments.initialized}
              unavailable={!jobDocuments.loading && missingDocumentsPackageCount == null}
            />
          </Box>

          <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            <Tabs
              value={statusTab}
              onChange={(_, value) => setStatusTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="Filter Packages by status"
              sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}
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
              spacing={1.5}
              sx={{ p: 2, alignItems: { md: 'center' } }}
            >
              <TextField
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Package, Invoice, Job or Phase"
                size="small"
                aria-label="Search Packages"
                sx={{ flex: 2, minWidth: { md: 230 } }}
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
                sx={{ flex: 1, minWidth: { md: 170 } }}
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
                sx={{ flex: 1, minWidth: { md: 170 } }}
              >
                <MenuItem value="ALL">All communities</MenuItem>
                {communityOptions.map((community) => (
                  <MenuItem key={community} value={community}>{community}</MenuItem>
                ))}
              </TextField>
              <Button color="inherit" onClick={clearFilters} sx={{ flexShrink: 0 }}>
                Clear filters
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pb: 1.5 }}>
              Cards follow the current filters. Missing Documents counts each Package whose Job
              {' '}still has pending requirements.
            </Typography>
          </Box>

          <PackageTable
            filteredContexts={filteredContexts}
            activeContexts={activeContexts}
            documentState={jobDocuments}
            canManage={canManage}
            onOpen={onOpen}
            onAction={(action, selected) => setCatalogAction({
              action,
              packageId: selected.record.id,
            })}
            onClearFilters={clearFilters}
          />
        </Box>
      )}

      {catalogAction?.action === 'edit' && selectedContext && (
        <EditDrawPackageDialog
          record={selectedContext.record}
          job={selectedContext.job}
          phase={selectedContext.phase}
          phases={selectedContext.phases}
          schedule={selectedContext.schedule}
          packages={packages}
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
    </Box>
  )
}
