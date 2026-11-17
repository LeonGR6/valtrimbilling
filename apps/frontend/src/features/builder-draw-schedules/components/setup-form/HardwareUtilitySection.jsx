import {
  Alert,
  Box,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useFormContext, useWatch } from 'react-hook-form'
import {
  drawEventTypeOptions,
  emptyHardwareEventPercentages,
  emptyUtilityEventPercentages,
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
  const utilityPercentages = useWatch({ control, name: 'utilityEventPercentages' }) ?? {}
  const utilityIsUnset = drawEventTypeOptions.every(
    ({ value }) => (Number(utilityPercentages[value]) || 0) === 0,
  )
  const touch = { shouldDirty: true, shouldValidate: true }

  return (
    <Section
      id="hardware"
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
          // Like Hardware, the Utility starts as 100% on one event: the first Draw's, or DM.
          const firstEvent = draws.find((draw) => draw.eventType)?.eventType ?? 'DM'
          setValue('utilityBillingMode', checked ? 'BY_EVENT' : 'FULL', touch)
          setValue(
            'utilityEventPercentages',
            checked
              ? { ...emptyUtilityEventPercentages, [firstEvent]: 100 }
              : { ...emptyUtilityEventPercentages },
            touch,
          )
        }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Split 100% of each Utility row&apos;s Plan price across Calendar events, or put 100% on
          one. They do not need to be Draws.
        </Typography>
        {utilityIsUnset && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            This setup charged the Utility 100% in one package. Choose the Calendar event(s) that
            bill it now; it is needed to save.
          </Alert>
        )}
        <EventAllocation
          name="utilityEventPercentages"
          events={drawEventTypeOptions}
          labelSuffix="Utility"
          helperFor={(value) => `${value} Calendar event`}
        />
      </ToggleRow>
    </Section>
  )
}
