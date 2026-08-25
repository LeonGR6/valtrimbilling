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
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import BusinessRoundedIcon from '@mui/icons-material/BusinessRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ResponsiveCreateButton from '../../../components/common/ResponsiveCreateButton'
import { initialBuilders } from '../../builders/data/builders.js'
import {
  defaultDraws,
  initialBuilderDrawSchedules,
  MAX_DRAW_COUNT,
  MIN_DRAW_COUNT,
} from '../data/builderDrawSchedules.js'
import { createBuilderDrawScheduleSchema } from '../schemas/builderDrawScheduleSchema.js'

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
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: schedule
      ? {
          builderId: schedule.builderId,
          draws: schedule.draws.map((draw) => ({ ...draw })),
        }
      : {
          builderId: '',
          draws: defaultDraws.map((draw) => ({ ...draw })),
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
        <Typography variant="h6" component="div" fontWeight={750}>
          {schedule ? 'Edit Builder Draw Schedule' : 'New Builder Draw Schedule'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Choose between {MIN_DRAW_COUNT} and {MAX_DRAW_COUNT} draws and allocate
          exactly 100% across them.
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
              Every active builder already has a draw schedule.
            </Alert>
          )}

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
                  Draw numbers follow their order below.
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
                  <TextField
                    label={`Draw ${index + 1}`}
                    type="number"
                    {...register(`draws.${index}.percentage`)}
                    error={Boolean(errors.draws?.[index]?.percentage)}
                    helperText={errors.draws?.[index]?.percentage?.message ?? ' '}
                    fullWidth
                    slotProps={{
                      input: {
                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                      },
                      htmlInput: {
                        min: 1,
                        max: 100,
                        step: 1,
                        inputMode: 'numeric',
                      },
                    }}
                  />
                  {fields.length > MIN_DRAW_COUNT && (
                    <IconButton
                      aria-label={`Remove Draw ${index + 1}`}
                      color="error"
                      onClick={() => remove(index)}
                      sx={{ mt: 1.25 }}
                    >
                      <DeleteOutlineRoundedIcon />
                    </IconButton>
                  )}
                </Stack>
              ))}
            </Stack>

            <Button
              type="button"
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              disabled={fields.length >= MAX_DRAW_COUNT}
              onClick={() => append({ percentage: 0 })}
              sx={{ mt: 0.5 }}
            >
              Add draw
            </Button>
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
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disableElevation disabled={!canSave}>
          {schedule ? 'Save changes' : 'Create schedule'}
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
          color="success"
          label={`${formatPercentage(total)}%`}
          sx={{ fontWeight: 750 }}
        />
      </Stack>

      <Divider />

      <Stack spacing={0} sx={{ flex: 1, px: 2 }}>
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
            </Typography>
            <Typography variant="body2" color="primary.main" fontWeight={800}>
              {formatPercentage(Number(draw.percentage))}%
            </Typography>
          </Stack>
        ))}
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
      <DialogTitle>Delete Builder Draw Schedule?</DialogTitle>
      <DialogContent>
        <Alert severity="warning">
          {builder
            ? `${builder.name}'s ${schedule.draws.length}-draw configuration will be permanently removed.`
            : 'This draw configuration will be permanently removed.'}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={onDelete} disableElevation>
          Delete schedule
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function BuilderDrawSchedules() {
  const [schedules, setSchedules] = useState(initialBuilderDrawSchedules)
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
      setNotice({ severity: 'success', message: 'Builder Draw Schedule updated.' })
    } else {
      setSchedules((current) => [
        ...current,
        { ...form, id: Date.now() },
      ])
      setNotice({ severity: 'success', message: 'Builder Draw Schedule created.' })
    }

    setDialogState(null)
  }

  const handleDelete = () => {
    setSchedules((current) =>
      current.filter((schedule) => schedule.id !== deleteTarget.id),
    )
    setDeleteTarget(null)
    setNotice({ severity: 'success', message: 'Builder Draw Schedule deleted.' })
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
              Define how each builder splits billing across 3 to 5 draws. Every
              schedule must allocate exactly 100%.
            </Typography>
          </Box>
          <ResponsiveCreateButton
            label="New Builder Draw Schedule"
            mobileLabel="New schedule"
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
              Existing schedules
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
              No Builder Draw Schedules yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
              Create the first schedule to define its draw percentages.
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={() => setDialogState({ mode: 'create' })}
              disableElevation
            >
              New Builder Draw Schedule
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
