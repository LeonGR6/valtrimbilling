import { Controller, useWatch } from 'react-hook-form'
import {
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import LotOptionPicker from './LotOptionPicker.jsx'
import { pruneOptionDetails } from '../utils/optionDetails.js'
import LotElevationField from './LotElevationField.jsx'
import { getPlan } from '../utils/sequenceSheetPlans.js'

export default function LotEditor({ index, fieldId, job, control, register, errors, setValue, remove, canRemove }) {
  const lots = useWatch({ control, name: 'lots' })
  const selectedPlan = getPlan(job, lots?.[index]?.planId)
  const planOptions = selectedPlan?.options ?? []
  const optionError = errors.lots?.[index]?.optionIds?.message
  const detailsError = errors.lots?.[index]?.optionDetails?.message
  const optionDetails = lots?.[index]?.optionDetails ?? {}

  return (
    <Box
      sx={{
        border: 1,
        borderColor: errors.lots?.[index] ? 'error.main' : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        sx={{
          px: 2,
          py: 1.25,
          bgcolor: 'action.hover',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontSize: 13,
              fontWeight: 750,
            }}
          >
            {index + 1}
          </Box>
          <Typography variant="subtitle2" fontWeight={750}>
            Lot assignment
          </Typography>
        </Stack>
        <Tooltip title={canRemove ? 'Remove lot' : 'A phase needs at least one lot'}>
          <span>
            <IconButton
              size="small"
              color="error"
              disabled={!canRemove}
              onClick={() => remove(index)}
              aria-label={`Remove lot ${index + 1}`}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Stack spacing={2.25} sx={{ p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'flex-start' } }}
        >
          <TextField
            label="Lot"
            placeholder="Lot #"
            {...register(`lots.${index}.lotNumber`)}
            error={Boolean(errors.lots?.[index]?.lotNumber)}
            helperText={errors.lots?.[index]?.lotNumber?.message ?? 'Required'}
            sx={{ width: { xs: '100%', md: 150 } }}
            slotProps={{ htmlInput: { maxLength: 30 } }}
          />

          <Controller
            name={`lots.${index}.planId`}
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Plan"
                error={Boolean(errors.lots?.[index]?.planId)}
                helperText={
                  errors.lots?.[index]?.planId?.message ??
                  'Plans configured for this Job'
                }
                sx={{ minWidth: { xs: '100%', md: 260 } }}
                onChange={(event) => {
                  field.onChange(event)
                  setValue(`lots.${index}.optionIds`, [], {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                  setValue(`lots.${index}.optionDetails`, {}, { shouldDirty: true })
                }}
              >
                <MenuItem value="">Select a plan</MenuItem>
                {(job.sequenceSheet?.plans ?? []).map((plan) => (
                  <MenuItem key={plan.id} value={plan.id}>
                    {plan.code} · {plan.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <Controller
            name={`lots.${index}.elevation`}
            control={control}
            render={({ field }) => (
              <LotElevationField
                value={field.value}
                onChange={field.onChange}
                error={Boolean(errors.lots?.[index]?.elevation)}
                helperText={errors.lots?.[index]?.elevation?.message ?? 'Optional'}
                sx={{ width: { xs: '100%', md: 130 } }}
              />
            )}
          />

          <Controller
            name={`lots.${index}.reverse`}
            control={control}
            render={({ field }) => (
              <FormControlLabel
                sx={{ mt: { md: 1 }, minWidth: 118 }}
                control={
                  <Checkbox
                    checked={field.value}
                    onChange={(_, checked) => field.onChange(checked)}
                  />
                }
                label="Reverse"
              />
            )}
          />
        </Stack>

        <Box>
          {!selectedPlan || planOptions.length === 0 ? (
            <>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Options for selected plan
              </Typography>
              <Box
                sx={{
                  border: 1,
                  borderColor: optionError ? 'error.main' : 'divider',
                  borderRadius: 1.5,
                  p: 1.5,
                  minHeight: 58,
                  bgcolor: 'action.hover',
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {!selectedPlan
                    ? 'Choose a plan first.'
                    : 'This plan does not have options configured yet.'}
                </Typography>
              </Box>
            </>
          ) : (
            <Controller
              key={`${fieldId}-${selectedPlan.id}`}
              name={`lots.${index}.optionIds`}
              control={control}
              render={({ field }) => (
                <LotOptionPicker
                  options={planOptions}
                  value={field.value ?? []}
                  onChange={(nextIds) => {
                    field.onChange(nextIds)
                    // An Option taken out of the Lot loses its quantity and locations.
                    setValue(
                      `lots.${index}.optionDetails`,
                      pruneOptionDetails(optionDetails, nextIds),
                      { shouldDirty: true },
                    )
                  }}
                  error={Boolean(optionError || detailsError)}
                  details={optionDetails}
                  onDetailsChange={(nextDetails) => setValue(
                    `lots.${index}.optionDetails`,
                    nextDetails,
                    { shouldDirty: true, shouldValidate: true },
                  )}
                />
              )}
            />
          )}
          {(optionError || detailsError) && (
            <Typography variant="caption" color="error" sx={{ ml: 1.75, mt: 0.5, display: 'block' }}>
              {optionError ?? detailsError}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  )
}
