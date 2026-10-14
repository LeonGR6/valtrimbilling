import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import BackupTableRoundedIcon from '@mui/icons-material/BackupTableRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { usePersistentState, isStoredString } from '../../../hooks/usePersistentState.js'
import { BuildersCatalog } from '../../builders/index.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { usePeople } from '../../people/context/usePeople.js'
import { contactTypeLabels, emptyContact } from '../../builder-contacts'
import { emptyPerson, personTypeLabels } from '../../people/data/people.js'
import { useBuilderContacts } from '../../builder-contacts/context/useBuilderContacts.js'
import JobDetails from './JobDetails.jsx'
import PersonPickerField from './PersonPickerField.jsx'
import {
  emptyJob,
  getJobPlanCount,
  getJobUnitCount,
} from '../data/jobs.js'
import { jobContactRoles } from '../data/jobContactRoles.js'
import { useJobs } from '../context/useJobs.js'
import { createJobSchema } from '../schemas/jobSchema.js'
import {
  builderJobsPath,
  getJobBuilderId,
  jobPlansOptionsPath,
} from '../utils/jobRoutes.js'
import {
  contactTypesToAdd,
  resolveJobContacts,
} from '../utils/jobAssignments.js'
import { JobContactsSummary } from './JobContacts.jsx'

