import { Accordion, AccordionDetails, AccordionSummary, Alert, Stack, Typography } from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import BillingSetupSummary from '../../builder-draw-schedules/components/BillingSetupSummary.jsx'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { describeSetupHeadline } from '../../builder-draw-schedules/utils/setupSummary.js'
import { resolveJobSetup } from '../utils/jobSetup.js'

/**
 * The billing setup a Job bills with, on its page: closed it says the figures that matter
 * (retention, OCIP / WRAP, payment terms); open it is the whole setup. Read-only.
 */
export default function JobBillingSetupCard({ job }) {
  const { builderDrawSchedules, jobBillingSetupVersions } = useBuilderDrawSchedules()
  const { setup, newerBuilderSetup } = resolveJobSetup({
    job,
    builderId: job.builderId,
    builderSetups: builderDrawSchedules,
    jobSetups: jobBillingSetupVersions,
  })
  if (!setup) return null

  return (
    <Accordion variant="outlined" disableGutters sx={{ mb: 2.5, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="job-billing-setup">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.25, sm: 1.5 }} sx={{ minWidth: 0 }}>
          <Typography component="h2" variant="subtitle1" fontWeight={700}>
            Billing setup · Version {setup.versionNumber}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
            {describeSetupHeadline(setup)}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails id="job-billing-setup">
        <Stack spacing={1.25}>
          {newerBuilderSetup && (
            <Alert severity="info">
              The Builder&apos;s current setup is version {newerBuilderSetup.versionNumber}. This Job keeps
              version {setup.versionNumber}, the one it was created with.
            </Alert>
          )}
          <BillingSetupSummary setup={setup} title="Setup this Job bills with" />
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}
