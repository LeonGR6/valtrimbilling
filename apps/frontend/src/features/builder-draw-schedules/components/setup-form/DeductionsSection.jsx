import { FormControl, InputLabel, MenuItem, Select, Stack, TextField } from '@mui/material'
import { Controller, useFormContext, useWatch } from 'react-hook-form'
import { retentionReleaseScopeOptions } from '../../data/builderDrawSchedules.js'
import {
  percentageFromFraction,
  WRAP_PERCENTAGE_MAX,
  WRAP_PERCENTAGE_MIN,
} from '../../schemas/builderDrawScheduleSchema.js'
import { Section, ToggleRow } from './formParts.jsx'
import numberSlots from './numberSlots.jsx'

export default function DeductionsSection() {
  const { control, register, setValue, formState: { errors } } = useFormContext()
  const retentionTyped = useWatch({ control, name: 'retentionPercentage' })

  // Retention is read as a percentage; 0.0833 means 8.33%, and the field says so once it is left.
  const retentionField = register('retentionPercentage')
  const retentionInput = {
    ...retentionField,
    onBlur: (event) => {
      retentionField.onBlur(event)
      const percentage = percentageFromFraction(event.target.value)
      if (percentage !== null) {
        setValue('retentionPercentage', percentage, { shouldValidate: true, shouldDirty: true })
      }
    },
  }
  const typedFraction = percentageFromFraction(retentionTyped)

  return (
    <Section
      title="Deductions"
      hint="What the builder holds back from every Package."
    >
      <ToggleRow
        name="retentionEnabled"
        label="Retention"
        description="A percentage withheld from every Package line and released later."
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ maxWidth: 580 }}>
          <TextField
            label="Retention percentage"
            type="number"
            {...retentionInput}
            error={Boolean(errors.retentionPercentage)}
            helperText={
              errors.retentionPercentage?.message
              ?? (typedFraction === null
                ? 'A fraction such as 0.0833 is read as 8.33%'
                : `${retentionTyped} is read as ${typedFraction}%`)
            }
            required
            fullWidth
            slotProps={numberSlots({ min: 1 })}
          />
          <Controller
            name="retentionReleaseScope"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth>
                <InputLabel id="retention-release-scope-label">Released</InputLabel>
                <Select {...field} labelId="retention-release-scope-label" label="Released">
                  {retentionReleaseScopeOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />
        </Stack>
      </ToggleRow>

      <ToggleRow
        name="ocipWrapEnabled"
        label="OCIP / WRAP insurance"
        description="A small percentage the builder deducts for its insurance program."
      >
        <TextField
          label="OCIP / WRAP percentage"
          type="number"
          {...register('ocipWrapPercentage')}
          error={Boolean(errors.ocipWrapPercentage)}
          helperText={errors.ocipWrapPercentage?.message ?? `From ${WRAP_PERCENTAGE_MIN}% to ${WRAP_PERCENTAGE_MAX}%`}
          required
          sx={{ maxWidth: 280 }}
          slotProps={numberSlots({ min: WRAP_PERCENTAGE_MIN, max: WRAP_PERCENTAGE_MAX, step: 0.001 })}
        />
      </ToggleRow>
    </Section>
  )
}
