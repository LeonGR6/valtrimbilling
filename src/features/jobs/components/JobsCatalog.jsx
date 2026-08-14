import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import {
  emptyJob,
  formatJobHierarchy,
  formatLotRange,
  getJobUnitCount,
  initialJobs,
  jobBuilderOptions,
} from '../data/jobs.js'
import { createJobSchema } from '../schemas/jobSchema.js'

function OptionalLabel({ children }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.75 }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {children}
      </Typography>
      <Chip
        label="Optional"
        size="small"
        variant="outlined"
        sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
      />
    </Stack>
  )
}

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
          builder: job.builder,
          community: job.community,
          phase: job.phase,
          building: job.building,
          lotFrom: job.lotFrom,
          lotTo: job.lotTo,
        }
      : { ...emptyJob },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const values = useWatch({ control })
  const hierarchyPreview = formatJobHierarchy(values)

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
          Define where the work belongs in the builder and project hierarchy.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Project
            </Typography>
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
                label="Community / Project"
                {...register('community')}
                error={Boolean(errors.community)}
                helperText={errors.community?.message ?? 'Example: Andara'}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Location
            </Typography>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Phase"
                  {...register('phase')}
                  error={Boolean(errors.phase)}
                  helperText={errors.phase?.message ?? 'Example: 1'}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 30 } }}
                />
                <Box sx={{ width: '100%' }}>
                  <OptionalLabel>Building</OptionalLabel>
                  <TextField
                    aria-label="Building"
                    placeholder="Example: 3"
                    {...register('building')}
                    error={Boolean(errors.building)}
                    helperText={errors.building?.message ?? 'Use only when the project has buildings.'}
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: 30 } }}
                  />
                </Box>
              </Stack>

              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
                  Lot / Unit range
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="From"
                    type="number"
                    {...register('lotFrom')}
                    error={Boolean(errors.lotFrom)}
                    helperText={errors.lotFrom?.message ?? 'First lot or unit.'}
                    fullWidth
                    slotProps={{ htmlInput: { min: 1, inputMode: 'numeric' } }}
                  />
                  <TextField
                    label="To (optional)"
                    type="number"
                    {...register('lotTo')}
                    error={Boolean(errors.lotTo)}
                    helperText={errors.lotTo?.message ?? 'Leave blank for a single lot.'}
                    fullWidth
                    slotProps={{ htmlInput: { min: 1, inputMode: 'numeric' } }}
                  />
                </Stack>
              </Box>
            </Stack>
          </Box>

          <Alert
            severity="info"
            icon={<AccountTreeRoundedIcon fontSize="inherit" />}
            sx={{ alignItems: 'center' }}
          >
            <Typography variant="caption" color="text.secondary" component="div">
              HIERARCHY PREVIEW
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {hierarchyPreview || 'Complete the fields to preview this job.'}
            </Typography>
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

function getNextJobCode(jobs) {
  const greatestNumber = jobs.reduce((greatest, job) => {
    const number = Number(job.code.match(/\d+$/)?.[0] ?? 0)
    return Math.max(greatest, number)
  }, 1000)

  return `JOB-${greatestNumber + 1}`
}

export default function JobsCatalog() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [jobs, setJobs] = useState(initialJobs)
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
        [job.code, formatJobHierarchy(job)]
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
          code: getNextJobCode(current),
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
            Manage project locations and the lots or units included in each job.
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
              placeholder="Search jobs, communities or lots..."
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
            <Table sx={{ minWidth: 940 }}>
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
                  <TableCell>Job</TableCell>
                  <TableCell>Builder / Community</TableCell>
                  <TableCell>Phase</TableCell>
                  <TableCell>Building</TableCell>
                  <TableCell>Lot / Unit</TableCell>
                  <TableCell>Units</TableCell>
                  <TableCell align="right" width={72}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleJobs.map((job) => (
                  <TableRow key={job.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
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
                          <AccountTreeRoundedIcon fontSize="small" />
                        </Box>
                        <Typography variant="body2" fontWeight={700} noWrap>
                          {job.code}
                        </Typography>
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
                      <Chip label={`Phase ${job.phase}`} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color={job.building ? 'text.primary' : 'text.secondary'}>
                        {job.building || 'Not applicable'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {formatLotRange(job)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {getJobUnitCount(job)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${job.code}`}
                        onClick={(event) => handleMenuOpen(event, job)}
                      >
                        <MoreHorizRoundedIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {visibleJobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 8, textAlign: 'center' }}>
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
              ? `${deleteTarget.code} — ${formatJobHierarchy(deleteTarget)} will be removed.`
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
