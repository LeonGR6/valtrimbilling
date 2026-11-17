import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link,
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
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import BlockRoundedIcon from '@mui/icons-material/BlockRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  CatalogEmptyState,
  CatalogPageHeader,
  CatalogSkeletonRows,
  FigureStrip,
  RowActionsMenu,
  StatusChip,
  StatusTabs,
  catalogTableSx,
  focusRingSx,
  visuallyHiddenSx,
} from '../../../components/common/CatalogPage'
import { usePersistentState, isStoredString } from '../../../hooks/usePersistentState.js'
import { BuildersCatalog } from '../../builders/index.js'
import { useBuilders } from '../../builders/context/useBuilders.js'
import { usePeople } from '../../people/context/usePeople.js'
import { contactTypeLabels, emptyContact } from '../../builder-contacts'
import { emptyPerson } from '../../people/data/people.js'
import { useBuilderContacts } from '../../builder-contacts/context/useBuilderContacts.js'
import JobDetails from './JobDetails.jsx'
import { getJobPlanCount, getJobUnitCount } from '../data/jobs.js'
import { jobContactRoles } from '../data/jobContactRoles.js'
import { useJobs } from '../context/useJobs.js'
import { builderJobsPath, getJobBuilderId, jobPlansOptionsPath } from '../utils/jobRoutes.js'
import { contactTypesToAdd, resolveJobContacts } from '../utils/jobAssignments.js'
import { JobContactsSummary } from './JobContacts.jsx'
import JobDialog from './JobDialog.jsx'

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
  const [statusFilter, setStatusFilter] = useState('all')
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

  const searchedJobs = useMemo(() => {
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
  const statusOptions = useMemo(() => [
    { value: 'all', label: 'All', count: searchedJobs.length },
    { value: 'active', label: 'Active', count: searchedJobs.filter((job) => job.isActive).length },
    { value: 'inactive', label: 'Inactive', count: searchedJobs.filter((job) => !job.isActive).length },
  ], [searchedJobs])
  const filteredJobs = useMemo(
    () => searchedJobs.filter((job) =>
      statusFilter === 'all' || (statusFilter === 'active' ? job.isActive : !job.isActive),
    ),
    [searchedJobs, statusFilter],
  )

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
    setStatusFilter('all')
    setPage(0)
    // Arriving from the sidebar's Create button: carry the intent to the Job form.
    navigate(
      createRequested && builder.isActive
        ? `${builderJobsPath(builder.id)}?create=1`
        : builderJobsPath(builder.id),
    )
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

  const openJobDetails = (job) => {
    navigate(jobPlansOptionsPath(selectedBuilder.id, job.id))
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setPage(0)
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
        banner={createRequested && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            Pick a builder to create the new job for. Jobs always belong to a builder.
          </Alert>
        )}
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
      />
    )
  }

  const columnCount = 5 + Number(canManageJobs)
  const hasFilters = Boolean(search.trim()) || statusFilter !== 'all'

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        breadcrumbs={[
          { label: 'Jobs', to: '/jobs' },
          { label: selectedBuilder.name },
        ]}
        title={selectedBuilder.name}
        titleAdornment={<StatusChip active={selectedBuilder.isActive} />}
        subtitle={`Builder ${selectedBuilder.code} · select a job to manage its Plans & options.`}
        meta={(
          <FigureStrip
            label={`${selectedBuilder.name} summary`}
            figures={[
              { label: builderJobs.length === 1 ? 'job' : 'jobs', value: builderJobs.length },
              { label: totalPlans === 1 ? 'plan' : 'plans', value: totalPlans },
              { label: 'lots from phases', value: totalUnits },
            ]}
          />
        )}
        actions={canManageJobs && selectedBuilder.isActive && (
          <ResponsiveCreateButton
            label="New job"
            onClick={openCreateDialog}
          />
        )}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
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

        {createRequested && !selectedBuilder.isActive && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            {selectedBuilder.name} is inactive, so it cannot receive new jobs. Pick another builder to create one.
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
            direction={{ xs: 'column', lg: 'row' }}
            sx={{
              alignItems: { lg: 'center' },
              justifyContent: 'space-between',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Box sx={{ px: 1, borderBottom: { xs: 1, lg: 0 }, borderColor: 'divider' }}>
              <StatusTabs
                label="Filter jobs by status"
                value={statusFilter}
                onChange={(next) => {
                  setStatusFilter(next)
                  setPage(0)
                }}
                options={statusOptions}
              />
            </Box>
            <Box sx={{ p: 1.25 }}>
              <TextField
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
                size="small"
                placeholder="Search jobs, communities or team members"
                sx={{ width: { xs: '100%', lg: 380 } }}
                slotProps={{
                  htmlInput: { 'aria-label': 'Search jobs, communities or team members' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label="Clear search"
                          onClick={() => {
                            setSearch('')
                            setPage(0)
                          }}
                        >
                          <ClearRoundedIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />
            </Box>
          </Stack>

          <TableContainer>
            <Table
              size="small"
              aria-label={`Jobs for ${selectedBuilder.name}`}
              aria-busy={loading}
              sx={[{ minWidth: 820 }, catalogTableSx]}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Job#</TableCell>
                  <TableCell>Community</TableCell>
                  <TableCell>Contacts</TableCell>
                  <TableCell align="right" width={80}>Plans</TableCell>
                  <TableCell align="right" width={130}>Lots from phases</TableCell>
                  <TableCell align="right" width={canManageJobs ? 120 : 64}>
                    <Box component="span" sx={visuallyHiddenSx}>Actions</Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    hover
                    onClick={() => openJobDetails(job)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Link
                          component="button"
                          type="button"
                          underline="hover"
                          variant="body2"
                          fontWeight={700}
                          aria-label={`Open Job ${job.code}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            openJobDetails(job)
                          }}
                          sx={[{ textAlign: 'left' }, focusRingSx]}
                        >
                          {job.code}
                        </Link>
                        {!job.isActive && (
                          <Chip label="Inactive" size="small" variant="outlined" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {job.community}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 260 }}>
                      <JobContactsSummary
                        contacts={resolveJobContacts(job, people, contacts)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        color={getJobPlanCount(job) ? 'text.primary' : 'text.disabled'}
                      >
                        {getJobPlanCount(job)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        color={getJobUnitCount(job) ? 'text.primary' : 'text.disabled'}
                      >
                        {getJobUnitCount(job)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
                      >
                        <Button
                          size="small"
                          color="inherit"
                          endIcon={<ArrowForwardRoundedIcon />}
                          aria-label={`Open Plans & options for Job ${job.code}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            openJobDetails(job)
                          }}
                          sx={{ color: 'primary.main' }}
                        >
                          Open
                        </Button>
                        {canManageJobs && (
                          <RowActionsMenu
                            label={`Actions for ${job.code}`}
                            items={[
                              {
                                label: 'Edit',
                                icon: <EditOutlinedIcon fontSize="small" />,
                                onClick: () => setEditTarget(job),
                              },
                              {
                                label: 'Deactivate',
                                icon: <BlockRoundedIcon fontSize="small" />,
                                color: 'error.main',
                                disabled: !job.isActive,
                                onClick: () => setDeactivateTarget(job),
                              },
                            ]}
                          />
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}

                {loading && visibleJobs.length === 0 && (
                  <CatalogSkeletonRows columns={columnCount} />
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {!loading && visibleJobs.length === 0 && (
            <CatalogEmptyState
              title={builderJobs.length === 0 ? 'No jobs yet' : 'No jobs found'}
              description={builderJobs.length === 0
                ? `Create the first job for ${selectedBuilder.name}.`
                : 'No job matches your search or status filter.'}
              action={hasFilters && builderJobs.length > 0
                ? (
                  <Button size="small" variant="outlined" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )
                : builderJobs.length === 0 && canManageJobs && selectedBuilder.isActive
                  ? (
                    <Button size="small" variant="outlined" onClick={openCreateDialog}>
                      New job
                    </Button>
                  )
                  : undefined}
            />
          )}

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
            labelRowsPerPage="Rows"
          />
        </Box>
      </Box>

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
