import { Controller } from 'react-hook-form'
import { Autocomplete, TextField } from '@mui/material'
import { MAX_CONTACT_TYPE_LENGTH, contactTypeDescriptions, contactTypeLabels } from '../data/builderContacts.js'

const descriptionsByName = Object.fromEntries(
  Object.entries(contactTypeLabels).map(([value, label]) => [
    label.toLowerCase(),
    contactTypeDescriptions[value],
  ]),
)

/**
 * The type of a Builder contact: pick one of the saved types or type a new one
 * ("Coordinator"); a new one is saved with the contact and offered next time.
 */
export default function ContactTypeField({
  control,
  name,
  typeNames,
  error,
  label = 'Contact type',
  size,
  hideDescription = false,
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Autocomplete
          freeSolo
          size={size}
          options={typeNames}
          value={field.value ?? ''}
          inputValue={field.value ?? ''}
          // Whatever is typed is the value: picking and typing are the same.
          onInputChange={(_, next) => field.onChange(next)}
          onBlur={field.onBlur}
          renderInput={(params) => (
            <TextField
              {...params}
              inputRef={field.ref}
              label={label}
              error={Boolean(error)}
              helperText={
                error?.message
                ?? (hideDescription
                  ? undefined
                  : descriptionsByName[String(field.value ?? '').trim().toLowerCase()]
                    ?? 'Pick a type or type a new one: it is saved for next time.')
              }
              slotProps={{
                ...params.slotProps,
                htmlInput: {
                  ...params.slotProps.htmlInput,
                  maxLength: MAX_CONTACT_TYPE_LENGTH,
                },
              }}
            />
          )}
        />
      )}
    />
  )
}
