import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import { getNationalPhoneNumber, getPhoneCountry } from '../../../utils/phoneNumbers.js'
import { emptyPerson, personTypeOptions } from '../data/people.js'
import { personSchema } from '../schemas/personSchema.js'

function getPersonFormValues(person) {
  if (!person) {
    return {
      ...emptyPerson,
      phoneCountry: 'US',
      officePhoneCountry: 'US',
    }
  }

  const phoneCountry = getPhoneCountry(person.phone)
  const officePhoneCountry = getPhoneCountry(person.officePhone)
  return {
    ...person,
    phoneCountry,
    phone: getNationalPhoneNumber(person.phone, phoneCountry),
    officePhoneCountry,
    officePhone: getNationalPhoneNumber(person.officePhone, officePhoneCountry),
  }
}

export default function PersonDialog({ person, onClose, onSave, submitting }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(personSchema),
    defaultValues: getPersonFormValues(person),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const selectedTypes = useWatch({ control, name: 'types' })
  const isSupervisor = selectedTypes.includes('SUPERVISOR')
  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {person ? 'Edit company contact' : 'New company contact'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {person
            ? 'Update the contact information and the types of this contact.'
            : 'Add someone who works for Valtrim and can be assigned to jobs.'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={2.25}>
          <TextField
            label="Name"
            {...register('name')}
            error={Boolean(errors.name)}
            helperText={errors.name?.message ?? ' '}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />

          <FormPhoneInput
            control={control}
            name="phone"
            label="Phone number"
            error={errors.phone}
            helperText="Optional · choose +1 or +52"
          />
          <FormPhoneInput
            control={control}
            name="officePhone"
            label="Office phone number"
            error={errors.officePhone}
            helperText="Optional · choose +1 or +52"
          />

          <TextField
            label="Email"
            type="email"
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message ?? ' '}
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MailOutlineRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { maxLength: 160 },
            }}
          />


          <Controller
            name="types"
            control={control}
            render={({ field }) => (
              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Contact type
                </Typography>
                <FormGroup>
                  {personTypeOptions.map((option) => (
                    <FormControlLabel
                      key={option.value}
                      control={(
                        <Checkbox
                          size="small"
                          checked={field.value.includes(option.value)}
                          onChange={(_, checked) => field.onChange(
                            checked
                              ? [...field.value, option.value]
                              : field.value.filter((type) => type !== option.value),
                          )}
                        />
                      )}
                      label={(
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {option.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {option.description}
                          </Typography>
                        </Box>
                      )}
                      sx={{ alignItems: 'flex-start', mb: 0.5 }}
                    />
                  ))}
                </FormGroup>
                <FormHelperText error={Boolean(errors.types)}>
                  {errors.types?.message ?? ' '}
                </FormHelperText>
              </Box>
            )}
          />

          {isSupervisor && (
            <TextField
              label="Territory"
              {...register('territory')}
              error={Boolean(errors.territory)}
              helperText={
                errors.territory?.message
                ?? 'Geographic area assigned to this Valtrim supervisor.'
              }
              required
              fullWidth
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
          )}

          {person && (
            <Box
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 2,
                px: 2,
                py: 1,
              }}
            >
              <FormControlLabel
                sx={{ m: 0, width: '100%', justifyContent: 'space-between' }}
                labelPlacement="start"
                control={(
                  <Controller
                    name="isActive"
                    control={control}
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onChange={(_, checked) => field.onChange(checked)}
                        slotProps={{ input: { ref: field.ref } }}
                      />
                    )}
                  />
                )}
                label={(
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      Active contact
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Inactive contacts remain visible in the list.
                    </Typography>
                  </Box>
                )}
              />
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={submitting} disableElevation>
          {submitting
            ? 'Saving...'
            : person ? 'Save changes' : 'Create contact'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
