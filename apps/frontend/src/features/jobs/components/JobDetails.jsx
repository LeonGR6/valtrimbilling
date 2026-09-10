import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
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
  Divider,
  IconButton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LayersRoundedIcon from '@mui/icons-material/LayersRounded'
import LocationCityRoundedIcon from '@mui/icons-material/LocationCityRounded'
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded'
import {
  emptyJobPlan,
  emptyPlanOption,
  getJobOptionCount,
  getJobPlanCount,
  getJobUnitCount,
  getOptionLotDependencies,
  getPlanLotDependencies,
} from '../data/jobs.js'
import {
  createJobPlanSchema,
  planOptionSchema,
} from '../schemas/jobSequenceSheetSchema.js'
import { useJobs } from '../context/useJobs.js'
import JobModuleNavigation from './JobModuleNavigation.jsx'

function PlanDialog({ plans, plan, onClose, onSave, submitting }) {
  const schema = useMemo(
    () => createJobPlanSchema(plans, plan?.id),
    [plan?.id, plans],
  )
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: plan
      ? { code: plan.code, name: plan.name ?? '' }
      : { ...emptyJobPlan },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {plan ? 'Edit plan' : 'Add plan'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Plans are the main groups displayed in this Job&apos;s sequence sheet.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <TextField
            label="Plan code"
            {...register('code')}
            error={Boolean(errors.code)}
            helperText={errors.code?.message ?? 'Example: 2 or 2-ADA'}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            label="Plan name"
            {...register('name')}
            error={Boolean(errors.name)}
            helperText={errors.name?.message ?? 'Optional descriptive name.'}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={submitting}>
          {submitting ? 'Saving...' : plan ? 'Save changes' : 'Add plan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function OptionDialog({ plan, option, onClose, onSave, submitting }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(planOptionSchema),
    defaultValues: option
      ? { code: option.code, description: option.description }
      : { ...emptyPlanOption },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {option ? 'Edit option' : `Add option to Plan ${plan.code}`}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          The code and description will appear as one column in the sequence sheet.
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <TextField
            label="P.O. / OPT # (option code)"
            {...register('code')}
            error={Boolean(errors.code)}
            helperText={errors.code?.message ?? `Example: ${plan.code}-OPT`}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            label="Option description"
            {...register('description')}
            error={Boolean(errors.description)}
            helperText={errors.description?.message ?? 'Describe the work included in this option.'}
            multiline
            minRows={3}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 240 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={submitting}>
          {submitting ? 'Saving...' : option ? 'Save changes' : 'Add option'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function DetailMetric({ icon, label, value }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 170 }}>
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

function JobField({ label, value }) {
  return (
    <Box sx={{ minWidth: 170 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>
        {value || 'Unassigned'}
      </Typography>
    </Box>
  )
}

function PlanCard({
  plan,
  position,
  canManage,
  onAddOption,
  onEditPlan,
  onDeletePlan,
  onEditOption,
  onDeleteOption,
}) {
  const options = plan.options ?? []

  return (
    <Card component="article" variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 2,
          bgcolor: 'primary.light',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Box
              sx={{
                width: 42,
                height: 42,
                flexShrink: 0,
                borderRadius: 1.5,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontWeight: 800,
              }}
            >
              {position}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" color="text.secondary" fontWeight={700}>
                Plan code: {plan.code}
              </Typography>
              <Typography variant="h6" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>
                {plan.name || `Plan ${plan.code}`}
              </Typography>
            </Box>
          </Stack>

          {canManage && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={onAddOption}
                disableElevation
              >
                Add option
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<EditOutlinedIcon />}
                onClick={onEditPlan}
              >
                Edit plan
              </Button>
              <Tooltip title="Delete plan">
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`Delete Plan ${plan.code}`}
                  onClick={onDeletePlan}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={750}>
              Options
            </Typography>
            <Typography variant="caption" color="text.secondary">
              P.O. / OPT # and description for this plan.
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            label={`${options.length} ${options.length === 1 ? 'option' : 'options'}`}
          />
        </Stack>

        {options.length > 0 ? (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns: 'minmax(170px, 0.32fr) minmax(260px, 1fr) auto',
                gap: 2,
                px: 2,
                py: 1,
                bgcolor: 'action.hover',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary" fontWeight={750}>
                P.O. / OPT #
              </Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={750}>
                Description
              </Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={750}>
                Actions
              </Typography>
            </Box>

            {options.map((option, optionIndex) => (
              <Box
                key={option.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'minmax(170px, 0.32fr) minmax(260px, 1fr) auto',
                  },
                  alignItems: { md: 'center' },
                  gap: { xs: 1.25, md: 2 },
                  px: 2,
                  py: 1.5,
                  borderTop: optionIndex === 0 ? 0 : 1,
                  borderColor: 'divider',
                  bgcolor: optionIndex % 2 === 0 ? 'background.paper' : 'action.hover',
                }}
              >
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: { xs: 'block', md: 'none' }, mb: 0.5 }}
                  >
                    P.O. / OPT #
                  </Typography>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={option.code}
                    sx={{ fontWeight: 750, maxWidth: '100%' }}
                  />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: { xs: 'block', md: 'none' }, mb: 0.25 }}
                  >
                    Description
                  </Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    {option.description}
                  </Typography>
                </Box>
                {canManage && (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ justifyContent: { xs: 'flex-start', md: 'flex-end' } }}
                  >
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<EditOutlinedIcon />}
                      onClick={() => onEditOption(option)}
                    >
                      Edit
                    </Button>
                    <Tooltip title="Delete option">
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={`Delete option ${option.code} for Plan ${plan.code}`}
                        onClick={() => onDeleteOption(option)}
                      >
                        <DeleteOutlineRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}
              </Box>
            ))}
          </Box>
        ) : (
          <Box
            sx={{
              py: 3,
              px: 2,
              textAlign: 'center',
              border: 1,
              borderStyle: 'dashed',
              borderColor: 'divider',
              borderRadius: 1.5,
              bgcolor: 'action.hover',
            }}
          >
            <ReceiptLongRoundedIcon color="disabled" sx={{ mb: 0.5 }} />
            <Typography variant="body2" fontWeight={700}>
              No options added to this plan
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
              Add the first option to complete this plan.
            </Typography>
            {canManage && (
              <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={onAddOption}>
                Add first option
              </Button>
            )}
          </Box>
        )}
      </Box>
    </Card>
  )
}

