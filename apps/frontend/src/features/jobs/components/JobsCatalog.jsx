import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
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
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded'
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import JobDetails from './JobDetails.jsx'
import {
  emptyJob,
  getJobPlanCount,
  getJobUnitCount,
  jobBuilderOptions,
} from '../data/jobs.js'
import { useJobs } from '../context/useJobs.js'
import { createJobSchema } from '../schemas/jobSchema.js'

function JobDialog({ job, jobs, onClose, onSave }) {
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
          totalLots: job.totalLots ?? 0,
          supervisor: job.supervisor ?? '',
          jobsiteSuperintendent: job.jobsiteSuperintendent ?? '',
        }
      : { ...emptyJob },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
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
                        {jobBuilderOptions.map((builder) => (
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
                <TextField
                  label="Total lots"
                  type="number"
                  {...register('totalLots')}
                  error={Boolean(errors.totalLots)}
                  helperText={errors.totalLots?.message ?? 'Lots or units included in this Job.'}
                  fullWidth
                  slotProps={{ htmlInput: { min: 0, max: 100000, step: 1 } }}
                />
              </Stack>
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Job team
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Supervisor"
                {...register('supervisor')}
                error={Boolean(errors.supervisor)}
                helperText={errors.supervisor?.message ?? 'Valtrim supervisor assigned to this job.'}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <TextField
                label="Jobsite Superintendent"
                {...register('jobsiteSuperintendent')}
                error={Boolean(errors.jobsiteSuperintendent)}
                helperText={errors.jobsiteSuperintendent?.message ?? 'Builder contact responsible for the jobsite.'}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 100 } }}
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
  const [searchParams, setSearchParams] = useSearchParams()
  const { jobs, setJobs } = useJobs()
  const [search, setSearch] = useState('')
  const [builderFilter, setBuilderFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(5)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)

  const createRequested = searchParams.get('create') === '1'
  const dialogJob = editTarget ?? (createRequested ? null : undefined)
  const dialogOpen = createRequested || Boolean(editTarget)

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase()

    return jobs.filter((job) => {
      const matchesSearch =
        !query ||
        [
          job.code,
          job.community,
          job.builder,
          job.supervisor,
          job.jobsiteSuperintendent,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesBuilder =
        builderFilter === 'all' || job.builder === builderFilter

      return matchesSearch && matchesBuilder
    })
  }, [builderFilter, jobs, search])

  const visibleJobs = filteredJobs.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage,
  )
  const totalUnits = jobs.reduce((total, job) => total + getJobUnitCount(job), 0)
  const builderCount = new Set(jobs.map((job) => job.builder)).size
  const detailJob = jobs.find(
    (job) => String(job.id) === searchParams.get('job'),
  )

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
    document.querySelector('main > div')?.scrollTo({ top: 0, left: 0 })
  }, [detailJob?.id])

  const openCreateDialog = () => {
    setEditTarget(null)
    setSearchParams({ create: '1' })
  }

  const closeDialog = () => {
    setEditTarget(null)
    if (createRequested) setSearchParams({}, { replace: true })
  }

  const handleMenuOpen = (event, job) => {
    setMenuAnchor(event.currentTarget)
    setSelectedJob(job)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedJob(null)
  }

  const openEditDialog = () => {
    setSearchParams({}, { replace: true })
    setEditTarget(selectedJob)
    handleMenuClose()
  }

  const openDeleteDialog = () => {
    setDeleteTarget(selectedJob)
    handleMenuClose()
  }

  const openJobDetails = (job) => {
    setSearchParams({ job: String(job.id) })
  }

  const openSelectedJobDetails = () => {
    const job = selectedJob
    handleMenuClose()
    if (job) openJobDetails(job)
  }

  const handleSave = (form) => {
    if (editTarget) {
      setJobs((current) =>
        current.map((job) =>
          job.id === editTarget.id ? { ...job, ...form } : job,
        ),
      )
      setNotice({ severity: 'success', message: 'Job updated.' })
    } else {
      setJobs((current) => [
        {
          ...form,
          id: Date.now(),
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

  if (detailJob) {
    return (
      <JobDetails
        job={detailJob}
        onBack={() => setSearchParams({}, { replace: true })}
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
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Jobs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Select a Job to manage its Plans and Options sequence sheet.
          </Typography>
        </Box>
        <ResponsiveCreateButton
          label="New job"
          onClick={openCreateDialog}
        />
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <SummaryCard icon={<HomeWorkRoundedIcon />} label="Total jobs" value={jobs.length} />
          <SummaryCard icon={<BusinessRoundedIcon />} label="Builders" value={builderCount} />
          <SummaryCard icon={<ApartmentRoundedIcon />} label="Lots / units" value={totalUnits} />
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
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="job-builder-filter-label">Builder</InputLabel>
              <Select
                labelId="job-builder-filter-label"
                label="Builder"
                value={builderFilter}
                onChange={(event) => {
                  setBuilderFilter(event.target.value)
                  setPage(0)
                }}
                startAdornment={
                  <InputAdornment position="start">
                    <FilterListRoundedIcon fontSize="small" color="action" />
                  </InputAdornment>
                }
              >
                <MenuItem value="all">All builders</MenuItem>
                {jobBuilderOptions.map((builder) => (
                  <MenuItem key={builder} value={builder}>
                    {builder}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
                  <TableCell width={150}>Total Lots</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleJobs.map((job) => (
                  <TableRow key={job.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <ButtonBase
                        onClick={() => openJobDetails(job)}
                        aria-label={`Open Job ${job.code}`}
                        sx={{ borderRadius: 1.5, textAlign: 'left' }}
                      >
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
                            <AccountTreeRoundedIcon fontSize="small" />
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
                      </ButtonBase>
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
                        {job.supervisor || 'Unassigned'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {job.jobsiteSuperintendent || 'Unassigned'}
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
                        Try changing your search or builder filter.
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
          <AccountTreeRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          View sequence sheet
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
          job={dialogJob}
          jobs={jobs}
          onClose={closeDialog}
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
