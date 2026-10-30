import { useRef } from 'react'
import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { Controller, useFormContext, useWatch } from 'react-hook-form'
import { frequencyOptions, weekdayOptions } from '../../data/builderDrawSchedules.js'
import { computeDrawPeriods, formatPeriodDate } from '../../utils/drawPeriods.js'
import { Section } from './formParts.jsx'
import numberSlots from './numberSlots.jsx'

const RHYTHM_TEXT = {
  FIXED: 'Packages are cut off on fixed dates. Package Suggestions shows the work billable at the next cutoff.',
  ANY: 'Packages can be made on any date. Create Package preselects the highest-value rolling 14-day window of open Calendar work through today, plus any older work still unbilled.',
}

function PeriodsPreview() {
  const { control } = useFormContext()
  const [frequency, cutoffDay, cutoffDays, cutoffWeekday, paymentTermsDays] = useWatch({
    control,
    name: ['frequency', 'cutoffDay', 'cutoffDays', 'cutoffWeekday', 'paymentTermsDays'],
  })
  const periods = computeDrawPeriods({
    frequency,
    anyDate: false,
    cutoffDay: Number(cutoffDay) || 1,
    cutoffWeekday: Number(cutoffWeekday) || 0,
    cutoffDays: (cutoffDays ?? []).map(Number).filter(Boolean),
    paymentTermsDays: Number(paymentTermsDays) || 0,
  }, 3)

  if (periods.length === 0) return null

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          columnGap: 1.5,
          px: 1.5,
          py: 0.75,
          bgcolor: 'action.hover',
        }}
      >
        {['Cutoff', 'Invoice dated', 'Payment about'].map((heading) => (
          <Typography key={heading} variant="caption" color="text.secondary" fontWeight={700}>
            {heading}
          </Typography>
        ))}
      </Box>
      {periods.map((period) => (
        <Box
          key={period.key}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            columnGap: 1.5,
            px: 1.5,
            py: 0.75,
            borderTop: 1,
            borderColor: 'divider',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Typography variant="body2" fontWeight={700}>{formatPeriodDate(period.cutoffDate)}</Typography>
          <Typography variant="body2">{formatPeriodDate(period.invoiceDate)}</Typography>
          <Typography variant="body2">{formatPeriodDate(period.estimatedPaymentDate)}</Typography>
        </Box>
      ))}
    </Box>
  )
}

export default function CycleSection() {
  const { control, register, setValue, formState: { errors } } = useFormContext()
  const anyDate = Boolean(useWatch({ control, name: 'anyDate' }))
  const frequency = useWatch({ control, name: 'frequency' })
  const cutoffDay = useWatch({ control, name: 'cutoffDay' })
  // Any date is a monthly setup with no cutoff; the frequency it had is back when it is turned off.
  const fixedFrequency = useRef(frequency === 'MONTHLY' || frequency === 'SEMIMONTHLY' || frequency === 'WEEKLY' ? frequency : 'MONTHLY')
  const rhythm = anyDate ? 'ANY' : 'FIXED'
  const touch = { shouldDirty: true, shouldValidate: true }

  const handleRhythm = (_, next) => {
    if (!next || next === rhythm) return

    if (next === 'ANY') {
      fixedFrequency.current = frequency
      setValue('anyDate', true, touch)
      setValue('frequency', 'MONTHLY', touch)
      return
    }

    setValue('anyDate', false, touch)
    setValue('frequency', fixedFrequency.current, touch)
    if (!Number.isInteger(Number(cutoffDay))) setValue('cutoffDay', 1, touch)
  }

  return (
    <Section
      id="cycle"
      title="Billing cycle"
      hint="When Packages are cut off, and when the builder pays."
    >
      <Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          color="primary"
          value={rhythm}
          onChange={handleRhythm}
          aria-label="How Packages are cut off"
        >
          <ToggleButton value="FIXED" sx={{ px: 2, textTransform: 'none' }}>Fixed cutoff</ToggleButton>
          <ToggleButton value="ANY" sx={{ px: 2, textTransform: 'none' }}>Any date</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 560 }}>
          {RHYTHM_TEXT[rhythm]}
        </Typography>
      </Box>

      {!anyDate && (
        <Controller
          name="frequency"
          control={control}
          render={({ field }) => (
            <FormControl sx={{ maxWidth: 280 }}>
              <InputLabel id="setup-frequency-label">Frequency</InputLabel>
              <Select {...field} labelId="setup-frequency-label" label="Frequency">
                {frequencyOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        />
      )}

      {!anyDate && frequency === 'MONTHLY' && (
        <TextField
          label="Cutoff day"
          type="number"
          required
          {...register('cutoffDay')}
          error={Boolean(errors.cutoffDay)}
          helperText={errors.cutoffDay?.message ?? 'Day of the month'}
          sx={{ maxWidth: 280 }}
          slotProps={numberSlots({ min: 1, max: 31, step: 1, unit: null, inputMode: 'numeric' })}
        />
      )}

      {!anyDate && frequency === 'SEMIMONTHLY' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ maxWidth: 580 }}>
          <TextField
            label="First cutoff day"
            type="number"
            required
            {...register('cutoffDays.0')}
            error={Boolean(errors.cutoffDays)}
            helperText={errors.cutoffDays?.message ?? 'Day of the month'}
            fullWidth
            slotProps={numberSlots({ min: 1, max: 31, step: 1, unit: null, inputMode: 'numeric' })}
          />
          <TextField
            label="Second cutoff day"
            type="number"
            required
            {...register('cutoffDays.1')}
            error={Boolean(errors.cutoffDays)}
            helperText="Day of the month"
            fullWidth
            slotProps={numberSlots({ min: 1, max: 31, step: 1, unit: null, inputMode: 'numeric' })}
          />
        </Stack>
      )}

      {!anyDate && frequency === 'WEEKLY' && (
        <Controller
          name="cutoffWeekday"
          control={control}
          render={({ field }) => (
            <FormControl sx={{ maxWidth: 280 }}>
              <InputLabel id="setup-weekday-label">Cutoff weekday</InputLabel>
              <Select {...field} labelId="setup-weekday-label" label="Cutoff weekday">
                {weekdayOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        />
      )}

      <TextField
        label="Payment terms"
        type="number"
        required
        {...register('paymentTermsDays')}
        error={Boolean(errors.paymentTermsDays)}
        helperText={errors.paymentTermsDays?.message ?? 'Days after the invoice date'}
        sx={{ maxWidth: 280 }}
        slotProps={numberSlots({ min: 0, max: 180, step: 1, unit: 'days', inputMode: 'numeric' })}
      />

      {!anyDate && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Work is accepted through the cutoff date, and the invoice carries that date. The next
            three:
          </Typography>
          <PeriodsPreview />
        </Box>
      )}
    </Section>
  )
}
