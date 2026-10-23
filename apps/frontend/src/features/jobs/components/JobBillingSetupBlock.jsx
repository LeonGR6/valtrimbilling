import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, Link, Stack, Typography } from '@mui/material'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import BillingSetupSummary from '../../builder-draw-schedules/components/BillingSetupSummary.jsx'

const builderSetupsPath = (builderId) => `/builder-draw-schedules?builder=${encodeURIComponent(builderId)}`

/**
 * The billing setup a Job uses, in the Job form. A new Job shows the Builder's current setup and
 * asks for a confirmation of that version before it can be created; "Edit builder setup" opens
 * the Builder Setups page in another tab (so what was typed here is kept) and "Reload" reads the
 * setup again. An existing Job shows the version it keeps.
 */
export default function JobBillingSetupBlock({
  resolved,
  builderName,
  creating,
  confirmedVersionId,
  onConfirm,
  loading,
  canEditSetups,
  onReload,
}) {
  const { setup, source, newerBuilderSetup } = resolved

  return (
    <Stack spacing={1.25}>
      {source === 'none' && (
        <Alert
          severity={creating ? 'error' : 'warning'}
          action={onReload && (
            <Button color="inherit" size="small" onClick={onReload} disabled={loading}>Reload</Button>
          )}
        >
          {creating
            ? `${builderName || 'This Builder'} has no active billing setup, so a Job cannot be created yet. Create the setup in Builder Setups, then reload.`
            : 'The billing setup of this Job could not be loaded.'}
        </Alert>
      )}

      {setup && (
        <BillingSetupSummary
          setup={setup}
          title={source === 'builder' ? `${builderName || 'Builder'} billing setup` : 'Billing setup of this Job'}
        >
          {loading && <CircularProgress size={16} />}
          {onReload && (
            <Button
              size="small"
              color="inherit"
              startIcon={<RefreshRoundedIcon />}
              onClick={onReload}
              disabled={loading}
              sx={{ textTransform: 'none' }}
            >
              Reload
            </Button>
          )}
          {canEditSetups && (
            <Button
              size="small"
              component={Link}
              href={builderSetupsPath(setup.builderId)}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<OpenInNewRoundedIcon />}
              sx={{ textTransform: 'none' }}
            >
              Edit builder setup
            </Button>
          )}
        </BillingSetupSummary>
      )}

      {creating && setup && (
        <Box>
          <FormControlLabel
            control={(
              <Checkbox
                checked={String(confirmedVersionId) === String(setup.id)}
                onChange={(event) => onConfirm(event.target.checked ? setup.id : null)}
              />
            )}
            label={`I reviewed this setup (version ${setup.versionNumber}). The Job will bill with it.`}
          />
          <Typography variant="caption" color="text.secondary" component="div" sx={{ ml: 4 }}>
            Something is wrong? Edit it in Builder Setups, come back and press Reload. Jobs the Builder
            already has keep the version they were created with.
          </Typography>
        </Box>
      )}

      {!creating && source === 'builder' && (
        <Alert severity="warning">
          Changing the Builder gives this Job that Builder&apos;s current setup (version {setup?.versionNumber}),
          not the one it has now.
        </Alert>
      )}

      {!creating && newerBuilderSetup && (
        <Alert severity="info">
          The Builder&apos;s current setup is version {newerBuilderSetup.versionNumber}. This Job keeps
          version {setup.versionNumber}, the one it was created with.
        </Alert>
      )}
    </Stack>
  )
}
