import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Snackbar,
  Skeleton,
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
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import ClearRoundedIcon from '@mui/icons-material/ClearRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import {
  CatalogEmptyState,
  CatalogPageHeader,
  FigureStrip,
  RowActionsMenu,
  StatusChip,
  catalogTableSx,
} from '../../../components/common/CatalogPage'
import { useBuilderDrawSchedules } from '../../builder-draw-schedules/context/useBuilderDrawSchedules.js'
import { isStoredString, usePersistentState } from '../../../hooks/usePersistentState.js'
import {
  filterJobsByScope,
  resolveJobScope,
} from '../../jobs/utils/jobScopeFilters.js'
import PhaseCalendarChip from '../../calendar/components/PhaseCalendarChip.jsx'
import { calendarSchedulePath } from '../../calendar/utils/calendarRoutes.js'
import { useProductionActivities } from '../../calendar/context/useProductionActivities.js'
import { usePhaseCalendarCoverage } from '../../calendar/hooks/usePhaseCalendarCoverage.js'
import JobModuleNavigation from '../../jobs/components/JobModuleNavigation.jsx'
import { useJobs } from '../../jobs/context/useJobs.js'
import {
  getJobAssignedLotCount,
  getJobPhaseCount,
  getJobPlanCount,
} from '../../jobs/data/jobs.js'
import {
  builderJobsPath,
  getJobBuilderId,
  jobBelongsToBuilder,
  jobPlansOptionsPath,
  jobSequenceSheetPath,
} from '../../jobs/utils/jobRoutes.js'
import { createPhaseByLotSchema } from '../schemas/phaseByLotSchema.js'
import {
  formatBuilding,
  formatPhase,
  formatPhaseBuilding,
} from '../utils/phaseBuildingCodes.js'
import { parseLotRange } from '../utils/lotRange.js'
import PhasesTable from './PhasesTable.jsx'
import LotOptionPicker from './LotOptionPicker.jsx'
import { getPhaseRowCounts, getSelectedOptionCount } from '../utils/phaseCounts.js'
import SequenceSheetEmailDialog from './SequenceSheetEmailDialog.jsx'
import OptionsChangeEmailDialog from '../../purchase-orders/components/OptionsChangeEmailDialog.jsx'
import { describeSequenceSheetEmailsSent } from '../services/sequenceSheetEmailRecord.js'
import { removedOptionChanges } from '../services/sequenceSheetRecord.js'

const emptyLot = {
  lotNumber: '',
  utilityName: '',
  planId: '',
  reverse: false,
  optionIds: [],
  isUtilityBuilding: false,
}

const emptyUtilityRow = {
  ...emptyLot,
  isUtilityBuilding: true,
}

function getPlan(job, planId) {
  return (job.sequenceSheet?.plans ?? []).find(
    (plan) => plan.id === Number(planId),
  )
}

