import { lazy, Suspense, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Backdrop,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import AttachMoneyRoundedIcon from '@mui/icons-material/AttachMoneyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import MoveToInboxRoundedIcon from '@mui/icons-material/MoveToInboxRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import { useAuth } from '../../../auth/context/useAuth.js'
import { useBuilderDrawSchedules } from '../../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { useProductionActivities } from '../../../calendar/context/useProductionActivities.js'
import JobModuleNavigation from '../../../jobs/components/JobModuleNavigation.jsx'
import { useJobs } from '../../../jobs/context/useJobs.js'
import {
  getJobBuilderId,
  jobBelongsToBuilder,
  jobDrawInvoicePath,
  jobPlanPricingPath,
  jobSequenceSheetPath,
} from '../../../jobs/utils/jobRoutes.js'
import {
  formatBuilding,
  formatPhase,
} from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import { useDrawInvoicePackages } from '../../context/useDrawInvoicePackages.js'
import { useQuickbooksInvoiceSync } from '../../hooks/useQuickbooksInvoiceSync.js'
import {
  canCorrectDrawPackage,
} from '../../services/drawInvoicePackageRecord.js'
import {
  canCreateQuickbooksInvoice,
  quickbooksPackageStatusView,
} from '../../services/quickbooksRecord.js'
import {
  buildPackageOptionHistory,
  summarizeDrawPackage,
} from '../../utils/drawPackages.js'
import { buildDrawWorksheet } from '../../utils/drawWorksheet.js'
import {
  isMultiPhasePackage,
  packagePhaseLabels,
  phaseScopeLabel,
} from '../../utils/packagePhaseScope.js'
import {
  formatCurrency,
  formatDate,
} from '../../utils/drawInvoiceFormatters.js'
import { canDeleteDraftPackage } from '../../utils/packageCatalog.js'
import {
  CancelDrawPackageDialog,
  EditDrawPackageDialog,
  TransferDrawPackageCellsDialog,
} from '../DrawPackageCorrectionDialogs.jsx'
import CreateDrawDialog from '../dialogs/CreateDrawDialog.jsx'
import QuickbooksInvoiceDialog from './QuickbooksInvoiceDialog.jsx'
import QuickbooksStatusCard from '../shared/QuickbooksStatusCard.jsx'
import {
  MetricCard,
  PackageStatusChip,
  PackageStatusControl,
  ReadinessChip,
} from '../shared/PackageUi.jsx'
import {
  DrawWorksheetTable,
  PackageHardwareTable,
  PackageOptionsTable,
  PackageUtilityTable,
} from './PackageTables.jsx'

// Loaded on demand: it brings the Release generation screens.
const GeneratePackageReleaseDialog = lazy(
  () => import('../../../release-templates/components/GeneratePackageReleaseDialog.jsx'),
)

// The same roles that can save Job documents can generate a Package's Release.
const RELEASE_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']

export default function DrawPackageDetail() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId, packageId } = useParams()
  const {
    jobs,
    loading: jobsLoading,
    error: jobsError,
    refreshJobs,
  } = useJobs()
  const {
    builderDrawSchedules,
    jobBillingSetupVersions,
    loading: billingSetupsLoading,
    error: billingSetupsError,
    refreshBuilderBillingSetups,
  } = useBuilderDrawSchedules()
  const {
    activities: productionActivities,
    loading: productionActivitiesLoading,
    error: productionActivitiesError,
  } = useProductionActivities()
  const {
    drawInvoicePackages,
    loading: packagesLoading,
    error: packagesError,
    saving,
    canManageDrawInvoicePackages,
    refreshDrawInvoicePackages,
    createDrawInvoicePackage,
    updateDrawInvoicePackageStatus,
    editDrawInvoicePackage,
    transferDrawPackageCells,
    cancelDrawInvoicePackage,
  } = useDrawInvoicePackages()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [correctionDialog, setCorrectionDialog] = useState(null)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [quickbooksDialogOpen, setQuickbooksDialogOpen] = useState(false)
  const { profile } = useAuth()
  const focusedPackageRecord = drawInvoicePackages.find(
    (record) =>
      String(record.id) === String(packageId) &&
      String(record.jobId) === String(jobId),
  )
  const quickbooksSync = useQuickbooksInvoiceSync(focusedPackageRecord)

  const handleCreate = async (input) => {
    const record = await createDrawInvoicePackage(input)
    const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
    setCreateDialogOpen(false)
    navigate(
      jobDrawInvoicePath(
        getJobBuilderId(job),
        record.jobId,
        record.phaseId,
        record.id,
      ),
    )
  }

  const handleRetry = () => {
    Promise.all([
      refreshJobs(),
      refreshDrawInvoicePackages(),
      refreshBuilderBillingSetups(),
    ]).catch(() => {})
  }

  const loading = jobsLoading || packagesLoading || billingSetupsLoading
  const error = jobsError || packagesError || billingSetupsError

  if (loading && (jobs.length === 0 || drawInvoicePackages.length === 0)) {
    return (
      <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
        <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={32} />
          <Typography color="text.secondary">Loading Draw & Invoice Packages…</Typography>
        </Stack>
      </Box>
    )
  }

  const focusedJob = jobs.find(
    (job) =>
      String(job.id) === String(jobId) && jobBelongsToBuilder(job, builderId),
  )

  if (!focusedJob) {
    return (
      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Alert
          severity="error"
          action={<Button color="inherit" onClick={() => navigate('/draw-invoice')}>All packages</Button>}
        >
          This Job does not exist or does not belong to the selected builder.
        </Alert>
      </Box>
    )
  }

  const phases = focusedJob.sequenceSheet?.phases ?? []
  const selectedPhase =
    phases.find((phase) => String(phase.id) === String(phaseId)) ?? phases[0]
  const focusedBuilderId = getJobBuilderId(focusedJob)
  const focusedPackage = drawInvoicePackages.find(
    (record) =>
      String(record.id) === String(packageId) &&
      String(record.jobId) === String(focusedJob.id),
  )
  const jobBillingSetupIsAvailable = jobBillingSetupVersions.some(
    (version) => String(version.id) === String(focusedJob.billingSetupVersionId),
  )
  const scheduleVersionId = focusedPackage?.setupVersionId
    ?? focusedJob.billingSetupVersionId
  const schedule = jobBillingSetupVersions.find(
    (version) => String(version.id) === String(scheduleVersionId),
  ) ?? builderDrawSchedules.find(
    (item) => String(item.builderId) === String(focusedBuilderId),
  )
  const worksheet = buildDrawWorksheet(focusedJob, selectedPhase, schedule)
  const focusedPackagePhaseIds = new Set(
    (focusedPackage?.phaseIds?.length
      ? focusedPackage.phaseIds
      : [focusedPackage?.phaseId])
      .filter((value) => value != null)
      .map(String),
  )
  const isRetentionRelease = focusedPackage?.packageType === 'RETENTION_RELEASE'
  const focusedPackagePhases = focusedPackage?.retentionRelease?.scopeType === 'JOB'
    ? phases
    : phases.filter((phase) => focusedPackagePhaseIds.has(String(phase.id)))
  const chargedOptionRows = buildPackageOptionHistory(
    drawInvoicePackages,
    focusedPackage,
  )
  const packageSummary = focusedPackage
    ? summarizeDrawPackage(
        { ...focusedPackage, chargedOptionRows },
        focusedJob,
        focusedPackagePhases,
        schedule,
      )
    : null
  const isMultiPhase = Boolean(focusedPackage)
    && !isRetentionRelease
    && isMultiPhasePackage(packageSummary?.phaseCount)
  const canCorrectFocusedPackage = canManageDrawInvoicePackages
    && canCorrectDrawPackage(focusedPackage)
  const canDeleteFocusedPackage = canManageDrawInvoicePackages
    && canDeleteDraftPackage(focusedPackage)
  const canSendToQuickbooks = canCreateQuickbooksInvoice(focusedPackage, profile?.role)
  const quickbooksView = quickbooksPackageStatusView({
    record: focusedPackage,
    sync: quickbooksSync,
    canSend: canSendToQuickbooks,
  })

  const handlePhaseChange = (event) => {
    navigate(jobDrawInvoicePath(focusedBuilderId, focusedJob.id, event.target.value))
  }

  const handlePackageStatusChange = (event) => {
    updateDrawInvoicePackageStatus(focusedPackage.id, event.target.value)
      .catch(() => {})
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 2.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Button
          color="inherit"
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate('/draw-invoice')}
          sx={{ mb: 1.5 }}
        >
          All packages
        </Button>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={800}>
              {isRetentionRelease
                ? 'Retention Release'
                : `${focusedJob.builder} / ${focusedJob.community}`}
            </Typography>
            <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h5" fontWeight={850}>
                {focusedPackage?.packageNumber ?? `Job #${focusedJob.code} Draw worksheet`}
              </Typography>
              {isMultiPhase && (
                <Chip
                  color="warning"
                  icon={<LayersRoundedIcon />}
                  label={`Multi-phase · ${packageSummary.phaseCount} Phases / Buildings`}
                  sx={{ fontWeight: 750 }}
                />
              )}
            </Stack>
            {selectedPhase && !isRetentionRelease && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Job #{focusedJob.code} · {isMultiPhase
                  ? packagePhaseLabels(packageSummary.phaseSummaries).join(' · ')
                  : `${formatPhase(selectedPhase.name)} · ${formatBuilding(selectedPhase.building)}`}
                {focusedPackage?.invoiceNumber
                  ? ` · Invoice ${focusedPackage.invoiceNumber}`
                  : ''}
              </Typography>
            )}
            {isRetentionRelease && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Job #{focusedJob.code} · {focusedPackage.retentionRelease?.scopeType === 'JOB'
                  ? 'Per Job'
                  : `${formatPhase(focusedPackage.retentionRelease?.phaseCode)} · ${formatBuilding(focusedPackage.retentionRelease?.building)}`}
                {focusedPackage.invoiceNumber
                  ? ` · Invoice ${focusedPackage.invoiceNumber}`
                  : ''}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {focusedPackage ? (
              canManageDrawInvoicePackages && focusedPackage.status !== 'CANCELLED' ? (
                <PackageStatusControl
                  status={focusedPackage.status}
                  disabled={saving}
                  onChange={handlePackageStatusChange}
                />
              ) : (
                <PackageStatusChip status={focusedPackage.status} />
              )
            ) : (
              <ReadinessChip worksheet={worksheet} />
            )}
            {quickbooksView && (
              <QuickbooksStatusCard
                tone={quickbooksView.tone}
                status={quickbooksView.status}
                detail={quickbooksView.detail}
                title={quickbooksView.href ? 'Open this invoice in QuickBooks' : undefined}
                href={quickbooksView.href ?? undefined}
                onClick={quickbooksView.action === 'send' && !saving
                  ? () => setQuickbooksDialogOpen(true)
                  : undefined}
              />
            )}
            {canCorrectFocusedPackage && (
              <>
                <Button
                  variant="outlined"
                  startIcon={<EditRoundedIcon />}
                  onClick={() => setCorrectionDialog('edit')}
                  disabled={saving}
                >
                  Edit Package
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<MoveToInboxRoundedIcon />}
                  onClick={() => setCorrectionDialog('transfer')}
                  disabled={saving}
                >
                  Move cells here
                </Button>
              </>
            )}
            {focusedPackage && RELEASE_ROLES.includes(profile?.role) && (
              <Button
                variant="outlined"
                startIcon={<DescriptionRoundedIcon />}
                onClick={() => setReleaseDialogOpen(true)}
                disabled={saving}
              >
                Generate Release
              </Button>
            )}
            {canDeleteFocusedPackage && (
              <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlineRoundedIcon />}
                onClick={() => setCorrectionDialog('delete')}
                disabled={saving}
              >
                Delete draft
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => setCreateDialogOpen(true)}
              disabled={
                !canManageDrawInvoicePackages
                || saving
                || billingSetupsLoading
                || !jobBillingSetupIsAvailable
              }
              disableElevation
            >
              Create Package
            </Button>
          </Stack>
        </Stack>
      </Box>

      {packageId == null && (
        <JobModuleNavigation
          active="draw-invoice"
          builderId={focusedBuilderId}
          jobId={focusedJob.id}
        />
      )}

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {error && (
          <Alert
            severity="error"
            action={<Button color="inherit" onClick={handleRetry}>Retry</Button>}
            sx={{ mb: 2.5 }}
          >
            {error}
          </Alert>
        )}
        {focusedPackage?.status === 'CANCELLED' && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            This Package was cancelled on {formatDate(focusedPackage.cancelledAt?.slice(0, 10))}.
            {isRetentionRelease
              ? ' Its retained source amounts are available for a new release; the Package number remains for history.'
              : ' Its Lot / Draw cells were released; the Package number remains for history.'}
            {focusedPackage.cancellationReason && ` Reason: ${focusedPackage.cancellationReason}`}
          </Alert>
        )}
        {focusedPackage?.quickbooksStatus === 'CREATED' && !isRetentionRelease && (
          <Alert
            severity="success"
            sx={{ mb: 2.5 }}
            action={quickbooksView?.href && (
              <Button
                color="inherit"
                size="small"
                component="a"
                href={quickbooksView.href}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ whiteSpace: 'nowrap' }}
              >
                Open in QuickBooks
              </Button>
            )}
          >
            <strong>Already invoiced in QuickBooks.</strong>{' '}
            {focusedPackage.quickbooksReference
              ? `Invoice ${focusedPackage.quickbooksReference}`
              : 'This Package has an invoice'}
            {quickbooksSync?.totalAmount != null
              ? ` · ${formatCurrency(quickbooksSync.totalAmount)}`
              : ''}
            {quickbooksSync?.updatedAt
              ? ` · sent ${new Date(quickbooksSync.updatedAt).toLocaleDateString('en-US')}`
              : ''}
            . It cannot be sent again or edited here.
          </Alert>
        )}
        {focusedPackage?.quickbooksStatus === 'SYNC_ERROR' && !isRetentionRelease && (
          <Alert
            severity="warning"
            sx={{ mb: 2.5 }}
            action={canSendToQuickbooks && (
              <Button color="inherit" size="small" onClick={() => setQuickbooksDialogOpen(true)}>
                Retry
              </Button>
            )}
          >
            <strong>The last QuickBooks attempt failed.</strong>
            {quickbooksSync?.error ? ` ${quickbooksSync.error}` : ''}
          </Alert>
        )}
        {phases.length === 0 ? (
          <Alert
            severity="info"
            action={
              <Button component={RouterLink} to={jobSequenceSheetPath(focusedBuilderId, focusedJob.id)} color="inherit">
                Open Sequence Sheet
              </Button>
            }
          >
            This Job has no phases yet. Create a phase and assign its lots first.
          </Alert>
        ) : (
          <Stack spacing={2.5}>
            {isMultiPhase && (
              <Alert severity="warning" icon={<LayersRoundedIcon />}>
                <strong>Multi-phase Package.</strong> This Package bills{' '}
                {packageSummary.phaseCount} Phases / Buildings together on one
                invoice. Each Phase worksheet is shown below.
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
                  {focusedPackagePhases.map((phase) => (
                    <Chip
                      key={phase.id}
                      size="small"
                      clickable
                      component="a"
                      href={`#package-phase-${phase.id}`}
                      label={phaseScopeLabel(phase.name, phase.building)}
                    />
                  ))}
                </Stack>
              </Alert>
            )}

            {!isRetentionRelease && !isMultiPhase && <Card variant="outlined">
              <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
                >
                  <Box>
                    <Typography fontWeight={800}>Worksheet scope</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Review which lot/draw combinations are available or already packaged.
                    </Typography>
                  </Box>
                  <TextField
                    select
                    label="Phase / Building"
                    value={selectedPhase?.id ?? ''}
                    onChange={handlePhaseChange}
                    sx={{ minWidth: { xs: '100%', md: 280 } }}
                  >
                    {phases.map((phase) => (
                      <MenuItem key={phase.id} value={phase.id}>
                        {formatPhase(phase.name)} · {formatBuilding(phase.building)} ·{' '}
                        {(phase.lots ?? []).filter((row) => !row.isUtilityBuilding).length} lots
                        {(phase.lots ?? []).some((row) => row.isUtilityBuilding)
                          ? ` · ${(phase.lots ?? []).filter((row) => row.isUtilityBuilding).length} Utility`
                          : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </CardContent>
            </Card>}

            {isRetentionRelease ? (
              <>
                <Alert severity="success">
                  This is a positive retention release. Retention and WRAP are not deducted again.
                </Alert>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <MetricCard
                    icon={<ApartmentRoundedIcon />}
                    label="Release scope"
                    value={focusedPackage.retentionRelease?.scopeType === 'JOB'
                      ? 'Per Job'
                      : formatBuilding(focusedPackage.retentionRelease?.building)}
                    detail={focusedPackage.retentionRelease?.scopeType === 'BUILDING'
                      ? formatPhase(focusedPackage.retentionRelease?.phaseCode)
                      : `Job #${focusedJob.code}`}
                  />
                  <MetricCard
                    icon={<LayersRoundedIcon />}
                    label="Source lines"
                    value={focusedPackage.retentionRelease?.sourceLines?.length ?? 0}
                    detail={`Cutoff ${formatDate(focusedPackage.retentionRelease?.sourceCutoffDate)}`}
                  />
                  <MetricCard
                    icon={<AttachMoneyRoundedIcon />}
                    label="Retention released"
                    value={formatCurrency(focusedPackage.retentionRelease?.retainedAmount)}
                    valueColor="success.main"
                    detail={`Available ${formatDate(focusedPackage.retentionRelease?.availableDate)}`}
                  />
                  <MetricCard
                    icon={<ReceiptLongRoundedIcon />}
                    label="Invoice Amount"
                    value={formatCurrency(packageSummary.invoiceAmount)}
                    valueColor="success.main"
                    detail={focusedPackage.invoiceNumber
                      ? `Invoice ${focusedPackage.invoiceNumber}`
                      : 'Invoice pending'}
                  />
                </Stack>
              </>
            ) : packageSummary ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <MetricCard
                  icon={<ApartmentRoundedIcon />}
                  label={packageSummary.utilityCount > 0 && packageSummary.lotCount === 0
                    ? 'Utility rows'
                    : 'Lots in package'}
                  value={packageSummary.utilityCount > 0 && packageSummary.lotCount === 0
                    ? packageSummary.utilityCount
                    : packageSummary.lotCount}
                  // detail={`${packageSummary.scopeCount} billing scopes`}
                />
                <MetricCard
                  icon={<LayersRoundedIcon />}
                  label="Draws in package"
                  value={focusedPackage.drawIndexes.length}
                  detail={focusedPackage.drawIndexes.map((drawIndex) => `Draw ${drawIndex + 1}`).join(', ')}
                />
                <MetricCard
                  icon={<AttachMoneyRoundedIcon />}
                  label="Current Draw"
                  value={formatCurrency(packageSummary.currentDraw)}
                  detail={(
                    <>
                      Retention{' '}
                      <Typography
                        component="span"
                        variant="inherit"
                        sx={{ color: 'error.main', fontWeight: 750 }}
                      >
                        {formatCurrency(packageSummary.retention)}
                      </Typography>
                      {' · '}WRAP{' '}
                      <Typography
                        component="span"
                        variant="inherit"
                        sx={{ color: 'error.main', fontWeight: 750 }}
                      >
                        {formatCurrency(packageSummary.wrapInsurance)}
                      </Typography>
                    </>
                  )}
                />
                <MetricCard
                  icon={<ReceiptLongRoundedIcon />}
                  label="Invoice Amount"
                  value={formatCurrency(packageSummary.invoiceAmount)}
                  valueColor="success.main"
                  detail={packageSummary.optionsTotal > 0
                    ? `${formatCurrency(packageSummary.optionsTotal)} options included`
                    : focusedPackage.invoiceNumber
                      ? `Invoice ${focusedPackage.invoiceNumber}`
                      : 'Invoice pending'}
                />
              </Stack>
            ) : (
              <Alert severity="info">
                This is the worksheet overview. Use Create Draw Package to select lots and
                one or more available draws for a new package.
              </Alert>
            )}

            {!isRetentionRelease && !worksheet.hasSchedule && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to="/builder-draw-schedules" color="inherit">Configure schedule</Button>}
              >
                {focusedJob.builder} does not have a Builder Setup.
              </Alert>
            )}
            {!isRetentionRelease && (worksheet.missingPlanCount > 0 || worksheet.unpricedLotCount > 0) && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to={jobPlanPricingPath(focusedBuilderId, focusedJob.id)} color="inherit">Open pricing</Button>}
              >
                Complete missing plan assignments and prices before creating a package.
              </Alert>
            )}

            {!isRetentionRelease && !isMultiPhase && <DrawWorksheetTable
              job={focusedJob}
              phase={selectedPhase}
              worksheet={worksheet}
              packages={drawInvoicePackages}
              currentPackageId={focusedPackage?.id}
            />}
            {isMultiPhase && focusedPackagePhases.map((phase, index) => (
              <Box key={phase.id} id={`package-phase-${phase.id}`} sx={{ scrollMarginTop: 16 }}>
                <DrawWorksheetTable
                  job={focusedJob}
                  phase={phase}
                  worksheet={buildDrawWorksheet(focusedJob, phase, schedule)}
                  packages={drawInvoicePackages}
                  currentPackageId={focusedPackage.id}
                  phaseHeading={`${index + 1} of ${focusedPackagePhases.length} · ${phaseScopeLabel(phase.name, phase.building)}`}
                />
              </Box>
            ))}

            {focusedPackage && !isRetentionRelease && <PackageHardwareTable summary={packageSummary} />}
            {focusedPackage && !isRetentionRelease && <PackageUtilityTable summary={packageSummary} />}
            {focusedPackage && !isRetentionRelease && packageSummary.lotCount > 0 && (
              <PackageOptionsTable summary={packageSummary} />
            )}
            {focusedPackage?.corrections?.length > 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography fontWeight={800} sx={{ mb: 1 }}>Correction history</Typography>
                  <Stack spacing={1}>
                    {focusedPackage.corrections.map((correction) => (
                      <Typography key={correction.id} variant="body2" color="text.secondary">
                        {new Date(correction.changed_at).toLocaleString('en-US')} ·{' '}
                        {correction.action === 'TRANSFER'
                          ? String(correction.package_id) === String(focusedPackage.id)
                            ? 'Cells moved here'
                            : 'Cells moved out'
                          : correction.action.toLowerCase()} ·{' '}
                        {correction.reason}
                        {correction.action === 'TRANSFER' && ` · Other Package ID ${
                          String(correction.package_id) === String(focusedPackage.id)
                            ? correction.other_package_id
                            : correction.package_id
                        }`}
                      </Typography>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}
      </Box>

      {createDialogOpen && (
        <CreateDrawDialog
          jobs={jobs}
          schedules={builderDrawSchedules}
          jobBillingSetupVersions={jobBillingSetupVersions}
          packages={drawInvoicePackages}
          productionActivities={productionActivities}
          productionActivitiesLoading={productionActivitiesLoading}
          productionActivitiesError={productionActivitiesError}
          initialJobId={focusedJob.id}
          initialPhaseId={selectedPhase?.id}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={handleCreate}
        />
      )}
      {releaseDialogOpen && focusedPackage && (
        <Suspense
          fallback={(
            <Backdrop open sx={{ zIndex: 'modal' }}>
              <CircularProgress color="inherit" />
            </Backdrop>
          )}
        >
          <GeneratePackageReleaseDialog
            packageRecord={focusedPackage}
            job={focusedJob}
            onClose={() => setReleaseDialogOpen(false)}
          />
        </Suspense>
      )}

      {quickbooksDialogOpen && focusedPackage && (
        <QuickbooksInvoiceDialog
          record={focusedPackage}
          onClose={() => setQuickbooksDialogOpen(false)}
          onSettled={refreshDrawInvoicePackages}
        />
      )}

      {correctionDialog === 'edit' && focusedPackage && (
        <EditDrawPackageDialog
          record={focusedPackage}
          job={focusedJob}
          phase={selectedPhase}
          phases={focusedPackagePhases}
          schedule={schedule}
          packages={drawInvoicePackages}
          productionActivities={productionActivities}
          onClose={() => setCorrectionDialog(null)}
          onSave={editDrawInvoicePackage}
        />
      )}
      {correctionDialog === 'transfer' && focusedPackage && (
        <TransferDrawPackageCellsDialog
          target={focusedPackage}
          packages={drawInvoicePackages}
          onClose={() => setCorrectionDialog(null)}
          onTransfer={transferDrawPackageCells}
        />
      )}
      {correctionDialog === 'delete' && focusedPackage && (
        <CancelDrawPackageDialog
          record={focusedPackage}
          onClose={() => setCorrectionDialog(null)}
          onCancel={cancelDrawInvoicePackage}
        />
      )}
    </Box>
  )
}
