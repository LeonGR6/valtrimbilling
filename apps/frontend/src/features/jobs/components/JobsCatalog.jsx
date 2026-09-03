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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { BuildersCatalog } from '../../builders/index.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { initialPeople } from '../../people'
import {
  builderLabels,
  emptyContact,
  initialContacts,
} from '../../builder-contacts'
import JobDetails from './JobDetails.jsx'
import PersonPickerField from './PersonPickerField.jsx'
import {
  emptyJob,
  getJobPlanCount,
  getJobUnitCount,
} from '../data/jobs.js'
import { useJobs } from '../context/useJobs.js'
import { createJobSchema } from '../schemas/jobSchema.js'
import {
  builderJobsPath,
  getJobBuilderId,
  jobPlansOptionsPath,
} from '../utils/jobRoutes.js'

const builderCodeByName = Object.fromEntries(
  Object.entries(builderLabels).map(([code, name]) => [name, code]),
)

const personName = (index, id) => index.get(id)?.name ?? 'Unassigned'

function JobDialog({
  builderOptions,
  defaultBuilder,
  supervisors,
  superintendents,
  job,
  jobs,
  onClose,
  onCreateSuperintendent,
  onSave,
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
          superintendentId: job.superintendentId ?? null,
        }
      : { ...emptyJob, builder: defaultBuilder ?? '' },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const selectedBuilderName = useWatch({ control, name: 'builder' })
  const selectedBuilderCode = builderCodeByName[selectedBuilderName]
  const availableSuperintendents = useMemo(
    () => superintendents.filter(
      (contact) =>
        contact.type === 'JOBSITE_SUPERINTENDENT'
        && (
          !selectedBuilderCode
          || contact.builder === selectedBuilderCode
          || contact.id === job?.superintendentId
        ),
    ),
    [job?.superintendentId, selectedBuilderCode, superintendents],
  )

  return (
    <Dialog
      open
      onClose={onClose}
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
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: 'flex-start' }}
            >
              <PersonPickerField
                name="supervisorId"
                label="Supervisor"
                helperText="Loaded from the saved Crews & Foremen roster."
                control={control}
                error={errors.supervisorId}
                people={supervisors}
              />
              <PersonPickerField
                name="superintendentId"
                label="Jobsite Superintendent"
                helperText="Builder contact responsible for the jobsite."
                control={control}
                error={errors.superintendentId}
                people={availableSuperintendents}
                onCreate={(draft) =>
                  onCreateSuperintendent(draft, selectedBuilderName)
                }
                createTitle="Add new superintendent"
                extraFields={['phone']}
              />
            </Stack>
          </Box>

          <Alert severity="info">
            After creating the Job, open it to configure its Plans and Options sequence sheet.
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation>
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

