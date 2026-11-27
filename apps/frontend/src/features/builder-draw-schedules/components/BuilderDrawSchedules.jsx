import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { useBuilderDrawSchedules } from '../context/useBuilderDrawSchedules.js'
import BuilderSetupTable from './BuilderSetupTable.jsx'
import BuilderSetupDialog from './setup-form/BuilderSetupDialog.jsx'

function DeactivateScheduleDialog({
  schedule,
  builder,
  onClose,
  onDeactivate,
  submitting,
}) {
  return (
    <Dialog
      open={Boolean(schedule)}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>Deactivate builder setup?</DialogTitle>
      <DialogContent>
        <Alert severity="warning">
          {builder
            ? `${builder.name}'s current setup will stop being available for new Jobs. Its version and financial history will be preserved.`
            : 'The current setup will be deactivated without deleting its financial history.'}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={onDeactivate}
          disabled={submitting}
          disableElevation
        >
          {submitting ? 'Deactivating...' : 'Deactivate setup'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BuilderDrawSchedules() {
  const {
    builderDrawSchedules: schedules,
    loading: schedulesLoading,
    error: schedulesError,
    canManageBuilderBillingSetups,
    refreshBuilderBillingSetups,
    saveBuilderBillingSetup,
    deactivateBuilderBillingSetup,
  } = useBuilderDrawSchedules()
  const {
    builders,
    loading: buildersLoading,
    error: buildersError,
    refreshBuilders,
  } = useBuilders()
  const [searchParams] = useSearchParams()
  // A link from Create Job names the Builder whose setup to open.
  const focusBuilderId = searchParams.get('builder')
  const [dialogState, setDialogState] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  // Why the last save was refused. It stays in the dialog, with the form, until it is fixed or closed.
  const [saveError, setSaveError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const buildersById = useMemo(
    () => new Map(builders.map((builder) => [builder.id, builder])),
    [builders],
  )

  const handleSave = async (form) => {
    setSubmitting(true)
    setSaveError(null)
    try {
      await saveBuilderBillingSetup(form)
      setNotice({
        severity: 'success',
        message: dialogState?.mode === 'edit'
          ? 'Builder setup updated with a new active version.'
          : 'Builder setup created and activated.',
      })
      setDialogState(null)
    } catch (failure) {
      setSaveError({ message: failure.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeactivate = async () => {
    if (!deactivateTarget) return

    setSubmitting(true)
    try {
      await deactivateBuilderBillingSetup(deactivateTarget.builderId)
      setDeactivateTarget(null)
      setNotice({
        severity: 'success',
        message: 'Builder setup deactivated. Its history was preserved.',
      })
    } catch (deactivateError) {
      setNotice({ severity: 'error', message: deactivateError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const loading = schedulesLoading || buildersLoading
  const loadError = schedulesError || buildersError

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h5" fontWeight={750} color="text.primary">
              Builder Setups
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
              One complete setup per builder: draw allocation, cutoff rules,
              payment deductions and required submission documents.
            </Typography>
          </Box>
          {canManageBuilderBillingSetups && (
            <ResponsiveCreateButton
              label="New builder setup"
              mobileLabel="New setup"
              disabled={loading || builders.length === 0}
              onClick={() => setDialogState({ mode: 'create' })}
            />
          )}
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {loadError && (
          <Alert
            severity="error"
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  refreshBuilderBillingSetups().catch(() => {})
                  refreshBuilders().catch(() => {})
                }}
              >
                Retry
              </Button>
            )}
            sx={{ mb: 2 }}
          >
            {loadError}
          </Alert>
        )}

        {schedules.length > 0 || builders.length > 0 ? (
          <BuilderSetupTable
            schedules={schedules}
            builders={builders}
            canManage={canManageBuilderBillingSetups}
            focusBuilderId={focusBuilderId}
            onEdit={(target) => setDialogState({ mode: 'edit', schedule: target })}
            onDeactivate={setDeactivateTarget}
            onCreateFor={(builder) => setDialogState({ mode: 'create', builderId: builder.id })}
          />
        ) : (
          <Card variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
            <BusinessRoundedIcon color="action" sx={{ fontSize: 44 }} />
            <Typography fontWeight={750} sx={{ mt: 1 }}>
              {loading ? 'Loading builder setups...' : 'No builder setups yet'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
              {loading
                ? 'Loading billing configuration from Supabase.'
                : 'Create the first setup with draw and billing configuration.'}
            </Typography>
            {!loading && canManageBuilderBillingSetups && (
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                disabled={builders.length === 0}
                onClick={() => setDialogState({ mode: 'create' })}
                disableElevation
              >
                New builder setup
              </Button>
            )}
          </Card>
        )}
      </Box>

      {dialogState && (
        <BuilderSetupDialog
          schedule={dialogState.schedule}
          schedules={schedules}
          builders={builders}
          initialBuilderId={dialogState.builderId ?? ''}
          onClose={submitting ? undefined : () => { setDialogState(null); setSaveError(null) }}
          onSave={handleSave}
          submitting={submitting}
          error={saveError}
        />
      )}

      <DeactivateScheduleDialog
        schedule={deactivateTarget}
        builder={deactivateTarget
          ? buildersById.get(deactivateTarget.builderId)
          : null}
        onClose={() => setDeactivateTarget(null)}
        onDeactivate={handleDeactivate}
        submitting={submitting}
      />

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3200}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={notice?.severity ?? 'success'}
          onClose={() => setNotice(null)}
          variant="filled"
        >
          {notice?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
