import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, CircularProgress, Snackbar, Stack, Typography } from '@mui/material'
import { useBuilderDrawSchedules } from '../../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { useProductionActivities } from '../../../calendar/context/useProductionActivities.js'
import { useAuth } from '../../../auth/context/useAuth.js'
import { useJobs } from '../../../jobs/context/useJobs.js'
import {
  getJobBuilderId,
  jobDrawInvoicePath,
} from '../../../jobs/utils/jobRoutes.js'
import { useDrawInvoicePackages } from '../../context/useDrawInvoicePackages.js'
import CreateDrawDialog from '../dialogs/CreateDrawDialog.jsx'
import CreateRetentionReleaseDialog from '../dialogs/CreateRetentionReleaseDialog.jsx'
import { refreshAllQuickbooksPayments } from '../../services/quickbooksRepository.js'
import PackageCatalog from './PackageCatalog.jsx'

// Opening the catalog asks QuickBooks how the open invoices stand, at most once
// every few minutes, so a Package paid there shows as Paid / Closed here.
const PAYMENT_CHECK_INTERVAL_MS = 5 * 60 * 1000
let lastPaymentCheck = 0

export default function DrawInvoiceCatalog() {
  const navigate = useNavigate()
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
    canManageDrawInvoicePackages,
    refreshDrawInvoicePackages,
    createDrawInvoicePackage,
    createRetentionReleasePackage,
    editDrawInvoicePackage,
    transferDrawPackageCells,
    cancelDrawInvoicePackage,
  } = useDrawInvoicePackages()
  const { profile } = useAuth()
  const canCheckPayments = ['ADMIN', 'ACCOUNTING'].includes(profile?.role)
  useEffect(() => {
    if (!canCheckPayments || Date.now() - lastPaymentCheck < PAYMENT_CHECK_INTERVAL_MS) return
    lastPaymentCheck = Date.now()
    refreshAllQuickbooksPayments()
      .then((checked) => (checked > 0 ? refreshDrawInvoicePackages() : null))
      // The scheduler keeps trying; a failed check here is not worth a message.
      .catch(() => { lastPaymentCheck = 0 })
  }, [canCheckPayments, refreshDrawInvoicePackages])
  const [createDialogContext, setCreateDialogContext] = useState(null)
  const [retentionSuggestion, setRetentionSuggestion] = useState(null)
  const [notice, setNotice] = useState(null)

  const handleCreate = async (input) => {
    const record = await createDrawInvoicePackage(input)
    const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
    setCreateDialogContext(null)
    navigate(
      jobDrawInvoicePath(
        getJobBuilderId(job),
        record.jobId,
        record.phaseId,
        record.id,
      ),
    )
  }

  // A selection that has to be divided (a Phase finishes while others still have something to bill)
  // becomes several Packages, created one after the other. If one fails after the first, the ones
  // already made stay: the dialog closes and says so, and reopening it offers what is left.
  const handleCreateMany = async (inputs) => {
    const created = []
    const numbers = () => created.map((record) => record.packageNumber).join(', ')

    for (const input of inputs) {
      try {
        created.push(await createDrawInvoicePackage(input))
      } catch (error) {
        if (created.length === 0) throw error

        setCreateDialogContext(null)
        setNotice({
          severity: 'error',
          message: `${numbers()} ${created.length === 1 ? 'was' : 'were'} created, but the next Package could not be: ${error.message} Open Create Package again to bill what is left.`,
        })
        return
      }
    }

    setCreateDialogContext(null)
    setNotice({ severity: 'success', message: `Created ${numbers()}.` })
  }

  const handleCreateRetention = async (input) => {
    const record = await createRetentionReleasePackage(input)
    const job = jobs.find((candidate) => String(candidate.id) === String(record.jobId))
    const phaseId = record.phaseId
      ?? retentionSuggestion?.phaseId
      ?? job?.sequenceSheet?.phases?.[0]?.id
    setRetentionSuggestion(null)
    navigate(jobDrawInvoicePath(
      getJobBuilderId(job),
      record.jobId,
      phaseId,
      record.id,
    ))
  }

  // A Package is made from what is saved now, so an Option added a moment ago (here or by someone
  // else) is read again when the dialog opens, and the Phase that was complete shows up open.
  const openCreateDialog = (context) => {
    setCreateDialogContext(context)
    Promise.all([refreshJobs(), refreshDrawInvoicePackages()]).catch(() => {})
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

  return (
    <>
      <PackageCatalog
        jobs={jobs}
        schedules={builderDrawSchedules}
        jobBillingSetupVersions={jobBillingSetupVersions}
        packages={drawInvoicePackages}
        productionActivities={productionActivities}
        productionActivitiesLoading={productionActivitiesLoading}
        productionActivitiesError={productionActivitiesError}
        canManage={canManageDrawInvoicePackages}
        createDisabled={billingSetupsLoading || jobBillingSetupVersions.length === 0}
        error={error}
        onRetry={handleRetry}
        onCreate={() => openCreateDialog({})}
        onReviewSuggestion={(suggestion) => openCreateDialog({
          jobId: suggestion.job.id,
          phaseId: suggestion.initialPhaseId,
        })}
        onReviewRetention={setRetentionSuggestion}
        onEdit={editDrawInvoicePackage}
        onTransfer={transferDrawPackageCells}
        onDelete={cancelDrawInvoicePackage}
        onOpen={(record, job, phase) =>
          navigate(
            jobDrawInvoicePath(
              getJobBuilderId(job),
              job.id,
              phase.id,
              record.id,
            ),
          )
        }
      />
      {createDialogContext && (
        <CreateDrawDialog
          jobs={jobs}
          schedules={builderDrawSchedules}
          jobBillingSetupVersions={jobBillingSetupVersions}
          packages={drawInvoicePackages}
          productionActivities={productionActivities}
          productionActivitiesLoading={productionActivitiesLoading}
          productionActivitiesError={productionActivitiesError}
          initialJobId={createDialogContext.jobId}
          initialPhaseId={createDialogContext.phaseId}
          onClose={() => setCreateDialogContext(null)}
          onCreate={handleCreate}
          onCreateMany={handleCreateMany}
        />
      )}
      {retentionSuggestion && (
        <CreateRetentionReleaseDialog
          suggestion={retentionSuggestion}
          onClose={() => setRetentionSuggestion(null)}
          onCreate={handleCreateRetention}
        />
      )}
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={notice?.severity === 'error' ? 12000 : 6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={notice?.severity ?? 'success'} onClose={() => setNotice(null)} variant="filled">
          {notice?.message}
        </Alert>
      </Snackbar>
    </>
  )
}
