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
  getJobSequenceColumnCount,
  getJobUnitCount,
} from '../data/jobs.js'
import {
  createJobPlanSchema,
  planOptionSchema,
} from '../schemas/jobSequenceSheetSchema.js'

function PlanDialog({ plans, plan, onClose, onSave }) {
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
      onClose={onClose}
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
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation>
          {plan ? 'Save changes' : 'Add plan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function OptionDialog({ plan, option, onClose, onSave }) {
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
      onClose={onClose}
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
            label="Option code"
            {...register('code')}
            error={Boolean(errors.code)}
            helperText={errors.code?.message ?? `Example: ${plan.code}-OPT`}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 50 } }}
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
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation>
          {option ? 'Save changes' : 'Add option'}
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

export default function JobDetails({ job, onBack, onChange }) {
  const [planDialog, setPlanDialog] = useState(null)
  const [optionDialog, setOptionDialog] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  const sequenceSheet = job.sequenceSheet ?? {
    name: 'Options Sequence Sheet',
    plans: [],
  }
  const plans = sequenceSheet.plans ?? []
  const columnCount = getJobSequenceColumnCount(job)

  const updatePlans = (nextPlans) => {
    onChange({
      ...job,
      sequenceSheet: {
        ...sequenceSheet,
        plans: nextPlans,
      },
    })
  }

  const handlePlanSave = (form) => {
    if (planDialog?.plan) {
      updatePlans(
        plans.map((plan) =>
          plan.id === planDialog.plan.id ? { ...plan, ...form } : plan,
        ),
      )
      setNotice({ severity: 'success', message: 'Plan updated.' })
    } else {
      updatePlans([...plans, { ...form, id: Date.now(), options: [] }])
      setNotice({ severity: 'success', message: 'Plan added.' })
    }
    setPlanDialog(null)
  }

  const handleOptionSave = (form) => {
    const { plan, option } = optionDialog
    updatePlans(
      plans.map((item) => {
        if (item.id !== plan.id) return item

        const options = item.options ?? []
        return {
          ...item,
          options: option
            ? options.map((itemOption) =>
                itemOption.id === option.id
                  ? { ...itemOption, ...form }
                  : itemOption,
              )
            : [...options, { ...form, id: Date.now() }],
        }
      }),
    )
    setNotice({
      severity: 'success',
      message: option ? 'Option updated.' : 'Option added.',
    })
    setOptionDialog(null)
  }

  const handleDelete = () => {
    if (deleteTarget.type === 'plan') {
      updatePlans(plans.filter((plan) => plan.id !== deleteTarget.plan.id))
      setNotice({ severity: 'success', message: 'Plan deleted.' })
    } else {
      updatePlans(
        plans.map((plan) =>
          plan.id === deleteTarget.plan.id
            ? {
                ...plan,
                options: (plan.options ?? []).filter(
                  (option) => option.id !== deleteTarget.option.id,
                ),
              }
            : plan,
        ),
      )
      setNotice({ severity: 'success', message: 'Option deleted.' })
    }
    setDeleteTarget(null)
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
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h5" fontWeight={700} color="text.primary">
                Job {job.code} · Sequence Sheet
              </Typography>
              <Chip label="Active" size="small" color="success" variant="outlined" />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {job.builder} · {job.community}
            </Typography>
          </Box>
        </Stack>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => setPlanDialog({ plan: null })}
          disableElevation
        >
          New plan
        </Button>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
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
                Each plan starts a blue group; every option is displayed as a column beside it.
              </Typography>
            </Box>
            <Chip
              label={`${columnCount} sequence ${columnCount === 1 ? 'column' : 'columns'}`}
              color="primary"
              variant="outlined"
              size="small"
            />
          </Box>

          {plans.length > 0 ? (
            <TableContainer>
              <Table
                aria-label={`Sequence sheet plans for Job ${job.code}`}
                sx={{
                  minWidth: Math.max(760, columnCount * 154),
                  tableLayout: 'fixed',
                  '& .MuiTableCell-root': {
                    borderColor: 'sequence.border',
                  },
                }}
              >
                <TableHead>
                  <TableRow>
                    {plans.map((plan) => (
                      <TableCell
                        key={plan.id}
                        colSpan={(plan.options?.length ?? 0) + 1}
                        sx={{
                          p: 1,
                          bgcolor: 'sequence.header',
                          color: 'sequence.text',
                          borderLeft: 2,
                          borderRight: 2,
                          borderLeftColor: 'sequence.border',
                          borderRightColor: 'sequence.border',
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="caption" color="sequence.muted">
                              Plan group
                            </Typography>
                            <Typography variant="body2" fontWeight={800} noWrap>
                              {plan.code} · {plan.name || `Plan ${plan.code}`}
                            </Typography>
                          </Box>
                          <Stack direction="row" spacing={0.25}>
                            <Tooltip title="Add option">
                              <IconButton
                                size="small"
                                color="primary"
                                aria-label={`Add option to Plan ${plan.code}`}
                                onClick={() => setOptionDialog({ plan, option: null })}
                              >
                                <AddRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Edit plan">
                              <IconButton
                                size="small"
                                aria-label={`Edit Plan ${plan.code}`}
                                onClick={() => setPlanDialog({ plan })}
                                sx={{ color: 'sequence.action' }}
                              >
                                <EditOutlinedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete plan">
                              <IconButton
                                size="small"
                                color="error"
                                aria-label={`Delete Plan ${plan.code}`}
                                onClick={() => setDeleteTarget({ type: 'plan', plan })}
                              >
                                <DeleteOutlineRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </Stack>
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    {plans.map((plan) => (
                      <Fragment key={plan.id}>
                        <TableCell
                          align="center"
                          sx={{
                            width: 154,
                            py: 0.8,
                            px: 1,
                            bgcolor: 'sequence.plan',
                            color: 'sequence.text',
                            borderLeft: 2,
                            borderLeftColor: 'sequence.border',
                            fontWeight: 800,
                          }}
                        >
                          {plan.code}
                        </TableCell>
                        {(plan.options ?? []).map((option, optionIndex) => (
                          <TableCell
                            key={option.id}
                            align="center"
                            sx={{
                              width: 154,
                              py: 0.8,
                              px: 1,
                              bgcolor: 'sequence.option',
                              color: 'sequence.text',
                              borderRight:
                                optionIndex === plan.options.length - 1
                                  ? 2
                                  : undefined,
                              borderRightColor: 'sequence.border',
                              fontSize: 12,
                              fontWeight: 800,
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {option.code}
                          </TableCell>
                        ))}
                      </Fragment>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    {plans.map((plan) => (
                      <Fragment key={plan.id}>
                        <TableCell
                          align="center"
                          sx={{
                            height: 126,
                            p: 1.5,
                            bgcolor: 'sequence.plan',
                            color: 'sequence.text',
                            borderLeft: 2,
                            borderLeftColor: 'sequence.border',
                            verticalAlign: 'middle',
                          }}
                        >
                          <Typography variant="body2" fontWeight={900}>
                            {plan.name || plan.code}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'sequence.muted' }}>
                            Base plan
                          </Typography>
                        </TableCell>
                        {(plan.options ?? []).map((option, optionIndex) => (
                          <TableCell
                            key={option.id}
                            align="center"
                            sx={{
                              height: 126,
                              p: 1.25,
                              bgcolor: 'sequence.option',
                              color: 'sequence.text',
                              borderRight:
                                optionIndex === plan.options.length - 1
                                  ? 2
                                  : undefined,
                              borderRightColor: 'sequence.border',
                              verticalAlign: 'middle',
                            }}
                          >
                            <Stack sx={{ height: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Typography
                                variant="body2"
                                fontWeight={800}
                                sx={{ lineHeight: 1.2, overflowWrap: 'anywhere' }}
                              >
                                {option.description}
                              </Typography>
                              <Stack direction="row" spacing={0.25} sx={{ mt: 1 }}>
                                <IconButton
                                  size="small"
                                  aria-label={`Edit option ${option.code} for Plan ${plan.code}`}
                                  onClick={() => setOptionDialog({ plan, option })}
                                  sx={{ color: 'sequence.action' }}
                                >
                                  <EditOutlinedIcon sx={{ fontSize: 17 }} />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  color="error"
                                  aria-label={`Delete option ${option.code} for Plan ${plan.code}`}
                                  onClick={() => setDeleteTarget({ type: 'option', plan, option })}
                                >
                                  <DeleteOutlineRoundedIcon sx={{ fontSize: 17 }} />
                                </IconButton>
                              </Stack>
                            </Stack>
                          </TableCell>
                        ))}
                      </Fragment>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
              <LayersRoundedIcon color="action" sx={{ fontSize: 42, mb: 1 }} />
              <Typography fontWeight={700}>No plans in this sequence sheet</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                Add the first plan, then place its options beside it.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                onClick={() => setPlanDialog({ plan: null })}
              >
                Add plan
              </Button>
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
        />
      )}

      {optionDialog && (
        <OptionDialog
          key={optionDialog.option?.id ?? `new-option-${optionDialog.plan.id}`}
          plan={optionDialog.plan}
          option={optionDialog.option}
          onClose={() => setOptionDialog(null)}
          onSave={handleOptionSave}
        />
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {deleteTarget?.type === 'plan' ? 'Delete plan?' : 'Delete option?'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {deleteTarget?.type === 'plan'
              ? `Plan ${deleteTarget.plan.code} and all of its options will be removed from Job ${job.code}.`
              : deleteTarget
                ? `${deleteTarget.option.code} will be removed from Plan ${deleteTarget.plan.code}.`
                : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button color="inherit" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disableElevation>
            Delete
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
