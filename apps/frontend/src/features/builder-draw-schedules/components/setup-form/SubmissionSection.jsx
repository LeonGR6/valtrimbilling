import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import { Controller, useFormContext, useWatch } from 'react-hook-form'
import {
  finalReleaseScopeOptions,
  invoiceLineFormatOptions,
  isNamedSubmissionMethod,
  submissionMethodOptions,
} from '../../data/builderDrawSchedules.js'
import { Section } from './formParts.jsx'

const REQUIRED_DOCUMENTS = [
  ['requiresPo', 'Purchase order (Options)'],
  ['requiresPaymentSchedule', 'Payment schedule'],
  ['requiresRelease', 'Release'],
  ['requiresBackup', 'Backup documentation'],
]

const DESTINATIONS = {
  PORTAL: { label: 'Portal', placeholder: 'Example: Textura', helper: 'Optional' },
  EMAIL: { label: 'Submission email', placeholder: 'billing@example.com', helper: 'Email used to submit billing' },
  MAIL: { label: 'Mailing address', placeholder: 'Street, city, state and ZIP code', helper: 'Address used to mail billing' },
}

export default function SubmissionSection() {
  const { control, register, setValue, formState: { errors } } = useFormContext()
  const requiresRelease = useWatch({ control, name: 'requiresRelease' })
  const submissionMethod = useWatch({ control, name: 'submissionMethod' })
  const destination = DESTINATIONS[submissionMethod] ?? DESTINATIONS.PORTAL
  // Supply Pro, Textura, KB IE and KB LA are the destination themselves: there is nothing to type.
  const hasDestination = !isNamedSubmissionMethod(submissionMethod)

  return (
    <Section
      id="submission"
      title="Documents and submission"
      hint="What each Package needs, and how it is sent to the builder."
    >
      <Box
        role="group"
        aria-label="Documents each Package needs"
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, maxWidth: 560 }}
      >
        {REQUIRED_DOCUMENTS.map(([name, label]) => (
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
                    onChange={(_, checked) => {
                      field.onChange(checked)
                      // The Conditional Final choice only exists with a Release.
                      if (name === 'requiresRelease' && !checked) {
                        setValue('finalReleaseScope', '', { shouldDirty: true, shouldValidate: true })
                      }
                    }}
                  />
                )}
              />
            )}
          />
        ))}
      </Box>

      {requiresRelease && (
        <Controller
          name="finalReleaseScope"
          control={control}
          render={({ field }) => (
            <FormControl required error={Boolean(errors.finalReleaseScope)} sx={{ maxWidth: 560 }}>
              <InputLabel id="final-release-scope-label">Conditional Final Release</InputLabel>
              <Select {...field} labelId="final-release-scope-label" label="Conditional Final Release">
                {finalReleaseScopeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {errors.finalReleaseScope?.message
                  ?? 'The last Package of each Phase, Building or Project uses the Conditional Final Release; the others use Conditional Progress.'}
              </FormHelperText>
            </FormControl>
          )}
        />
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ maxWidth: 680 }}>
        <Controller
          name="submissionMethod"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              select
              label="Submitted by"
              onChange={(event) => {
                field.onChange(event)
                if (isNamedSubmissionMethod(event.target.value)) {
                  setValue('submissionDestination', '', { shouldDirty: true, shouldValidate: true })
                }
              }}
              error={Boolean(errors.submissionMethod)}
              helperText={errors.submissionMethod?.message}
              sx={{ width: { xs: '100%', sm: 180 }, flexShrink: 0 }}
            >
              {submissionMethodOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </TextField>
          )}
        />
        {hasDestination && (
          <TextField
            key={submissionMethod}
            label={destination.label}
            type={submissionMethod === 'EMAIL' ? 'email' : 'text'}
            placeholder={destination.placeholder}
            {...register('submissionDestination')}
            error={Boolean(errors.submissionDestination)}
            helperText={errors.submissionDestination?.message ?? destination.helper}
            required={submissionMethod !== 'PORTAL'}
            multiline={submissionMethod === 'MAIL'}
            minRows={submissionMethod === 'MAIL' ? 2 : undefined}
            fullWidth
          />
        )}
      </Stack>

      <Controller
        name="invoiceLineFormat"
        control={control}
        render={({ field }) => (
          <FormControl sx={{ maxWidth: 380 }}>
            <InputLabel id="setup-line-format-label">Invoice lines</InputLabel>
            <Select {...field} labelId="setup-line-format-label" label="Invoice lines">
              {invoiceLineFormatOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      />

      <TextField
        label="Notes"
        {...register('notes')}
        error={Boolean(errors.notes)}
        helperText={errors.notes?.message ?? 'Optional billing instructions'}
        multiline
        minRows={2}
        sx={{ maxWidth: 680 }}
      />
    </Section>
  )
}
