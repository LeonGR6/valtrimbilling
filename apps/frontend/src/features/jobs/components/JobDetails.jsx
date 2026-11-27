import { useMemo, useState } from 'react'
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
  IconButton,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import {
  CatalogEmptyState,
  CatalogPageHeader,
  FigureStrip,
  StatusChip,
} from '../../../components/common/CatalogPage'
import {
  getJobOptionCount,
  getJobPlanCount,
  getJobUnitCount,
  getOptionLotDependencies,
  getPlanLotDependencies,
} from '../data/jobs.js'
import { useJobs } from '../context/useJobs.js'
import { builderJobsPath } from '../utils/jobRoutes.js'
import JobModuleNavigation from './JobModuleNavigation.jsx'
import { CopyOptionsDialog } from './CopyPlanOptions.jsx'
import { plansToCopyFrom } from '../services/planOptionCopy.js'
import { JobContactsGrid } from './JobContacts.jsx'
import JobBillingSetupCard from './JobBillingSetupCard.jsx'
import JobPurchaseOrders from './JobPurchaseOrders.jsx'
import OptionsBillingNotice from './OptionsBillingNotice.jsx'
import PlanOptionNotes from './PlanOptionNotes.jsx'
import { filterPlansByQuery } from '../utils/planSearch.js'
import BulkPlanOptionsMode from './bulk-edit/BulkPlanOptionsMode.jsx'
import { describeBulkResult } from '../utils/bulkPlanOptions.js'
import { getJobPlanUsage } from '../utils/planUsage.js'
import PlansOptionsSheet from './PlansOptionsSheet.jsx'
import PlanDialog from './PlanDialog.jsx'
import OptionDialog from './OptionDialog.jsx'

