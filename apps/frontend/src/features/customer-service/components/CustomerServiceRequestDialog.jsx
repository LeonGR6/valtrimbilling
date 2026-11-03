import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import {
  getNationalPhoneNumber,
  getPhoneCountry,
} from '../../../utils/phoneNumbers.js'
import { createPersistedCustomerServiceSchema } from '../schemas/persistedCustomerServiceSchema.js'
import { priorityOptions, requestTypeOptions } from '../data/customerService.js'
import { suggestServiceWorkdays } from '../utils/suggestedServiceWindows.js'

const workTypeOptions = [
  { value: 'HW', label: 'HW' },
  { value: 'WS', label: 'WS' },
  { value: 'HW_WS', label: 'HW & WS' },
]

function defaultValues(request, createdOn, defaultDurationMinutes) {
  const phoneCountry = getPhoneCountry(request?.contactPhone)

  return {
    reportedAt: request?.reportedAt ?? createdOn,
    lotNumber: request?.lotNumber ?? '',
    city: request?.city ?? '',
    state: request?.state ?? 'CA',
    postalCode: request?.postalCode ?? '',
    plan: request?.plan ?? '',
    coordinates: request?.latitude != null && request?.longitude != null
      ? `${request.latitude}, ${request.longitude}`
      : '',
    contactName: request?.contactName ?? '',
    contactPhoneCountry: phoneCountry,
    contactPhone: getNationalPhoneNumber(
      request?.contactPhone ?? '',
      phoneCountry,
    ),
    contactEmail: request?.contactEmail ?? '',
    type: request?.type ?? 'WARRANTY',
    priority: request?.priority ?? 'MEDIUM',
    issue: request?.issue ?? '',
    workType: request?.workType ?? 'HW',
    estimatedDurationMinutes: request?.estimatedDurationMinutes ?? defaultDurationMinutes,
    internalNotes: request?.internalNotes ?? '',
    customerUnavailableDates: request?.customerUnavailableDates?.map((date) => ({ date })) ?? [],
    customerNeedsContact: request?.customerNeedsContact ?? false,
    customerAvailabilityNotes: request?.customerAvailabilityNotes ?? '',
  }
}

function SectionTitle({ children }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ fontWeight: 700, letterSpacing: '0.08em' }}
    >
      {children}
    </Typography>
  )
}

