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

export default function UtilityRowEditor({ index, job, control, register, errors, remove, canRemove }) {
  const utilityName = useWatch({ control, name: `lots.${index}.utilityName` })
  const displayName = utilityName?.trim() || 'Utility Building'

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
        <Typography variant="subtitle2" fontWeight={750}>
          {displayName}
        </Typography>
        <Tooltip title={canRemove ? 'Remove Utility row' : 'A Phase needs at least one row'}>
          <span>
            <IconButton
              size="small"
              color="error"
              disabled={!canRemove}
              onClick={() => remove(index)}
              aria-label={`Remove ${displayName}`}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ p: 2, alignItems: { md: 'flex-start' } }}
      >
        <TextField
          fullWidth
          label="Utility name"
          placeholder="Example: B1"
          {...register(`lots.${index}.utilityName`)}
          error={Boolean(errors.lots?.[index]?.utilityName)}
          helperText={errors.lots?.[index]?.utilityName?.message ?? 'This name appears on the Sequence Sheet and Draw Packages.'}
          slotProps={{ htmlInput: { maxLength: 80 } }}
        />
        <Controller
          name={`lots.${index}.planId`}
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              select
              fullWidth
              label="Plan"
              sx={{ minWidth: { md: 280 } }}
              error={Boolean(errors.lots?.[index]?.planId)}
              helperText={
                errors.lots?.[index]?.planId?.message
                ?? 'The full Plan Price will be charged on the selected Draw.'
              }
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
    </Box>
  )
}
