import { Autocomplete, TextField } from '@mui/material'
import {
  ELEVATION_SUGGESTIONS,
  MAX_ELEVATION_LENGTH,
  cleanElevation,
} from '../utils/lotElevation.js'

/**
 * The elevation of a Lot: A to D are offered and any other text can be typed. The text is the value as it is
 * typed, so nothing has to be confirmed with Enter.
 */
export default function LotElevationField({ value, onChange, error, helperText, sx }) {
  return (
    <Autocomplete
      freeSolo
      size="medium"
      options={ELEVATION_SUGGESTIONS}
      value={value || null}
      inputValue={value ?? ''}
      onInputChange={(_, next) => onChange(cleanElevation(next))}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Elevation"
          error={error}
          helperText={helperText}
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps?.htmlInput, maxLength: MAX_ELEVATION_LENGTH },
          }}
        />
      )}
    />
  )
}
