import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { personTypeLabels } from '../../people/data/people.js'
import JobBillingSetupBlock from './JobBillingSetupBlock.jsx'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { canCreateWithSetup, resolveJobSetup } from '../utils/jobSetup.js'
import PersonPickerField from './PersonPickerField.jsx'
import { emptyJob } from '../data/jobs.js'
import { jobContactRoles } from '../data/jobContactRoles.js'
import { createJobSchema } from '../schemas/jobSchema.js'

export default function JobDialog({
  builderOptions,
  builderIdsByName,
  defaultBuilder,
  supervisors,
  contacts,
  companyContacts,
  job,
  jobs,
  onClose,
  onCreateContact,
  onCreateCompanyContact,
  onSave,
  onUpdateContact,
  onUpdateCompanyContact,
  submitting,
}) {

  const schema = useMemo(
    () => createJobSchema(jobs, job?.id),
    [job?.id, jobs],
  )
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: job
      ? {
          code: job.code,
          builder: job.builder,
          community: job.community,
          supervisorId: job.supervisorId ?? null,
          ...Object.fromEntries(jobContactRoles.map(
            ({ field }) => [field, job[field] ?? null],
          )),
        }
      : { ...emptyJob, builder: defaultBuilder ?? '' },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const selectedBuilderName = useWatch({ control, name: 'builder' })
  const selectedBuilderId = builderIdsByName.get(selectedBuilderName)
  // The billing setup the Job will use (a new Job takes the Builder's current one), and which
  // version of it the person confirmed.
  const {
    builderDrawSchedules,
    jobBillingSetupVersions,
    loading: setupsLoading,
    canManageBuilderBillingSetups,
    refreshBuilderBillingSetups,
  } = useBuilderDrawSchedules()
  const [confirmedSetupVersionId, setConfirmedSetupVersionId] = useState(null)
  const resolvedSetup = resolveJobSetup({
    job,
    builderId: selectedBuilderId ?? job?.builderId,
    builderSetups: builderDrawSchedules,
    jobSetups: jobBillingSetupVersions,
  })
  const canSubmit = Boolean(job) || canCreateWithSetup(resolvedSetup.setup, confirmedSetupVersionId)
  // Per role: the active contacts that fit it, plus the one the Job already
  // has so an inactive assignment still shows while editing. The Superintendent
  // comes from the selected Builder; the rest are Company Contacts of that type.
  const availableContacts = useMemo(
    () => Object.fromEntries(jobContactRoles.map((role) => [
      role.field,
      role.source === 'builder'
        ? contacts.filter(
            (contact) =>
              contact.type === role.type
              && (
                contact.id === job?.[role.field]
                || (
                  contact.isActive
                  && (!selectedBuilderId || contact.builderId === selectedBuilderId)
                )
              ),
          )
        // Any active Company Contact can fill the role, so one person can hold
        // several; the ones who already have the type come first.
        : companyContacts
            .filter((contact) => contact.id === job?.[role.field] || contact.isActive)
            .sort((left, right) => (
              Number(right.types.includes(role.type)) - Number(left.types.includes(role.type))
              || left.name.localeCompare(right.name)
            )),
    ])),
    [companyContacts, contacts, job, selectedBuilderId],
  )

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {job ? 'Edit job' : 'Create new job'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Add the identifying and assigned team information for this job.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Job information
            </Typography>
            <Stack spacing={2}>
              <TextField
                label="Job#"
                {...register('code')}
                error={Boolean(errors.code)}
                helperText={errors.code?.message ?? 'Example: JOB-1005'}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 30 } }}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {job ? (
                  <FormControl fullWidth error={Boolean(errors.builder)}>
                    <InputLabel id="job-builder-label">Builder / Client</InputLabel>
                    <Controller
                      name="builder"
                      control={control}
                      render={({ field }) => (
                        <Select
                          {...field}
                          labelId="job-builder-label"
                          label="Builder / Client"
                        >
                          {builderOptions.map((builder) => (
                            <MenuItem key={builder} value={builder}>
                              {builder}
                            </MenuItem>
                          ))}
                        </Select>
                      )}
                    />
                    <Typography
                      variant="caption"
                      color={errors.builder ? 'error' : 'text.secondary'}
                      sx={{ mt: 0.5, ml: 1.75, minHeight: 18 }}
                    >
                      {errors.builder?.message ?? 'Select a builder from the catalog.'}
                    </Typography>
                  </FormControl>
                ) : (
                  <TextField
                    label="Builder / Client"
                    {...register('builder')}
                    error={Boolean(errors.builder)}
                    helperText={errors.builder?.message ?? 'Selected from the current builder.'}
                    fullWidth
                    slotProps={{ htmlInput: { readOnly: true } }}
                  />
                )}

                <TextField
                  label="Community"
                  {...register('community')}
                  error={Boolean(errors.community)}
                  helperText={errors.community?.message ?? 'Example: Andara'}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
              </Stack>
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Job team
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                alignItems: 'start',
              }}
            >
              <PersonPickerField
                name="supervisorId"
                label="Supervisor"
                control={control}
                error={errors.supervisorId}
                people={supervisors}
                onCreate={onCreateCompanyContact
                  ? (draft) => onCreateCompanyContact(draft, 'SUPERVISOR')
                  : undefined}
                onUpdate={onUpdateCompanyContact}
                createTitle="Add new supervisor"
                editTitle="Edit supervisor"
                extraFields={['phone', 'territory']}
              />
              {jobContactRoles.map((role) => (
                <PersonPickerField
                  key={role.field}
                  name={role.field}
                  label={role.label}
                  helperText={role.helperText}
                  control={control}
                  error={errors[role.field]}
                  optional={role.optional}
                  people={availableContacts[role.field]}
                  optionCaption={role.source === 'company'
                    ? (person) => person.types.map((type) => personTypeLabels[type]).join(' · ')
                    : undefined}
                  selectedNote={role.source === 'company'
                    ? (person) => (person.types.includes(role.type)
                      ? null
                      : `${person.name} will also be set as ${role.label} in Company Contacts.`)
                    : undefined}
                  onCreate={role.source === 'builder'
                    ? (onCreateContact
                      ? (draft) => onCreateContact(draft, selectedBuilderName, role.type)
                      : undefined)
                    : (onCreateCompanyContact
                      ? (draft) => onCreateCompanyContact(draft, role.type)
                      : undefined)}
                  onUpdate={role.source === 'builder' ? onUpdateContact : onUpdateCompanyContact}
                  createTitle={role.addTitle}
                  editTitle={role.editTitle}
                  extraFields={['phone']}
                />
              ))}
            </Box>
          </Box>

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Billing setup
            </Typography>
            <JobBillingSetupBlock
              resolved={resolvedSetup}
              builderName={selectedBuilderName}
              creating={!job}
              confirmedVersionId={confirmedSetupVersionId}
              onConfirm={setConfirmedSetupVersionId}
              loading={setupsLoading}
              canEditSetups={canManageBuilderBillingSetups}
              onReload={() => refreshBuilderBillingSetups().catch(() => {})}
            />
          </Box>

          <Alert severity="info">
            After creating the Job, open it to configure its Plans and Options sequence sheet.
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={submitting || !canSubmit} disableElevation>
          {job ? 'Save changes' : 'Create job'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
