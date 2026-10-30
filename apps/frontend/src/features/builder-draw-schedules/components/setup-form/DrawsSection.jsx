import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import {
  drawEventTypeOptions,
  MAX_DRAW_COUNT,
  MIN_DRAW_COUNT,
} from '../../data/builderDrawSchedules.js'
import { drawSharesEvent } from '../../utils/drawLag.js'
import { formatSetupPercentage } from '../../utils/setupSummary.js'
import DrawBar from '../DrawBar.jsx'
import DrawLagControl from '../DrawLagControl.jsx'
import { Section } from './formParts.jsx'
import numberSlots from './numberSlots.jsx'

export default function DrawsSection() {
  const { control, register, setValue, formState: { errors } } = useFormContext()
  const { fields, append, remove } = useFieldArray({ control, name: 'draws', keyName: 'fieldKey' })
  const draws = useWatch({ control, name: 'draws' }) ?? []
  const optionsValue = useWatch({ control, name: 'optionsBillingDrawIndex' })
  const optionsDraw = optionsValue == null || optionsValue === '' ? null : Number(optionsValue)
  const total = draws.reduce((sum, draw) => sum + (Number(draw?.percentage) || 0), 0)
  const totalIsValid = Math.abs(total - 100) <= 0.001
  const drawsError = errors.draws?.message ?? errors.draws?.root?.message

  const handleRemove = (index) => {
    // The Options Draw and the Utility split follow the Draws that are left.
    if (optionsDraw === index) {
      setValue('optionsBillingDrawIndex', null, { shouldDirty: true, shouldValidate: true })
    } else if (optionsDraw !== null && optionsDraw > index) {
      setValue('optionsBillingDrawIndex', optionsDraw - 1, { shouldDirty: true, shouldValidate: true })
    }

    const removedEvent = draws[index]?.eventType
    const eventStillExists = draws.some((draw, other) => other !== index && draw.eventType === removedEvent)
    if (removedEvent && !eventStillExists) {
      setValue(`utilityEventPercentages.${removedEvent}`, 0, { shouldDirty: true, shouldValidate: true })
    }

    remove(index)
  }

  return (
    <Section
      id="draws"
      title="Draws"
      hint="A Draw is a share of the price billed when its Calendar event happens. They are billed in this order and must add up to 100%."
    >
      <Stack spacing={1.5}>
        {fields.map((field, index) => {
          const fieldErrors = errors.draws?.[index]
          const billsOptions = optionsDraw === index
          const hasLag = drawSharesEvent(draws, index) || draws[index]?.lag

          return (
            <Stack
              key={field.fieldKey}
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: 'flex-start',
                p: 1,
                mx: -1,
                border: 1,
                borderColor: billsOptions ? 'primary.main' : 'transparent',
                borderRadius: 2,
                bgcolor: billsOptions ? 'primary.light' : 'transparent',
                transition: (theme) => theme.transitions.create(['background-color', 'border-color']),
              }}
            >
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  mt: 1.25,
                  fontSize: 13,
                  fontWeight: 750,
                  bgcolor: 'action.selected',
                  color: 'text.primary',
                }}
              >
                {index + 1}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    alignItems: 'start',
                    // On a phone the name takes a line and the other two share the next.
                    gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'minmax(0, 1fr) 150px 130px auto' },
                  }}
                >
                  <TextField
                    label={`Draw ${index + 1} name`}
                    placeholder="Optional, e.g. Trim complete"
                    {...register(`draws.${index}.name`)}
                    error={Boolean(fieldErrors?.name)}
                    helperText={fieldErrors?.name?.message}
                    sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
                  />
                  <TextField
                    label="Percentage"
                    type="number"
                    required
                    {...register(`draws.${index}.percentage`)}
                    error={Boolean(fieldErrors?.percentage)}
                    helperText={fieldErrors?.percentage?.message}
                    slotProps={numberSlots({ min: 1, max: 99 })}
                  />
                  <Controller
                    name={`draws.${index}.eventType`}
                    control={control}
                    render={({ field: eventField }) => (
                      <TextField
                        {...eventField}
                        select
                        required
                        label="Event"
                        error={Boolean(fieldErrors?.eventType)}
                        helperText={fieldErrors?.eventType ? 'Choose an event' : undefined}
                      >
                        <MenuItem value="">Select event</MenuItem>
                        {drawEventTypeOptions.map((eventType) => (
                          <MenuItem key={eventType.value} value={eventType.value}>
                            {eventType.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                  {/* Only one Draw charges the Options: clicking it selects it, clicking it
                      again goes back to "Do not bill Options". */}
                  <FormControlLabel
                    label={(
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2">Charge Options</Typography>
                        {billsOptions && <Chip size="small" color="primary" label="Selected" sx={{ height: 22 }} />}
                      </Stack>
                    )}
                    control={(
                      <Checkbox
                        checked={billsOptions}
                        onChange={(_, checked) => setValue(
                          'optionsBillingDrawIndex',
                          checked ? index : null,
                          { shouldDirty: true, shouldValidate: true },
                        )}
                        slotProps={{ input: { 'aria-label': `Charge Options in Draw ${index + 1}` } }}
                      />
                    )}
                    sx={{ m: 0, minHeight: 56, gridColumn: { xs: '1 / -1', sm: 'auto' } }}
                  />
                </Box>
                {hasLag && (
                  <Stack direction="row" spacing={1} sx={{ mt: 0.75, alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    {hasLag && (
                      <DrawLagControl
                        drawNumber={index + 1}
                        eventType={draws[index]?.eventType}
                        lag={draws[index]?.lag}
                        error={fieldErrors?.lag?.message}
                        onChange={(next) => setValue(`draws.${index}.lag`, next, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })}
                      />
                    )}
                  </Stack>
                )}
              </Box>
              {fields.length > MIN_DRAW_COUNT && (
                <IconButton
                  aria-label={`Remove Draw ${index + 1}`}
                  color="error"
                  onClick={() => handleRemove(index)}
                  sx={{ mt: 0.5 }}
                >
                  <DeleteOutlineRoundedIcon />
                </IconButton>
              )}
            </Stack>
          )
        })}
      </Stack>

      <Box>
        <Button
          type="button"
          size="small"
          startIcon={<AddRoundedIcon />}
          disabled={fields.length >= MAX_DRAW_COUNT}
          onClick={() => append({ name: '', percentage: 0, eventType: '', lag: null })}
        >
          Add draw
        </Button>
        {fields.length >= MAX_DRAW_COUNT && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {MAX_DRAW_COUNT} is the most.
          </Typography>
        )}
      </Box>

      <Box>
        <DrawBar schedule={{ draws }} showTotal={false} />
        <Stack direction="row" sx={{ mt: 0.5, justifyContent: 'space-between' }} aria-live="polite">
          <Typography variant="body2" fontWeight={750} color={totalIsValid ? 'success.main' : 'error.main'}>
            Total {formatSetupPercentage(Math.round(total * 1000) / 1000)}%
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {totalIsValid
              ? 'Adds up to 100%'
              : total < 100
                ? `${formatSetupPercentage(Math.round((100 - total) * 1000) / 1000)}% to go`
                : `${formatSetupPercentage(Math.round((total - 100) * 1000) / 1000)}% over`}
          </Typography>
        </Stack>
        {drawsError && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
            {drawsError}
          </Typography>
        )}
      </Box>

      <Box>
        <FormControlLabel
          label="Do not bill Options"
          control={(
            <Radio
              name="optionsBillingDrawIndex"
              checked={optionsDraw === null}
              onChange={() => setValue('optionsBillingDrawIndex', null, { shouldDirty: true, shouldValidate: true })}
              slotProps={{ input: { 'aria-label': 'Do not bill Options in a Draw' } }}
            />
          )}
          sx={{ m: 0 }}
        />
        {errors.optionsBillingDrawIndex && (
          <Typography variant="caption" color="error" sx={{ display: 'block' }}>
            {errors.optionsBillingDrawIndex.message}
          </Typography>
        )}
      </Box>
    </Section>
  )
}
