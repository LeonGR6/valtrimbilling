import { useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
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
import { formatLongDate, formatTime } from '../utils/dates.js'
import { suggestServiceWorkdays } from '../utils/suggestedServiceWindows.js'

const workTypeOptions = [
  { value: 'HW', label: 'HW' },
  { value: 'WS', label: 'WS' },
  { value: 'HW_WS', label: 'HW & WS' },
]

function defaultValues(request, createdOn) {
  const phoneCountry = getPhoneCountry(request?.contactPhone)

  return {
    reportedAt: request?.reportedAt ?? createdOn,
    lotNumber: request?.lotNumber ?? '',
    street: request?.street ?? '',
    city: request?.city ?? '',
    state: request?.state ?? 'CA',
    postalCode: request?.postalCode ?? '',
    plan: request?.plan ?? '',
    latitude: request?.latitude ?? '',
    longitude: request?.longitude ?? '',
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
    estimatedDurationMinutes: request?.estimatedDurationMinutes ?? 60,
    internalNotes: request?.internalNotes ?? '',
    customerAvailabilityNotes: request?.customerAvailabilityNotes ?? '',
    availability: request?.availability?.map(({ availableFrom, availableUntil, notes }) => ({
        availableFrom,
        availableUntil,
        notes,
      })) ?? [],
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
  const suggestions = useMemo(
    () => suggestServiceWorkdays(createdAt, settings, new Date(), request?.dueOn),
    [createdAt, request?.dueOn, settings],
  )
  const schema = useMemo(
    () => createPersistedCustomerServiceSchema(
      settings.businessDaysToComplete,
      { startDate: suggestions.startOn, dueDate: suggestions.dueOn },
    ),
    [settings.businessDaysToComplete, suggestions.startOn, suggestions.dueOn],
  )
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(request, suggestions.createdOn),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'availability',
  })
  const confirmedWindows = useWatch({ control, name: 'availability' }) ?? []
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
          Save the request now; customer availability can be added later.
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
              helperText={errors.reportedAt?.message ?? 'The five-business-day deadline starts when this request is created.'}
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

          <TextField
            label="Property address"
            {...register('street')}
            error={Boolean(errors.street)}
            helperText={errors.street?.message ?? 'Coordinates remain required for new construction.'}
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

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Latitude"
              type="number"
              {...register('latitude')}
              error={Boolean(errors.latitude)}
              helperText={errors.latitude?.message ?? 'Example: 33.986588'}
              fullWidth
              slotProps={{ htmlInput: { step: 'any' } }}
            />
            <TextField
              label="Longitude"
              type="number"
              {...register('longitude')}
              error={Boolean(errors.longitude)}
              helperText={errors.longitude?.message ?? 'Example: -117.343021'}
              fullWidth
              slotProps={{ htmlInput: { step: 'any' } }}
            />
          </Stack>

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
          <SectionTitle>Suggested visit days</SectionTitle>
          <Typography variant="body2" color="text.secondary">
            Generated from the request creation date and the configured workday.
            These are proposals, not customer-confirmed availability, and are not saved.
          </Typography>
          {suggestions.days.length ? (
            <Stack spacing={1}>
              {suggestions.days.map((day) => (
                <Box
                  key={day.date}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                    p: 1.5,
                    display: 'flex',
                    alignItems: { xs: 'stretch', sm: 'center' },
                    justifyContent: 'space-between',
                    gap: 1.5,
                    flexDirection: { xs: 'column', sm: 'row' },
                  }}
                >
                  <Typography variant="body2">
                    {formatLongDate(day.date)} · {formatTime(day.availableFrom.slice(11))}
                    {' – '}{formatTime(day.availableUntil.slice(11))}
                  </Typography>
                  <Button
                    size="small"
                    onClick={() => append({
                      availableFrom: day.availableFrom,
                      availableUntil: day.availableUntil,
                      notes: '',
                    })}
                    disabled={fields.length >= 5 || confirmedWindows.some(
                      (window) => window.availableFrom === day.availableFrom
                        && window.availableUntil === day.availableUntil,
                    )}
                  >
                    Customer confirmed this window
                  </Button>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="warning.main">
              No workday remains before the current deadline. Review this request manually.
            </Typography>
          )}

          <Divider />
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <SectionTitle>Customer availability</SectionTitle>
              <Typography variant="body2" color="text.secondary">
                Optional. Record only windows the customer has confirmed.
              </Typography>
            </Box>
            <Button
              startIcon={<AddRoundedIcon />}
              onClick={() => append({ availableFrom: '', availableUntil: '', notes: '' })}
              disabled={fields.length >= 5}
            >
              Add window
            </Button>
          </Stack>

          {fields.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No customer availability recorded yet. You can still save the request.
            </Typography>
          )}

          {typeof errors.availability?.message === 'string' && (
            <FormHelperText error>{errors.availability.message}</FormHelperText>
          )}

          {fields.map((field, index) => (
            <Box
              key={field.id}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
            >
              <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Window {index + 1}
                </Typography>
                <IconButton
                  aria-label={`Remove availability window ${index + 1}`}
                  size="small"
                  color="error"
                  onClick={() => remove(index)}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Available from"
                  type="datetime-local"
                  {...register(`availability.${index}.availableFrom`)}
                  error={Boolean(errors.availability?.[index]?.availableFrom)}
                  helperText={errors.availability?.[index]?.availableFrom?.message ?? ' '}
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="Available until"
                  type="datetime-local"
                  {...register(`availability.${index}.availableUntil`)}
                  error={Boolean(errors.availability?.[index]?.availableUntil)}
                  helperText={errors.availability?.[index]?.availableUntil?.message ?? ' '}
                  fullWidth
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>
              <TextField
                label="Window notes"
                {...register(`availability.${index}.notes`)}
                error={Boolean(errors.availability?.[index]?.notes)}
                helperText={errors.availability?.[index]?.notes?.message ?? 'Optional'}
                fullWidth
              />
            </Box>
          ))}

          <TextField
            label="General availability notes"
            {...register('customerAvailabilityNotes')}
            error={Boolean(errors.customerAvailabilityNotes)}
            helperText={errors.customerAvailabilityNotes?.message ?? 'Optional context that applies to every window.'}
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
