import { useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { initialBuilders } from '../../builders/data/builders.js'
import {
  defaultDraws,
  defaultBillingSettings,
  frequencyLabels,
  frequencyOptions,
  invoiceDateOptions,
  invoiceLineFormatLabels,
  invoiceLineFormatOptions,
  MAX_DRAW_COUNT,
  MIN_DRAW_COUNT,
  weekdayOptions,
  workAcceptedOptions,
} from '../data/builderDrawSchedules.js'
import { createBuilderDrawScheduleSchema } from '../schemas/builderDrawScheduleSchema.js'
import {
  computeDrawPeriods,
  describeSchedule,
  formatPeriodDate,
} from '../utils/drawPeriods.js'
import { useBuilderDrawSchedules } from '../context/useBuilderDrawSchedules.js'

const sectionSx = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'text.secondary',
}

function formatPercentage(value) {
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function getBuilderInitials(builder) {
  const words = builder.name.trim().split(/\s+/)
  return words.length > 1
    ? `${words[0][0]}${words[1][0]}`.toUpperCase()
    : builder.name.slice(0, 2).toUpperCase()
}

function getDrawTotal(draws) {
  return draws.reduce(
    (total, draw) => total + (Number(draw.percentage) || 0),
    0,
  )
}

function requiredDocuments(setup) {
  return [
    setup.requiresPo && 'PO',
    setup.requiresPaymentSchedule && 'Payment schedule',
    setup.requiresRelease && 'Release',
    setup.requiresBackup && 'Backup',
  ].filter(Boolean)
}

function SchedulePreview({ control }) {
  const values = useWatch({ control })
  const periods = useMemo(
    () => computeDrawPeriods(
      {
        ...values,
        cutoffDay: Number(values.cutoffDay) || 1,
        submissionDay: Number(values.submissionDay) || 1,
        cutoffWeekday: Number(values.cutoffWeekday) || 0,
        cutoffDays: (values.cutoffDays ?? []).map(Number).filter(Boolean),
        submissionOffsetDays: Number(values.submissionOffsetDays) || 0,
        paymentTermsDays: Number(values.paymentTermsDays) || 0,
      },
      3,
    ),
    [values],
  )

  return (
    <Box sx={{ bgcolor: 'primary.light', borderRadius: 2, p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
        <CalendarMonthRoundedIcon fontSize="small" sx={{ color: 'primary.main' }} />
        <Typography variant="body2" fontWeight={700} color="primary.main">
          Next billing periods
        </Typography>
      </Stack>
      <Stack spacing={0.75}>
        {periods.map((period) => (
          <Stack
            key={period.key}
            direction="row"
            spacing={1}
            sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
          >
            <Typography variant="caption" color="text.secondary">
              Cutoff {formatPeriodDate(period.cutoffDate)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Due {formatPeriodDate(period.submissionDate)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Invoice {formatPeriodDate(period.invoiceDate)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Pay ~{formatPeriodDate(period.estimatedPaymentDate)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

function BuilderDrawScheduleDialog({
  schedule,
  schedules,
  builders,
  onClose,
  onSave,
}) {
  const schema = useMemo(
    () => createBuilderDrawScheduleSchema(schedules, schedule?.id),
    [schedule?.id, schedules],
  )
  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: schedule
      ? {
          ...schedule,
          optionsBillingDrawIndex: schedule.optionsBillingDrawIndex ?? null,
          draws: schedule.draws.map((draw) => ({ ...draw })),
          cutoffDays: [...schedule.cutoffDays],
        }
      : {
          builderId: '',
          draws: defaultDraws.map((draw) => ({ ...draw })),
          ...defaultBillingSettings,
          cutoffDays: [...defaultBillingSettings.cutoffDays],
        },
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'draws',
    keyName: 'fieldKey',
  })
  const selectedBuilderId = useWatch({ control, name: 'builderId' })
  const watchedDraws = useWatch({ control, name: 'draws' }) ?? []
  const separateHardwarePrice = useWatch({
    control,
    name: 'separateHardwarePrice',
  })
  const optionsBillingDrawIndex = useWatch({
    control,
    name: 'optionsBillingDrawIndex',
  })
  const frequency = useWatch({ control, name: 'frequency' })
  const retentionEnabled = useWatch({ control, name: 'retentionEnabled' })
  const ocipWrapEnabled = useWatch({ control, name: 'ocipWrapEnabled' })
  const total = getDrawTotal(watchedDraws)
  const totalIsValid = Math.abs(total - 100) <= 0.001
  const percentagesAreValid =
    watchedDraws.length >= MIN_DRAW_COUNT &&
    watchedDraws.length <= MAX_DRAW_COUNT &&
    watchedDraws.every((draw) => {
      const percentage = Number(draw.percentage)
      return percentage > 0 && percentage <= 100
    })
  const canSave = Boolean(selectedBuilderId) && totalIsValid && percentagesAreValid
  const availableBuilders = builders.filter(
    (builder) =>
      builder.id === schedule?.builderId ||
      (builder.isActive &&
        !schedules.some(
          (item) =>
            item.id !== schedule?.id && item.builderId === builder.id,
        )),
  )
  const drawsError = errors.draws?.message ?? errors.draws?.root?.message

  const handleRemoveDraw = (drawIndex) => {
    const configuredDrawIndex = optionsBillingDrawIndex == null
      ? null
      : Number(optionsBillingDrawIndex)

    if (configuredDrawIndex === drawIndex) {
      setValue('optionsBillingDrawIndex', null, {
        shouldDirty: true,
        shouldValidate: true,
      })
    } else if (configuredDrawIndex > drawIndex) {
      setValue('optionsBillingDrawIndex', configuredDrawIndex - 1, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }

    remove(drawIndex)
  }

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
        <Typography variant="h6" component="div" fontWeight={750}>
          {schedule ? 'Edit builder setup' : 'New builder setup'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Configure draw allocation, billing rules and submission requirements in
          one setup for this builder.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={3}>
          <Controller
            name="builderId"
            control={control}
            render={({ field }) => (
              <TextField
                select
                label="Builder"
                value={field.value}
                onChange={(event) => field.onChange(Number(event.target.value))}
                onBlur={field.onBlur}
                inputRef={field.ref}
                disabled={Boolean(schedule)}
                error={Boolean(errors.builderId)}
                helperText={
                  errors.builderId?.message ??
                  (schedule
                    ? 'The builder cannot be changed after creation.'
                    : 'Only active builders without a schedule are available.')
                }
                fullWidth
              >
                {availableBuilders.map((builder) => (
                  <MenuItem key={builder.id} value={builder.id}>
                    {builder.name} ({builder.code})
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          {availableBuilders.length === 0 && !schedule && (
            <Alert severity="info">
              Every active builder already has a billing and draw setup.
            </Alert>
          )}

          <Divider textAlign="left">
            <Typography sx={sectionSx}>Draw allocation</Typography>
          </Divider>

          <Box>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
            >
              <Box>
                <Typography variant="subtitle2" fontWeight={750}>
                  Draw allocation
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Draw numbers follow their order. Add an optional name for each one.
                </Typography>
              </Box>
              <Chip
                size="small"
                label={`${fields.length} ${fields.length === 1 ? 'draw' : 'draws'}`}
                variant="outlined"
              />
            </Stack>

            <Stack spacing={1.25}>
              {fields.map((field, index) => (
                <Stack
                  key={field.fieldKey}
                  direction="row"
                  spacing={1.25}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <Avatar
                    sx={{
                      width: 32,
                      height: 32,
                      mt: 1.5,
                      bgcolor: 'primary.light',
                      color: 'primary.main',
                      fontSize: 13,
                      fontWeight: 750,
                    }}
                  >
                    {index + 1}
                  </Avatar>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.25}
                    sx={{ flex: 1, minWidth: 0 }}
                  >
                    <TextField
                      label={`Draw ${index + 1} name`}
                      placeholder="Example: Trim Complete"
                      {...register(`draws.${index}.name`)}
                      error={Boolean(errors.draws?.[index]?.name)}
                      helperText={
                        errors.draws?.[index]?.name?.message
                        ?? `Displayed as Draw ${index + 1} (name)`
                      }
                      fullWidth
                    />
                    <TextField
                      label="Percentage"
                      type="number"
                      {...register(`draws.${index}.percentage`)}
                      error={Boolean(errors.draws?.[index]?.percentage)}
                      helperText={errors.draws?.[index]?.percentage?.message ?? ' '}
                      sx={{ width: { xs: '100%', sm: 180 }, flexShrink: 0 }}
                      slotProps={{
                        input: {
                          endAdornment: <InputAdornment position="end">%</InputAdornment>,
                        },
                        htmlInput: {
                          min: 1,
                          max: 100,
                          step: 0.01,
                          inputMode: 'decimal',
                        },
                      }}
                    />
                  </Stack>
                  {fields.length > MIN_DRAW_COUNT && (
                    <IconButton
                      aria-label={`Remove Draw ${index + 1}`}
                      color="error"
                      onClick={() => handleRemoveDraw(index)}
                      sx={{ mt: 1.25 }}
                    >
                      <DeleteOutlineRoundedIcon />
                    </IconButton>
                  )}
                </Stack>
              ))}
            </Stack>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ mt: 0.5, alignItems: { sm: 'center' } }}
            >
              <Button
                type="button"
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                disabled={fields.length >= MAX_DRAW_COUNT}
                onClick={() => append({ name: '', percentage: 0 })}
              >
                Add draw
              </Button>
              <Button
                type="button"
                variant={separateHardwarePrice ? 'contained' : 'outlined'}
                color={separateHardwarePrice ? 'primary' : 'inherit'}
                startIcon={<ConstructionRoundedIcon />}
                onClick={() => setValue(
                  'separateHardwarePrice',
                  !separateHardwarePrice,
                  { shouldDirty: true, shouldValidate: true },
                )}
                disableElevation
              >
                Separate Hardware Price
              </Button>
            </Stack>

            {separateHardwarePrice && (
              <Alert severity="info" sx={{ mt: 1.25 }}>
                Draws will allocate 100% of the plan price excluding hardware.
                Hardware will be billed separately at 100%.
              </Alert>
            )}

            <Controller
              name="optionsBillingDrawIndex"
              control={control}
              render={({ field }) => (
                <TextField
                  select
                  label="Options billing draw"
                  value={field.value ?? ''}
                  onChange={(event) => field.onChange(
                    event.target.value === '' ? null : Number(event.target.value),
                  )}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  error={Boolean(errors.optionsBillingDrawIndex)}
                  helperText={
                    errors.optionsBillingDrawIndex?.message
                    ?? 'Selected lot options are added when this draw is included in a package.'
                  }
                  fullWidth
                  sx={{ mt: 1.5 }}
                >
                  <MenuItem value="">Do not bill options in a draw</MenuItem>
                  {watchedDraws.map((draw, index) => (
                    <MenuItem key={`options-draw-${index + 1}`} value={index}>
                      Draw {index + 1}
                      {draw.name?.trim() ? ` · ${draw.name.trim()}` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Box>

          <Box  
            sx={{
              p: 2,
              border: 1,
              borderColor: totalIsValid ? 'success.main' : 'warning.main',
              borderRadius: 2,
              bgcolor: 'background.default',
            }}
          >
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
              <Box>
                <Typography variant="subtitle2" fontWeight={750}>
                  Total allocation
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {totalIsValid
                    ? 'Ready to save'
                    : total < 100
                      ? `${formatPercentage(100 - total)}% remaining`
                      : `${formatPercentage(total - 100)}% over the limit`}
                </Typography>
              </Box>
              <Typography
                variant="h6"
                color={totalIsValid ? 'success.main' : 'warning.main'}
                fontWeight={800}
              >
                {formatPercentage(total)}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={Math.min(Math.max(total, 0), 100)}
              color={totalIsValid ? 'success' : 'warning'}
              sx={{ height: 7, borderRadius: 999 }}
            />
            {drawsError && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                {drawsError}
              </Typography>
            )}
          </Box>

          <Divider textAlign="left">
            <Typography sx={sectionSx}>Billing cycle</Typography>
          </Divider>

          <Controller
            name="frequency"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth>
                <InputLabel id="setup-frequency-label">Frequency</InputLabel>
                <Select
                  {...field}
                  labelId="setup-frequency-label"
                  label="Frequency"
                >
                  {frequencyOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />

          {frequency === 'MONTHLY' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Cutoff day"
                type="number"
                {...register('cutoffDay')}
                error={Boolean(errors.cutoffDay)}
                helperText={errors.cutoffDay?.message ?? 'Day of the month'}
                fullWidth
                slotProps={{ htmlInput: { min: 1, max: 31, step: 1 } }}
              />
              <TextField
                label="Submission due day"
                type="number"
                {...register('submissionDay')}
                error={Boolean(errors.submissionDay)}
                helperText={errors.submissionDay?.message ?? 'Day of the month'}
                fullWidth
                slotProps={{ htmlInput: { min: 1, max: 31, step: 1 } }}
              />
            </Stack>
          )}

          {frequency === 'SEMIMONTHLY' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="First cutoff day"
                type="number"
                {...register('cutoffDays.0')}
                error={Boolean(errors.cutoffDays)}
                helperText={errors.cutoffDays?.message ?? 'Day of the month'}
                fullWidth
                slotProps={{ htmlInput: { min: 1, max: 31, step: 1 } }}
              />
              <TextField
                label="Second cutoff day"
                type="number"
                {...register('cutoffDays.1')}
                error={Boolean(errors.cutoffDays)}
                helperText="Day of the month"
                fullWidth
                slotProps={{ htmlInput: { min: 1, max: 31, step: 1 } }}
              />
            </Stack>
          )}

          {frequency === 'WEEKLY' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="cutoffWeekday"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth>
                    <InputLabel id="setup-weekday-label">Cutoff weekday</InputLabel>
                    <Select
                      {...field}
                      labelId="setup-weekday-label"
                      label="Cutoff weekday"
                    >
                      {weekdayOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
              
            </Stack>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Controller
              name="workAcceptedThrough"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="setup-accepted-label">Work accepted through</InputLabel>
                  <Select
                    {...field}
                    labelId="setup-accepted-label"
                    label="Work accepted through"
                  >
                    {workAcceptedOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />
            <Controller
              name="invoiceDateRule"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="setup-invoice-date-label">Invoice date</InputLabel>
                  <Select
                    {...field}
                    labelId="setup-invoice-date-label"
                    label="Invoice date"
                  >
                    {invoiceDateOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />
          </Stack>

          <SchedulePreview control={control} />

          <Divider textAlign="left">
            <Typography sx={sectionSx}>Payment</Typography>
          </Divider>

          <TextField
            label="Payment terms"
            type="number"
            {...register('paymentTermsDays')}
            error={Boolean(errors.paymentTermsDays)}
            helperText={errors.paymentTermsDays?.message ?? 'Days after the invoice date'}
            fullWidth
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">days</InputAdornment> },
              htmlInput: { min: 0, max: 180, step: 1 },
            }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{ width: '100%' }}>
              <Controller
                name="retentionEnabled"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    label="Apply retention"
                    control={(
                      <Checkbox
                        checked={Boolean(field.value)}
                        onChange={(_, checked) => field.onChange(checked)}
                      />
                    )}
                  />
                )}
              />
              {retentionEnabled && (
                <TextField
                  label="Retention percentage"
                  type="number"
                  {...register('retentionPercentage')}
                  error={Boolean(errors.retentionPercentage)}
                  helperText={
                    errors.retentionPercentage?.message
                    ?? 'Percentage deducted after draws total 100%.'
                  }
                  fullWidth
                  required
                  sx={{ mt: 1 }}
                  slotProps={{
                    input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                    htmlInput: { min: 1, max: 100, step: 0.01, inputMode: 'decimal' },
                  }}
                />
              )}
            </Box>

            <Box sx={{ width: '100%' }}>
              <Controller
                name="ocipWrapEnabled"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    label="Apply OCIP / WRAP insurance"
                    control={(
                      <Checkbox
                        checked={Boolean(field.value)}
                        onChange={(_, checked) => field.onChange(checked)}
                      />
                    )}
                  />
                )}
              />
              {ocipWrapEnabled && (
                <TextField
                  label="OCIP / WRAP insurance percentage"
                  type="number"
                  {...register('ocipWrapPercentage')}
                  error={Boolean(errors.ocipWrapPercentage)}
                  helperText={
                    errors.ocipWrapPercentage?.message
                    ?? 'Insurance percentage deducted by the builder.'
                  }
                  fullWidth
                  required
                  sx={{ mt: 1 }}
                  slotProps={{
                    input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                    htmlInput: { min: 1, max: 100, step: 0.01, inputMode: 'decimal' },
                  }}
                />
              )}
            </Box>
          </Stack>

          <Divider textAlign="left">
            <Typography sx={sectionSx}>Required to submit</Typography>
          </Divider>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            }}
          >
            {[
              ['requiresPo', 'Purchase order'],
              ['requiresPaymentSchedule', 'Payment schedule'],
              ['requiresRelease', 'Release'],
              ['requiresBackup', 'Backup documentation'],
            ].map(([name, label]) => (
              <Controller
                key={name}
                name={name}
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    label={label}
                    control={(
                      <Checkbox
                        checked={Boolean(field.value)}
                        onChange={(_, checked) => field.onChange(checked)}
                      />
                    )}
                  />
                )}
              />
            ))}
          </Box>

          <Divider textAlign="left">
            <Typography sx={sectionSx}>Submission</Typography>
          </Divider>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Portal"
              {...register('portalName')}
              error={Boolean(errors.portalName)}
              helperText={errors.portalName?.message ?? 'Optional'}
              fullWidth
            />
            <Controller
              name="invoiceLineFormat"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth>
                  <InputLabel id="setup-line-format-label">Invoice line format</InputLabel>
                  <Select
                    {...field}
                    labelId="setup-line-format-label"
                    label="Invoice line format"
                  >
                    {invoiceLineFormatOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            />
          </Stack>

          <TextField
            label="Notes"
            {...register('notes')}
            error={Boolean(errors.notes)}
            helperText={errors.notes?.message ?? 'Optional billing instructions'}
            fullWidth
            multiline
            minRows={2}
          />

        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation disabled={!canSave}>
          {schedule ? 'Save changes' : 'Create setup'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function BuilderDrawScheduleCard({ schedule, builder, onEdit, onDelete }) {
  const total = getDrawTotal(schedule.draws)

  return (
    <Card
      variant="outlined"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', p: 2, pb: 1.75 }}
      >
        <Avatar
          variant="rounded"
          sx={{
            width: 42,
            height: 42,
            bgcolor: 'primary.light',
            color: 'primary.main',
            fontSize: 13,
            fontWeight: 800,
          }}
        >
          {getBuilderInitials(builder)}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography fontWeight={750} noWrap>
            {builder.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {builder.code} · {schedule.draws.length} draws
          </Typography>
        </Box>
        <Chip
          size="small"
          variant="outlined"
          label={`${formatPercentage(total)}% allocated`}
          sx={{ fontWeight: 750 }}
        />
      </Stack>

      <Divider />

      <Stack spacing={0} sx={{ px: 2 }}>
        {schedule.draws.map((draw, index) => (
          <Stack
            key={`${schedule.id}-draw-${index + 1}`}
            direction="row"
            spacing={1.25}
            sx={{
              minHeight: 54,
              alignItems: 'center',
              borderBottom: index < schedule.draws.length - 1 ? 1 : 0,
              borderColor: 'divider',
            }}
          >
            <Avatar
              sx={{
                width: 24,
                height: 24,
                bgcolor: 'background.default',
                color: 'text.secondary',
                fontSize: 11,
                fontWeight: 750,
              }}
            >
              {index + 1}
            </Avatar>
            <Typography variant="body2" fontWeight={650} sx={{ flex: 1 }}>
              Draw {index + 1}
              {draw.name?.trim() ? ` (${draw.name.trim()})` : ''}
            </Typography>
            {schedule.optionsBillingDrawIndex != null
              && Number(schedule.optionsBillingDrawIndex) === index && (
              <Chip size="small" color="primary" label="Options billed" />
            )}
            <Typography variant="body2" color="primary.main" fontWeight={800}>
              {formatPercentage(Number(draw.percentage))}%
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Divider />

      <Stack spacing={1.25} sx={{ flex: 1, p: 2 }}>
        {schedule.separateHardwarePrice && (
          <Chip
            size="small"
            color="primary"
            icon={<ConstructionRoundedIcon />}
            label="Hardware separated · 100%"
            sx={{ alignSelf: 'flex-start', fontWeight: 750 }}
          />
        )}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            variant="outlined"
            label={frequencyLabels[schedule.frequency]}
          />
          <Typography variant="caption" color="text.secondary">
            {describeSchedule(schedule)}
          </Typography>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Net {schedule.paymentTermsDays}
          {schedule.retentionEnabled
            ? ` · ${formatPercentage(schedule.retentionPercentage)}% retention`
            : ''}
          {schedule.ocipWrapEnabled
            ? ` · ${formatPercentage(schedule.ocipWrapPercentage)}% OCIP / WRAP`
            : ''}
        </Typography>

        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {requiredDocuments(schedule).length > 0 ? (
            requiredDocuments(schedule).map((document) => (
              <Chip key={document} label={document} size="small" variant="outlined" />
            ))
          ) : (
            <Typography variant="caption" color="text.secondary">
              No submission documents required
            </Typography>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {schedule.portalName || 'No portal'} ·{' '}
          {invoiceLineFormatLabels[schedule.invoiceLineFormat]}
        </Typography>
      </Stack>

      <CardActions
        sx={{
          px: 2,
          py: 1.25,
          borderTop: 1,
          borderColor: 'divider',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          size="small"
          startIcon={<EditOutlinedIcon />}
          onClick={() => onEdit(schedule)}
        >
          Edit
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineRoundedIcon />}
          onClick={() => onDelete(schedule)}
        >
          Delete
        </Button>
      </CardActions>
    </Card>
  )
}

function DeleteScheduleDialog({ schedule, builder, onClose, onDelete }) {
  return (
    <Dialog open={Boolean(schedule)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Delete builder setup?</DialogTitle>
      <DialogContent>
        <Alert severity="warning">
          {builder
            ? `${builder.name}'s draw allocation and complete billing configuration will be permanently removed.`
            : 'This draw and billing configuration will be permanently removed.'}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={onDelete} disableElevation>
          Delete setup
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BuilderDrawSchedules() {
  const {
    builderDrawSchedules: schedules,
    setBuilderDrawSchedules: setSchedules,
  } = useBuilderDrawSchedules()
  const [dialogState, setDialogState] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [notice, setNotice] = useState(null)
  const buildersById = useMemo(
    () => new Map(initialBuilders.map((builder) => [builder.id, builder])),
    [],
  )

  const handleSave = (form) => {
    if (dialogState?.mode === 'edit') {
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === dialogState.schedule.id
            ? { ...schedule, ...form }
            : schedule,
        ),
      )
      setNotice({ severity: 'success', message: 'Builder setup updated.' })
    } else {
      setSchedules((current) => [
        ...current,
        { ...form, id: Date.now() },
      ])
      setNotice({ severity: 'success', message: 'Builder setup created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setSchedules((current) =>
      current.filter((schedule) => schedule.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setNotice({ severity: 'success', message: 'Builder setup deleted.' })
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
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h5" fontWeight={750} color="text.primary">
              Builder Draw Schedules
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
              One complete setup per builder: draw allocation, cutoff rules,
              payment deductions and required submission documents.
            </Typography>
          </Box>
          <ResponsiveCreateButton
            label="New builder setup"
            mobileLabel="New setup"
            onClick={() => setDialogState({ mode: 'create' })}
          />
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 4 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 2 }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={750}>
              Existing builder setups
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {schedules.length} {schedules.length === 1 ? 'builder is' : 'builders are'} configured.
            </Typography>
          </Box>
          <Chip
            icon={<BusinessRoundedIcon />}
            label={`${schedules.length} configured`}
            variant="outlined"
          />
        </Stack>

        {schedules.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                md: 'repeat(2, minmax(0, 1fr))',
                xl: 'repeat(3, minmax(0, 1fr))',
              },
              alignItems: 'stretch',
              gap: 2,
            }}
          >
            {schedules.map((schedule) => {
              const builder = buildersById.get(schedule.builderId)
              if (!builder) return null

              return (
                <BuilderDrawScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  builder={builder}
                  onEdit={(target) =>
                    setDialogState({ mode: 'edit', schedule: target })
                  }
                  onDelete={setDeleteTarget}
                />
              )
            })}
          </Box>
        ) : (
          <Card variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
            <BusinessRoundedIcon color="action" sx={{ fontSize: 44 }} />
            <Typography fontWeight={750} sx={{ mt: 1 }}>
              No builder setups yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
              Create the first setup with draw and billing configuration.
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => setDialogState({ mode: 'create' })}
              disableElevation
            >
              New builder setup
            </Button>
          </Card>
        )}
      </Box>

      {dialogState && (
        <BuilderDrawScheduleDialog
          schedule={dialogState.schedule}
          schedules={schedules}
          builders={initialBuilders}
          onClose={() => setDialogState(null)}
          onSave={handleSave}
        />
      )}

      <DeleteScheduleDialog
        schedule={deleteTarget}
        builder={deleteTarget ? buildersById.get(deleteTarget.builderId) : null}
        onClose={() => setDeleteTarget(null)}
        onDelete={handleDelete}
      />

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3200}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
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
