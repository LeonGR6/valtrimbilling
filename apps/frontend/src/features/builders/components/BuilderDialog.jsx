import { useMemo } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded'
import { FormPhoneInput } from '../../../components/common/InternationalPhoneInput.jsx'
import { getNationalPhoneNumber, getPhoneCountry } from '../../../utils/phoneNumbers.js'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from 'react-hook-form'
import { builderCountries, emptyBuilder } from '../data/builders.js'
import { createBuilderSchema } from '../schemas/builderSchema.js'
import ContactTypeField from '../../builder-contacts/components/ContactTypeField.jsx'

function OptionalLabel({ children }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {children}
      </Typography>
      <Chip
        label="Optional"
        size="small"
        variant="outlined"
        sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
      />
    </Stack>
  )
}

function getBuilderFormValues(builder) {
  if (!builder) return { ...emptyBuilder, contactPhoneCountry: 'US' }

  const contactPhoneCountry = getPhoneCountry(builder.contactPhone)
  return {
    ...builder,
    contactPhoneCountry,
    contactPhone: getNationalPhoneNumber(builder.contactPhone, contactPhoneCountry),
  }
}

const emptyExtraContact = {
  name: '',
  typeName: '',
  email: '',
  phone: '',
  phoneCountry: 'US',
  officePhone: '',
  officePhoneCountry: 'US',
}