export default function JobDetails({ builderId, job, onBack }) {
  const {
    canManageJobs,
    createJobPlan,
    updateJobPlan,
    deactivateJobPlan,
    createPlanOption,
    updatePlanOption,
    deactivatePlanOption,
  } = useJobs()
  const [planDialog, setPlanDialog] = useState(null)
  const [optionDialog, setOptionDialog] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  const canManagePlans = canManageJobs && job.isActive
  const sequenceSheet = job.sequenceSheet ?? {
    name: 'Options Sequence Sheet',
    plans: [],
  }
  const plans = sequenceSheet.plans ?? []
  const deleteDependencies = deleteTarget
    ? deleteTarget.type === 'plan'
      ? getPlanLotDependencies(job, deleteTarget.plan.id)
      : getOptionLotDependencies(job, deleteTarget.option.id)
    : []
  const dependencyPhaseCount = new Set(
    deleteDependencies.map((dependency) => dependency.phaseId),
  ).size
  const deletionBlocked = deleteDependencies.length > 0

  const handlePlanSave = async (form) => {
    setSubmitting(true)
    try {
      if (planDialog?.plan) {
        await updateJobPlan(job.id, planDialog.plan.id, form)
        setNotice({ severity: 'success', message: 'Plan updated.' })
      } else {
        await createJobPlan(job.id, form)
        setNotice({ severity: 'success', message: 'Plan added.' })
      }
      setPlanDialog(null)
    } catch (saveError) {
      setNotice({ severity: 'error', message: saveError.message })
    } finally {
      setSubmitting(false)
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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <IconButton aria-label="Back to jobs" onClick={onBack} sx={{ mt: -0.5, ml: -1 }}>
            <ArrowBackRoundedIcon />
          </IconButton>
          <Box>
            <Typography variant="caption" color="primary.main" fontWeight={700}>
              Builders / {job.builder} / Jobs / Job {job.code} / Plans &amp; Options
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h5" fontWeight={700} color="text.primary">
                Job {job.code} · Plans &amp; options
              </Typography>
              <Chip
                label={job.isActive ? 'Active' : 'Inactive'}
                size="small"
                color={job.isActive ? 'success' : 'default'}
                variant="outlined"
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {job.builder} · {job.community}
            </Typography>
          </Box>
        </Stack>
        {canManagePlans && (
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={() => setPlanDialog({ plan: null })}
            disableElevation
          >
            New plan
          </Button>
        )}
      </Box>

      <JobModuleNavigation
        active="plans-options"
        builderId={builderId}
        jobId={job.id}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {!canManagePlans && (
          <Alert severity="info" sx={{ mb: 2.5 }}>
            {job.isActive
              ? 'You can review Plans and Options, but your role cannot change them.'
              : 'This Job is inactive. Its Plans, Options and prices are read-only.'}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <DetailMetric
            icon={<ApartmentRoundedIcon />}
            label="Total lots"
            value={getJobUnitCount(job)}
          />
          <DetailMetric
            icon={<LayersRoundedIcon />}
            label="Plans"
            value={getJobPlanCount(job)}
          />
          <DetailMetric
            icon={<ReceiptLongRoundedIcon />}
            label="Options"
            value={getJobOptionCount(job)}
          />
        </Stack>

        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: '20px !important' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
              <LocationCityRoundedIcon color="primary" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={700}>
                Job information
              </Typography>
            </Stack>
            <Divider sx={{ mb: 2 }} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 2, sm: 4 }}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <JobField label="Builder" value={job.builder} />
              <JobField label="Community / Project" value={job.community} />
              <JobField label="Supervisor" value={job.supervisor} />
              <JobField label="Jobsite Superintendent" value={job.jobsiteSuperintendent} />
            </Stack>
          </CardContent>
        </Card>

        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              px: 2.5,
              py: 2,
              borderBottom: 1,
              borderColor: 'divider',
              display: 'flex',
              alignItems: { xs: 'flex-start', sm: 'center' },
              justifyContent: 'space-between',
              gap: 1.5,
              flexDirection: { xs: 'column', sm: 'row' },
            }}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Plans &amp; options
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                Review each plan and manage its options directly underneath it.
              </Typography>
            </Box>
            <Chip
              label={`${plans.length} ${plans.length === 1 ? 'plan' : 'plans'}`}
              color="primary"
              variant="outlined"
              size="small"
            />
          </Box>

          {plans.length > 0 ? (
            <Stack spacing={2} sx={{ p: { xs: 2, sm: 2.5 } }}>
              {plans.map((plan, index) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  position={index + 1}
                  canManage={canManagePlans}
                  onAddOption={() => setOptionDialog({ plan, option: null })}
                  onEditPlan={() => setPlanDialog({ plan })}
                  onDeletePlan={() => setDeleteTarget({ type: 'plan', plan })}
                  onEditOption={(option) => setOptionDialog({ plan, option })}
                  onDeleteOption={(option) =>
                    setDeleteTarget({ type: 'option', plan, option })
                  }
                />
              ))}
              {canManagePlans && (
                <Button
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => setPlanDialog({ plan: null })}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                >
                  Add another plan
                </Button>
              )}
            </Stack>
          ) : (
            <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
              <LayersRoundedIcon color="action" sx={{ fontSize: 42, mb: 1 }} />
              <Typography fontWeight={700}>No plans configured for this Job</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                Add the first plan, then organize its options underneath it.
              </Typography>
              {canManagePlans && (
                <Button
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => setPlanDialog({ plan: null })}
                >
                  Add plan
                </Button>
              )}
            </Box>
          )}
        </Box>
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
