import { useCallback, useEffect, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Chip,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import LockRoundedIcon from '@mui/icons-material/LockRounded'
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded'
import BillingSetupSummary from '../../builder-draw-schedules/components/BillingSetupSummary.jsx'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { describeSetupHeadline } from '../../builder-draw-schedules/utils/setupSummary.js'
import { useJobs } from '../context/useJobs.js'
import { loadJobSetupState } from '../services/jobSetupRepository.js'
import { resolveJobSetup } from '../utils/jobSetup.js'
import ChangeJobSetupDialog from './ChangeJobSetupDialog.jsx'

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function describeLastChange(change) {
  const when = new Date(change.changedAt)
  const day = Number.isNaN(when.getTime()) ? '' : ` on ${dateFormatter.format(when)}`
  return `The setup was last changed${day}${change.reason ? `: ${change.reason}` : '.'}`
}

/**
 * The billing setup a Job bills with, on its page: closed it says the figures that matter
 * (retention, OCIP / WRAP, payment terms); open it is the whole setup. An Admin or Project
 * Management user can move the Job to another version until it has a Package; from then on the
 * setup is locked, because a Package freezes it.
 */
export default function JobBillingSetupCard({ job }) {
  const { builderDrawSchedules, jobBillingSetupVersions } = useBuilderDrawSchedules()
  const { canManageJobs, refreshJobs } = useJobs()
  const [state, setState] = useState(null)
  const [reloads, setReloads] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const { setup, newerBuilderSetup } = resolveJobSetup({
    job,
    builderId: job.builderId,
    builderSetups: builderDrawSchedules,
    jobSetups: jobBillingSetupVersions,
  })

  useEffect(() => {
    if (!canManageJobs) return undefined
    let ignore = false
    loadJobSetupState(job.id)
      .then((next) => {
        if (!ignore) setState(next)
      })
      .catch(() => {
        // Only informs; the change itself is checked again by the database.
      })
    return () => {
      ignore = true
    }
  }, [canManageJobs, job.id, job.billingSetupVersionId, reloads])

  const handleChanged = useCallback(async (message) => {
    setDialogOpen(false)
    setNotice(message)
    setState(null)
    setReloads((current) => current + 1)
    await refreshJobs().catch(() => {})
  }, [refreshJobs])

  if (!setup) return null

  const canTryChange = canManageJobs && job.isActive
  const locked = state !== null && state.packageCount > 0
  const lockText = locked
    ? `This Job has ${state.packageCount} Package${state.packageCount === 1 ? '' : 's'} that ${state.packageCount === 1 ? 'is' : 'are'} not voided, and a Package freezes the setup. Void ${state.packageCount === 1 ? 'it' : 'them'} to change the setup.`
    : ''

  return (
    <>
      <Accordion variant="outlined" disableGutters sx={{ mb: 2.5, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="job-billing-setup">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0.25, sm: 1.5 }}
            sx={{ minWidth: 0, alignItems: { sm: 'center' } }}
          >
            <Typography component="h2" variant="subtitle1" fontWeight={700}>
              Billing setup · Version {setup.versionNumber}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {describeSetupHeadline(setup)}
            </Typography>
            {locked && (
              <Tooltip title={lockText}>
                <Chip size="small" icon={<LockRoundedIcon />} label="Locked" variant="outlined" />
              </Tooltip>
            )}
          </Stack>
        </AccordionSummary>
        <AccordionDetails id="job-billing-setup">
          <Stack spacing={1.25}>
            {newerBuilderSetup && (
              <Alert severity="info">
                The Builder&apos;s current setup is version {newerBuilderSetup.versionNumber}. This Job keeps
                version {setup.versionNumber}, the one it has now.
              </Alert>
            )}
            {locked && <Alert severity="info">{lockText}</Alert>}
            {state?.lastChange && <Typography variant="caption" color="text.secondary">{describeLastChange(state.lastChange)}</Typography>}
            <BillingSetupSummary setup={setup} title="Setup this Job bills with">
              {canTryChange && (
                <Tooltip title={locked ? lockText : 'Use another version of this Builder’s setup'}>
                  <span>
                    <Button
                      size="small"
                      startIcon={<SwapHorizRoundedIcon />}
                      disabled={locked}
                      onClick={() => setDialogOpen(true)}
                      sx={{ textTransform: 'none' }}
                    >
                      Change setup
                    </Button>
                  </span>
                </Tooltip>
              )}
            </BillingSetupSummary>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {dialogOpen && (
        <ChangeJobSetupDialog
          job={job}
          currentSetup={setup}
          onClose={() => setDialogOpen(false)}
          onChanged={handleChanged}
        />
      )}
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={() => setNotice('')}
        message={notice}
      />
    </>
  )
}
