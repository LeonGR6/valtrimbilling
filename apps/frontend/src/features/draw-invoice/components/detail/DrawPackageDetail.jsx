import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Backdrop,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import { useAuth } from '../../../auth/context/useAuth.js'
import { useBuilderDrawSchedules } from '../../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { displayInvoiceNumber } from '../../utils/packageInvoiceLabel.js'
import { usePackageSubmissions } from '../../hooks/usePackageSubmissions.js'
import { describeSentHistory, describeSentPackage } from '../../services/packageSubmissionRecord.js'
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
import { formatBuilding, formatPhase, formatPhaseBuilding } from '../../../sequence-sheets/utils/phaseBuildingCodes.js'
import { useDrawInvoicePackages } from '../../context/useDrawInvoicePackages.js'
import { useQuickbooksInvoiceSync } from '../../hooks/useQuickbooksInvoiceSync.js'
import { refreshQuickbooksPayment } from '../../services/quickbooksRepository.js'
import {
  canCorrectDrawPackage,
  draftLockReason,
} from '../../services/drawInvoicePackageRecord.js'
import {
  canCreateQuickbooksInvoice,
  quickbooksPackageStatusView,
} from '../../services/quickbooksRecord.js'
import {
  buildPackageOptionHistory,
  summarizeDrawPackage,
  summarizeRetentionSource,
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
import QuickbooksPackageNotice from './QuickbooksPackageNotice.jsx'
import QuickbooksStatusCard from '../shared/QuickbooksStatusCard.jsx'
import {
  PackageEnvironmentLabel,
  PackageStatusChip,
  PackageStatusControl,
  PackageSummaryPanel,
  ReadinessChip,
} from '../shared/PackageUi.jsx'
import PackageCorrectionHistory from './PackageCorrectionHistory.jsx'
import PackagePriceAdjustmentTable from './PackagePriceAdjustmentTable.jsx'
import PackagePriceDifferenceNotice from './PackagePriceDifferenceNotice.jsx'
import PackageHeaderActions from './PackageHeaderActions.jsx'
import {
  DrawWorksheetTable,
  PackageHardwareTable,
  PackageOptionsTable,
  PackageUtilityTable,
} from './PackageTables.jsx'
import { usePurchaseOrderBacking } from '../../../purchase-orders/hooks/usePurchaseOrders.js'
import { currentPackageOptions } from '../../utils/packagePurchaseOrders.js'
import ViewGeneratedPackageButton from './ViewGeneratedPackageButton.jsx'

// Loaded on demand: it brings the Release generation screens.
const GeneratePackageDialog = lazy(() => import('./GeneratePackageDialog.jsx'))

// The same roles that can save Job documents can generate a Package's Release.
const RELEASE_ROLES = ['ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT']

export default function DrawPackageDetail() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId, packageId } = useParams()
  // Whether the Job's Purchase Orders back the options of this Package (information only).
  const purchaseOrderBacking = usePurchaseOrderBacking(jobId ?? null)
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
  const [packageDialogOpen, setPackageDialogOpen] = useState(false)
  const [quickbooksDialogOpen, setQuickbooksDialogOpen] = useState(false)
  const { profile } = useAuth()
  const focusedPackageRecord = drawInvoicePackages.find(
    (record) =>
      String(record.id) === String(packageId) &&
      String(record.jobId) === String(jobId),
  )
  const [paymentRefresh, setPaymentRefresh] = useState(0)
  const [refreshingPayment, setRefreshingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState(null)
  const quickbooksSync = useQuickbooksInvoiceSync(focusedPackageRecord, paymentRefresh)

  // Asks QuickBooks how the invoice stands (open, overdue, paid...). A Package
  // that is paid there becomes Paid / Closed here. Admin and Accounting only:
  // the same people who send the invoice.
  const checkedPackageId = focusedPackageRecord?.id ?? null
  const canCheckPayment = ['ADMIN', 'ACCOUNTING'].includes(profile?.role)
    && focusedPackageRecord?.quickbooksStatus === 'CREATED'
  const checkPayment = useCallback(async ({ silent = false } = {}) => {
    if (checkedPackageId == null) return
    if (!silent) {
      setRefreshingPayment(true)
      setPaymentError(null)
    }
    try {
      await refreshQuickbooksPayment(checkedPackageId)
      await refreshDrawInvoicePackages()
      setPaymentRefresh((count) => count + 1)
    } catch (error) {
      if (!silent) setPaymentError(error.message)
    } finally {
      if (!silent) setRefreshingPayment(false)
    }
  }, [checkedPackageId, refreshDrawInvoicePackages])

  // Once when a Package is opened, so what is shown is not stale.
  const autoCheckedRef = useRef(null)
  useEffect(() => {
    if (!canCheckPayment || autoCheckedRef.current === checkedPackageId) return
    autoCheckedRef.current = checkedPackageId
    checkPayment({ silent: true })
  }, [canCheckPayment, checkedPackageId, checkPayment])
  const { submissions, reload: reloadSubmissions } = usePackageSubmissions(
    focusedPackageRecord?.id ?? null,
  )

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
  const focusedInvoiceNumber = focusedPackage ? displayInvoiceNumber(focusedPackage) : null
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
  // What a Package bills stays with the setup it was made with. The documents it needs and how it
  // is delivered follow the setup the Job is on now: the same one, unless the Job was moved to
  // another version after it was billed.
  const jobSetup = jobBillingSetupVersions.find(
    (version) => String(version.id) === String(focusedJob.billingSetupVersionId),
  ) ?? schedule
  const worksheet = buildDrawWorksheet(focusedJob, selectedPhase, schedule)
  const focusedPackagePhaseIds = new Set(
    (focusedPackage?.phaseIds?.length
      ? focusedPackage.phaseIds
      : [focusedPackage?.phaseId])
      .filter((value) => value != null)
      .map(String),
  )
  const isRetentionRelease = focusedPackage?.packageType === 'RETENTION_RELEASE'
  const isPriceAdjustment = focusedPackage?.packageType === 'PRICE_ADJUSTMENT'
  const retentionSource = isRetentionRelease
    ? summarizeRetentionSource(focusedPackage.retentionRelease, drawInvoicePackages)
    : null
  // Neither has Lot / Draw cells: the Draw worksheet and its tables do not apply.
  const hasNoDrawCells = isRetentionRelease || isPriceAdjustment
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
  // What this Package charges now: the Purchase Orders behind these go into its PDF.
  const currentOptionRows = currentPackageOptions(
    packageSummary?.chargedOptionRows ?? packageSummary?.selectedOptionRows ?? [],
  )
  const isMultiPhase = Boolean(focusedPackage)
    && !hasNoDrawCells
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

  const packageContext = isPriceAdjustment
    ? `Job #${focusedJob.code} · Price adjustment`
    : isRetentionRelease
    ? `Job #${focusedJob.code} · ${focusedPackage.retentionRelease?.scopeType === 'JOB'
      ? 'Per Job'
      : formatPhaseBuilding(focusedPackage.retentionRelease?.phaseCode, focusedPackage.retentionRelease?.building)}`
    : selectedPhase
      ? `Job #${focusedJob.code} · ${isMultiPhase
        ? packagePhaseLabels(packageSummary.phaseSummaries).join(' · ')
        : formatPhaseBuilding(selectedPhase.name, selectedPhase.building)}`
      : null
  const canCreatePackage = canManageDrawInvoicePackages
    && !billingSetupsLoading
    && jobBillingSetupIsAvailable
  // Why a Draft cannot be edited, moved or deleted, so the button explains itself.
  const editLockedReason = canManageDrawInvoicePackages && !canCorrectFocusedPackage
    && !canDeleteFocusedPackage
    ? draftLockReason(focusedPackage)
    : null

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2, md: 3 },
          pt: 1,
          pb: 2,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Button
          color="inherit"
          size="small"
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate('/draw-invoice')}
          sx={{ ml: -1, mb: 1, color: 'text.secondary' }}
        >
          All packages
        </Button>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'flex-start' }, justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {isPriceAdjustment
                ? `Price Adjustment · ${focusedJob.builder} / ${focusedJob.community}`
                : isRetentionRelease
                ? `Retention Release · ${focusedJob.builder} / ${focusedJob.community}`
                : `${focusedJob.builder} / ${focusedJob.community}`}
            </Typography>
            {/* Each item of the first line is as tall as the status field, so the Test or
                Production label can hang under the status without moving the rest. */}
            <Stack
              direction="row"
              spacing={1.25}
              useFlexGap
              sx={{ alignItems: 'flex-start', flexWrap: 'wrap', mt: 0.25 }}
            >
              <Typography
                variant="h5"
                component="h1"
                fontWeight={850}
                letterSpacing="-0.01em"
                sx={{ lineHeight: '40px' }}
              >
                {focusedPackage?.packageNumber ?? `Job #${focusedJob.code} Draw worksheet`}
              </Typography>
              <Box>
                <Box sx={{ minHeight: 40, display: 'flex', alignItems: 'center' }}>
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
                </Box>
                <PackageEnvironmentLabel record={focusedPackage} />
              </Box>
              {isMultiPhase && (
                <Box sx={{ minHeight: 40, display: 'flex', alignItems: 'center' }}>
                  <Chip
                    size="small"
                    color="warning"
                    icon={<LayersRoundedIcon />}
                    label={`Multi-phase · ${packageSummary.phaseCount} Phases / Buildings`}
                    sx={{ fontWeight: 750 }}
                  />
                </Box>
              )}
            </Stack>
            {(packageContext || focusedInvoiceNumber) && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {[packageContext, focusedInvoiceNumber ? `Invoice ${focusedInvoiceNumber}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            )}
          </Box>
          <Stack spacing={1} sx={{ alignItems: { xs: 'flex-start', md: 'flex-end' }, flexShrink: 0 }}>
            <PackageHeaderActions
              leading={(
                <>
                  {quickbooksView && (
                    <QuickbooksStatusCard
                      compact
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
                  {canCheckPayment && (
                    <Tooltip
                      title={paymentError
                        ?? 'Check in QuickBooks whether this invoice is open, overdue or paid'}
                    >
                      <span>
                        <IconButton
                          size="small"
                          color={paymentError ? 'error' : 'default'}
                          aria-label="Check payment in QuickBooks"
                          disabled={refreshingPayment}
                          onClick={() => checkPayment()}
                        >
                          {refreshingPayment ? <CircularProgress size={18} /> : <SyncRoundedIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                </>
              )}
              viewGenerated={focusedPackage && focusedJob && (
                <ViewGeneratedPackageButton
                  packageRecord={focusedPackage}
                  job={focusedJob}
                  optionRows={currentOptionRows}
                  reloadKey={packageDialogOpen}
                />
              )}
              lockedReason={editLockedReason}
              hasPackage={Boolean(focusedPackage)}
              canGenerate={RELEASE_ROLES.includes(profile?.role)}
              canEdit={canCorrectFocusedPackage}
              canMoveCells={canCorrectFocusedPackage}
              canDelete={canDeleteFocusedPackage}
              canCreate={canCreatePackage}
              saving={saving}
              onGenerate={() => setPackageDialogOpen(true)}
              onEdit={() => setCorrectionDialog('edit')}
              onMoveCells={() => setCorrectionDialog('transfer')}
              onDelete={() => setCorrectionDialog('delete')}
              onCreate={() => {
                setCreateDialogOpen(true)
                // Read again what is saved, so an Option added a moment ago is seen.
                Promise.all([refreshJobs(), refreshDrawInvoicePackages()]).catch(() => {})
              }}
            />
            {submissions.length > 0 && (
              <Tooltip
                arrow
                title={(
                  <Box sx={{ py: 0.5 }}>
                    {describeSentHistory(submissions).map((entry) => (
                      <Box key={entry.id} sx={{ mb: 1, '&:last-child': { mb: 0 } }}>
                        <Typography variant="caption" sx={{ fontWeight: 800, display: 'block' }}>
                          {entry.isLatest ? 'Last sent' : 'Sent earlier'} · {entry.when}
                        </Typography>
                        {entry.recipients.map((email) => (
                          <Typography key={email} variant="caption" sx={{ display: 'block' }}>
                            {email}
                          </Typography>
                        ))}
                      </Box>
                    ))}
                  </Box>
                )}
              >
                <Chip
                  color="success"
                  variant="outlined"
                  tabIndex={0}
                  icon={<MarkEmailReadRoundedIcon />}
                  label={describeSentPackage(submissions)}
                  sx={{ fontWeight: 650, height: 'auto', minHeight: 32 }}
                />
              </Tooltip>
            )}
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

      <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
        {error && (
          <Alert
            severity="error"
            action={<Button color="inherit" onClick={handleRetry}>Retry</Button>}
          >
            {error}
          </Alert>
        )}
        {focusedPackage?.status === 'CANCELLED' && (
          <Alert severity="info">
            This Package was cancelled on {formatDate(focusedPackage.cancelledAt?.slice(0, 10))}.
            {isPriceAdjustment
              ? ' Its price differences are pending again; the Package number remains for history.'
              : isRetentionRelease
              ? ' Its retained source amounts are available for a new release; the Package number remains for history.'
              : ' Its Lot / Draw cells were released; the Package number remains for history.'}
            {focusedPackage.cancellationReason && ` Reason: ${focusedPackage.cancellationReason}`}
          </Alert>
        )}
        {focusedPackage?.id != null && (
          <PackagePriceDifferenceNotice
            packageId={focusedPackage.id}
            builderId={focusedBuilderId}
            jobId={focusedJob?.id}
          />
        )}
        <QuickbooksPackageNotice
          record={focusedPackage}
          sync={quickbooksSync}
          href={quickbooksView?.href}
          canSend={canSendToQuickbooks}
          role={profile?.role}
          onSend={() => setQuickbooksDialogOpen(true)}
          onChanged={refreshDrawInvoicePackages}
        />
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
          <>
            {isRetentionRelease && focusedPackage.status !== 'CANCELLED' && (
              <Alert severity="success">
                This is a positive retention release. Retention and WRAP are not deducted again.
              </Alert>
            )}

            {isPriceAdjustment && focusedPackage.status !== 'CANCELLED' && (
              <Alert severity="info">
                This Package invoices price differences of Packages that could not change. Retention
                and WRAP are deducted like in any Package, and the Retention Release includes what was
                retained here. It is sent to QuickBooks from the QuickBooks card, like any other
                Package.
              </Alert>
            )}

            {isPriceAdjustment ? (
              <PackageSummaryPanel
                facts={[
                  {
                    label: 'Source Packages',
                    value: focusedPackage.priceAdjustment?.sourcePackageCount ?? 0,
                  },
                  {
                    label: 'Difference lines',
                    value: focusedPackage.priceAdjustment?.lineCount ?? 0,
                  },
                ]}
                lines={[
                  {
                    label: 'Price difference',
                    value: formatCurrency(focusedPackage.priceAdjustment?.grossAmount ?? 0),
                  },
                  {
                    label: 'Retention',
                    value: formatCurrency(focusedPackage.priceAdjustment?.retentionAmount ?? 0),
                    tone: (focusedPackage.priceAdjustment?.retentionAmount ?? 0) > 0 ? 'deduction' : 'muted',
                  },
                  {
                    label: 'WRAP',
                    value: formatCurrency(focusedPackage.priceAdjustment?.wrapAmount ?? 0),
                    tone: (focusedPackage.priceAdjustment?.wrapAmount ?? 0) > 0 ? 'deduction' : 'muted',
                  },
                ]}
                total={{
                  label: 'Invoice Amount',
                  value: formatCurrency(packageSummary.invoiceAmount),
                  detail: focusedInvoiceNumber ? `Invoice ${focusedInvoiceNumber}` : 'Invoice pending',
                }}
              />
            ) : isRetentionRelease ? (
              <PackageSummaryPanel
                facts={[
                  {
                    label: 'Release scope',
                    value: focusedPackage.retentionRelease?.scopeType === 'JOB'
                      ? 'Per Job'
                      : formatBuilding(focusedPackage.retentionRelease?.building) || 'No building',
                    detail: focusedPackage.retentionRelease?.scopeType === 'BUILDING'
                      ? formatPhase(focusedPackage.retentionRelease?.phaseCode)
                      : `Job #${focusedJob.code}`,
                  },
                  {
                    label: 'Lots billed',
                    value: retentionSource.lotCount,
                    detail: `Cutoff ${formatDate(focusedPackage.retentionRelease?.sourceCutoffDate)}`,
                  },
                  {
                    label: 'Options billed',
                    value: retentionSource.optionCount,
                  },
                ]}
                lines={[
                  {
                    label: 'Retention released',
                    value: formatCurrency(focusedPackage.retentionRelease?.retainedAmount),
                  },
                ]}
                total={{
                  label: 'Invoice Amount',
                  value: formatCurrency(packageSummary.invoiceAmount),
                  detail: [
                    focusedInvoiceNumber ? `Invoice ${focusedInvoiceNumber}` : 'Invoice pending',
                    `available ${formatDate(focusedPackage.retentionRelease?.availableDate)}`,
                  ].join(' · '),
                }}
              />
            ) : packageSummary ? (
              <PackageSummaryPanel
                facts={[
                  {
                    label: packageSummary.utilityCount > 0 && packageSummary.lotCount === 0
                      ? 'Utility rows'
                      : 'Lots in package',
                    value: packageSummary.utilityCount > 0 && packageSummary.lotCount === 0
                      ? packageSummary.utilityCount
                      : packageSummary.lotCount,
                  },
                  {
                    label: 'Draws in package',
                    value: focusedPackage.drawIndexes.length,
                    chips: focusedPackage.drawIndexes.map((drawIndex) => `Draw ${drawIndex + 1}`),
                  },
                ]}
                lines={[
                  { label: 'Current Draw', value: formatCurrency(packageSummary.currentDraw) },
                  { label: 'Retention', value: formatCurrency(packageSummary.retention), tone: packageSummary.retention > 0 ? 'deduction' : 'muted' },
                  { label: 'WRAP', value: formatCurrency(packageSummary.wrapInsurance), tone: packageSummary.wrapInsurance > 0 ? 'deduction' : 'muted' },
                ]}
                total={{
                  label: 'Invoice Amount',
                  value: formatCurrency(packageSummary.invoiceAmount),
                  detail: focusedInvoiceNumber ? `Invoice ${focusedInvoiceNumber}` : 'Invoice pending',
                }}
                note={[
                  packageSummary.optionsTotal > 0 && `Options ${formatCurrency(packageSummary.optionsTotal)}`,
                  packageSummary.hardwareTotal > 0 && `Hardware ${formatCurrency(packageSummary.hardwareTotal)}`,
                  packageSummary.utilityTotal > 0 && `Utility ${formatCurrency(packageSummary.utilityTotal)}`,
                ].filter(Boolean).join(' · ') || null}
              />
            ) : (
              <Alert severity="info">
                This is the worksheet overview. Use New Package to select lots and
                one or more available draws for a new package.
              </Alert>
            )}

            {isMultiPhase && (
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                useFlexGap
                sx={{
                  px: 2,
                  py: 1,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                  alignItems: { sm: 'center' },
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {packageSummary.phaseCount} Phases / Buildings on one invoice. Jump to a worksheet:
                </Typography>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
              </Stack>
            )}

            {!hasNoDrawCells && !worksheet.hasSchedule && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to="/builder-draw-schedules" color="inherit">Configure schedule</Button>}
              >
                {focusedJob.builder} does not have a Builder Setup.
              </Alert>
            )}
            {!hasNoDrawCells && (worksheet.missingPlanCount > 0 || worksheet.unpricedLotCount > 0) && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to={jobPlanPricingPath(focusedBuilderId, focusedJob.id)} color="inherit">Open pricing</Button>}
              >
                Complete missing plan assignments and prices before creating a package.
              </Alert>
            )}

            {!hasNoDrawCells && !isMultiPhase && (
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Typography variant="body2" color="text.secondary">
                  Choose a Phase / Building to review which lot and draw combinations are available or already packaged.
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Phase / Building"
                  value={selectedPhase?.id ?? ''}
                  onChange={handlePhaseChange}
                  sx={{ minWidth: { xs: '100%', sm: 280 }, bgcolor: 'background.paper' }}
                >
                  {phases.map((phase) => (
                    <MenuItem key={phase.id} value={phase.id}>
                      {formatPhaseBuilding(phase.name, phase.building)} ·{' '}
                      {(phase.lots ?? []).filter((row) => !row.isUtilityBuilding).length} lots
                      {(phase.lots ?? []).some((row) => row.isUtilityBuilding)
                        ? ` · ${(phase.lots ?? []).filter((row) => row.isUtilityBuilding).length} Utility`
                        : ''}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            )}

            {!hasNoDrawCells && !isMultiPhase && <DrawWorksheetTable
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

            {focusedPackage && !hasNoDrawCells && <PackageHardwareTable summary={packageSummary} />}
            {focusedPackage && !hasNoDrawCells && <PackageUtilityTable summary={packageSummary} />}
            {focusedPackage && !hasNoDrawCells && packageSummary.lotCount > 0 && (
              <PackageOptionsTable summary={packageSummary} backing={purchaseOrderBacking} />
            )}
            {focusedPackage && isPriceAdjustment && (
              <PackagePriceAdjustmentTable adjustment={focusedPackage.priceAdjustment} />
            )}
            {focusedPackage?.corrections?.length > 0 && (
              <PackageCorrectionHistory package={focusedPackage} />
            )}
          </>
        )}
      </Stack>

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
      {packageDialogOpen && focusedPackage && (
        <Suspense
          fallback={(
            <Backdrop open sx={{ zIndex: 'modal' }}>
              <CircularProgress color="inherit" />
            </Backdrop>
          )}
        >
          <GeneratePackageDialog
            packageRecord={focusedPackage}
            job={focusedJob}
            packages={drawInvoicePackages}
            optionRows={currentOptionRows}
            canCreateInvoice={canSendToQuickbooks}
            onInvoiceCreated={refreshDrawInvoicePackages}
            submission={{
              method: jobSetup?.submissionMethod,
              destination: jobSetup?.submissionDestination,
            }}
            requiresRelease={jobSetup ? jobSetup.requiresRelease : true}
            requiresPaymentSchedule={jobSetup ? jobSetup.requiresPaymentSchedule : true}
            submissions={submissions}
            onSent={() => {
              reloadSubmissions()
              refreshDrawInvoicePackages()
            }}
            onGenerated={refreshDrawInvoicePackages}
            onClose={() => setPackageDialogOpen(false)}
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