export default function JobDetails({
  builderId,
  job,
  contacts,
}) {
  const {
    canManageJobs,
    createJobPlan,
    applyPlanOptionChanges,
    updateJobPlan,
    deactivateJobPlan,
    reorderJobPlans,
    createPlanOption,
    createPlanOptions,
    updatePlanOption,
    deactivatePlanOption,
  } = useJobs()
  const [planDialog, setPlanDialog] = useState(null)
  // The bulk mode: Plans and Options edited, deleted and added in a grid, and saved together.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [optionDialog, setOptionDialog] = useState(null)
  const [copyDialog, setCopyDialog] = useState(null)
  // Plans the person has opened; every Plan starts closed.
  const [openPlanIds, setOpenPlanIds] = useState(() => new Set())
  const revealPlan = (planId) => {
    setOpenPlanIds((current) => new Set(current).add(planId))
  }
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  const [query, setQuery] = useState('')
  const canManagePlans = canManageJobs && job.isActive
  const jobPlans = job.sequenceSheet?.plans
  const plans = useMemo(() => jobPlans ?? [], [jobPlans])
  // Which Plans and Options the Lots use: those cannot be deleted in the bulk mode.
  const bulkUsage = useMemo(() => getJobPlanUsage(job), [job])
  // While searching, a plan shows when it matches or when some of its options
  // do; then only the matching options are listed under it.
  const visiblePlans = useMemo(() => filterPlansByQuery(plans, query), [plans, query])
  const deleteDependencies = deleteTarget
    ? deleteTarget.type === 'plan'
      ? getPlanLotDependencies(job, deleteTarget.plan.id)
      : getOptionLotDependencies(job, deleteTarget.option.id)
    : []
  const dependencyPhaseCount = new Set(
    deleteDependencies.map((dependency) => dependency.phaseId),
  ).size
  const deletionBlocked = deleteDependencies.length > 0

  const handlePlanSave = async (form, copiedOptions = []) => {
    setSubmitting(true)
    try {
      if (planDialog?.plan) {
        await updateJobPlan(job.id, planDialog.plan.id, form)
        setNotice({ severity: 'success', message: 'Plan updated.' })
      } else {
        const created = await createJobPlan(job.id, form)
        if (copiedOptions.length === 0) {
          setNotice({ severity: 'success', message: 'Plan added.' })
        } else {
          // The Plan exists by now: a failure here must not look like the Plan was not saved.
          try {
            await createPlanOptions(job.id, created.id, copiedOptions)
            revealPlan(created.id)
            setNotice({
              severity: 'success',
              message: `Plan added with ${copiedOptions.length} ${copiedOptions.length === 1 ? 'option' : 'options'}.`,
            })
          } catch (copyError) {
            setNotice({
              severity: 'warning',
              message: `Plan added, but its options could not be copied: ${copyError.message}`,
            })
          }
        }
      }
      setPlanDialog(null)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkSave = async (changes, summary) => {
    try {
      const result = await applyPlanOptionChanges(job.id, changes)
      // A few Plans open to show what was added; a long list stays closed.
      const touched = [...new Set([...result.plans.map(({ id }) => id), ...result.optionPlanIds])]
      if (touched.length <= 3) touched.forEach(revealPlan)
      setNotice({
        severity: 'success',
        // The Options already there that the grid left out count with the ones the database skipped.
        message: describeBulkResult({ ...result, optionsSkipped: result.optionsSkipped + summary.optionsSkipped }),
      })
      setBulkOpen(false)
    } catch (bulkError) {
      setNotice({ severity: 'error', message: bulkError.message })
      throw bulkError
    }
  }

  const handleCopyOptions = async (options) => {
    setSubmitting(true)
    try {
      await createPlanOptions(job.id, copyDialog.plan.id, options)
      revealPlan(copyDialog.plan.id)
      setNotice({
        severity: 'success',
        message: `${options.length} ${options.length === 1 ? 'option' : 'options'} copied into Plan ${copyDialog.plan.code}.`,
      })
      setCopyDialog(null)
    } catch (copyError) {
      setNotice({ severity: 'error', message: copyError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleReorder = async (planIds) => {
    try {
      await reorderJobPlans(job.id, planIds)
    } catch (reorderError) {
      setNotice({ severity: 'error', message: reorderError.message })
    }
  }

  const handleOptionSave = async (form) => {
    const { plan, option } = optionDialog
    setSubmitting(true)
    try {
      if (option) {
        await updatePlanOption(job.id, plan.id, option.id, form)
      } else {
        await createPlanOption(job.id, plan.id, form)
      }
      revealPlan(plan.id)
      setNotice({
        severity: 'success',
        message: option ? 'Option updated.' : 'Option added.',
      })
      setOptionDialog(null)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deletionBlocked) {
      setNotice({
        severity: 'error',
        message: 'Reassign or remove the dependent lots before deleting this item.',
      })
      return
    }

    setSubmitting(true)
    try {
      if (deleteTarget.type === 'plan') {
        await deactivateJobPlan(job.id, deleteTarget.plan.id)
        setNotice({ severity: 'success', message: 'Plan deleted.' })
      } else {
        await deactivatePlanOption(
          job.id,
          deleteTarget.plan.id,
          deleteTarget.option.id,
        )
        setNotice({ severity: 'success', message: 'Option deleted.' })
      }
      setDeleteTarget(null)
    } catch (deleteError) {
      setNotice({ severity: 'error', message: deleteError.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        borderless
        breadcrumbs={[
          { label: 'Jobs', to: '/jobs' },
          { label: job.builder, to: builderJobsPath(builderId) },
          { label: `Job ${job.code}` },
        ]}
        title={`Job ${job.code}`}
        titleAdornment={<StatusChip active={job.isActive} />}
        subtitle={`${job.community} · ${job.builder}`}
        meta={(
          <FigureStrip
            label={`Job ${job.code} summary`}
            figures={[
              { label: 'lots', value: getJobUnitCount(job) },
              { label: getJobPlanCount(job) === 1 ? 'plan' : 'plans', value: getJobPlanCount(job) },
              { label: getJobOptionCount(job) === 1 ? 'option' : 'options', value: getJobOptionCount(job) },
            ]}
          />
        )}
        actions={canManagePlans && (
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<PlaylistAddRoundedIcon />}
              onClick={() => setBulkOpen(true)}
              disabled={bulkOpen}
            >
              Bulk edit
            </Button>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => setPlanDialog({ plan: null })}
              disabled={bulkOpen}
              disableElevation
            >
              New plan
            </Button>
          </Stack>
        )}
      />

      <JobModuleNavigation
        active="plans-options"
        builderId={builderId}
        jobId={job.id}
        showBack={false}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {!canManagePlans && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            {job.isActive
              ? 'You can review Plans and Options, but your role cannot change them.'
              : 'This Job is inactive. Its Plans, Options and prices are read-only.'}
          </Alert>
        )}

        <Card variant="outlined" sx={{ mb: 2.5 }}>
          <CardContent sx={{ p: '16px 20px !important' }}>
            <Typography component="h2" variant="subtitle1" fontWeight={700} sx={{ mb: 1.25 }}>
              Job team
            </Typography>
            <JobContactsGrid contacts={contacts} />
          </CardContent>
        </Card>

        <JobBillingSetupCard job={job} />
        <JobPurchaseOrders job={job} />
        <OptionsBillingNotice job={job} optionCount={getJobOptionCount(job)} sx={{ mb: 2.5 }} />
        <PlanOptionNotes job={job} canAdd={canManageJobs} />

        {bulkOpen && canManagePlans ? (
          <BulkPlanOptionsMode
            plans={plans}
            usage={bulkUsage}
            onSave={handleBulkSave}
            onClose={() => setBulkOpen(false)}
          />
        ) : (
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
              sx={{
                px: 2.5,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                alignItems: { md: 'center' },
                justifyContent: 'space-between',
              }}
            >
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                <Typography component="h2" variant="subtitle1" fontWeight={700}>
                  Plans &amp; options
                </Typography>
                <Chip
                  label={`${plans.length} ${plans.length === 1 ? 'plan' : 'plans'}`}
                  size="small"
                  variant="outlined"
                />
              </Stack>
              {plans.length > 0 && (
                <TextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  size="small"
                  placeholder="Search plans or options"
                  sx={{ width: { xs: '100%', md: 320 } }}
                  slotProps={{
                    htmlInput: { 'aria-label': 'Search plans or options' },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchRoundedIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                      endAdornment: query ? (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            edge="end"
                            aria-label="Clear search"
                            onClick={() => setQuery('')}
                          >
                            <ClearRoundedIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    },
                  }}
                />
              )}
            </Stack>

            {plans.length === 0 ? (
              <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
                <LayersRoundedIcon color="disabled" sx={{ fontSize: 36, mb: 1 }} aria-hidden="true" />
                <Typography fontWeight={700}>No plans in this job yet</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                  Add the first plan, then organize its options underneath it.
                </Typography>
                {canManagePlans && (
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
                    <Button
                      variant="outlined"
                      startIcon={<AddRoundedIcon />}
                      onClick={() => setPlanDialog({ plan: null })}
                    >
                      Add plan
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<PlaylistAddRoundedIcon />}
                      onClick={() => setBulkOpen(true)}
                    >
                      Bulk edit
                    </Button>
                  </Stack>
                )}
              </Box>
            ) : visiblePlans.length === 0 ? (
              <CatalogEmptyState
                title="No plans or options found"
                description={`Nothing in Job ${job.code} matches “${query.trim()}”.`}
                action={(
                  <Button size="small" variant="outlined" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                )}
              />
            ) : (
              <PlansOptionsSheet
                plans={visiblePlans}
                canManage={canManagePlans}
                // A filtered list hides Plans, so the order only changes without a search.
                reorderable={canManagePlans && !query.trim() && plans.length > 1}
                onReorder={handleReorder}
                openPlanIds={openPlanIds}
                onOpenPlanIdsChange={setOpenPlanIds}
                searching={Boolean(query.trim())}
                onAddPlan={() => setPlanDialog({ plan: null })}
                onAddOption={(plan) => setOptionDialog({ plan, option: null })}
                copySourcePlans={plans}
                onCopyOptions={(plan) => setCopyDialog({ plan })}
                onEditPlan={(plan) => setPlanDialog({ plan })}
                onDeletePlan={(plan) => setDeleteTarget({ type: 'plan', plan })}
                onEditOption={(plan, option) => setOptionDialog({ plan, option })}
                onDeleteOption={(plan, option) =>
                  setDeleteTarget({ type: 'option', plan, option })
                }
              />
            )}
          </Box>
        )}
      </Box>

      {planDialog && (
        <PlanDialog
          key={planDialog.plan?.id ?? 'new-plan'}
          plans={plans}
          plan={planDialog.plan}
          onClose={() => setPlanDialog(null)}
          onSave={handlePlanSave}
          submitting={submitting}
        />
      )}

      {copyDialog && (
        <CopyOptionsDialog
          key={`copy-${copyDialog.plan.id}`}
          plan={plans.find(({ id }) => id === copyDialog.plan.id) ?? copyDialog.plan}
          sources={plansToCopyFrom(plans, copyDialog.plan.id)}
          onClose={() => setCopyDialog(null)}
          onCopy={handleCopyOptions}
          submitting={submitting}
        />
      )}

      {optionDialog && (
        <OptionDialog
          key={optionDialog.option?.id ?? `new-option-${optionDialog.plan.id}`}
          plan={optionDialog.plan}
          option={optionDialog.option}
          onClose={() => setOptionDialog(null)}
          onSave={handleOptionSave}
          submitting={submitting}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={submitting ? undefined : () => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {deletionBlocked
            ? deleteTarget?.type === 'plan'
              ? 'Plan is in use'
              : 'Option is in use'
            : deleteTarget?.type === 'plan'
              ? 'Delete plan?'
              : 'Delete option?'}
        </DialogTitle>
        <DialogContent>
          {deletionBlocked ? (
            <Stack spacing={2}>
              <Alert severity="warning">
                {deleteTarget?.type === 'plan'
                  ? `Plan ${deleteTarget.plan.code} cannot be deleted because ${deleteDependencies.length} ${deleteDependencies.length === 1 ? 'lot depends' : 'lots depend'} on it across ${dependencyPhaseCount} ${dependencyPhaseCount === 1 ? 'phase' : 'phases'}.`
                  : `${deleteTarget.option.code} cannot be deleted because it is selected for ${deleteDependencies.length} ${deleteDependencies.length === 1 ? 'lot' : 'lots'} across ${dependencyPhaseCount} ${dependencyPhaseCount === 1 ? 'phase' : 'phases'}.`}
              </Alert>
              <Typography variant="body2" color="text.secondary">
                Reassign or remove these dependencies from Sequence Sheets before deleting it.
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {deleteDependencies.slice(0, 6).map((dependency) => (
                  <Chip
                    key={`${dependency.phaseId}-${dependency.lotId}`}
                    size="small"
                    variant="outlined"
                    label={`Phase ${dependency.phaseName} · Lot ${dependency.lotNumber}`}
                  />
                ))}
                {deleteDependencies.length > 6 && (
                  <Chip
                    size="small"
                    label={`+${deleteDependencies.length - 6} more`}
                  />
                )}
              </Stack>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {deleteTarget?.type === 'plan'
                ? `Plan ${deleteTarget.plan.code} and all of its options will be removed from Job ${job.code}.`
                : deleteTarget
                  ? `${deleteTarget.option.code} will be removed from Plan ${deleteTarget.plan.code}.`
                  : ''}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            color="inherit"
            onClick={() => setDeleteTarget(null)}
            disabled={submitting}
          >
            {deletionBlocked ? 'Close' : 'Cancel'}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDelete}
            disableElevation
            disabled={deletionBlocked || submitting}
          >
            {submitting ? 'Deleting...' : 'Delete'}
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
