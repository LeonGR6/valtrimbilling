import { useEffect, useMemo, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  AlertTitle,
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
import {
  countIssuesBySection,
  describeFormIssueTargets,
  explainSaveError,
} from '../../utils/setupForm.js'
import CycleSection from './CycleSection.jsx'
import DeductionsSection from './DeductionsSection.jsx'
import DrawsSection from './DrawsSection.jsx'
import { FormIssuesContext } from './formIssues.js'
import HardwareUtilitySection from './HardwareUtilitySection.jsx'
import IssueList from './IssueList.jsx'
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

// Where a field is on the page: the control that holds it, or the part of the form it is in.
const FOCUSABLE = 'input:not([type="hidden"]):not([aria-hidden="true"]), textarea, [role="combobox"], [role="button"], button'

/**
 * Takes the person to a problem of the form: scrolls it into the middle of the dialog and puts the
 * cursor in the field. `target` is `{ name, section }`; a problem with no field of its own leads to
 * its part of the form.
 */
function revealIssue(root, target) {
  if (!root || !target) return

  const field = target.name
    ? root.querySelector(`[data-setup-field="${CSS.escape(target.name)}"], [name="${CSS.escape(target.name)}"]`)
    : null
  const anchor = field?.closest('.MuiFormControl-root')
    ?? field
    ?? (target.section ? root.querySelector(`#setup-section-${target.section}`) : null)
  if (!anchor) return

  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  anchor.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' })

  const control = field?.matches?.(FOCUSABLE) ? field : anchor.querySelector(FOCUSABLE)
  control?.focus({ preventScroll: true })
}

/**
 * Creates a Builder's billing setup, or edits it (which saves a new version of it). The form is
 * on the left; on the right the setup as it stands, what is missing and, for an edit, what
 * differs from the version being edited. Closing with unsaved changes asks first.
 *
 * Nothing is left unsaid. Saving is always possible: with problems it shows every one of them on
 * its own field, marks the parts of the form that have them and takes the person to the first one,
 * and from then on the marks follow what is typed. A save the database refuses stays on screen,
 * on the field it is about when that is known (`error` is `{ message }`, a new object each time).
 */
export default function BuilderSetupDialog({
  schedule = null,
  schedules,
  builders,
  initialBuilderId = '',
  onClose,
  onSave,
  submitting,
  error = null,
}) {
  const theme = useTheme()
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'))
  const [confirmingClose, setConfirmingClose] = useState(false)
  // Whether the person has tried to save with problems: from then on they are shown everywhere.
  const [attempted, setAttempted] = useState(false)
  const [dismissedError, setDismissedError] = useState(null)
  const contentRef = useRef(null)
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
  const { control, handleSubmit, clearErrors, setError, subscribe, trigger, formState: { errors, isDirty } } = methods
  const values = useWatch({ control })
  const issues = useMemo(() => {
    const parsed = schema.safeParse(values)
    return parsed.success ? [] : describeFormIssueTargets(parsed.error.issues, values)
  }, [schema, values])
  const nothingChanged = Boolean(schedule) && !isDirty

  // The message of a save the database refused, until the person closes it, and where it belongs.
  const refused = useMemo(
    () => (error && error !== dismissedError ? explainSaveError(error.message) : null),
    [error, dismissedError],
  )
  const showErrors = attempted || Boolean(refused)
  const counts = useMemo(() => {
    const byPart = countIssuesBySection(issues)
    if (refused?.section) byPart[refused.section] = (byPart[refused.section] ?? 0) + 1
    return byPart
  }, [issues, refused])
  const issuesContext = useMemo(() => ({ showErrors, counts }), [showErrors, counts])

  // The refused field says why, in its own place.
  useEffect(() => {
    if (refused?.name) setError(refused.name, { type: 'server', message: refused.text })
  }, [refused, setError])

  // Editing the part the refusal is about answers it: its message goes, as the field's mark does.
  useEffect(() => {
    if (!error || !refused?.name) return undefined
    const part = refused.name.split('.')[0]
    return subscribe({
      formState: { values: true },
      callback: ({ name }) => {
        if (!name?.startsWith(part)) return
        clearErrors(refused.name)
        setDismissedError(error)
      },
    })
  }, [error, refused, subscribe, clearErrors])

  // Once the person has tried to save, what they fix is checked as they type.
  useEffect(() => {
    if (attempted) trigger()
  }, [attempted, values, trigger])

  const goTo = (target) => revealIssue(contentRef.current, target)
  // The marks appear on the next paint; the first problem is found after them.
  const showFirstIssue = () => {
    setAttempted(true)
    requestAnimationFrame(() => goTo(issues[0]))
  }

  const submit = (event) => handleSubmit(onSave, showFirstIssue)(event)

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

  const footerMessage = nothingChanged
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
        slotProps={{ paper: { component: 'form', onSubmit: submit, noValidate: true } }}
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
          <FormIssuesContext.Provider value={issuesContext}>
            <DialogContent dividers ref={contentRef} sx={{ pt: 2.5 }}>
              <Box
                sx={{
                  display: 'grid',
                  gap: { xs: 3, md: 4 },
                  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
                  alignItems: 'start',
                }}
              >
                <Box sx={{ display: 'grid', gap: 3, minWidth: 0 }}>
                  {refused && (
                    <Alert
                      severity="error"
                      role="alert"
                      onClose={() => setDismissedError(error)}
                      action={refused.name || refused.section ? (
                        <Button color="inherit" size="small" onClick={() => goTo(refused)} sx={{ whiteSpace: 'nowrap' }}>
                          Go to it
                        </Button>
                      ) : null}
                    >
                      <AlertTitle>The setup was not saved</AlertTitle>
                      {refused.text}
                    </Alert>
                  )}
                  {/* Beside the form the list is in the panel; under it, on a narrow screen, it is here. */}
                  {attempted && issues.length > 0 && (
                    <Box sx={{ display: { md: 'none' } }}>
                      <Alert severity="error" icon={false}>
                        <AlertTitle>
                          {issues.length} {issues.length === 1 ? 'thing' : 'things'} to fix before this can be saved
                        </AlertTitle>
                        <IssueList items={issues} onSelect={goTo} />
                      </Alert>
                    </Box>
                  )}
                  <Controller
                    name="builderId"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        select
                        label="Builder"
                        required
                        name="builderId"
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
                  <SetupLivePanel
                    current={schedule}
                    issues={issues}
                    isDirty={isDirty}
                    attempted={attempted}
                    onSelectIssue={goTo}
                  />
                </Box>
              </Box>
            </DialogContent>
          </FormIssuesContext.Provider>
        </FormProvider>

        <DialogActions sx={{ px: 3, py: 1.75, gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ flex: '1 1 220px', minWidth: 0 }} aria-live="polite">
            {issues.length > 0 ? (
              <Button
                color="error"
                size="small"
                onClick={showFirstIssue}
                sx={{ textTransform: 'none', textAlign: 'left', justifyContent: 'flex-start', overflowWrap: 'anywhere' }}
              >
                {issues.length === 1
                  ? issues[0].text
                  : `${issues.length} things to fix, starting with ${issues[0].text}`}
              </Button>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {footerMessage}
              </Typography>
            )}
          </Box>
          <Button color="inherit" onClick={requestClose} disabled={submitting}>Cancel</Button>
          {/* Never disabled by what is missing: saving with problems shows them, field by field. */}
          <Button type="submit" variant="contained" disableElevation disabled={nothingChanged || submitting}>
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
