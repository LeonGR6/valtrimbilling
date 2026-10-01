import { Fragment, useMemo, useState } from 'react'
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
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h6" component="div" fontWeight={750}>
              {plan ? 'Edit plan' : 'Add plan'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Enter the Plan exactly as it should appear in the Job worksheet.
            </Typography>
          </Box>
          <Chip size="small" variant="outlined" color="primary" label="Plan worksheet" />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  Plan code <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  Plan name
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell>
                  <TextField
                    placeholder="Example: 2-ADA"
                    {...register('code')}
                    error={Boolean(errors.code)}
                    helperText={errors.code?.message ?? 'Required'}
                    fullWidth
                    size="small"
                    sx={{ '& .MuiInputBase-input': { fontWeight: 800 } }}
                    slotProps={{ htmlInput: { maxLength: 40, 'aria-label': 'Plan code' } }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder="Optional descriptive name"
                    {...register('name')}
                    error={Boolean(errors.name)}
                    helperText={errors.name?.message ?? 'Optional'}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 100, 'aria-label': 'Plan name' } }}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
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
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h6" component="div" fontWeight={750}>
              {option ? 'Edit option' : 'Add option'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              This Option will be grouped under Plan{' '}
              <Box component="span" sx={{ fontWeight: 800, color: 'text.primary' }}>
                {plan.code}
              </Box>
              .
            </Typography>
          </Box>
          <Chip
            size="small"
            variant="outlined"
            color="primary"
            label={`Plan ${plan.code}`}
          />
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: '16px !important' }}>
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ width: 130, fontWeight: 750, color: 'text.secondary' }}>
                  Parent plan
                </TableCell>
                <TableCell sx={{ width: 190, fontWeight: 750, color: 'text.secondary' }}>
                  OPT # <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
                <TableCell sx={{ fontWeight: 750, color: 'text.secondary' }}>
                  Option description <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow sx={{ verticalAlign: 'top' }}>
                <TableCell sx={{ pt: 2.25 }}>
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={plan.code}
                    sx={{ fontWeight: 750 }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder={`Example: OPT 1`}
                    {...register('code')}
                    error={Boolean(errors.code)}
                    helperText={errors.code?.message ?? 'Required'}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 40, 'aria-label': 'Option code' } }}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    placeholder="Enter the option description, if doesn't exist, put the same as the OPT #."
                    {...register('description')}
                    error={Boolean(errors.description)}
                    helperText={errors.description?.message ?? 'Required'}
                    multiline
                    minRows={2}
                    fullWidth
                    size="small"
                    slotProps={{ htmlInput: { maxLength: 240, 'aria-label': 'Option description' } }}
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
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
                Plan code:{' '}
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 900 }}>
                  {plan.code}
                </Box>
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
              Option code and description for this plan.
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
                OPT #
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
                    OPT #
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

