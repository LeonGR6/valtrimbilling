import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { schedulingSettingsSchema } from '../schemas/technicianSchema.js'
import { updateCustomerServiceSettings } from '../services/customerServiceRepository.js'

function formValues(settings) {
  return {
    companyAddress: settings.companyAddress ?? '',
    coordinates: settings.companyLatitude != null && settings.companyLongitude != null
      ? `${settings.companyLatitude}, ${settings.companyLongitude}`
      : '',
    workdayStartsAt: settings.workdayStartsAt?.slice(0, 5) ?? '08:00',
    workdayEndsAt: settings.workdayEndsAt?.slice(0, 5) ?? '17:00',
    timeZone: settings.timeZone ?? 'America/Los_Angeles',
    defaultDurationMinutes: settings.defaultDurationMinutes ?? 60,
    distanceGreenMaxMiles: settings.distanceGreenMaxMiles ?? 10,
    distanceYellowMaxMiles: settings.distanceYellowMaxMiles ?? 20,
    requiresDispatcherApproval: settings.requiresDispatcherApproval ?? true,
  }
}

export default function SchedulingSettings({ settings, canEdit, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schedulingSettingsSchema),
    defaultValues: formValues(settings),
    mode: 'onTouched',
  })

  const save = async (values) => {
    setSaving(true)
    setNotice(null)
    try {
      const updated = await updateCustomerServiceSettings(values)
      reset(formValues(updated))
      onSaved(updated)
      setNotice({ severity: 'success', message: 'Scheduling settings saved.' })
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally {
      setSaving(false)
    }
  }

  const disabled = !canEdit || saving

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(save)}
      noValidate
      sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, p: 3 }}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Scheduling settings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Shared rules used to determine whether a request can enter the proposal generator.
          </Typography>
        </Box>

        <Alert severity="info">
          Customer Service has a fixed deadline of 5 business days. Lunch, parts and technician skills are not scheduling requirements.
        </Alert>
        {!canEdit && <Alert severity="warning">Only administrators can change these settings.</Alert>}
        {notice && <Alert severity={notice.severity}>{notice.message}</Alert>}

        <TextField label="Dispatch address" {...register('companyAddress')} disabled={disabled}
          error={Boolean(errors.companyAddress)} helperText={errors.companyAddress?.message} fullWidth />
        <TextField label="Dispatch coordinates" {...register('coordinates')} disabled={disabled}
          error={Boolean(errors.coordinates)}
          helperText={errors.coordinates?.message ?? 'Latitude and longitude, for example: 33.986588, -117.343021'}
          fullWidth slotProps={{ htmlInput: { inputMode: 'decimal' } }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Workday starts" type="time" {...register('workdayStartsAt')}
            disabled={disabled} error={Boolean(errors.workdayStartsAt)}
            helperText={errors.workdayStartsAt?.message} fullWidth
            slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Workday ends" type="time" {...register('workdayEndsAt')}
            disabled={disabled} error={Boolean(errors.workdayEndsAt)}
            helperText={errors.workdayEndsAt?.message} fullWidth
            slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Time zone" {...register('timeZone')} disabled={disabled}
            error={Boolean(errors.timeZone)} helperText={errors.timeZone?.message} fullWidth />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Default job minutes" type="number" {...register('defaultDurationMinutes')}
            disabled={disabled} error={Boolean(errors.defaultDurationMinutes)}
            helperText={errors.defaultDurationMinutes?.message ?? '15–720 minutes'} fullWidth
            slotProps={{ htmlInput: { min: 15, max: 720, step: 15 } }} />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Near distance (miles)" type="number" {...register('distanceGreenMaxMiles')}
            disabled={disabled} error={Boolean(errors.distanceGreenMaxMiles)}
            helperText={errors.distanceGreenMaxMiles?.message ?? 'First grouping band'} fullWidth
            slotProps={{ htmlInput: { min: 0.1, step: 0.1 } }} />
          <TextField label="Extended distance (miles)" type="number" {...register('distanceYellowMaxMiles')}
            disabled={disabled} error={Boolean(errors.distanceYellowMaxMiles)}
            helperText={errors.distanceYellowMaxMiles?.message ?? 'Second grouping band'} fullWidth
            slotProps={{ htmlInput: { min: 0.1, step: 0.1 } }} />
        </Stack>

        <Controller
          name="requiresDispatcherApproval"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Switch checked={field.value} onChange={(_, checked) => field.onChange(checked)} disabled={disabled} />}
              label="Require dispatcher approval before creating appointments"
            />
          )}
        />

        {canEdit && (
          <Button type="submit" variant="contained" startIcon={<SaveRoundedIcon />}
            disabled={saving} sx={{ alignSelf: 'flex-start' }} disableElevation>
            {saving ? 'Saving...' : 'Save settings'}
          </Button>
        )}
      </Stack>
    </Box>
  )
}
