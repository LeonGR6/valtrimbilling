import {
  Alert,
  Box,
  FormControlLabel,
  LinearProgress,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Controller, useFormContext, useWatch } from 'react-hook-form'
import {
  drawEventTypeOptions,
  emptyHardwareEventPercentages,
  emptyUtilityEventPercentages,
  utilityBillingModeOptions,
} from '../../data/builderDrawSchedules.js'
import { formatSetupPercentage } from '../../utils/setupSummary.js'
import { Section, ToggleRow } from './formParts.jsx'
import numberSlots from './numberSlots.jsx'

/** A percentage for each Calendar event that has to add up to 100%. */
function EventAllocation({ name, events, labelSuffix, helperFor }) {
  const { control, register, formState: { errors } } = useFormContext()
  const values = useWatch({ control, name }) ?? {}
  const total = events.reduce((sum, { value }) => sum + (Number(values[value]) || 0), 0)
  const isValid = Math.abs(total - 100) <= 0.001

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
        {events.map(({ value, label }) => (
          <TextField
            key={value}
            label={`${label} ${labelSuffix}`}
            type="number"
            {...register(`${name}.${value}`)}
            error={Boolean(errors[name]?.[value])}
            helperText={errors[name]?.[value]?.message ?? helperFor(value)}
            fullWidth
            slotProps={numberSlots()}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1.25, justifyContent: 'space-between' }} aria-live="polite">
        <Typography variant="caption" color={isValid ? 'success.main' : 'error.main'}>
          {errors[name]?.message
            ?? (isValid
              ? `${labelSuffix} allocation ready`
              : `${labelSuffix} event percentages must total 100%.`)}
        </Typography>
        <Typography variant="caption" fontWeight={850} color={isValid ? 'success.main' : 'error.main'}>
          {formatSetupPercentage(Math.round(total * 1000) / 1000)}%
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(Math.max(total, 0), 100)}
        color={isValid ? 'success' : 'error'}
        sx={{ height: 6, borderRadius: 999, mt: 0.5 }}
      />
    </Box>
  )
}

export default function HardwareUtilitySection() {
  const { control, setValue } = useFormContext()
  const draws = useWatch({ control, name: 'draws' }) ?? []
  const utilityMode = useWatch({ control, name: 'utilityBillingMode' })
  const drawEvents = new Set(draws.map((draw) => draw.eventType).filter(Boolean))
  const touch = { shouldDirty: true, shouldValidate: true }

  return (
    <Section
      title="Hardware and Utility"
      hint="Two things this builder may price apart from the Plan."
    >
      <ToggleRow
        name="separateHardwarePrice"
        label="Separate Hardware price"
        description="Off: Hardware is part of the Plan price. On: each Lot's Hardware price is billed on its own."
        onChange={(checked) => {
          setValue('hardwareBillingMode', checked ? 'BY_EVENT' : 'FULL', touch)
          setValue(
            'hardwareEventPercentages',
            checked ? { EXT: 0, DM: 0, HW: 100 } : { ...emptyHardwareEventPercentages },
            touch,
          )
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Split 100% of each Lot&apos;s Hardware price across Calendar events. They do not need
          to be Draws.
        </Typography>
        <EventAllocation
          name="hardwareEventPercentages"
          events={drawEventTypeOptions}
          labelSuffix="Hardware"
          helperFor={(value) => `${value} Calendar event`}
        />
      </ToggleRow>

      <ToggleRow
        name="utilityBuilding"
        label="Utility Building"
        description="The builder has buildings whose Plans are Utility rows, billed apart from the houses."
        onChange={(checked) => {
          if (checked) return
          setValue('utilityBillingMode', 'FULL', touch)
          setValue('utilityEventPercentages', { ...emptyUtilityEventPercentages }, touch)
        }}
      >
        <Controller
          name="utilityBillingMode"
          control={control}
          render={({ field }) => (
            <RadioGroup
              {...field}
              onChange={(event) => {
                field.onChange(event.target.value)
                if (event.target.value === 'FULL') {
                  setValue('utilityEventPercentages', { ...emptyUtilityEventPercentages }, touch)
                }
              }}
            >
              {utilityBillingModeOptions.map((option) => (
                <FormControlLabel
                  key={option.value}
                  value={option.value}
                  control={<Radio size="small" />}
                  label={option.label}
                />
              ))}
            </RadioGroup>
          )}
        />
        {utilityMode === 'FULL' ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            Create Package shows one Charge checkbox per Utility row. Checking it adds 100% of
            that row&apos;s Plan price.
          </Alert>
        ) : (
          <Box sx={{ mt: 1.5 }}>
            <EventAllocation
              name="utilityEventPercentages"
              events={drawEventTypeOptions.filter(({ value }) => drawEvents.has(value))}
              labelSuffix="Utility"
              helperFor={(value) => draws
                .flatMap((draw, index) => (draw.eventType === value ? [`Draw ${index + 1}`] : []))
                .join(', ')}
            />
          </Box>
        )}
      </ToggleRow>
    </Section>
  )
}
