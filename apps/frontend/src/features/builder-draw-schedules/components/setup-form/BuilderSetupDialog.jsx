import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import {
  defaultBillingSettings,
  defaultDraws,
  emptyHardwareEventPercentages,
  emptyUtilityEventPercentages,
} from '../../data/builderDrawSchedules.js'
import { createBuilderDrawScheduleSchema } from '../../schemas/builderDrawScheduleSchema.js'
import { describeFormIssues } from '../../utils/setupForm.js'
import CycleSection from './CycleSection.jsx'
import DeductionsSection from './DeductionsSection.jsx'
import DrawsSection from './DrawsSection.jsx'
import HardwareUtilitySection from './HardwareUtilitySection.jsx'
import SetupLivePanel from './SetupLivePanel.jsx'
import SubmissionSection from './SubmissionSection.jsx'

function defaultValuesFor(schedule, initialBuilderId) {
  if (!schedule) {
    return {
      builderId: initialBuilderId,
      draws: defaultDraws.map((draw) => ({ ...draw })),
      ...defaultBillingSettings,
      hardwareEventPercentages: { ...emptyHardwareEventPercentages },
      utilityEventPercentages: { ...emptyUtilityEventPercentages },
      cutoffDays: [...defaultBillingSettings.cutoffDays],
    }
  }

  return {
    ...schedule,
    hardwareBillingMode: schedule.separateHardwarePrice ? 'BY_EVENT' : 'FULL',
    optionsBillingDrawIndex: schedule.optionsBillingDrawIndex ?? null,
    draws: schedule.draws.map((draw) => ({ ...draw })),
    hardwareEventPercentages: { ...emptyHardwareEventPercentages, ...schedule.hardwareEventPercentages },
    utilityEventPercentages: { ...emptyUtilityEventPercentages, ...schedule.utilityEventPercentages },
    cutoffDays: [...schedule.cutoffDays],
  }
}

/**
 * Creates a Builder's billing setup, or edits it (which saves a new version of it). The form is
 * on the left; on the right the setup as it stands, what is missing and, for an edit, what
 * differs from the version being edited. Closing with unsaved changes asks first.
 */
export default function BuilderSetupDialog({
  schedule = null,
  schedules,
  builders,
  initialBuilderId = '',
  onClose,
  onSave,
  submitting,
}) {
  const theme = useTheme()
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'))
  const [confirmingClose, setConfirmingClose] = useState(false)
  const schema = useMemo(
    () => createBuilderDrawScheduleSchema(schedules, schedule?.id),
    [schedule?.id, schedules],
  )
  const methods = useForm({
    resolver: zodResolver(schema),
    defaultValues: defaultValuesFor(schedule, initialBuilderId),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const { control, handleSubmit, formState: { errors, isDirty } } = methods
  const values = useWatch({ control })
  const issues = useMemo(() => {
    const parsed = schema.safeParse(values)
    return parsed.success ? [] : describeFormIssues(parsed.error.issues, values)
  }, [schema, values])
  const nothingChanged = Boolean(schedule) && !isDirty
  const canSave = issues.length === 0 && !nothingChanged

  const availableBuilders = builders.filter(
    (builder) => builder.id === schedule?.builderId
      || (builder.isActive
        && !schedules.some((item) => item.id !== schedule?.id && item.builderId === builder.id)),
  )
  const builderName = builders.find((builder) => builder.id === schedule?.builderId)?.name

  const requestClose = () => {
    if (submitting) return
    if (isDirty) setConfirmingClose(true)
    else onClose()
  }

  const footerMessage = issues.length > 0
    ? `${issues[0]}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ''}`
    : nothingChanged
      ? 'Nothing has changed yet'
      : schedule
        ? `Saves version ${schedule.versionNumber + 1} as the builder's current setup`
        : 'Ready to save'

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        fullScreen={isPhone}
        fullWidth
        maxWidth="lg"
        slotProps={{ paper: { component: 'form', onSubmit: handleSubmit(onSave), noValidate: true } }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" component="div" fontWeight={750}>
            {schedule ? `Edit builder setup${builderName ? ` · ${builderName}` : ''}` : 'New builder setup'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            {schedule
              ? `Saving makes a new version of this setup. Jobs already on version ${schedule.versionNumber} keep it until you change them from the Job page.`
              : 'How this builder is billed: its Draws, cutoff, payment terms and what each Package needs.'}
          </Typography>
        </DialogTitle>

        <FormProvider {...methods}>
          <DialogContent dividers sx={{ pt: 2.5 }}>
            <Box
              sx={{
                display: 'grid',
                gap: { xs: 3, md: 4 },
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
                alignItems: 'start',
              }}
            >
              <Box sx={{ display: 'grid', gap: 3, minWidth: 0 }}>
                <Controller
                  name="builderId"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      select
                      label="Builder"
                      value={field.value}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                      onBlur={field.onBlur}
                      inputRef={field.ref}
                      disabled={Boolean(schedule)}
                      error={Boolean(errors.builderId)}
                      helperText={
                        errors.builderId?.message
                        ?? (schedule
                          ? 'The builder cannot be changed after creation.'
                          : 'Only active builders without a setup are listed.')
                      }
                      sx={{ maxWidth: 380 }}
                    >
                      {availableBuilders.map((builder) => (
                        <MenuItem key={builder.id} value={builder.id}>
                          {builder.name} ({builder.code})
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                {availableBuilders.length === 0 && !schedule && (
                  <Alert severity="info">Every active builder already has a setup.</Alert>
                )}

                <DrawsSection />
                <HardwareUtilitySection />
                <CycleSection />
                <DeductionsSection />
                <SubmissionSection />
              </Box>

              <Box
                sx={{
                  position: { md: 'sticky' },
                  top: { md: 0 },
                  maxHeight: { md: 'calc(100dvh - 250px)' },
                  overflowY: { md: 'auto' },
                  // Keeps the scrollbar of a tall summary from touching the cards.
                  pr: { md: 0.5 },
                }}
              >
                <SetupLivePanel current={schedule} issues={issues} isDirty={isDirty} />
              </Box>
            </Box>
          </DialogContent>
        </FormProvider>

        <DialogActions sx={{ px: 3, py: 1.75, gap: 1, flexWrap: 'wrap' }}>
          <Typography
            variant="body2"
            color={issues.length > 0 ? 'error.main' : 'text.secondary'}
            sx={{ flex: '1 1 220px', minWidth: 0, overflowWrap: 'anywhere' }}
            aria-live="polite"
          >
            {footerMessage}
          </Typography>
          <Button color="inherit" onClick={requestClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="contained" disableElevation disabled={!canSave || submitting}>
            {submitting ? 'Saving...' : schedule ? 'Save new version' : 'Create setup'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmingClose} onClose={() => setConfirmingClose(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Discard your changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The setup has changes that are not saved. If you close it now, they are lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirmingClose(false)}>Keep editing</Button>
          <Button color="error" onClick={onClose}>Discard</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