function PlansOptionsSheet({
  plans,
  canManage,
  onAddPlan,
  onAddOption,
  onEditPlan,
  onDeletePlan,
  onEditOption,
  onDeleteOption,
}) {
  return (
    <>
      <Stack spacing={2} sx={{ display: { xs: 'flex', md: 'none' }, p: 2 }}>
        {plans.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            position={index + 1}
            canManage={canManage}
            onAddOption={() => onAddOption(plan)}
            onEditPlan={() => onEditPlan(plan)}
            onDeletePlan={() => onDeletePlan(plan)}
            onEditOption={(option) => onEditOption(plan, option)}
            onDeleteOption={(option) => onDeleteOption(plan, option)}
          />
        ))}
        {canManage && (
          <Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={onAddPlan}>
            Add another plan
          </Button>
        )}
      </Stack>

      <TableContainer sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
        <Table size="small" aria-label="Plans and options worksheet" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow
              sx={{
                bgcolor: 'action.hover',
                '& th': {
                  py: 1.25,
                  color: 'text.secondary',
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <TableCell sx={{ width: 125 }}>Item</TableCell>
              <TableCell sx={{ width: 180 }}>Code</TableCell>
              <TableCell>Name / description</TableCell>
              <TableCell align="center" sx={{ width: 100 }}>Options</TableCell>
              <TableCell align="right" sx={{ width: 220 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => {
              const options = plan.options ?? []

              return (
                <Fragment key={plan.id}>
                  <TableRow sx={{ bgcolor: 'primary.light', '& td': { py: 1.25 } }}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={800} color="primary.main">
                        Plan
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        component="strong"
                        variant="body1"
                        sx={{
                          display: 'inline-block',
                          color: 'text.primary',
                          fontWeight: '900 !important',
                          letterSpacing: '0.01em',
                        }}
                      >
                        {plan.code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                        {plan.name || `Plan ${plan.code}`}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={options.length}
                        sx={{ minWidth: 34, fontWeight: 800 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {canManage ? (
                        <Stack direction="row" spacing={0.25} sx={{ justifyContent: 'flex-end' }}>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<AddRoundedIcon />}
                            onClick={() => onAddOption(plan)}
                            disableElevation
                          >
                            Option
                          </Button>
                          <Tooltip title={`Edit Plan ${plan.code}`}>
                            <IconButton
                              size="small"
                              aria-label={`Edit Plan ${plan.code}`}
                              onClick={() => onEditPlan(plan)}
                            >
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={`Delete Plan ${plan.code}`}>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={`Delete Plan ${plan.code}`}
                              onClick={() => onDeletePlan(plan)}
                            >
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.disabled">Read only</Typography>
                      )}
                    </TableCell>
                  </TableRow>

                  {options.length > 0 ? options.map((option, optionIndex) => (
                    <TableRow
                      key={option.id}
                      hover
                      sx={{
                        bgcolor: optionIndex % 2 === 0 ? 'background.paper' : 'action.hover',
                        '& td': { py: 1.15 },
                      }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Box sx={{ width: 14, borderTop: 1, borderColor: 'divider' }} />
                          <Typography variant="body2" color="text.secondary" fontWeight={650}>
                            Option
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                        >
                          {option.code}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                          {option.description}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography color="text.disabled">—</Typography>
                      </TableCell>
                      <TableCell align="right">
                        {canManage ? (
                          <Stack direction="row" spacing={0.25} sx={{ justifyContent: 'flex-end' }}>
                            <Tooltip title={`Edit option ${option.code}`}>
                              <IconButton
                                size="small"
                                aria-label={`Edit option ${option.code} for Plan ${plan.code}`}
                                onClick={() => onEditOption(plan, option)}
                              >
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={`Delete option ${option.code}`}>
                              <IconButton
                                size="small"
                                color="error"
                                aria-label={`Delete option ${option.code} for Plan ${plan.code}`}
                                onClick={() => onDeleteOption(plan, option)}
                              >
                                <DeleteOutlineRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.disabled">Read only</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow key={`${plan.id}-empty-options`}>
                      <TableCell colSpan={5} sx={{ py: 1.5, bgcolor: 'background.default' }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            No Options in this Plan yet.
                          </Typography>
                          {canManage && (
                            <Button
                              size="small"
                              variant="text"
                              startIcon={<AddRoundedIcon />}
                              onClick={() => onAddOption(plan)}
                            >
                              Add first option
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}

            {canManage && (
              <TableRow>
                <TableCell colSpan={5} sx={{ bgcolor: 'background.default' }}>
                  <Button size="small" startIcon={<AddRoundedIcon />} onClick={onAddPlan}>
                    Add another plan
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  )
}

export default function JobDetails({
  builderId,
  job,
  supervisorName,
  jobsiteSuperintendentName,
  onBack,
}) {
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
              <JobField label="Supervisor" value={supervisorName} />
              <JobField
                label="Jobsite Superintendent"
                value={jobsiteSuperintendentName}
              />
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
            <PlansOptionsSheet
              plans={plans}
              canManage={canManagePlans}
              onAddPlan={() => setPlanDialog({ plan: null })}
              onAddOption={(plan) => setOptionDialog({ plan, option: null })}
              onEditPlan={(plan) => setPlanDialog({ plan })}
              onDeletePlan={(plan) => setDeleteTarget({ type: 'plan', plan })}
              onEditOption={(plan, option) => setOptionDialog({ plan, option })}
              onDeleteOption={(plan, option) =>
                setDeleteTarget({ type: 'option', plan, option })
              }
            />
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