export default function CustomerServiceRequestDialog({
  request,
  settings,
  currentUserName,
  saving,
  onClose,
  onSave,
}) {
  const createdAt = useMemo(
    () => request?.createdAt ?? new Date().toISOString(),
    [request?.createdAt],
  )
  const createdOn = useMemo(
    () => suggestServiceWorkdays(createdAt, settings, new Date()).createdOn,
    [createdAt, settings],
  )
  const schema = useMemo(
    () => createPersistedCustomerServiceSchema(
      settings.businessDaysToComplete,
    ),
    [settings.businessDaysToComplete],
  )
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(
      request,
      createdOn,
      settings.defaultDurationMinutes ?? 60,
    ),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'customerUnavailableDates',
  })
  const selectField = (name, label, options) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <FormControl error={Boolean(errors[name])} fullWidth>
          <InputLabel id={`customer-service-${name}-label`}>{label}</InputLabel>
          <Select
            {...field}
            labelId={`customer-service-${name}-label`}
            label={label}
          >
            {options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>{errors[name]?.message ?? ' '}</FormHelperText>
        </FormControl>
      )}
    />
  )

  return (
    <Dialog
      open
      onClose={saving ? undefined : onClose}
      component="form"
      onSubmit={handleSubmit(onSave)}
      fullWidth
      maxWidth="md"
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {request ? `Edit ${request.requestNumber}` : 'New request'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Save the request now; scheduling restrictions can be updated later.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <SectionTitle>Request</SectionTitle>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Request number"
              value={request?.requestNumber ?? 'Assigned after saving'}
              helperText="The database assigns and preserves this folio."
              fullWidth
              slotProps={{ htmlInput: { readOnly: true } }}
              sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
            />
            <TextField
              label="Reported on"
              type="date"
              {...register('reportedAt')}
              error={Boolean(errors.reportedAt)}
              helperText={errors.reportedAt?.message ?? 'The reported business day counts as day 1 of the five-day deadline.'}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Coordinator"
              value={currentUserName || 'Current signed-in user'}
              helperText="Taken from the authenticated account."
              fullWidth
              slotProps={{ htmlInput: { readOnly: true } }}
              sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
            />
          </Stack>

          <Divider />
          <SectionTitle>Property</SectionTitle>
          <TextField
            label="Lot"
            {...register('lotNumber')}
            error={Boolean(errors.lotNumber)}
            helperText={errors.lotNumber?.message ?? ' '}
            fullWidth
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="City"
              {...register('city')}
              error={Boolean(errors.city)}
              helperText={errors.city?.message ?? 'Optional'}
              fullWidth
            />
            <TextField
              label="State"
              {...register('state')}
              error={Boolean(errors.state)}
              helperText={errors.state?.message ?? ' '}
              sx={{ width: { xs: '100%', sm: 140 } }}
            />
            <TextField
              label="ZIP code"
              {...register('postalCode')}
              error={Boolean(errors.postalCode)}
              helperText={errors.postalCode?.message ?? 'Optional'}
              sx={{ width: { xs: '100%', sm: 180 } }}
            />
            <TextField
              label="Plan"
              {...register('plan')}
              error={Boolean(errors.plan)}
              helperText={errors.plan?.message ?? 'Optional'}
              fullWidth
            />
          </Stack>

          <TextField
            label="Coordinates"
            {...register('coordinates')}
            error={Boolean(errors.coordinates)}
            helperText={errors.coordinates?.message ?? 'Paste latitude and longitude together, for example: 33.97788205770745, -117.34520765941319'}
            placeholder="33.97788205770745, -117.34520765941319"
            fullWidth
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />

          <Divider />
          <SectionTitle>Customer</SectionTitle>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Name"
              {...register('contactName')}
              error={Boolean(errors.contactName)}
              helperText={errors.contactName?.message ?? ' '}
              fullWidth
            />
            <FormPhoneInput
              control={control}
              name="contactPhone"
              label="Phone"
              error={errors.contactPhone}
              helperText="Choose +1 or +52"
            />
            <TextField
              label="Email"
              {...register('contactEmail')}
              error={Boolean(errors.contactEmail)}
              helperText={errors.contactEmail?.message ?? 'Required for confirmation.'}
              fullWidth
            />
          </Stack>

          <Divider />
          <SectionTitle>Work</SectionTitle>
          <TextField
            label="Issue"
            {...register('issue')}
            error={Boolean(errors.issue)}
            helperText={errors.issue?.message ?? 'Describe the work that must be completed.'}
            fullWidth
            multiline
            minRows={2}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {selectField('type', 'Classification', requestTypeOptions)}
            {selectField('priority', 'Priority', priorityOptions)}
            {selectField('workType', 'Work type', workTypeOptions)}
            <TextField
              label="Estimated minutes"
              type="number"
              {...register('estimatedDurationMinutes')}
              error={Boolean(errors.estimatedDurationMinutes)}
              helperText={errors.estimatedDurationMinutes?.message ?? '15–720 minutes'}
              fullWidth
              slotProps={{ htmlInput: { min: 15, max: 720, step: 15 } }}
            />
          </Stack>

          <TextField
            label="Internal notes"
            {...register('internalNotes')}
            error={Boolean(errors.internalNotes)}
            helperText={errors.internalNotes?.message ?? 'Visible only inside the application.'}
            fullWidth
            multiline
            minRows={2}
          />

          <Divider />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <SectionTitle>Scheduling restrictions</SectionTitle>
              <Typography variant="body2" color="text.secondary">
                Optional. Record only days the customer cannot receive service.
              </Typography>
            </Box>
            <Button
              startIcon={<AddRoundedIcon />}
              onClick={() => append({ date: '' })}
              disabled={fields.length >= 5}
            >
              Add unavailable day
            </Button>
          </Stack>

          {fields.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No unavailable days recorded. Valtrim may propose any open business day.
            </Typography>
          )}

          {typeof errors.customerUnavailableDates?.message === 'string' && (
            <FormHelperText error>{errors.customerUnavailableDates.message}</FormHelperText>
          )}

          {fields.map((field, index) => (
            <Box
              key={field.id}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <TextField
                  label={`Unavailable day ${index + 1}`}
                  type="date"
                  {...register(`customerUnavailableDates.${index}.date`)}
                  error={Boolean(errors.customerUnavailableDates?.[index]?.date)}
                  helperText={errors.customerUnavailableDates?.[index]?.date?.message ?? 'The proposal generator will skip this day.'}
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <IconButton
                  aria-label={`Remove unavailable day ${index + 1}`}
                  size="small"
                  color="error"
                  onClick={() => remove(index)}
                  sx={{ mt: 1 }}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          ))}

          <Controller
            name="customerNeedsContact"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox {...field} checked={field.value} />}
                label="Customer needs to be contacted before receiving another proposal"
              />
            )}
          />

          <TextField
            label="Additional comments"
            {...register('customerAvailabilityNotes')}
            error={Boolean(errors.customerAvailabilityNotes)}
            helperText={errors.customerAvailabilityNotes?.message ?? 'Optional scheduling context from the customer.'}
            fullWidth
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving} disableElevation>
          {saving && <CircularProgress size={18} color="inherit" sx={{ mr: 1 }} />}
          {request ? 'Save changes' : 'Create request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
