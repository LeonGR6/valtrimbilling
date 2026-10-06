import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { useBuilderDrawSchedules } from '../../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { useProductionActivities } from '../../../calendar/context/useProductionActivities.js'
import { useJobs } from '../../../jobs/context/useJobs.js'
import {
  getJobBuilderId,
  jobDrawInvoicePath,
} from '../../../jobs/utils/jobRoutes.js'
import { useDrawInvoicePackages } from '../../context/useDrawInvoicePackages.js'
import CreateDrawDialog from '../dialogs/CreateDrawDialog.jsx'
import CreateRetentionReleaseDialog from '../dialogs/CreateRetentionReleaseDialog.jsx'
import PackageCatalog from './PackageCatalog.jsx'

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
  const [createDialogContext, setCreateDialogContext] = useState(null)
  const [retentionSuggestion, setRetentionSuggestion] = useState(null)

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
        onCreate={() => setCreateDialogContext({})}
        onReviewSuggestion={(suggestion) => setCreateDialogContext({
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
        />
      )}
      {retentionSuggestion && (
        <CreateRetentionReleaseDialog
          suggestion={retentionSuggestion}
          onClose={() => setRetentionSuggestion(null)}
          onCreate={handleCreateRetention}
        />
      )}
    </>
  )
}
