import { useEffect, useMemo, useState } from 'react'
import {
  Link as RouterLink,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  CatalogEmptyState,
  CatalogPageHeader,
  FigureStrip,
  StatusChip,
} from '../../../components/common/CatalogPage'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { isStoredString, usePersistentState } from '../../../hooks/usePersistentState.js'
import { filterJobsByScope, resolveJobScope } from '../../jobs/utils/jobScopeFilters.js'
import { calendarSchedulePath } from '../../calendar/utils/calendarRoutes.js'
import { useProductionActivities } from '../../calendar/context/useProductionActivities.js'
import { usePhaseCalendarCoverage } from '../../calendar/hooks/usePhaseCalendarCoverage.js'
import JobModuleNavigation from '../../jobs/components/JobModuleNavigation.jsx'
import { useJobs } from '../../jobs/context/useJobs.js'
import { useAuth } from '../../auth/context/useAuth.js'
import { SCHEDULING_ROLES, canWork } from '../../auth/authorization/roleAccess.js'
import { getJobAssignedLotCount, getJobPhaseCount, getJobPlanCount } from '../../jobs/data/jobs.js'
import {
  builderJobsPath,
  getJobBuilderId,
  jobBelongsToBuilder,
  jobPlansOptionsPath,
  jobSequenceSheetPath,
} from '../../jobs/utils/jobRoutes.js'
import { formatPhaseBuilding } from '../utils/phaseBuildingCodes.js'
import PhasesTable from './PhasesTable.jsx'
import SequenceSheetEmailDialog from './SequenceSheetEmailDialog.jsx'
import OptionsChangeEmailDialog from '../../purchase-orders/components/OptionsChangeEmailDialog.jsx'
import { describeSequenceSheetEmailsSent } from '../services/sequenceSheetEmailRecord.js'
import { addedOptionChanges, removedOptionChanges } from '../services/sequenceSheetRecord.js'
import PhaseDetails from './PhaseDetails.jsx'
import PhaseDialog from './PhaseDialog.jsx'
import PhaseDeleteDialog from './PhaseDeleteDialog.jsx'
import NoticeSnackbar from './NoticeSnackbar.jsx'

