import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import { getNationalPhoneNumber, getPhoneCountry } from '../../../utils/phoneNumbers.js'
import { emptyContact } from '../data/builderContacts.js'
import ContactTypeField from './ContactTypeField.jsx'
import { createBuilderContactSchema } from '../schemas/builderContactSchema.js'

function getContactFormValues(contact) {
  if (!contact) {
    return {
      ...emptyContact,
      phoneCountry: 'US',
      officePhoneCountry: 'US',
    }
  }

  const phoneCountry = getPhoneCountry(contact.phone)
  const officePhoneCountry = getPhoneCountry(contact.officePhone)
  return {
    ...contact,
    phoneCountry,
    phone: getNationalPhoneNumber(contact.phone, phoneCountry),
    officePhoneCountry,
    officePhone: getNationalPhoneNumber(contact.officePhone, officePhoneCountry),
  }
}

export default function ContactDialog({ contact, contacts, builders, typeNames, onClose, onSave, submitting }) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createBuilderContactSchema(contacts, contact?.id ?? null)),
    defaultValues: getContactFormValues(contact),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })

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
          {contact ? 'Edit contact' : 'New contact'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {contact
            ? 'Update who to reach on the builder side.'
            : 'Add someone who works for the builder, not for Valtrim.'}
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

          <Controller
            name="builderId"
            control={control}
            render={({ field }) => (
              <FormControl error={Boolean(errors.builderId)} fullWidth>
                <InputLabel id="contact-builder-label">Builder</InputLabel>
                <Select
                  labelId="contact-builder-label"
                  label="Builder"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                >
                  {builders.map((builder) => (
                    <MenuItem key={builder.id} value={builder.id}>
                      {builder.name} ({builder.code})
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errors.builderId?.message ?? ' '}</FormHelperText>
              </FormControl>
            )}
          />

          <ContactTypeField
            control={control}
            name="typeName"
            typeNames={typeNames}
            error={errors.typeName}
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
            label="Notes"
            {...register('notes')}
            error={Boolean(errors.notes)}
            helperText={errors.notes?.message ?? 'How they prefer to be reached, quirks to remember'}
            fullWidth
            multiline
            minRows={2}
          />

          {contact && (
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
                      Inactive contacts remain visible in the catalog.
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
          {submitting ? 'Saving...' : contact ? 'Save changes' : 'Create contact'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
