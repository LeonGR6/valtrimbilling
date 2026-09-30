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
    editDrawInvoicePackage,
    transferDrawPackageCells,
    cancelDrawInvoicePackage,
  } = useDrawInvoicePackages()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

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

  return (
    <>
      <PackageCatalog
        jobs={jobs}
        schedules={builderDrawSchedules}
        packages={drawInvoicePackages}
        canManage={canManageDrawInvoicePackages}
        createDisabled={billingSetupsLoading || jobBillingSetupVersions.length === 0}
        error={error}
        onRetry={handleRetry}
        onCreate={() => setCreateDialogOpen(true)}
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
      {createDialogOpen && (
        <CreateDrawDialog
          jobs={jobs}
          schedules={builderDrawSchedules}
          jobBillingSetupVersions={jobBillingSetupVersions}
          packages={drawInvoicePackages}
          productionActivities={productionActivities}
          productionActivitiesLoading={productionActivitiesLoading}
          productionActivitiesError={productionActivitiesError}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={handleCreate}
        />
      )}
    </>
  )
}