export default function BuilderDialog({
  open,
  builder,
  builders,
  contactEmails,
  typeNames,
  onClose,
  onSave,
  submitting,
}) {
  const schema = useMemo(
    () => createBuilderSchema(builders, builder?.id, contactEmails),
    [builder?.id, builders, contactEmails],
  )
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: getBuilderFormValues(builder),
    mode: 'onTouched',
    reValidateMode: 'onChange',
  })
  const description = useWatch({ control, name: 'description' })
  const {
    fields: extraContacts,
    append: addExtraContact,
    remove: removeExtraContact,
  } = useFieldArray({ control, name: 'contacts' })

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      fullWidth
      maxWidth="md"
      component="form"
      onSubmit={handleSubmit(onSave)}
      noValidate
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          {builder ? 'Edit builder' : 'New builder'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {builder
            ? 'Update the company and contact information for this builder.'
            : 'Add a new builder to the company catalog.'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '16px !important' }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
              Builder information
            </Typography>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Builder code"
                  {...register('code')}
                  error={Boolean(errors.code)}
                  helperText={errors.code?.message ?? 'Example: CV'}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 24 } }}
                />
                <TextField
                  label="Builder name"
                  {...register('name')}
                  error={Boolean(errors.name)}
                  helperText={errors.name?.message ?? ' '}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
              </Stack>

              <Box>
                <OptionalLabel>Description</OptionalLabel>
                <TextField
                  aria-label="Description"
                  {...register('description')}
                  multiline
                  minRows={2}
                  placeholder="Add a short description of this builder..."
                  fullWidth
                  sx={{ mt: 1 }}
                  slotProps={{ htmlInput: { maxLength: 240 } }}
                  error={Boolean(errors.description)}
                  helperText={errors.description?.message ?? `${description.length}/240`}
                />
              </Box>

              <Box>
                <OptionalLabel>Address</OptionalLabel>
                <Stack spacing={2} sx={{ mt: 1.5 }}>
                  <TextField
                    label="Address line 1"
                    placeholder="Street and number"
                    {...register('addressLine1')}
                    error={Boolean(errors.addressLine1)}
                    helperText={errors.addressLine1?.message ?? ' '}
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                  />
                  <TextField
                    label="Address line 2"
                    placeholder="Apartment, suite, unit"
                    {...register('addressLine2')}
                    error={Boolean(errors.addressLine2)}
                    helperText={errors.addressLine2?.message ?? ' '}
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
                      {...register('zipCode')}
                      error={Boolean(errors.zipCode)}
                      helperText={errors.zipCode?.message ?? ' '}
                      sx={{ width: { xs: '100%', sm: 180 } }}
                      slotProps={{ htmlInput: { maxLength: 10 } }}
                    />
                  </Stack>
                  <Controller
                    name="country"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        select
                        label="Country"
                        {...field}
                        error={Boolean(errors.country)}
                        helperText={errors.country?.message ?? ' '}
                        fullWidth
                      >
                        {builderCountries.map((country) => (
                          <MenuItem key={country.value} value={country.value}>
                            {country.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </Stack>
              </Box>
            </Stack>
          </Box>

          <Box>
            <OptionalLabel>Primary contact</OptionalLabel>
            <Stack spacing={2} sx={{ mt: 1.5 }}>
              <TextField
                label="Contact name"
                {...register('contactName')}
                error={Boolean(errors.contactName)}
                helperText={errors.contactName?.message ?? ' '}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <Stack spacing={2}>
                <TextField
                  label="Email"
                  type="email"
                  {...register('contactEmail')}
                  error={Boolean(errors.contactEmail)}
                  helperText={errors.contactEmail?.message ?? ' '}
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
                  name="contactPhone"
                  label="Phone"
                  error={errors.contactPhone}
                  helperText="Optional · choose +1 or +52"
                />
              </Stack>
            </Stack>
          </Box>

          {!builder && (
            <Box>
              <OptionalLabel>Other contacts</OptionalLabel>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                People at the builder besides the primary contact. Pick a contact type
                or type a new one: it is saved for the next builder.
              </Typography>
              <Stack spacing={2} sx={{ mt: 1.5 }}>
                {extraContacts.map((item, index) => (
                  <Box
                    key={item.id}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
                  >
                    <Stack spacing={2}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField
                          label="Name"
                          {...register(`contacts.${index}.name`)}
                          error={Boolean(errors.contacts?.[index]?.name)}
                          helperText={errors.contacts?.[index]?.name?.message ?? ' '}
                          fullWidth
                          slotProps={{ htmlInput: { maxLength: 100 } }}
                        />
                        <Box sx={{ width: '100%' }}>
                          <ContactTypeField
                            control={control}
                            name={`contacts.${index}.typeName`}
                            typeNames={typeNames}
                            error={errors.contacts?.[index]?.typeName}
                            hideDescription
                          />
                        </Box>
                        <IconButton
                          aria-label="Remove contact"
                          onClick={() => removeExtraContact(index)}
                          sx={{ alignSelf: { xs: 'flex-end', sm: 'flex-start' }, mt: { sm: 0.5 } }}
                        >
                          <DeleteOutlineRoundedIcon />
                        </IconButton>
                      </Stack>
                      <TextField
                        label="Email"
                        type="email"
                        {...register(`contacts.${index}.email`)}
                        error={Boolean(errors.contacts?.[index]?.email)}
                        helperText={errors.contacts?.[index]?.email?.message ?? ' '}
                        fullWidth
                        slotProps={{ htmlInput: { maxLength: 160 } }}
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <FormPhoneInput
                          control={control}
                          name={`contacts.${index}.officePhone`}
                          label="Office number"
                          error={errors.contacts?.[index]?.officePhone}
                          helperText="Optional · choose +1 or +52"
                        />
                        <FormPhoneInput
                          control={control}
                          name={`contacts.${index}.phone`}
                          label="Cell phone"
                          error={errors.contacts?.[index]?.phone}
                          helperText="Optional · choose +1 or +52"
                        />
                      </Stack>
                    </Stack>
                  </Box>
                ))}
                <Box>
                  <Button
                    size="small"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => addExtraContact(emptyExtraContact)}
                  >
                    Add contact
                  </Button>
                </Box>
              </Stack>
            </Box>
          )}

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
              control={
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
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    Active builder
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Inactive builders remain visible in the catalog.
                  </Typography>
                </Box>
              }
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1.5 }}>
        <Button color="inherit" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="contained" type="submit" disabled={submitting} disableElevation>
          {submitting
            ? 'Saving...'
            : builder ? 'Save changes' : 'Create builder'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