function PhaseDetails({
  builderId,
  calendarStatus,
  canManage,
  canSchedule,
  job,
  phase,
  onDelete,
  onEdit,
  onEmail,
  onSchedule,
}) {
  const phaseLabel = formatPhase(phase.name)
  const buildingLabel = formatBuilding(phase.building)
  const selectedOptionCount = getSelectedOptionCount(phase)
  const rowCounts = getPhaseRowCounts(phase)

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <CatalogPageHeader
        borderless
        breadcrumbs={[
          { label: 'Jobs', to: '/jobs' },
          { label: job.builder, to: builderJobsPath(builderId) },
          { label: `Job ${job.code}`, to: jobPlansOptionsPath(builderId, job.id) },
          { label: 'Sequence sheet', to: jobSequenceSheetPath(builderId, job.id) },
          { label: phaseLabel },
        ]}
        title={phaseLabel}
        titleAdornment={<PhaseCalendarChip status={calendarStatus} size="medium" />}
        subtitle={[buildingLabel, job.community, job.builder].filter(Boolean).join(' · ')}
        meta={(
          <FigureStrip
            label={`${phaseLabel} summary`}
            figures={[
              { label: rowCounts.lots === 1 ? 'lot' : 'lots', value: rowCounts.lots },
              ...(rowCounts.utility > 0
                ? [{
                  label: rowCounts.utility === 1 ? 'utility row' : 'utility rows',
                  value: rowCounts.utility,
                }]
                : []),
              {
                label: selectedOptionCount === 1 ? 'selected option' : 'selected options',
                value: selectedOptionCount,
              },
            ]}
          />
        )}
        actions={canManage && (
          <>
            <Button
              variant="contained"
              startIcon={<EmailRoundedIcon />}
              onClick={onEmail}
              disableElevation
            >
              Email sequence sheet
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<EditOutlinedIcon />}
              onClick={onEdit}
            >
              Edit phase
            </Button>
            <RowActionsMenu
              label={`More actions for ${phaseLabel}`}
              items={[
                {
                  label: 'Delete phase',
                  icon: <DeleteOutlineRoundedIcon fontSize="small" />,
                  color: 'error.main',
                  onClick: onDelete,
                },
              ]}
            />
          </>
        )}
      />

      <JobModuleNavigation
        active="sequence-sheet"
        builderId={builderId}
        jobId={job.id}
        showBack={false}
      />

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        {calendarStatus === 'unscheduled' && (
          <Alert
            severity="warning"
            sx={{ mb: 2.5 }}
            action={canSchedule ? (
              <Button color="inherit" size="small" onClick={onSchedule}>
                Schedule in Calendar
              </Button>
            ) : undefined}
          >
            This Phase has no EXT, DM or HW events in the Calendar yet. Package
            Suggestions only appear for Phases with Calendar work.
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
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Typography component="h2" variant="subtitle1" fontWeight={700}>
              Phase assignments
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Lots and Utility rows keep their orientation. Utility rows use only one Plan Price.
            </Typography>
          </Box>
          <TableContainer>
            <Table
              size="small"
              aria-label={`${phaseLabel} lot and Utility assignments`}
              sx={[{ minWidth: 700 }, catalogTableSx]}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Lot / Utility</TableCell>
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
                      <TableCell sx={{ width: 110 }}>
                        <Typography variant="body2" fontWeight={700}>
                          {lot.isUtilityBuilding
                            ? lot.utilityName
                            : lot.lotNumber}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ minWidth: 160 }}>
                        {plan ? (
                          <Typography variant="body2">{plan.code}</Typography>
                        ) : (
                          <Typography variant="body2" color="error">Plan unavailable</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center" sx={{ width: 100 }}>
                        {lot.reverse ? (
                          <Chip size="small" color="primary" label="Reverse" />
                        ) : (
                          <Typography variant="body2" color="text.disabled">No</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ minWidth: 320 }}>
                        {lot.isUtilityBuilding ? (
                          <Typography variant="body2" color="text.secondary">Plan only</Typography>
                        ) : options.length > 0 ? (
                          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
                          <Typography variant="body2" color="text.disabled">
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
        </Box>
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
        sx={{
          px: 2,
          py: 1.25,
          bgcolor: 'action.hover',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'flex-start' } }}
        >
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
          {!selectedPlan || planOptions.length === 0 ? (
            <>
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
                <Typography variant="body2" color="text.secondary">
                  {!selectedPlan
                    ? 'Choose a plan first.'
                    : 'This plan does not have options configured yet.'}
                </Typography>
              </Box>
            </>
          ) : (
            <Controller
              key={`${fieldId}-${selectedPlan.id}`}
              name={`lots.${index}.optionIds`}
              control={control}
              render={({ field }) => (
                <LotOptionPicker
                  options={planOptions}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  error={Boolean(optionError)}
                />
              )}
            />
          )}
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

function UtilityRowEditor({ index, job, control, register, errors, remove, canRemove }) {
  const utilityName = useWatch({ control, name: `lots.${index}.utilityName` })
  const displayName = utilityName?.trim() || 'Utility Building'

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
        sx={{
          px: 2,
          py: 1.25,
          bgcolor: 'action.hover',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="subtitle2" fontWeight={750}>
          {displayName}
        </Typography>
        <Tooltip title={canRemove ? 'Remove Utility row' : 'A Phase needs at least one row'}>
          <span>
            <IconButton
              size="small"
              color="error"
              disabled={!canRemove}
              onClick={() => remove(index)}
              aria-label={`Remove ${displayName}`}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ p: 2, alignItems: { md: 'flex-start' } }}
      >
        <TextField
          fullWidth
          label="Utility name"
          placeholder="Example: B1"
          {...register(`lots.${index}.utilityName`)}
          error={Boolean(errors.lots?.[index]?.utilityName)}
          helperText={errors.lots?.[index]?.utilityName?.message ?? 'This name appears on the Sequence Sheet and Draw Packages.'}
          slotProps={{ htmlInput: { maxLength: 80 } }}
        />
        <Controller
          name={`lots.${index}.planId`}
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              select
              fullWidth
              label="Plan"
              sx={{ minWidth: { md: 280 } }}
              error={Boolean(errors.lots?.[index]?.planId)}
              helperText={
                errors.lots?.[index]?.planId?.message
                ?? 'The full Plan Price will be charged on the selected Draw.'
              }
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
    </Box>
  )
}

function PhaseDialog({
  job,
  phase,
  utilityBuildingEnabled,
  utilityBuildingRequired,
  onClose,
  onSave,
}) {
  const [lotRange, setLotRange] = useState('')
  const [lotRangeError, setLotRangeError] = useState('')
  const schema = useMemo(
    () => createPhaseByLotSchema(job, phase?.id, utilityBuildingRequired),
    [job, phase?.id, utilityBuildingRequired],
  )
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: phase
      ? {
          phaseName: phase.name,
          building: phase.building,
          lots: (phase.lots ?? []).map((lot) => ({
            id: lot.id,
            lotNumber: lot.lotNumber,
            utilityName: lot.utilityName ?? '',
            planId: lot.planId,
            reverse: lot.reverse ?? false,
            optionIds: [...(lot.optionIds ?? [])],
            isUtilityBuilding: Boolean(lot.isUtilityBuilding),
          })),
        }
      : {
          phaseName: '',
          building: '',
          lots: utilityBuildingRequired
            ? [{ ...emptyLot }, { ...emptyUtilityRow }]
            : [{ ...emptyLot }],
        },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'lots',
    keyName: 'fieldKey',
  })
  const hasPlans = (job.sequenceSheet?.plans?.length ?? 0) > 0

  const addLotRange = () => {
    const currentLots = getValues('lots') ?? []
    const ordinaryLots = currentLots.filter((lot) => !lot.isUtilityBuilding)
    const initialEmptyLot = ordinaryLots.length === 1 ? ordinaryLots[0] : null
    const hasReplaceableInitialLot = Boolean(
      initialEmptyLot
      && !initialEmptyLot.lotNumber?.trim()
      && !initialEmptyLot.planId
      && !initialEmptyLot.reverse
      && (initialEmptyLot.optionIds?.length ?? 0) === 0,
    )
    const initialEmptyLotIndex = hasReplaceableInitialLot
      ? currentLots.indexOf(initialEmptyLot)
      : -1
    const remainingLotCapacity = hasReplaceableInitialLot
      ? Math.max(500 - currentLots.length + 1, 0)
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
        .filter((lot) => !lot.isUtilityBuilding)
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

    if (hasReplaceableInitialLot) {
      replace(currentLots.flatMap((lot, index) =>
        index === initialEmptyLotIndex ? generatedLots : [lot]))
    } else {
      append(generatedLots)
    }

    setLotRange('')
    setLotRangeError('')
  }

  return (
    <Dialog
      open
      onClose={isSubmitting ? undefined : onClose}
      fullWidth
      maxWidth="lg"
      component="form"
      onSubmit={handleSubmit(onSave)}
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
          {phase ? `Edit ${formatPhase(phase.name)}` : 'Create Phase'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {phase
            ? `Update its Lot and Utility Building assignments for Job #${job.code}.`
            : `Add Lots and, when enabled, Utility Building rows to Job #${job.code}.`}
        </Typography>
        <IconButton
          onClick={onClose}
          disabled={isSubmitting}
          aria-label={phase ? 'Close edit phase dialog' : 'Close create phase dialog'}
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
              spacing={2}
              sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
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
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'flex-start' } }}
              >
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
                    htmlInput: { maxLength: 40 },
                  }}
                />
                <TextField
                  label="Building number / code (optional)"
                  placeholder="Example: 3 or C5"
                  {...register('building')}
                  error={Boolean(errors.building)}
                  helperText={errors.building?.message ?? 'Only the number or code. Leave empty if this phase has no building.'}
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
                {utilityBuildingEnabled && (
                  <Button
                    type="button"
                    variant="outlined"
                    color="primary"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => append({ ...emptyUtilityRow })}
                    sx={{ minHeight: 56, whiteSpace: 'nowrap' }}
                  >
                    Add Utility
                  </Button>
                )}
              </Stack>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ alignItems: { sm: 'flex-start' } }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" fontWeight={750}>
                  Add lot ranges
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Separate multiple ranges with commas, then assign a plan, Reverse and options to each lot.
                </Typography>
              </Box>
              <TextField
                label="Lot ranges"
                placeholder="Example: 9-14, 20-25"
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
                helperText={lotRangeError || 'Separate ranges with commas'}
                sx={{ width: { xs: '100%', sm: 280 } }}
                slotProps={{ htmlInput: { maxLength: 255 } }}
              />
              <Button
                type="button"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={addLotRange}
                disableElevation
                sx={{ minHeight: 56, whiteSpace: 'nowrap' }}
              >
                Add ranges
              </Button>
            </Stack>
            {utilityBuildingEnabled && (
              <Alert severity="info" sx={{ mt: 2 }}>
                {utilityBuildingRequired
                  ? 'Utility Building is active for this Job. Every Phase must include at least one named Utility row with a Plan; Reverse is optional.'
                  : 'Utility rows use only the full Plan Price and may be marked Reverse. They do not count as Lots or appear in Lot ranges, and cannot include Options or Hardware.'}
              </Alert>
            )}
          </Box>

          {!hasPlans && (
            <Alert severity="warning">
              This Job has no plans yet. Add at least one plan from Jobs before saving a phase.
            </Alert>
          )}

          {(errors.lots?.message || errors.lots?.root?.message) && (
            <Alert severity="error">
              {errors.lots.message ?? errors.lots.root.message}
            </Alert>
          )}

          <Stack spacing={2}>
            {fields.map((field, index) => field.isUtilityBuilding ? (
              <UtilityRowEditor
                key={field.fieldKey}
                index={index}
                job={job}
                control={control}
                register={register}
                errors={errors}
                remove={remove}
                canRemove={fields.length > 1}
              />
            ) : (
              <LotEditor
                key={field.fieldKey}
                fieldId={field.fieldKey}
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
        <Button color="inherit" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disableElevation
          disabled={!hasPlans || isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {isSubmitting ? 'Saving…' : phase ? 'Save changes' : 'Create phase'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function PhaseDeleteDialog({ busy, target, onClose, onDelete }) {
  const rowCounts = getPhaseRowCounts(target?.phase)
  const selectedOptionCount = (target?.phase.lots ?? []).reduce(
    (total, lot) => total + (lot.optionIds?.length ?? 0),
    0,
  )

  return (
    <Dialog
      open={Boolean(target)}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>
        Delete {target ? formatPhaseBuilding(target.phase.name, target.phase.building) : 'phase'}?
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="warning">
            This will remove this Phase from the active Sequence Sheet, including {rowCounts.lots}{' '}
            {rowCounts.lots === 1 ? 'lot assignment' : 'lot assignments'}
            {rowCounts.utility > 0
              ? ` and ${rowCounts.utility} Utility ${rowCounts.utility === 1 ? 'row' : 'rows'}`
              : ''}
            {selectedOptionCount > 0
              ? `, including ${selectedOptionCount} selected ${selectedOptionCount === 1 ? 'option' : 'options'}`
              : ''}. Cancelled Calendar history will remain archived for audit.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            The Job Total Lots will be recalculated from ordinary Lots only;
            Utility rows never affect that count.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          onClick={onDelete}
          disableElevation
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {busy ? 'Deleting…' : 'Delete phase'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function NoticeSnackbar({ notice, onClose }) {
  return (
    <Snackbar
      open={Boolean(notice)}
      autoHideDuration={4000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {notice ? (
        <Alert severity={notice.severity} onClose={onClose} variant="filled">
          {notice.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  )
}

export default function SequenceSheets() {
  const navigate = useNavigate()
  const { builderId, jobId, phaseId } = useParams()
  const {
    jobs,
    loading,
    error,
    canManageJobs,
    refreshJobs,
    saveSequenceSheetPhase,
    deactivateSequenceSheetPhase,
  } = useJobs()
  const { jobBillingSetupVersions } = useBuilderDrawSchedules()
  const { canManageProductionActivities } = useProductionActivities()
  const calendarCoverage = usePhaseCalendarCoverage()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = usePersistentState('sequence-sheets:search', '', isStoredString)
  const [storedBuilderId, setStoredBuilderId] = usePersistentState('sequence-sheets:builder', 'ALL', isStoredString)
  const [storedCommunity, setStoredCommunity] = usePersistentState('sequence-sheets:community', 'ALL', isStoredString)
  const [expandedJobId, setExpandedJobId] = useState(jobs[0]?.id ?? null)
  const [dialogJobId, setDialogJobId] = useState(null)
  const [dialogPhaseId, setDialogPhaseId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [emailTarget, setEmailTarget] = useState(null)
  // After an edit took options out of a Lot: the email that offers to tell Purchasing
  // and the Job Coordinator (null = closed).
  const [removalEmail, setRemovalEmail] = useState(null)
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
  const canManageFocusedJob = canManageJobs && Boolean(focusedJob?.isActive)

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
    if (!canManageJobs || !job.isActive) return
    setExpandedJobId(job.id)
    setDialogJobId(job.id)
    setDialogPhaseId(null)
  }

  const openEdit = (job, phase) => {
    if (!canManageJobs || !job.isActive) return
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
    if (!canManageJobs || !job.isActive) return
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
      // The people who order and coordinate the options should know when one is taken out.
      if (isEditing && savedJob) {
        const changes = removedOptionChanges(dialogPhase, form)
        if (changes.length > 0) setRemovalEmail({ job: savedJob, changes })
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
        {removalEmail && (
          <OptionsChangeEmailDialog
            kind="removed"
            job={removalEmail.job}
            changes={removalEmail.changes}
            onClose={() => setRemovalEmail(null)}
            onSent={(message) => {
              setRemovalEmail(null)
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
    const canManageJob = canManageJobs && job.isActive

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
                      {canManageJobs && job.isActive && (
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
      {removalEmail && (
        <OptionsChangeEmailDialog
          kind="removed"
          job={removalEmail.job}
          changes={removalEmail.changes}
          onClose={() => setRemovalEmail(null)}
          onSent={(message) => {
            setRemovalEmail(null)
            setNotice({ severity: 'success', message })
          }}
        />
      )}
      <NoticeSnackbar notice={notice} onClose={() => setNotice(null)} />
    </Box>
  )
}