export default function JobsCatalog() {
  const navigate = useNavigate()
  const { builderId, jobId } = useParams()
  const [searchParams] = useSearchParams()
  const { jobs, setJobs } = useJobs()
  const { builders, setBuilders } = useBuilders()
  const [superintendents, setSuperintendents] = useState(
    () => initialContacts.filter(
      (contact) => contact.type === 'JOBSITE_SUPERINTENDENT',
    ),
  )
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  const supervisors = useMemo(
    () => initialPeople.filter((person) => person.types.includes('SUPERVISOR')),
    [],
  )
  const supervisorsById = useMemo(
    () => new Map(supervisors.map((person) => [person.id, person])),
    [supervisors],
  )
  const superintendentsById = useMemo(
    () => new Map(superintendents.map((person) => [person.id, person])),
    [superintendents],
  )

  const createRequested = searchParams.get('create') === '1'
  const legacyBuilderId = searchParams.get('builder')
  const legacyJobId = searchParams.get('job')
  const dialogJob = editTarget ?? (createRequested ? null : undefined)
  const dialogOpen = createRequested || Boolean(editTarget)
  const selectedBuilder = builders.find(
    (builder) => String(builder.id) === builderId,
  )
  const builderJobs = useMemo(
    () => selectedBuilder
      ? jobs.filter((job) => job.builder === selectedBuilder.name)
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
          personName(supervisorsById, job.supervisorId),
          personName(superintendentsById, job.superintendentId),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [builderJobs, search, superintendentsById, supervisorsById])

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
  useEffect(() => {
    if (builderId || jobId || (!legacyBuilderId && !legacyJobId)) return

    const legacyJob = jobs.find((job) => String(job.id) === legacyJobId)
    const resolvedBuilderId = legacyJob
      ? getJobBuilderId(legacyJob, builders)
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
    builders,
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

  const openDeleteDialog = () => {
    setDeleteTarget(selectedJob)
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

  const handleCreateSuperintendent = (draft, builderName) => {
    const created = {
      ...emptyContact,
      ...draft,
      id: Date.now(),
      type: 'JOBSITE_SUPERINTENDENT',
      builder: builderCodeByName[builderName] ?? '',
    }
    setSuperintendents((current) => [created, ...current])
    return created
  }

  const handleSave = (form) => {
    const savedBuilderId = builders.find(
      (builder) => builder.name === form.builder,
    )?.id ?? editTarget?.builderId ?? selectedBuilder.id

    if (editTarget) {
      setJobs((current) =>
        current.map((job) =>
          job.id === editTarget.id
            ? { ...job, ...form, builderId: savedBuilderId }
            : job,
        ),
      )
      setNotice({ severity: 'success', message: 'Job updated.' })
    } else {
      setJobs((current) => [
        {
          ...form,
          id: Date.now(),
          builderId: savedBuilderId,
          sequenceSheet: {
            name: 'Options Sequence Sheet',
            plans: [],
            phases: [],
          },
        },
        ...current,
      ])
      setPage(0)
      setNotice({ severity: 'success', message: 'Job created.' })
    }

    closeDialog()
  }

  const handleDelete = () => {
    setJobs((current) => current.filter((job) => job.id !== deleteTarget.id))
    setDeleteTarget(null)
    setPage(0)
    setNotice({ severity: 'success', message: 'Job deleted.' })
  }

  const handleBuilderRenamed = (previousName, nextName) => {
    setJobs((current) =>
      current.map((job) =>
        job.builder === previousName ? { ...job, builder: nextName } : job,
      ),
    )
  }

  if (!selectedBuilder) {
    return (
      <BuildersCatalog
        builders={builders}
        setBuilders={setBuilders}
        getBuilderJobCount={(builder) =>
          jobs.filter((job) => job.builder === builder.name).length
        }
        onBuilderRenamed={handleBuilderRenamed}
        onSelectBuilder={openBuilderJobs}
      />
    )
  }

  if (detailJob) {
    return (
      <JobDetails
        job={detailJob}
        builderId={selectedBuilder.id}
        onBack={() => navigate(builderJobsPath(selectedBuilder.id))}
        onChange={(updatedJob) => {
          setJobs((current) =>
            current.map((job) => (job.id === updatedJob.id ? updatedJob : job)),
          )
        }}
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
        <ResponsiveCreateButton
          label="New job"
          onClick={openCreateDialog}
        />
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
                  <TableCell>Supervisor</TableCell>
                  <TableCell>Jobsite Superintendent</TableCell>
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
                          <Typography variant="body2" fontWeight={700} noWrap color="primary.main">
                            {job.code}
                          </Typography>
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
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {personName(supervisorsById, job.supervisorId)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {personName(superintendentsById, job.superintendentId)}
                      </Typography>
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
                        <IconButton
                          size="small"
                          aria-label={`Actions for ${job.code}`}
                          onClick={(event) => handleMenuOpen(event, job)}
                        >
                          <MoreHorizRoundedIcon />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}

                {visibleJobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 8, textAlign: 'center' }}>
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
            rowsPerPageOptions={[5, 10, 25]}
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
        <MenuItem onClick={openDeleteDialog} sx={{ color: 'error.main' }}>
          <DeleteOutlineRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Delete
        </MenuItem>
      </Menu>

      {dialogOpen && (
        <JobDialog
          key={dialogJob?.id ?? 'new'}
          builderOptions={builderOptions}
          defaultBuilder={selectedBuilder.name}
          supervisors={supervisors}
          superintendents={superintendents}
          job={dialogJob}
          jobs={jobs}
          onClose={closeDialog}
          onCreateSuperintendent={handleCreateSuperintendent}
          onSave={handleSave}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete job?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget
              ? `${deleteTarget.code} — ${deleteTarget.community} / ${deleteTarget.builder} will be removed.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete job
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