export default function SequenceSheets() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId } = useParams()
  const { profile } = useAuth()
  const {
    jobs,
    loading,
    error,
    refreshJobs,
    saveSequenceSheetPhase,
    deactivateSequenceSheetPhase,
  } = useJobs()
  // Sequence Sheets belong to Scheduling, not to whoever manages the Jobs.
  const canManageSequenceSheets = canWork(profile?.role, SCHEDULING_ROLES)
  const { jobBillingSetupVersions } = useBuilderDrawSchedules()
  const { canManageProductionActivities } = useProductionActivities()
  const calendarCoverage = usePhaseCalendarCoverage()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = usePersistentState('sequence-sheets:search', '', isStoredString)
  const [storedBuilderId, setStoredBuilderId] = usePersistentState('sequence-sheets:builder', 'ALL', isStoredString)
  const [storedCommunity, setStoredCommunity] = usePersistentState('sequence-sheets:community', 'ALL', isStoredString)
  // Every Job starts collapsed; opening one is the user's choice.
  const [expandedJobId, setExpandedJobId] = useState(null)
  const [dialogJobId, setDialogJobId] = useState(null)
  const [dialogPhaseId, setDialogPhaseId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [emailTarget, setEmailTarget] = useState(null)
  // After an edit changed the options of a Lot: the emails that offer to tell Purchasing
  // and the Job Coordinator, one after the other (empty = none).
  const [optionEmails, setOptionEmails] = useState([])
  const optionEmail = optionEmails[0] ?? null
  const [notice, setNotice] = useState(null)

  const legacyJobId = searchParams.get('job')
  const legacyPhaseId = searchParams.get('phase')
  const focusedJobId = jobId ?? legacyJobId
  const focusedJob = jobs.find(
    (job) =>
      String(job.id) === focusedJobId &&
      (!builderId || jobBelongsToBuilder(job, builderId)),
  )
  const focusedBuilderId = builderId ?? getJobBuilderId(focusedJob)
  const scopedJobs = useMemo(
    () => (focusedJob ? [focusedJob] : jobId ? [] : jobs),
    [focusedJob, jobId, jobs],
  )
  const visibleExpandedJobId = focusedJob?.id ?? expandedJobId
  const canManageFocusedJob = canManageSequenceSheets && Boolean(focusedJob?.isActive)

  const scope = useMemo(
    () => resolveJobScope(scopedJobs, {
      builderId: storedBuilderId,
      community: storedCommunity,
    }),
    [scopedJobs, storedBuilderId, storedCommunity],
  )
  // Looking at one Job never applies the remembered filters, or they could hide it.
  const filtersApply = !focusedJob && !jobId
  const filteredJobs = useMemo(
    () => (filtersApply
      ? filterJobsByScope(scopedJobs, {
          search,
          builderId: scope.builderId,
          community: scope.community,
        })
      : scopedJobs),
    [filtersApply, scope.builderId, scope.community, scopedJobs, search],
  )
  const hasActiveFilters = Boolean(search.trim())
    || scope.builderId !== 'ALL'
    || scope.community !== 'ALL'
  const clearFilters = () => {
    setSearch('')
    setStoredBuilderId('ALL')
    setStoredCommunity('ALL')
  }

  // The summary follows the filters, like the Packages cards do.
  const totalPhases = filteredJobs.reduce(
    (total, job) => total + getJobPhaseCount(job),
    0,
  )
  const totalAssignedLots = filteredJobs.reduce(
    (total, job) => total + getJobAssignedLotCount(job),
    0,
  )
  const dialogJob = jobs.find((job) => job.id === dialogJobId)
  const dialogPhase = dialogJob?.sequenceSheet?.phases?.find(
    (phase) => phase.id === dialogPhaseId,
  )
  const dialogSetup = jobBillingSetupVersions.find(
    (version) => String(version.id) === String(dialogJob?.billingSetupVersionId),
  )
  const detailPhaseId = phaseId ?? legacyPhaseId
  const detailPhase = focusedJob?.sequenceSheet?.phases?.find(
    (phase) => String(phase.id) === detailPhaseId,
  )
  useEffect(() => {
    if (jobId || !legacyJobId) return

    const legacyJob = jobs.find((job) => String(job.id) === legacyJobId)
    const legacyBuilderId = getJobBuilderId(legacyJob)
    if (!legacyJob || legacyBuilderId == null) return

    navigate(
      jobSequenceSheetPath(legacyBuilderId, legacyJob.id, legacyPhaseId),
      { replace: true },
    )
  }, [jobId, jobs, legacyJobId, legacyPhaseId, navigate])

  const openCreate = (event, job) => {
    event.stopPropagation()
    if (!canManageSequenceSheets || !job.isActive) return
    setExpandedJobId(job.id)
    setDialogJobId(job.id)
    setDialogPhaseId(null)
  }

  const openEdit = (job, phase) => {
    if (!canManageSequenceSheets || !job.isActive) return
    setExpandedJobId(job.id)
    setDialogJobId(job.id)
    setDialogPhaseId(phase.id)
  }

  const closePhaseDialog = () => {
    setDialogJobId(null)
    setDialogPhaseId(null)
  }

  const openPhaseDetails = (job, phase) => {
    const phaseBuilderId = getJobBuilderId(job)
    if (phaseBuilderId == null) return

    navigate(jobSequenceSheetPath(phaseBuilderId, job.id, phase.id))
  }

  const openEmail = (job, phase) => {
    if (!canManageSequenceSheets || !job.isActive) return
    setEmailTarget({ job, phase })
  }

  const savePhase = async (form) => {
    const isEditing = Boolean(dialogPhase)
    const savedJob = dialogJob

    try {
      const savedPhase = await saveSequenceSheetPhase(
        dialogJobId,
        dialogPhase?.id ?? null,
        form,
      )
      closePhaseDialog()
      const rowCounts = form.lots.reduce((counts, row) => {
        if (row.isUtilityBuilding) counts.utility += 1
        else counts.lots += 1
        return counts
      }, { lots: 0, utility: 0 })
      setNotice({
        severity: 'success',
        message: `${formatPhaseBuilding(form.phaseName, form.building)} ${isEditing ? 'updated' : 'created'} with ${rowCounts.lots} lot${rowCounts.lots === 1 ? '' : 's'}${rowCounts.utility > 0 ? ` and ${rowCounts.utility} Utility ${rowCounts.utility === 1 ? 'row' : 'rows'}` : ''}. Total Lots updated.`,
      })
      if (!isEditing && savedJob) {
        setEmailTarget({ job: savedJob, phase: savedPhase })
      }
      // The people who order and coordinate the options should know when one is put in
      // or taken out of a Lot.
      if (isEditing && savedJob) {
        const added = addedOptionChanges(dialogPhase, savedPhase)
        const removed = removedOptionChanges(dialogPhase, form)
        setOptionEmails([
          ...(added.length > 0 ? [{ kind: 'added_manually', job: savedJob, changes: added }] : []),
          ...(removed.length > 0 ? [{ kind: 'removed', job: savedJob, changes: removed }] : []),
        ])
      }
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    }
  }

  const deletePhase = async () => {
    if (!deleteTarget) return

    setDeleting(true)
    try {
      await deactivateSequenceSheetPhase(
        deleteTarget.jobId,
        deleteTarget.phase.id,
      )
      if (
        String(deleteTarget.jobId) === String(focusedJob?.id) &&
        String(deleteTarget.phase.id) === detailPhaseId &&
        focusedBuilderId != null
      ) {
        navigate(
          jobSequenceSheetPath(focusedBuilderId, deleteTarget.jobId),
          { replace: true },
        )
      }
      setNotice({
        severity: 'success',
        message: `${formatPhaseBuilding(deleteTarget.phase.name, deleteTarget.phase.building)} deleted. Total Lots updated.`,
      })
      setDeleteTarget(null)
    } catch (deleteError) {
      setNotice({ severity: 'error', message: deleteError.message })
    } finally {
      setDeleting(false)
    }
  }

  if (focusedJob && detailPhase) {
    return (
      <>
        <PhaseDetails
          builderId={focusedBuilderId}
          calendarStatus={calendarCoverage.ready
            ? calendarCoverage.statusOf(focusedJob, detailPhase)
            : null}
          canSchedule={canManageProductionActivities}
          onSchedule={() => navigate(calendarSchedulePath(focusedJob.id, detailPhase.id))}
          canManage={canManageFocusedJob}
          job={focusedJob}
          phase={detailPhase}
          onEdit={() => openEdit(focusedJob, detailPhase)}
          onDelete={() => setDeleteTarget({ jobId: focusedJob.id, phase: detailPhase })}
          onEmail={() => openEmail(focusedJob, detailPhase)}
        />
        {dialogJob && (
          <PhaseDialog
            key={dialogPhase?.id ?? `new-phase-${dialogJob.id}`}
            job={dialogJob}
            phase={dialogPhase}
            utilityBuildingEnabled={Boolean(
              dialogSetup?.utilityBuilding
              || dialogPhase?.lots?.some((row) => row.isUtilityBuilding)
            )}
            utilityBuildingRequired={Boolean(dialogSetup?.utilityBuilding)}
            onClose={closePhaseDialog}
            onSave={savePhase}
          />
        )}
        <PhaseDeleteDialog
          busy={deleting}
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={deletePhase}
        />
        {emailTarget && (
          <SequenceSheetEmailDialog
            key={`${emailTarget.phase.id}-email`}
            phase={emailTarget.phase}
            onClose={() => setEmailTarget(null)}
            onSent={(results) => {
              setEmailTarget(null)
              setNotice({
                severity: 'success',
                message: describeSequenceSheetEmailsSent(results),
              })
            }}
          />
        )}
        {optionEmail && (
          <OptionsChangeEmailDialog
            key={optionEmail.kind}
            kind={optionEmail.kind}
            job={optionEmail.job}
            changes={optionEmail.changes}
            onClose={() => setOptionEmails((current) => current.slice(1))}
            onSent={(message) => {
              setOptionEmails((current) => current.slice(1))
              setNotice({ severity: 'success', message })
            }}
          />
        )}
        <NoticeSnackbar notice={notice} onClose={() => setNotice(null)} />
      </>
    )
  }

  const jobPhasesContent = (job) => {
    const phases = job.sequenceSheet?.phases ?? []
    const canManageJob = canManageSequenceSheets && job.isActive

    if (phases.length === 0) {
      return (
        <CatalogEmptyState
          icon={<TableChartRoundedIcon color="disabled" sx={{ fontSize: 36 }} aria-hidden="true" />}
          title="No phases yet"
          description="Create the first phase and assign its lots to this Job's plans."
          action={canManageJob && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddRoundedIcon />}
              onClick={(event) => openCreate(event, job)}
            >
              Create phase
            </Button>
          )}
        />
      )
    }

    return (
      <PhasesTable
        job={job}
        phases={phases}
        canManage={canManageJob}
        calendarCoverage={calendarCoverage}
        onOpen={(phase) => openPhaseDetails(job, phase)}
        onEmail={(phase) => openEmail(job, phase)}
        onEdit={(phase) => openEdit(job, phase)}
        onDelete={(phase) => setDeleteTarget({ jobId: job.id, phase })}
      />
    )
  }

  const breadcrumbs = focusedJob
    ? [
        { label: 'Jobs', to: '/jobs' },
        { label: focusedJob.builder, to: builderJobsPath(focusedBuilderId) },
        { label: `Job ${focusedJob.code}`, to: jobPlansOptionsPath(focusedBuilderId, focusedJob.id) },
        { label: 'Sequence sheet' },
      ]
    : jobId
      ? [{ label: 'Jobs', to: '/jobs' }, { label: 'Sequence sheet' }]
      : [{ label: 'Sequence sheets' }]
  const focusedPhaseCount = focusedJob ? getJobPhaseCount(focusedJob) : 0

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        borderless={Boolean(focusedJob)}
        breadcrumbs={breadcrumbs}
        title={focusedJob ? `Job ${focusedJob.code}` : 'Sequence sheets'}
        titleAdornment={focusedJob && <StatusChip active={focusedJob.isActive} />}
        subtitle={focusedJob
          ? `${focusedJob.community} · ${focusedJob.builder}`
          : 'Phases and lot assignments for every job. Expand a job to review its phases.'}
        meta={(
          <FigureStrip
            label="Sequence sheet summary"
            figures={focusedJob
              ? [
                  { label: focusedPhaseCount === 1 ? 'phase' : 'phases', value: totalPhases },
                  { label: 'assigned lots', value: totalAssignedLots },
                  {
                    label: getJobPlanCount(focusedJob) === 1 ? 'plan' : 'plans',
                    value: getJobPlanCount(focusedJob),
                  },
                ]
              : [
                  { label: filteredJobs.length === 1 ? 'job' : 'jobs', value: filteredJobs.length },
                  { label: totalPhases === 1 ? 'phase' : 'phases', value: totalPhases },
                  { label: 'assigned lots', value: totalAssignedLots },
                ]}
          />
        )}
        actions={canManageFocusedJob && (
          <ResponsiveCreateButton
            label="Create phase"
            mobileLabel="Create"
            onClick={(event) => openCreate(event, focusedJob)}
          />
        )}
      />

      {focusedJob && (
        <JobModuleNavigation
          active="sequence-sheet"
          builderId={focusedBuilderId}
          jobId={focusedJob.id}
          showBack={false}
        />
      )}

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={(
              <Button
                color="inherit"
                size="small"
                startIcon={<RefreshRoundedIcon />}
                onClick={() => refreshJobs().catch(() => {})}
              >
                Retry
              </Button>
            )}
          >
            {error}
          </Alert>
        )}

        {focusedJob && !focusedJob.isActive && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            This Job is inactive. Its phases are read-only.
          </Alert>
        )}

        {loading && jobs.length === 0 && (
          <Box
            role="status"
            aria-label="Loading sequence sheets"
            sx={{
              mb: 2,
              p: 2.5,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            <Skeleton variant="text" width="30%" />
            <Skeleton variant="text" width="55%" />
            <Skeleton variant="text" width="45%" />
          </Box>
        )}

        {filtersApply && (
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.25}
            sx={{
              mb: 2,
              p: 1.25,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              alignItems: { md: 'center' },
            }}
          >
            <TextField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              size="small"
              placeholder="Search by Job#, builder or community"
              sx={{ flex: 2, minWidth: { md: 260 } }}
              slotProps={{
                htmlInput: { 'aria-label': 'Search Sequence Sheets' },
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
                        onClick={() => setSearch('')}
                      >
                        <ClearRoundedIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
            <TextField
              select
              size="small"
              label="Builder"
              value={scope.builderId}
              onChange={(event) => {
                setStoredBuilderId(event.target.value)
                setStoredCommunity('ALL')
              }}
              sx={{ flex: 1, minWidth: { md: 180 } }}
            >
              <MenuItem value="ALL">All builders</MenuItem>
              {scope.builderOptions.map(({ id, name }) => (
                <MenuItem key={id} value={id}>{name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Community"
              value={scope.community}
              onChange={(event) => setStoredCommunity(event.target.value)}
              sx={{ flex: 1, minWidth: { md: 180 } }}
            >
              <MenuItem value="ALL">All communities</MenuItem>
              {scope.communityOptions.map((community) => (
                <MenuItem key={community} value={community}>{community}</MenuItem>
              ))}
            </TextField>
            <Button
              color="inherit"
              size="small"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              sx={{ flexShrink: 0 }}
            >
              Clear filters
            </Button>
            <Typography
              variant="body2"
              color="text.secondary"
              role="status"
              sx={{ flexShrink: 0, px: { md: 1 } }}
            >
              {filteredJobs.length} of {scopedJobs.length} {scopedJobs.length === 1 ? 'job' : 'jobs'}
            </Typography>
          </Stack>
        )}

        {focusedJob && (
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
              direction="row"
              spacing={1.25}
              sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}
            >
              <Typography component="h2" variant="subtitle1" fontWeight={700}>
                Phases
              </Typography>
              <Chip size="small" variant="outlined" label={focusedPhaseCount} />
              {calendarCoverage.ready
                && (calendarCoverage.unscheduledCountByJob.get(String(focusedJob.id)) ?? 0) > 0 && (
                <Chip
                  size="small"
                  color="warning"
                  icon={<EventBusyRoundedIcon />}
                  label={`${calendarCoverage.unscheduledCountByJob.get(String(focusedJob.id))} without Calendar`}
                />
              )}
            </Stack>
            {jobPhasesContent(focusedJob)}
          </Box>
        )}

        {!focusedJob && (
          <Stack spacing={1.25}>
            {filteredJobs.map((job) => {
              const phases = job.sequenceSheet?.phases ?? []
              const isExpanded = visibleExpandedJobId === job.id
              const jobBuilderId = getJobBuilderId(job)
              const unscheduledCount = calendarCoverage.ready
                ? calendarCoverage.unscheduledCountByJob.get(String(job.id)) ?? 0
                : 0

              return (
                <Accordion
                  key={job.id}
                  expanded={isExpanded}
                  onChange={(_, expanded) => setExpandedJobId(expanded ? job.id : null)}
                  disableGutters
                  elevation={0}
                  slotProps={{ transition: { unmountOnExit: true } }}
                  sx={{
                    border: 1,
                    borderColor: isExpanded ? 'primary.main' : 'divider',
                    borderRadius: '8px !important',
                    overflow: 'hidden',
                    bgcolor: 'background.paper',
                    '&::before': { display: 'none' },
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    sx={{ alignItems: { md: 'center' } }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreRoundedIcon />}
                      aria-controls={`job-${job.id}-phases`}
                      id={`job-${job.id}-header`}
                      sx={{
                        minHeight: 60,
                        flex: 1,
                        minWidth: 0,
                        '& .MuiAccordionSummary-content': { my: 1, minWidth: 0 },
                      }}
                    >
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={{ xs: 0.5, sm: 2 }}
                        sx={{
                          width: '100%',
                          pr: 1,
                          minWidth: 0,
                          alignItems: { xs: 'flex-start', sm: 'center' },
                          justifyContent: 'space-between',
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={800}>Job #{job.code}</Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {job.community} · {job.builder}
                          </Typography>
                        </Box>
                        <Stack
                          direction="row"
                          spacing={1.5}
                          useFlexGap
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {getJobPlanCount(job)} {getJobPlanCount(job) === 1 ? 'plan' : 'plans'}
                            {' · '}
                            {phases.length} {phases.length === 1 ? 'phase' : 'phases'}
                          </Typography>
                          {unscheduledCount > 0 && (
                            <Chip
                              size="small"
                              color="warning"
                              icon={<EventBusyRoundedIcon />}
                              label={`${unscheduledCount} without Calendar`}
                            />
                          )}
                        </Stack>
                      </Stack>
                    </AccordionSummary>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ px: { xs: 2, md: 2 }, pb: { xs: 1.5, md: 0 }, alignItems: 'center' }}
                    >
                      {jobBuilderId != null && (
                        <Button
                          component={RouterLink}
                          to={jobSequenceSheetPath(jobBuilderId, job.id)}
                          size="small"
                          color="inherit"
                          endIcon={<ArrowForwardRoundedIcon />}
                          aria-label={`Open Job ${job.code}`}
                          sx={{ color: 'primary.main' }}
                        >
                          Open job
                        </Button>
                      )}
                      {canManageSequenceSheets && job.isActive && (
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<AddRoundedIcon />}
                          onClick={(event) => openCreate(event, job)}
                          disableElevation
                        >
                          Create phase
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                  <AccordionDetails
                    id={`job-${job.id}-phases`}
                    sx={{ p: 0, borderTop: 1, borderColor: 'divider' }}
                  >
                    {jobPhasesContent(job)}
                  </AccordionDetails>
                </Accordion>
              )
            })}
          </Stack>
        )}

        {!loading && filteredJobs.length === 0 && (
          <Box
            sx={{
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            <CatalogEmptyState
              title={jobId ? 'The selected Job is unavailable' : 'No jobs match these filters'}
              description={jobId
                ? 'Return to Jobs and choose a Job that belongs to this builder.'
                : 'Try another Job number, builder or community, or clear the filters.'}
              action={jobId
                ? (
                  <Button component={RouterLink} to="/jobs" size="small" variant="outlined">
                    Go to Jobs
                  </Button>
                )
                : hasActiveFilters
                  ? (
                    <Button size="small" variant="outlined" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )
                  : undefined}
            />
          </Box>
        )}
      </Box>

      {dialogJob && (
        <PhaseDialog
          key={dialogPhase?.id ?? `new-phase-${dialogJob.id}`}
          job={dialogJob}
          phase={dialogPhase}
          utilityBuildingEnabled={Boolean(
            dialogSetup?.utilityBuilding
            || dialogPhase?.lots?.some((row) => row.isUtilityBuilding)
          )}
          utilityBuildingRequired={Boolean(dialogSetup?.utilityBuilding)}
          onClose={closePhaseDialog}
          onSave={savePhase}
        />
      )}

      <PhaseDeleteDialog
        busy={deleting}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDelete={deletePhase}
      />
      {emailTarget && (
        <SequenceSheetEmailDialog
          key={`${emailTarget.phase.id}-email`}
          phase={emailTarget.phase}
          onClose={() => setEmailTarget(null)}
          onSent={(results) => {
            setEmailTarget(null)
            setNotice({
              severity: 'success',
              message: describeSequenceSheetEmailsSent(results),
            })
          }}
        />
      )}
      {optionEmail && (
        <OptionsChangeEmailDialog
          key={optionEmail.kind}
          kind={optionEmail.kind}
          job={optionEmail.job}
          changes={optionEmail.changes}
          onClose={() => setOptionEmails((current) => current.slice(1))}
          onSent={(message) => {
            setOptionEmails((current) => current.slice(1))
            setNotice({ severity: 'success', message })
          }}
        />
      )}
      <NoticeSnackbar notice={notice} onClose={() => setNotice(null)} />
    </Box>
  )
}
