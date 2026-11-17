import { Alert, Button } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { describeMissingOptionsBilling, resolveJobSetup } from '../utils/jobSetup.js'

/**
 * Warns that the Job has options its billing setup never bills: the setup has no Draw chosen for
 * Options. Nothing shows while the setup is not loaded, or when it already names the Draw.
 */
export default function OptionsBillingNotice({ job, optionCount, sx }) {
  const { builderDrawSchedules, jobBillingSetupVersions, canManageBuilderBillingSetups } = useBuilderDrawSchedules()
  const { setup, newerBuilderSetup } = resolveJobSetup({
    job,
    builderId: job.builderId,
    builderSetups: builderDrawSchedules,
    jobSetups: jobBillingSetupVersions,
  })
  const message = describeMissingOptionsBilling({ setup, newerBuilderSetup, optionCount })
  if (!message) return null

  return (
    <Alert
      severity="warning"
      sx={sx}
      action={canManageBuilderBillingSetups && (
        <Button component={RouterLink} to="/builder-draw-schedules" size="small" color="inherit">
          Builder Setup
        </Button>
      )}
    >
      {message}
    </Alert>
  )
}
