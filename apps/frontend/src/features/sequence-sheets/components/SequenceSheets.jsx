import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputAdornment,
  MenuItem,
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
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import FolderRoundedIcon from '@mui/icons-material/FolderRounded'
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded'
import HomeWorkRoundedIcon from '@mui/icons-material/HomeWorkRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { useJobs } from '../../jobs/context/useJobs.js'
import {
  getJobAssignedLotCount,
  getJobPhaseCount,
  getJobPlanCount,
} from '../../jobs/data/jobs.js'
import { createPhaseByLotSchema } from '../schemas/phaseByLotSchema.js'
import {
  formatBuilding,
  formatPhase,
} from '../utils/phaseBuildingCodes.js'
import { parseLotRange } from '../utils/lotRange.js'

const emptyLot = {
  lotNumber: '',
  planId: '',
  reverse: false,
  optionIds: [],
}

function SummaryCard({ icon, value, label }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 180 }}>
      <CardContent
        sx={{
          p: '16px !important',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
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
          <Typography variant="h6" fontWeight={750} sx={{ lineHeight: 1.2 }}>
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

function getPlan(job, planId) {
  return (job.sequenceSheet?.plans ?? []).find(
    (plan) => plan.id === Number(planId),
  )
}

function PhaseCard({ phase, onOpen }) {
  const phaseLabel = formatPhase(phase.name)
  const buildingLabel = formatBuilding(phase.building)
  const selectedOptionCount = (phase.lots ?? []).reduce(
    (total, lot) => total + (lot.optionIds?.length ?? 0),
    0,
  )

  return (
    <Card
      variant="outlined"
      sx={{
        '& + &': { mt: 1.5 },
        overflow: 'hidden',
      }}
    >
      <ButtonBase
        onClick={onOpen}
        aria-label={`View details for ${phaseLabel}`}
        sx={{
          width: '100%',
          px: { xs: 2, sm: 2.5 },
          py: 2,
          textAlign: 'left',
          justifyContent: 'stretch',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          spacing={1.5}
          sx={{ width: '100%' }}
        >
          <Box>
            <Typography fontWeight={750}>{phaseLabel}</Typography>
            <Typography variant="caption" color="text.secondary">
              {buildingLabel} · Created {phase.createdAt}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={formatBuilding(phase.building, 'short')} />
            <Chip size="small" label={`${phase.lots?.length ?? 0} lots`} />
            <Chip size="small" variant="outlined" label={`${selectedOptionCount} selected options`} />
            <ArrowForwardIosRoundedIcon fontSize="small" color="action" />
          </Stack>
        </Stack>
      </ButtonBase>
    </Card>
  )
}

function PhaseDetails({ job, phase, onBack }) {
  const phaseLabel = formatPhase(phase.name)
  const buildingLabel = formatBuilding(phase.building)
  const selectedOptionCount = (phase.lots ?? []).reduce(
    (total, lot) => total + (lot.optionIds?.length ?? 0),
    0,
  )

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: { xs: 2.5, md: 4 },
          py: 2.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Button
          color="inherit"
          startIcon={<ArrowBackRoundedIcon />}
          onClick={onBack}
          sx={{ mb: 1.5 }}
        >
          All Sequence Sheets
        </Button>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="overline" color="text.secondary" fontWeight={700}>
              Job #{job.code} · {job.community}
            </Typography>
            <Typography variant="h5" fontWeight={800} color="text.primary">
              {phaseLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {buildingLabel} · {job.builder}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip color="primary" variant="outlined" label={formatBuilding(phase.building, 'short')} />
            <Chip label={`${phase.lots?.length ?? 0} lots`} />
            <Chip variant="outlined" label={`${selectedOptionCount} selected options`} />
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Card variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 2.5, py: 2, bgcolor: 'action.hover' }}>
            <Typography fontWeight={750}>Phase lot assignments</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Plan, orientation and selected options for every lot in this phase.
            </Typography>
          </Box>
          <Divider />
          <TableContainer>
            <Table aria-label={`${phaseLabel} lot assignments`} sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Lot</TableCell>
                  <TableCell>Plan</TableCell>
                  <TableCell align="center">Reverse</TableCell>
                  <TableCell>Options for selected plan</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(phase.lots ?? []).map((lot) => {
                  const plan = getPlan(job, lot.planId)
                  const options = (plan?.options ?? []).filter((option) =>
                    lot.optionIds?.includes(option.id),
                  )

                  return (
                    <TableRow key={lot.id} hover>
                      <TableCell sx={{ width: 100 }}>
                        <Typography fontWeight={750}>{lot.lotNumber}</Typography>
                      </TableCell>
                      <TableCell sx={{ minWidth: 180 }}>
                        {plan ? `${plan.code}` : 'Plan unavailable'}
                      </TableCell>
                      <TableCell align="center" sx={{ width: 120 }}>
                        <Chip
                          size="small"
                          color={lot.reverse ? 'primary' : 'default'}
                          variant={lot.reverse ? 'filled' : 'outlined'}
                          label={lot.reverse ? 'Yes' : 'No'}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 320 }}>
                        {options.length > 0 ? (
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            {options.map((option) => (
                              <Chip
                                key={option.id}
                                size="small"
                                variant="outlined"
                                label={`${option.code} · ${option.description}`}
                              />
                            ))}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            No options selected
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      </Box>
    </Box>
  )
}

function LotEditor({ index, fieldId, job, control, register, errors, setValue, remove, canRemove }) {
  const lots = useWatch({ control, name: 'lots' })
  const selectedPlan = getPlan(job, lots?.[index]?.planId)
  const planOptions = selectedPlan?.options ?? []
  const optionError = errors.lots?.[index]?.optionIds?.message

  return (
    <Box
      sx={{
        border: 1,
        borderColor: errors.lots?.[index] ? 'error.main' : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1.25, bgcolor: 'action.hover' }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            sx={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontSize: 13,
              fontWeight: 750,
            }}
          >
            {index + 1}
          </Box>
          <Typography variant="subtitle2" fontWeight={750}>
            Lot assignment
          </Typography>
        </Stack>
        <Tooltip title={canRemove ? 'Remove lot' : 'A phase needs at least one lot'}>
          <span>
            <IconButton
              size="small"
              color="error"
              disabled={!canRemove}
              onClick={() => remove(index)}
              aria-label={`Remove lot ${index + 1}`}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Stack spacing={2.25} sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
          <TextField
            label="Lot"
            placeholder="Lot #"
            {...register(`lots.${index}.lotNumber`)}
            error={Boolean(errors.lots?.[index]?.lotNumber)}
            helperText={errors.lots?.[index]?.lotNumber?.message ?? 'Required'}
            sx={{ width: { xs: '100%', md: 150 } }}
            slotProps={{ htmlInput: { maxLength: 30 } }}
          />

          <Controller
            name={`lots.${index}.planId`}
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Plan"
                error={Boolean(errors.lots?.[index]?.planId)}
                helperText={
                  errors.lots?.[index]?.planId?.message ??
                  'Plans configured for this Job'
                }
                sx={{ minWidth: { xs: '100%', md: 260 } }}
                onChange={(event) => {
                  field.onChange(event)
                  setValue(`lots.${index}.optionIds`, [], {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }}
              >
                <MenuItem value="">Select a plan</MenuItem>
                {(job.sequenceSheet?.plans ?? []).map((plan) => (
                  <MenuItem key={plan.id} value={plan.id}>
                    {plan.code} · {plan.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <Controller
            name={`lots.${index}.reverse`}
            control={control}
            render={({ field }) => (
              <FormControlLabel
                sx={{ mt: { md: 1 }, minWidth: 118 }}
                control={
                  <Checkbox
                    checked={field.value}
                    onChange={(_, checked) => field.onChange(checked)}
                  />
                }
                label="Reverse"
              />
            )}
          />
        </Stack>

        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Options for selected plan
          </Typography>
          <Box
            sx={{
              border: 1,
              borderColor: optionError ? 'error.main' : 'divider',
              borderRadius: 1.5,
              p: 1.5,
              minHeight: 58,
              bgcolor: 'action.hover',
            }}
          >
            {!selectedPlan ? (
              <Typography variant="body2" color="text.secondary">
                Choose a plan first.
              </Typography>
            ) : planOptions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                This plan does not have options configured yet.
              </Typography>
            ) : (
              <Controller
                key={`${fieldId}-${selectedPlan.id}`}
                name={`lots.${index}.optionIds`}
                control={control}
                render={({ field }) => (
                  <FormGroup row sx={{ gap: 0.5 }}>
                    {planOptions.map((option) => {
                      const isChecked = field.value?.includes(option.id) ?? false
                      return (
                        <FormControlLabel
                          key={option.id}
                          sx={{
                            mr: 1.5,
                            alignItems: 'flex-start',
                            '& .MuiFormControlLabel-label': { pt: 0.75 },
                          }}
                          control={
                            <Checkbox
                              size="small"
                              checked={isChecked}
                              onChange={(_, checked) => {
                                const current = field.value ?? []
                                field.onChange(
                                  checked
                                    ? [...current, option.id]
                                    : current.filter((id) => id !== option.id),
                                )
                              }}
                            />
                          }
                          label={
                            <Box>
                              <Typography variant="body2" fontWeight={700}>
                                {option.code}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {option.description}
                              </Typography>
                            </Box>
                          }
                        />
                      )
                    })}
                  </FormGroup>
                )}
              />
            )}
          </Box>
          {optionError && (
            <Typography variant="caption" color="error" sx={{ ml: 1.75, mt: 0.5, display: 'block' }}>
              {optionError}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  )
}

function CreatePhaseDialog({ job, onClose, onCreate }) {
  const [lotRange, setLotRange] = useState('')
  const [lotRangeError, setLotRangeError] = useState('')
  const schema = useMemo(() => createPhaseByLotSchema(job), [job])
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { phaseName: '', building: '', lots: [{ ...emptyLot }] },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lots' })
  const hasPlans = (job.sequenceSheet?.plans?.length ?? 0) > 0

  const addLotRange = () => {
    const currentLots = getValues('lots') ?? []
    const hasOnlyInitialEmptyLot =
      currentLots.length === 1 &&
      !currentLots[0].lotNumber?.trim() &&
      !currentLots[0].planId &&
      !currentLots[0].reverse &&
      (currentLots[0].optionIds?.length ?? 0) === 0
    const remainingLotCapacity = hasOnlyInitialEmptyLot
      ? 500
      : Math.max(500 - currentLots.length, 0)

    if (remainingLotCapacity === 0) {
      setLotRangeError('A phase can contain up to 500 lots.')
      return
    }

    const parsedRange = parseLotRange(lotRange, remainingLotCapacity)

    if (!parsedRange.success) {
      setLotRangeError(parsedRange.error)
      return
    }

    const existingLotNumbers = new Set(
      currentLots
        .map((lot) => lot.lotNumber?.trim().toUpperCase())
        .filter(Boolean),
    )
    const duplicateLot = parsedRange.lotNumbers.find((lotNumber) =>
      existingLotNumbers.has(lotNumber),
    )

    if (duplicateLot) {
      setLotRangeError(`Lot ${duplicateLot} has already been added.`)
      return
    }

    const generatedLots = parsedRange.lotNumbers.map((lotNumber) => ({
      ...emptyLot,
      lotNumber,
    }))

    if (hasOnlyInitialEmptyLot) {
      replace(generatedLots)
    } else {
      append(generatedLots)
    }

    setLotRange('')
    setLotRangeError('')
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      component="form"
      onSubmit={handleSubmit(onCreate)}
      noValidate
      slotProps={{
        paper: {
          sx: {
            maxHeight: { xs: '100%', sm: 'calc(100% - 48px)' },
            m: { xs: 0, sm: 3 },
            borderRadius: { xs: 0, sm: 2 },
          },
        },
      }}
    >
      <DialogTitle sx={{ pr: 7, pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={750}>
          Create Phase
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Assign every lot to one of Job #{job.code}&apos;s plans and select its applicable options.
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label="Close create phase dialog"
          sx={{ position: 'absolute', right: 16, top: 14 }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.5}>
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
              bgcolor: 'action.hover',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ md: 'center' }}
              justifyContent="space-between"
              spacing={2}
            >
              <Box>
                <Typography variant="overline" color="text.secondary" fontWeight={700}>
                  Sequence Sheet · Job #{job.code}
                </Typography>
                <Typography fontWeight={750}>
                  {job.community} · {job.builder}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {getJobPlanCount(job)} plans available
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
                <TextField
                  label="Phase number / code"
                  placeholder="Example: 3"
                  {...register('phaseName')}
                  error={Boolean(errors.phaseName)}
                  helperText={errors.phaseName?.message ?? 'Enter only the number or code'}
                  sx={{ minWidth: { sm: 280 } }}
                  slotProps={{
                    input: {
                      startAdornment: <InputAdornment position="start">Phase</InputAdornment>,
                    },
                    htmlInput: { maxLength: 100 },
                  }}
                />
                <TextField
                  label="Building number / code"
                  placeholder="Example: 3 or C5"
                  {...register('building')}
                  error={Boolean(errors.building)}
                  helperText={errors.building?.message ?? 'Enter only the number or code'}
                  sx={{ minWidth: { sm: 190 } }}
                  slotProps={{
                    input: {
                      startAdornment: <InputAdornment position="start">Building</InputAdornment>,
                    },
                    htmlInput: { maxLength: 50 },
                  }}
                />
                <Button
                  type="button"
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => append({ ...emptyLot })}
                  sx={{ minHeight: 56, whiteSpace: 'nowrap' }}
                >
                  Add lot
                </Button>
              </Stack>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ sm: 'flex-start' }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" fontWeight={750}>
                  Add a lot range
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Generate consecutive lots, then assign a plan, Reverse and options to each one.
                </Typography>
              </Box>
              <TextField
                label="Lot range"
                placeholder="Example: 9-14"
                value={lotRange}
                onChange={(event) => {
                  setLotRange(event.target.value)
                  if (lotRangeError) setLotRangeError('')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addLotRange()
                  }
                }}
                error={Boolean(lotRangeError)}
                helperText={lotRangeError || 'Start and end lot numbers'}
                sx={{ width: { xs: '100%', sm: 230 } }}
                slotProps={{ htmlInput: { maxLength: 31 } }}
              />
              <Button
                type="button"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={addLotRange}
                disableElevation
                sx={{ minHeight: 56, whiteSpace: 'nowrap' }}
              >
                Add range
              </Button>
            </Stack>
          </Box>

          {!hasPlans && (
            <Alert severity="warning">
              This Job has no plans yet. Add at least one plan from Jobs before creating a phase.
            </Alert>
          )}

          {errors.lots?.root?.message && (
            <Alert severity="error">{errors.lots.root.message}</Alert>
          )}

          <Stack spacing={2}>
            {fields.map((field, index) => (
              <LotEditor
                key={field.id}
                fieldId={field.id}
                index={index}
                job={job}
                control={control}
                register={register}
                errors={errors}
                setValue={setValue}
                remove={remove}
                canRemove={fields.length > 1}
              />
            ))}
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', display: { xs: 'none', sm: 'block' } }}>
          Door Style is intentionally excluded from this version.
        </Typography>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation disabled={!hasPlans}>
          Create phase
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function SequenceSheets() {
  const { jobs, setJobs } = useJobs()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [expandedJobId, setExpandedJobId] = useState(jobs[0]?.id ?? null)
  const [dialogJobId, setDialogJobId] = useState(null)
  const [notice, setNotice] = useState(null)

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return jobs

    return jobs.filter((job) =>
      [job.code, job.builder, job.community]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [jobs, search])

  const totalPhases = jobs.reduce(
    (total, job) => total + getJobPhaseCount(job),
    0,
  )
  const totalAssignedLots = jobs.reduce(
    (total, job) => total + getJobAssignedLotCount(job),
    0,
  )
  const dialogJob = jobs.find((job) => job.id === dialogJobId)
  const detailJob = jobs.find(
    (job) => String(job.id) === searchParams.get('job'),
  )
  const detailPhase = detailJob?.sequenceSheet?.phases?.find(
    (phase) => String(phase.id) === searchParams.get('phase'),
  )

  const openCreate = (event, job) => {
    event.stopPropagation()
    setExpandedJobId(job.id)
    setDialogJobId(job.id)
  }

  const createPhase = (form) => {
    const phaseId = Date.now()
    const phase = {
      id: phaseId,
      name: form.phaseName,
      building: form.building,
      createdAt: new Date().toISOString().slice(0, 10),
      lots: form.lots.map((lot, index) => ({
        ...lot,
        id: phaseId + index + 1,
      })),
    }

    setJobs((current) =>
      current.map((job) =>
        job.id === dialogJobId
          ? {
              ...job,
              sequenceSheet: {
                ...job.sequenceSheet,
                phases: [...(job.sequenceSheet?.phases ?? []), phase],
              },
            }
          : job,
      ),
    )
    setDialogJobId(null)
    setNotice({
      severity: 'success',
      message: `${formatPhase(form.phaseName)} created with ${form.lots.length} lot${form.lots.length === 1 ? '' : 's'}.`,
    })
  }

  if (detailJob && detailPhase) {
    return (
      <PhaseDetails
        job={detailJob}
        phase={detailPhase}
        onBack={() => setSearchParams({}, { replace: true })}
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
        }}
      >
        <Typography variant="h5" fontWeight={750} color="text.primary">
          Sequence Sheets
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Expand a Job to review its phases or create a new Phase by Lot.
        </Typography>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <SummaryCard icon={<FolderRoundedIcon />} value={jobs.length} label="Jobs" />
          <SummaryCard icon={<TableChartRoundedIcon />} value={totalPhases} label="Phases" />
          <SummaryCard icon={<ApartmentRoundedIcon />} value={totalAssignedLots} label="Assigned lots" />
        </Stack>

        <TextField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by Job#, builder or community"
          fullWidth
          sx={{ mb: 2 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon color="action" />
                </InputAdornment>
              ),
            },
          }}
        />

        <Stack spacing={1.5}>
          {filteredJobs.map((job) => {
            const phases = job.sequenceSheet?.phases ?? []
            const isExpanded = expandedJobId === job.id

            return (
              <Accordion
                key={job.id}
                expanded={isExpanded}
                onChange={(_, expanded) => setExpandedJobId(expanded ? job.id : null)}
                disableGutters
                elevation={0}
                sx={{
                  border: 1,
                  borderColor: isExpanded ? 'primary.main' : 'divider',
                  borderRadius: '10px !important',
                  overflow: 'hidden',
                  bgcolor: 'background.paper',
                  '&::before': { display: 'none' },
                }}
              >
                <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }}>
                  <AccordionSummary
                    expandIcon={<ExpandMoreRoundedIcon />}
                    aria-controls={`job-${job.id}-phases`}
                    id={`job-${job.id}-header`}
                    sx={{
                      minHeight: 84,
                      flex: 1,
                      minWidth: 0,
                      '& .MuiAccordionSummary-content': { my: 1.5, minWidth: 0 },
                    }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                      justifyContent="space-between"
                      spacing={1.5}
                      sx={{ width: '100%', pr: 1, minWidth: 0 }}
                    >
                      <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
                        <Box
                          sx={{
                            width: 44,
                            height: 44,
                            flexShrink: 0,
                            borderRadius: 1.5,
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'primary.light',
                            color: 'primary.main',
                          }}
                        >
                          <HomeWorkRoundedIcon />
                        </Box>
                        <Box minWidth={0}>
                          <Typography fontWeight={800}>Job #{job.code}</Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {job.community} · {job.builder}
                          </Typography>
                        </Box>
                      </Stack>

                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip size="small" icon={<FormatListNumberedRoundedIcon />} label={`${getJobPlanCount(job)} plans`} />
                        <Chip size="small" variant="outlined" label={`${phases.length} phases`} />
                      </Stack>
                    </Stack>
                  </AccordionSummary>
                  <Box sx={{ px: { xs: 2, md: 2.5 }, pb: { xs: 2, md: 0 } }}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddRoundedIcon />}
                      onClick={(event) => openCreate(event, job)}
                      disableElevation
                      fullWidth
                    >
                      Create Phase
                    </Button>
                  </Box>
                </Stack>
                <Divider />
                <AccordionDetails id={`job-${job.id}-phases`} sx={{ p: { xs: 2, md: 2.5 } }}>
                  {phases.length > 0 ? (
                    phases.map((phase) => (
                      <PhaseCard
                        key={phase.id}
                        phase={phase}
                        onOpen={() =>
                          setSearchParams({
                            job: String(job.id),
                            phase: String(phase.id),
                          })
                        }
                      />
                    ))
                  ) : (
                    <Box
                      sx={{
                        py: 4,
                        px: 2,
                        textAlign: 'center',
                        border: 1,
                        borderStyle: 'dashed',
                        borderColor: 'divider',
                        borderRadius: 2,
                      }}
                    >
                      <TableChartRoundedIcon color="disabled" sx={{ fontSize: 38, mb: 1 }} />
                      <Typography fontWeight={700}>No phases created yet</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                        Create the first phase and assign its lots to this Job&apos;s plans.
                      </Typography>
                      <Button
                        variant="outlined"
                        startIcon={<AddRoundedIcon />}
                        onClick={(event) => openCreate(event, job)}
                      >
                        Create Phase
                      </Button>
                    </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            )
          })}
        </Stack>

        {filteredJobs.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography fontWeight={700}>No Jobs match your search.</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Try another Job number, builder or community.
            </Typography>
          </Box>
        )}
      </Box>

      {dialogJob && (
        <CreatePhaseDialog
          job={dialogJob}
          onClose={() => setDialogJobId(null)}
          onCreate={createPhase}
        />
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {notice ? (
          <Alert severity={notice.severity} onClose={() => setNotice(null)} variant="filled">
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  )
}