function JobDialog({
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

          <Alert severity="info">
            After creating the Job, open it to configure its Plans and Options sequence sheet.
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={submitting} disableElevation>
          {job ? 'Save changes' : 'Create job'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function SummaryCard({ icon, label, value }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 180 }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: '16px !important' }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'primary.light',
            color: 'primary.main',
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}

const JOB_ROWS_PER_PAGE_OPTIONS = [5, 10, 25]

export default function JobsCatalog() {
  const navigate = useNavigate()
  const { builderId, jobId } = useParams()
  const [searchParams] = useSearchParams()
  const {
    jobs,
    loading,
    error,
    canManageJobs,
    refreshJobs,
    createJob,
    updateJob,
    deactivateJob,
  } = useJobs()
  const { builders } = useBuilders()
  const {
    people,
    canManageContacts,
    createContact,
    updateContact,
  } = usePeople()
  const {
    contacts,
    canManageBuilderContacts,
    createBuilderContact,
    updateBuilderContact,
  } = useBuilderContacts()
  const [search, setSearch] = usePersistentState('jobs:search', '', isStoredString)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = usePersistentState(
    'jobs:rows-per-page',
    JOB_ROWS_PER_PAGE_OPTIONS[0],
    (value) => JOB_ROWS_PER_PAGE_OPTIONS.includes(value),
  )
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  const supervisors = useMemo(
    () => people.filter((person) => person.types.includes('SUPERVISOR')),
    [people],
  )
  const builderIdsByName = useMemo(
    () => new Map(builders.map((builder) => [builder.name, builder.id])),
    [builders],
  )

  const createRequested = searchParams.get('create') === '1'
  const legacyBuilderId = searchParams.get('builder')
  const legacyJobId = searchParams.get('job')
  const dialogJob = editTarget ?? (createRequested ? null : undefined)
  const selectedBuilder = builders.find(
    (builder) => String(builder.id) === builderId,
  )
  const dialogOpen = canManageJobs && (
    Boolean(editTarget) || (createRequested && selectedBuilder?.isActive)
  )
  const builderJobs = useMemo(
    () => selectedBuilder
      ? jobs.filter(
          (job) => String(job.builderId) === String(selectedBuilder.id),
        )
      : [],
    [jobs, selectedBuilder],
  )

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase()

    return builderJobs.filter((job) =>
      !query ||
      [
          job.code,
          job.community,
          job.builder,
          ...resolveJobContacts(job, people, contacts).map((contact) => contact.name),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [builderJobs, contacts, people, search])

  const visibleJobs = filteredJobs.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )
  const totalUnits = builderJobs.reduce(
    (total, job) => total + getJobUnitCount(job),
    0,
  )
  const totalPlans = builderJobs.reduce(
    (total, job) => total + getJobPlanCount(job),
    0,
  )
  const detailJob = builderJobs.find(
    (job) => String(job.id) === jobId,
  )
  const builderOptions = builders
    .filter(
      (builder) =>
        builder.isActive ||
        builder.name === selectedBuilder?.name ||
        builder.name === editTarget?.builder,
    )
    .map((builder) => builder.name)
  const availableSupervisors = supervisors.filter(
    (supervisor) => supervisor.isActive || supervisor.id === editTarget?.supervisorId,
  )
  useEffect(() => {
    if (builderId || jobId || (!legacyBuilderId && !legacyJobId)) return

    const legacyJob = jobs.find((job) => String(job.id) === legacyJobId)
    const resolvedBuilderId = legacyJob
      ? getJobBuilderId(legacyJob)
      : legacyBuilderId

    if (legacyJob && resolvedBuilderId != null) {
      navigate(jobPlansOptionsPath(resolvedBuilderId, legacyJob.id), {
        replace: true,
      })
      return
    }

    if (resolvedBuilderId != null) {
      navigate(builderJobsPath(resolvedBuilderId), { replace: true })
    }
  }, [
    builderId,
    jobId,
    jobs,
    legacyBuilderId,
    legacyJobId,
    navigate,
  ])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
    document.querySelector('main > div')?.scrollTo({ top: 0, left: 0 })
  }, [detailJob?.id, selectedBuilder?.id])

  const openBuilderJobs = (builder) => {
    setSearch('')
    setPage(0)
    navigate(builderJobsPath(builder.id))
  }

  const showBuilders = () => {
    setSearch('')
    setPage(0)
    navigate('/jobs')
  }

  const openCreateDialog = () => {
    setEditTarget(null)
    navigate(`${builderJobsPath(selectedBuilder.id)}?create=1`)
  }

  const closeDialog = () => {
    setEditTarget(null)
    if (createRequested) {
      navigate(builderJobsPath(selectedBuilder.id), { replace: true })
    }
  }

  const handleMenuOpen = (event, job) => {
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setSelectedJob(job)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedJob(null)
  }

  const openEditDialog = () => {
    setEditTarget(selectedJob)
    handleMenuClose()
  }

  const openDeactivateDialog = () => {
    setDeactivateTarget(selectedJob)
    handleMenuClose()
  }

  const openJobDetails = (job) => {
    navigate(jobPlansOptionsPath(selectedBuilder.id, job.id))
  }

  const openSelectedJobDetails = () => {
    const job = selectedJob
    handleMenuClose()
    if (job) openJobDetails(job)
  }

  const handleCreateContact = async (draft, builderName, type) => {
    const builderIdForContact = builderIdsByName.get(builderName)
    if (!builderIdForContact) {
      throw new Error('Select a persisted Builder before adding a contact.')
    }

    return createBuilderContact({
      ...emptyContact,
      ...draft,
      typeName: contactTypeLabels[type],
      builderId: builderIdForContact,
      isActive: true,
    })
  }

  const handleUpdateContact = (contactId, draft) => {
    const existing = contacts.find((contact) => contact.id === contactId)
    if (!existing) throw new Error('That contact no longer exists.')

    return updateBuilderContact(contactId, { ...existing, ...draft })
  }

  const handleCreateCompanyContact = (draft, type) =>
    createContact({ ...emptyPerson, ...draft, types: [type], isActive: true })

  const handleUpdateCompanyContact = (contactId, draft) => {
    const existing = people.find((person) => person.id === contactId)
    if (!existing) throw new Error('That contact no longer exists.')

    return updateContact(contactId, { ...existing, ...draft })
  }

  const handleSave = async (form) => {
    const savedBuilderId = editTarget
      ? builders.find((builder) => builder.name === form.builder)?.id
        ?? editTarget.builderId
      : selectedBuilder.id

    setSubmitting(true)
    try {
      const mutation = { ...form, builderId: savedBuilderId }

      // A person picked for a role they do not have yet gets that type first,
      // because the Job only accepts contacts of the matching type.
      for (const { person, types } of contactTypesToAdd(form, people, jobContactRoles)) {
        await updateContact(person.id, { ...person, types })
      }

      if (editTarget) {
        await updateJob(editTarget.id, mutation)
        setNotice({ severity: 'success', message: 'Job updated.' })
      } else {
        await createJob(mutation)
        setPage(0)
        setNotice({ severity: 'success', message: 'Job created.' })
      }

      closeDialog()
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeactivate = async () => {
    if (!deactivateTarget) return

    setSubmitting(true)
    try {
      await deactivateJob(deactivateTarget.id)
      setDeactivateTarget(null)
      setPage(0)
      setNotice({ severity: 'success', message: 'Job deactivated.' })
    } catch (deactivateError) {
      setNotice({ severity: 'error', message: deactivateError.message })
    } finally {
      setSubmitting(false)
    }
  }

  if (!selectedBuilder) {
    return (
      <BuildersCatalog
        getBuilderJobCount={(builder) =>
          jobs.filter((job) => String(job.builderId) === String(builder.id)).length
        }
        onSelectBuilder={openBuilderJobs}
      />
    )
  }

  if (detailJob) {
    return (
      <JobDetails
        job={detailJob}
        builderId={selectedBuilder.id}
        contacts={resolveJobContacts(detailJob, people, contacts)}
        onBack={() => navigate(builderJobsPath(selectedBuilder.id))}
      />
    )
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 3,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
          flexDirection: { xs: 'column', sm: 'row' },
        }}
      >
        <Stack spacing={1.25} sx={{ alignItems: 'flex-start' }}>
          <Button
            color="inherit"
            size="small"
            startIcon={<ArrowBackRoundedIcon />}
            onClick={showBuilders}
            sx={{ ml: -1, color: 'text.secondary' }}
          >
            All builders
          </Button>
          <Box>
            <Typography
              variant="caption"
              color="primary.main"
              fontWeight={700}
              sx={{ display: 'block', mb: 0.5, letterSpacing: '0.04em' }}
            >
              JOBS / BUILDERS / {selectedBuilder.name.toUpperCase()}
            </Typography>
            <Typography variant="h5" fontWeight={700} color="text.primary">
              {selectedBuilder.name} jobs
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Viewing jobs assigned to this builder. Select one to manage its Plans &amp; Options.
            </Typography>
          </Box>
        </Stack>
        {canManageJobs && selectedBuilder.isActive && (
          <ResponsiveCreateButton
            label="New job"
            onClick={openCreateDialog}
          />
        )}
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Jobs for {selectedBuilder.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            This list only includes jobs belonging to the selected builder.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <SummaryCard icon={<HomeWorkRoundedIcon />} label="Jobs" value={builderJobs.length} />
          <SummaryCard icon={<LayersRoundedIcon />} label="Plans" value={totalPlans} />
          <SummaryCard icon={<ApartmentRoundedIcon />} label="Lots from phases" value={totalUnits} />
        </Stack>

        {error && (
          <Alert
            severity="error"
            action={(
              <Button color="inherit" size="small" onClick={() => refreshJobs().catch(() => {})}>
                Retry
              </Button>
            )}
            sx={{ mb: 2.5 }}
          >
            {error}
          </Alert>
        )}

        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}
          >
            <TextField
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
              }}
              size="small"
              placeholder="Search jobs, communities or team members..."
              sx={{ width: { xs: '100%', md: 380 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Stack>

          <TableContainer>
            <Table sx={{ minWidth: 840 }}>
              <TableHead>
                <TableRow
                  sx={{
                    bgcolor: 'sidebar.bg',
                    '& .MuiTableCell-root': {
                      color: 'text.secondary',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    },
                  }}
                >
                  <TableCell>Job#</TableCell>
                  <TableCell>Community / Builder</TableCell>
                  <TableCell>Contacts</TableCell>
                  <TableCell width={150}>Lots from Phases</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    hover
                    role="link"
                    tabIndex={0}
                    aria-label={`Open Job ${job.code}`}
                    onClick={() => openJobDetails(job)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && event.key === 'Enter') {
                        openJobDetails(job)
                      }
                    }}
                    sx={{
                      cursor: 'pointer',
                      '&:last-child td': { borderBottom: 0 },
                      '&:focus-visible': {
                        outline: '2px solid',
                        outlineColor: 'primary.main',
                        outlineOffset: -2,
                      },
                    }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                        <Box
                          sx={{
                            width: 36,
                            height: 36,
                            borderRadius: 1.5,
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'primary.light',
                            color: 'primary.main',
                            flexShrink: 0,
                          }}
                        >
                          <BackupTableRoundedIcon fontSize="small" />
                        </Box>
                        <Box>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <Typography variant="body2" fontWeight={700} noWrap color="primary.main">
                              {job.code}
                            </Typography>
                            {!job.isActive && (
                              <Chip label="Inactive" size="small" variant="outlined" />
                            )}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            {getJobPlanCount(job)}{' '}
                            {getJobPlanCount(job) === 1 ? 'plan' : 'plans'}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {job.community}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {job.builder}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 260 }}>
                      <JobContactsSummary
                        contacts={resolveJobContacts(job, people, contacts)}
                      />
                    </TableCell>
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          {getJobUnitCount(job)}
                        </Typography>
                        {canManageJobs && (
                          <IconButton
                            size="small"
                            aria-label={`Actions for ${job.code}`}
                            onClick={(event) => handleMenuOpen(event, job)}
                          >
                            <MoreHorizRoundedIcon />
                          </IconButton>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}

                {loading && visibleJobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center' }}>
                      <Typography color="text.secondary">Loading Jobs...</Typography>
                    </TableCell>
                  </TableRow>
                )}

                {!loading && visibleJobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ py: 8, textAlign: 'center' }}>
                      <SearchRoundedIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                      <Typography fontWeight={600}>No jobs found</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {search
                          ? 'Try changing your search.'
                          : `Create the first job for ${selectedBuilder.name}.`}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredJobs.length}
            page={page}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value))
              setPage(0)
            }}
            rowsPerPageOptions={JOB_ROWS_PER_PAGE_OPTIONS}
          />
        </Box>
      </Box>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={openSelectedJobDetails}>
          <BackupTableRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          View Plans & Options for job #{selectedJob?.code}
        </MenuItem>
        <MenuItem onClick={openEditDialog}>
          <EditOutlinedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Edit
        </MenuItem>
        <MenuItem
          onClick={openDeactivateDialog}
          disabled={!selectedJob?.isActive}
          sx={{ color: 'error.main' }}
        >
          <BlockRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Deactivate
        </MenuItem>
      </Menu>

      {dialogOpen && (
        <JobDialog
          key={dialogJob?.id ?? `new-${selectedBuilder.id}`}
          builderOptions={builderOptions}
          builderIdsByName={builderIdsByName}
          defaultBuilder={selectedBuilder.name}
          supervisors={availableSupervisors}
          contacts={contacts}
          companyContacts={people}
          job={dialogJob}
          jobs={jobs}
          onClose={closeDialog}
          onCreateContact={
            canManageBuilderContacts ? handleCreateContact : undefined
          }
          onCreateCompanyContact={
            canManageContacts ? handleCreateCompanyContact : undefined
          }
          onSave={handleSave}
          onUpdateContact={
            canManageBuilderContacts ? handleUpdateContact : undefined
          }
          onUpdateCompanyContact={
            canManageContacts ? handleUpdateCompanyContact : undefined
          }
          submitting={submitting}
        />
      )}

      <Dialog
        open={Boolean(deactivateTarget)}
        onClose={submitting ? undefined : () => setDeactivateTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Deactivate Job?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deactivateTarget
              ? `${deactivateTarget.code} — ${deactivateTarget.community} / ${deactivateTarget.builder} will remain in the catalog as inactive. Its existing configuration will be preserved.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeactivateTarget(null)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeactivate}
            disabled={submitting}
            disableElevation
          >
            Deactivate Job
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
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
