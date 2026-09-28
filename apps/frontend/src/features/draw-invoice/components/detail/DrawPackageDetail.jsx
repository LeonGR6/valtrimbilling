import { useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import { useBuilderDrawSchedules } from '../../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
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
import {
  canCorrectDrawPackage,
} from '../../services/drawInvoicePackageRecord.js'
import { summarizeDrawPackage } from '../../utils/drawPackages.js'
import { buildDrawWorksheet } from '../../utils/drawWorksheet.js'
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
import {
  MetricCard,
  PackageStatusChip,
  PackageStatusControl,
  ReadinessChip,
} from '../shared/PackageUi.jsx'
import {
  DrawWorksheetTable,
  PackageOptionsTable,
} from './PackageTables.jsx'

export default function DrawPackageDetail() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId, packageId } = useParams()
  const {
    jobs,
    loading: jobsLoading,
    error: jobsError,
    refreshJobs,
  } = useJobs()
  const { builderDrawSchedules } = useBuilderDrawSchedules()
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
    ]).catch(() => {})
  }

  const loading = jobsLoading || packagesLoading
  const error = jobsError || packagesError

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
  const schedule = builderDrawSchedules.find(
    (item) => String(item.builderId) === String(focusedBuilderId),
  )
  const worksheet = buildDrawWorksheet(focusedJob, selectedPhase, schedule)
  const focusedPackage = drawInvoicePackages.find(
    (record) =>
      String(record.id) === String(packageId) &&
      String(record.jobId) === String(focusedJob.id),
  )
  const focusedPackagePhaseIds = new Set(
    (focusedPackage?.phaseIds?.length
      ? focusedPackage.phaseIds
      : [focusedPackage?.phaseId])
      .filter((value) => value != null)
      .map(String),
  )
  const focusedPackagePhases = phases.filter(
    (phase) => focusedPackagePhaseIds.has(String(phase.id)),
  )
  const packageSummary = focusedPackage
    ? summarizeDrawPackage(
        focusedPackage,
        focusedJob,
        focusedPackagePhases,
        schedule,
      )
    : null
  const canCorrectFocusedPackage = canManageDrawInvoicePackages
    && canCorrectDrawPackage(focusedPackage)
  const canDeleteFocusedPackage = canManageDrawInvoicePackages
    && canDeleteDraftPackage(focusedPackage)

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
          All draw packages
        </Button>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={800}>
              {focusedJob.builder} / {focusedJob.community}
            </Typography>
            <Typography variant="h5" fontWeight={850}>
              {focusedPackage?.packageNumber ?? `Job #${focusedJob.code} Draw worksheet`}
            </Typography>
            {selectedPhase && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Job #{focusedJob.code} · {formatPhase(selectedPhase.name)} ·{' '}
                {formatBuilding(selectedPhase.building)}
                {focusedPackage && packageSummary?.phaseCount > 1
                  ? ` · ${packageSummary.phaseCount} Phases in Package`
                  : ''}
                {focusedPackage?.invoiceNumber
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
              disabled={!canManageDrawInvoicePackages || saving}
              disableElevation
            >
              Create Draw
            </Button>
          </Stack>
        </Stack>
      </Box>

      <JobModuleNavigation active="draw-invoice" builderId={focusedBuilderId} jobId={focusedJob.id} />

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
            Its Lot / Draw cells were released; the Package number remains for history.
            {focusedPackage.cancellationReason && ` Reason: ${focusedPackage.cancellationReason}`}
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
            <Card variant="outlined">
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
                        {formatPhase(phase.name)} · {formatBuilding(phase.building)} · {phase.lots?.length ?? 0} lots
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </CardContent>
            </Card>

            {packageSummary ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <MetricCard
                  icon={<ApartmentRoundedIcon />}
                  label="Lots in package"
                  value={packageSummary.lotCount}
                  detail={`${packageSummary.scopeCount} lot/draw scopes`}
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
                  detail={`Retention ${formatCurrency(packageSummary.retention)} · WRAP ${formatCurrency(packageSummary.wrapInsurance)}`}
                />
                <MetricCard
                  icon={<ReceiptLongRoundedIcon />}
                  label="Invoice Amount"
                  value={formatCurrency(packageSummary.invoiceAmount)}
                  detail={packageSummary.optionsTotal > 0
                    ? `${formatCurrency(packageSummary.optionsTotal)} options included`
                    : focusedPackage.invoiceNumber
                      ? `Invoice ${focusedPackage.invoiceNumber}`
                      : 'Invoice pending'}
                />
              </Stack>
            ) : (
              <Alert severity="info">
                This is the worksheet overview. Use Create Draw to select lots and
                one or more available draws for a new package.
              </Alert>
            )}

            {!worksheet.hasSchedule && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to="/builder-draw-schedules" color="inherit">Configure schedule</Button>}
              >
                {focusedJob.builder} does not have a Builder Draw Schedule.
              </Alert>
            )}
            {(worksheet.missingPlanCount > 0 || worksheet.unpricedLotCount > 0) && (
              <Alert
                severity="warning"
                action={<Button component={RouterLink} to={jobPlanPricingPath(focusedBuilderId, focusedJob.id)} color="inherit">Open pricing</Button>}
              >
                Complete missing plan assignments and prices before creating a package.
              </Alert>
            )}

            <DrawWorksheetTable
              job={focusedJob}
              phase={selectedPhase}
              worksheet={worksheet}
              packages={drawInvoicePackages}
              currentPackageId={focusedPackage?.id}
            />

            {focusedPackage && <PackageOptionsTable summary={packageSummary} />}
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
          packages={drawInvoicePackages}
          initialJobId={focusedJob.id}
          initialPhaseId={selectedPhase?.id}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={handleCreate}
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
