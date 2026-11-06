import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import { getNationalPhoneNumber, getPhoneCountry } from '../../../utils/phoneNumbers.js'
import {
  appointmentStateOptions,
  coordinatorLabelsById,
  emptyRequest,
  formStatusOptions,
  priorityOptions,
  requestTagOptions,
  requestTypeOptions,
  technicianOptions,
} from '../data/customerService.js'
import { createServiceRequestSchema } from '../schemas/customerServiceSchema.js'
import { nextRequestNumber } from '../utils/requestNumber.js'

function getRequestFormValues(request, requests) {
  const formRequest = request ?? {
    ...emptyRequest,
    requestNumber: nextRequestNumber(requests),
  }
  const contactPhoneCountry = getPhoneCountry(formRequest.contactPhone)

  return {
    ...formRequest,
    contactPhoneCountry,
    contactPhone: getNationalPhoneNumber(
      formRequest.contactPhone,
      contactPhoneCountry,
    ),
  }
}

export default function RequestDialog({ request, requests, builderOptions, onClose, onSave }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(
      createServiceRequestSchema(requests, request?.id ?? null),
    ),
    // A new request arrives with its folio already assigned and logged under
    // the coordinator who owns the screen. Neither is typed.
    defaultValues: getRequestFormValues(request, requests),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

  // The visit fields only apply once there is something to schedule.
  // useWatch rather than watch(): the latter returns a fresh function every
  // render, which makes the React Compiler skip memoizing the whole dialog.
  const appointmentState = useWatch({ control, name: 'appointmentState' })
  const showVisitFields = appointmentState !== 'NOT_SCHEDULED'
  const showVisitWindow =
    appointmentState === 'SCHEDULED' || appointmentState === 'COMPLETED'

  const selectField = (name, label, options, { emptyLabel } = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <FormControl error={Boolean(errors[name])} fullWidth>
          <InputLabel id={`request-${name}-label`}>{label}</InputLabel>
          <Select
            labelId={`request-${name}-label`}
            label={label}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          >
            {emptyLabel && (
              <MenuItem value="">
                <em>{emptyLabel}</em>
              </MenuItem>
            )}
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

  const sectionTitle = (title) => (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ fontWeight: 700, letterSpacing: '0.08em' }}
    >
      {title}
    </Typography>
  )

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
        <Typography variant="h6" component="div" fontWeight={700}>
          {request ? `Request ${request.requestNumber}` : 'New request'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          What the homeowner reported, where it is and who is going out.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          {sectionTitle('Request')}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Request number"
              {...register('requestNumber')}
              error={Boolean(errors.requestNumber)}
              helperText={
                errors.requestNumber?.message ??
                (request
                  ? 'A folio never changes once issued.'
                  : 'Assigned automatically.')
              }
              fullWidth
              slotProps={{ htmlInput: { maxLength: 30, readOnly: true } }}
              sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
            />
            <TextField
              label="Reported on"
              type="date"
              {...register('reportedAt')}
              error={Boolean(errors.reportedAt)}
              helperText={errors.reportedAt?.message ?? ' '}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {/* Who logged the request is a fact of whose desk this is, not a
                question. Controller keeps the id in the form while the input
                only ever displays the name and takes no input. */}
            <Controller
              name="createdById"
              control={control}
              render={({ field }) => (
                <TextField
                  label="Logged by"
                  value={coordinatorLabelsById[field.value] ?? ''}
                  helperText="Customer Service is logged under this desk."
                  fullWidth
                  slotProps={{ htmlInput: { readOnly: true } }}
                  sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                />
              )}
            />
            {selectField('tag', 'Flag', requestTagOptions, {
              emptyLabel: 'No flag',
            })}
          </Stack>

          <Divider />
          {sectionTitle('Property')}
          {selectField('builder', 'Builder', builderOptions)}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Community"
              {...register('community')}
              error={Boolean(errors.community)}
              helperText={errors.community?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              label="Lot"
              {...register('lotNumber')}
              error={Boolean(errors.lotNumber)}
              helperText={errors.lotNumber?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 20 } }}
            />
            <TextField
              label="Plan"
              {...register('plan')}
              error={Boolean(errors.plan)}
              helperText={errors.plan?.message ?? 'Optional'}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 40 } }}
            />
          </Stack>

          <TextField
            label="Street address"
            {...register('street')}
            error={Boolean(errors.street)}
            helperText={errors.street?.message ?? ' '}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="City"
              {...register('city')}
              error={Boolean(errors.city)}
              helperText={errors.city?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              label="State"
              {...register('state')}
              error={Boolean(errors.state)}
              helperText={errors.state?.message ?? ' '}
              sx={{ width: { xs: '100%', sm: 140 } }}
              slotProps={{ htmlInput: { maxLength: 2 } }}
            />
            <TextField
              label="ZIP code"
              {...register('postalCode')}
              error={Boolean(errors.postalCode)}
              helperText={errors.postalCode?.message ?? ' '}
              sx={{ width: { xs: '100%', sm: 180 } }}
              slotProps={{ htmlInput: { maxLength: 5 } }}
            />
          </Stack>

          <Divider />
          {sectionTitle('Homeowner')}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Name"
              {...register('contactName')}
              error={Boolean(errors.contactName)}
              helperText={errors.contactName?.message ?? ' '}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 100 } }}
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
              helperText={errors.contactEmail?.message ?? 'Optional'}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 160 } }}
            />
          </Stack>

          <Divider />
          {sectionTitle('Issue')}
          <TextField
            label="Issue"
            {...register('issue')}
            error={Boolean(errors.issue)}
            helperText={
              errors.issue?.message ?? 'The one line that shows in the table'
            }
            fullWidth
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {selectField('type', 'Classification', requestTypeOptions)}
            {selectField('priority', 'Priority', priorityOptions)}
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {selectField('status', 'Status', formStatusOptions)}
            <TextField
              label="Status note"
              {...register('statusNote')}
              error={Boolean(errors.statusNote)}
              helperText={errors.statusNote?.message ?? 'Optional'}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 60 } }}
            />
          </Stack>

          <Divider />
          {sectionTitle('Appointment')}
          {selectField(
            'appointmentState',
            'Appointment',
            appointmentStateOptions,
          )}

          {showVisitFields && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={
                  appointmentState === 'OVERDUE' ? 'Was due on' : 'Visit date'
                }
                type="date"
                {...register('appointmentDate')}
                error={Boolean(errors.appointmentDate)}
                helperText={errors.appointmentDate?.message ?? ' '}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              {showVisitWindow && (
                <>
                  <TextField
                    label="From"
                    type="time"
                    {...register('appointmentStart')}
                    error={Boolean(errors.appointmentStart)}
                    helperText={errors.appointmentStart?.message ?? ' '}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    label="To"
                    type="time"
                    {...register('appointmentEnd')}
                    error={Boolean(errors.appointmentEnd)}
                    helperText={errors.appointmentEnd?.message ?? ' '}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </>
              )}
            </Stack>
          )}

          {showVisitWindow &&
            selectField('technicianId', 'Technician', technicianOptions, {
              emptyLabel: 'Unassigned',
            })}

          <TextField
            label="Notes"
            {...register('notes')}
            error={Boolean(errors.notes)}
            helperText={
              errors.notes?.message ?? 'Access, pets, anything to remember'
            }
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
        <Button type="submit" variant="contained" disableElevation>
          {request ? 'Save changes' : 'Create request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
